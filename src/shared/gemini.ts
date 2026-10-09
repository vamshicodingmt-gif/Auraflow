/**
 * Minimal Gemini client built on the Interactions API
 * (POST {base}/interactions). Works in Node/Electron main processes and in browsers.
 *
 *  - transcribeAudio(): gemini-3.5-transcribe on inline 16 kHz WAV audio
 *  - refineText():      text model with optional SSE streaming for live output
 *  - testConnection():  tiny round-trip used by the "Test key" button
 */
import { parseSseBuffer, flushSseRemainder, type SseEvent } from './sse';
import { transcriptionHints } from './prompts';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';

/** Thinking budget per refinement model, taken from the Gemini thinking-level table. */
export const THINKING_LEVEL_BY_MODEL: Record<string, 'minimal' | 'low'> = {
  'gemini-3.5-flash-lite': 'minimal',
  'gemini-3.5-flash': 'minimal',
  'gemini-3.8-flash': 'low',
};

export class GeminiError extends Error {
  readonly status: number | null;
  readonly reason: string | null;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number | null; reason?: string | null; retryable?: boolean } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = options.status ?? null;
    this.reason = options.reason ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export interface GeminiRequestOptions {
  apiKey: string;
  /** Defaults to globalThis.fetch. Electron callers pass net.fetch for proxy support. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: (attempt: number) => number;
  signal?: AbortSignal;
}

export interface TranscribeOptions extends GeminiRequestOptions {
  wav: Uint8Array;
  mode: 'smart' | 'verbatim';
  vocabulary?: readonly string[];
  languageCode?: string;
  model?: string;
}

export interface RefineOptions extends GeminiRequestOptions {
  model: string;
  systemInstruction: string;
  userText: string;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  onDelta?: (delta: string, fullText: string) => void;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Pulls the model's text out of an Interactions resource (non-streaming or completed). */
export function extractInteractionText(interaction: unknown): string {
  if (typeof interaction !== 'object' || interaction === null) return '';
  const record = interaction as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  const steps = Array.isArray(record.steps) ? record.steps : [];
  let text = '';
  for (const step of steps) {
    if (typeof step !== 'object' || step === null) continue;
    const s = step as Record<string, unknown>;
    if (s.type !== 'model_output' || !Array.isArray(s.content)) continue;
    for (const part of s.content) {
      if (typeof part !== 'object' || part === null) continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'text' && typeof p.text === 'string') text += p.text;
    }
  }
  return text;
}

export function looksLikeApiKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length >= 20 && trimmed.length <= 200 && /^[\x21-\x7e]+$/.test(trimmed);
}

function defaultRetryDelay(attempt: number): number {
  return [700, 1800, 4000][Math.min(attempt, 2)];
}

function friendlyHttpMessage(status: number, apiMessage: string): string {
  if (status === 400) return `Gemini rejected the request${apiMessage ? `: ${apiMessage}` : '.'}`;
  if (status === 401 || status === 403) return 'Gemini rejected your API key. Check it in Settings.';
  if (status === 404) return `That Gemini model is not available to this key${apiMessage ? ` (${apiMessage})` : ''}.`;
  if (status === 429) return 'Gemini rate limit or quota reached. Wait a moment and try again.';
  if (status >= 500) return 'Gemini is temporarily unavailable. Try again in a moment.';
  return apiMessage || `Gemini request failed (HTTP ${status}).`;
}

async function readHttpError(response: Response): Promise<GeminiError> {
  let apiMessage = '';
  let reason: string | null = null;
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; status?: string } };
      apiMessage = parsed.error?.message ?? '';
      reason = parsed.error?.status ?? null;
    } catch {
      apiMessage = text.slice(0, 200);
    }
  } catch {
    // Body unreadable; fall back to the generic message.
  }
  const status = response.status;
  const retryable = status === 429 || status >= 500;
  return new GeminiError(friendlyHttpMessage(status, apiMessage), { status, reason, retryable });
}

function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  return AbortSignal.any(active);
}

async function postInteraction(body: unknown, options: GeminiRequestOptions, stream: boolean): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = options.baseUrl ?? GEMINI_API_BASE;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelay = options.retryDelayMs ?? defaultRetryDelay;
  const timeoutMs = options.timeoutMs ?? 90_000;

  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw new GeminiError('Dictation was cancelled.', { reason: 'cancelled' });
    const signal = combineSignals([options.signal, AbortSignal.timeout(timeoutMs)]);
    let response: Response;
    try {
      response = await fetchImpl(`${base}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': options.apiKey,
          Accept: stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new GeminiError('Dictation was cancelled.', { reason: 'cancelled' });
      if (attempt < maxRetries) {
        await sleep(retryDelay(attempt));
        continue;
      }
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new GeminiError(
        timedOut ? 'Gemini took too long to respond. Try a shorter dictation.' : 'Could not reach Gemini. Check your internet connection.',
        { retryable: true, reason: timedOut ? 'timeout' : 'network' },
      );
    }

    if (response.ok) return response;
    const error = await readHttpError(response);
    if (error.retryable && attempt < maxRetries) {
      await sleep(retryDelay(attempt));
      continue;
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function transcribeAudio(options: TranscribeOptions): Promise<string> {
  const transcriptionConfig: Record<string, unknown> = {
    mode: options.mode === 'smart' ? 'smart' : { type: 'verbatim' },
  };
  if (options.languageCode) transcriptionConfig.language_codes = [options.languageCode];
  const hints = transcriptionHints(options.vocabulary ?? []);
  if (hints.length > 0) transcriptionConfig.custom_vocabulary = hints;

  const body = {
    model: options.model ?? TRANSCRIBE_MODEL,
    input: [{ type: 'audio', data: toBase64(options.wav), mime_type: 'audio/wav' }],
    generation_config: { transcription_config: transcriptionConfig },
    store: false,
  };

  const response = await postInteraction(body, { timeoutMs: 150_000, ...options }, false);
  const json: unknown = await response.json();
  assertNotFailed(json);
  return extractInteractionText(json).trim();
}

function assertNotFailed(json: unknown): void {
  if (typeof json !== 'object' || json === null) return;
  const record = json as Record<string, unknown>;
  if (record.status === 'failed') {
    const error = record.error as { message?: string } | undefined;
    throw new GeminiError(error?.message ? `Gemini could not process the request: ${error.message}` : 'Gemini could not process the request.', {
      reason: 'failed',
    });
  }
}

type StreamHandler = (event: SseEvent) => 'done' | void;

async function consumeEventStream(body: ReadableStream<Uint8Array>, onDelta?: RefineOptions['onDelta']): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let finished = false;

  const handle: StreamHandler = (event) => {
    if (event.data === '[DONE]') return 'done';
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = (payload.event_type as string | undefined) ?? event.event ?? '';
    if (type === 'error' || type === 'interaction.failed') {
      const error = (payload.error as { message?: string } | undefined) ?? undefined;
      throw new GeminiError(error?.message ? `Gemini stream error: ${error.message}` : 'Gemini stream failed.', { reason: 'stream' });
    }
    if (type === 'step.delta') {
      const delta = payload.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === 'text' && typeof delta.text === 'string' && delta.text.length > 0) {
        full += delta.text;
        onDelta?.(delta.text, full);
      }
    }
    if (type === 'interaction.completed' && full.length === 0) {
      // Some responses arrive whole, with no incremental deltas: use the completed output.
      const text = extractInteractionText(payload.interaction).trim();
      if (text) {
        full = text;
        onDelta?.(text, text);
      }
    }
    return undefined;
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (handle(event) === 'done') {
          finished = true;
          break;
        }
      }
    }
    buffer += decoder.decode();
    if (!finished) {
      for (const event of flushSseRemainder(buffer)) {
        if (handle(event) === 'done') break;
      }
    }
  } catch (error) {
    // Release the HTTP connection before surfacing the failure.
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return full.trim();
}

export async function refineText(options: RefineOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    input: [{ type: 'text', text: options.userText }],
    system_instruction: options.systemInstruction,
    generation_config: { thinking_level: options.thinkingLevel ?? THINKING_LEVEL_BY_MODEL[options.model] ?? 'minimal' },
    store: false,
  };

  if (!options.onDelta) {
    const response = await postInteraction(body, { timeoutMs: 60_000, ...options }, false);
    const json: unknown = await response.json();
    assertNotFailed(json);
    return extractInteractionText(json).trim();
  }

  body.stream = true;
  const response = await postInteraction(body, { timeoutMs: 60_000, ...options }, true);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    const json: unknown = await response.json();
    assertNotFailed(json);
    const text = extractInteractionText(json).trim();
    if (text) options.onDelta(text, text);
    return text;
  }
  return consumeEventStream(response.body, options.onDelta);
}

export interface ConnectionTestResult {
  model: string;
  latencyMs: number;
  reply: string;
}

/** Cheap round-trip that proves the key works and the chosen model is reachable. */
export async function testConnection(options: GeminiRequestOptions & { model: string }): Promise<ConnectionTestResult> {
  const started = Date.now();
  const response = await postInteraction(
    {
      model: options.model,
      input: [{ type: 'text', text: 'Reply with the single word: OK' }],
      generation_config: { thinking_level: THINKING_LEVEL_BY_MODEL[options.model] ?? 'minimal' },
      store: false,
    },
    { timeoutMs: 30_000, ...options },
    false,
  );
  const json: unknown = await response.json();
  assertNotFailed(json);
  const reply = extractInteractionText(json).trim();
  if (!reply) {
    throw new GeminiError('Gemini answered without any text. Try a different refinement model.', { reason: 'empty' });
  }
  return { model: options.model, latencyMs: Date.now() - started, reply: reply.slice(0, 80) };
}
