import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GeminiError, refineText, testConnection, toBase64, transcribeAudio, looksLikeApiKey } from '../src/shared/gemini';

interface Scripted {
  status: number;
  contentType?: string;
  body: string;
  chunks?: string[];
}

interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  json: Record<string, unknown>;
}

let server: http.Server;
let baseUrl = '';
let queue: Scripted[] = [];
let recorded: Recorded[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      recorded.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      const next = queue.shift() ?? { status: 500, body: '{"error":{"message":"no script"}}' };
      res.statusCode = next.status;
      res.setHeader('content-type', next.contentType ?? 'application/json');
      if (next.chunks) {
        for (const chunk of next.chunks) res.write(chunk);
        res.end();
      } else {
        res.end(next.body);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/v1beta`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  queue = [];
  recorded = [];
});

const completed = (text: string) =>
  JSON.stringify({ id: 'v1_test', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] });

describe('transcribeAudio', () => {
  it('sends inline WAV audio with smart mode, vocabulary and the API key header', async () => {
    queue.push({ status: 200, body: completed('Hello from the test.') });
    const wav = new Uint8Array([82, 73, 70, 70, 0, 1, 2, 255]);
    const text = await transcribeAudio({
      apiKey: 'AIzaSyTESTKEY1234567890abcdef',
      baseUrl,
      wav,
      mode: 'smart',
      vocabulary: ['AuraFlow', 'Kubernetes'],
      languageCode: 'en-US',
      maxRetries: 0,
    });

    expect(text).toBe('Hello from the test.');
    expect(recorded).toHaveLength(1);
    const [request] = recorded;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1beta/interactions');
    expect(request.headers['x-goog-api-key']).toBe('AIzaSyTESTKEY1234567890abcdef');
    expect(request.url).not.toContain('key=');

    const body = request.json as {
      model: string;
      input: { type: string; data: string; mime_type: string }[];
      generation_config: { transcription_config: Record<string, unknown> };
      store: boolean;
    };
    expect(body.model).toBe('gemini-3.5-transcribe');
    expect(body.store).toBe(false);
    expect(body.input[0].type).toBe('audio');
    expect(body.input[0].mime_type).toBe('audio/wav');
    expect(Buffer.from(body.input[0].data, 'base64')).toEqual(Buffer.from(wav));
    expect(body.generation_config.transcription_config).toEqual({
      mode: 'smart',
      language_codes: ['en-US'],
      custom_vocabulary: ['AuraFlow', 'Kubernetes'],
    });
  });

  it('uses verbatim mode and omits empty optional fields', async () => {
    queue.push({ status: 200, body: completed('um hello') });
    await transcribeAudio({ apiKey: 'AIzaSyTESTKEY1234567890abcdef', baseUrl, wav: new Uint8Array(4), mode: 'verbatim', maxRetries: 0 });
    const config = (recorded[0].json as { generation_config: { transcription_config: Record<string, unknown> } }).generation_config.transcription_config;
    expect(config).toEqual({ mode: { type: 'verbatim' } });
  });

  it('retries once on HTTP 429 and then succeeds', async () => {
    queue.push({ status: 429, body: JSON.stringify({ error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }) });
    queue.push({ status: 200, body: completed('second try') });
    const text = await transcribeAudio({
      apiKey: 'AIzaSyTESTKEY1234567890abcdef',
      baseUrl,
      wav: new Uint8Array(4),
      mode: 'smart',
      retryDelayMs: () => 0,
    });
    expect(text).toBe('second try');
    expect(recorded).toHaveLength(2);
  });

  it('maps an invalid key to a clear message without retrying', async () => {
    queue.push({ status: 403, body: JSON.stringify({ error: { message: 'API key not valid', status: 'PERMISSION_DENIED' } }) });
    const error = await transcribeAudio({ apiKey: 'AIzaSyBADKEY1234567890abcdef', baseUrl, wav: new Uint8Array(4), mode: 'smart', retryDelayMs: () => 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeminiError);
    expect((error as GeminiError).message).toContain('API key');
    expect((error as GeminiError).status).toBe(403);
    expect((error as GeminiError).retryable).toBe(false);
    expect(recorded).toHaveLength(1);
  });

  it('surfaces the API message for bad requests', async () => {
    queue.push({ status: 400, body: JSON.stringify({ error: { message: 'Unsupported audio format' } }) });
    const error = (await transcribeAudio({ apiKey: 'AIzaSyTESTKEY1234567890abcdef', baseUrl, wav: new Uint8Array(4), mode: 'smart', maxRetries: 0 }).catch((e: unknown) => e)) as GeminiError;
    expect(error.message).toContain('Unsupported audio format');
    expect(error.status).toBe(400);
  });

  it('reports network failures as retryable GeminiErrors', async () => {
    const error = (await transcribeAudio({
      apiKey: 'AIzaSyTESTKEY1234567890abcdef',
      baseUrl: 'http://127.0.0.1:1/v1beta',
      wav: new Uint8Array(4),
      mode: 'smart',
      maxRetries: 1,
      retryDelayMs: () => 0,
    }).catch((e: unknown) => e)) as GeminiError;
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('Could not reach Gemini');
  });

  it('honours cancellation before sending', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = (await transcribeAudio({ apiKey: 'AIzaSyTESTKEY1234567890abcdef', baseUrl, wav: new Uint8Array(4), mode: 'smart', signal: controller.signal }).catch((e: unknown) => e)) as GeminiError;
    expect(error.reason).toBe('cancelled');
    expect(recorded).toHaveLength(0);
  });
});

describe('refineText', () => {
  it('streams text deltas over SSE and returns the full text', async () => {
    const chunks = [
      'event: interaction.created\ndata: {"event_type":"interaction.created"}\n\n',
      'event: step.delta\ndata: {"index":0,"delta":{"type":"text","text":"Hello, "},"event_type":"step.delta"}\n\nevent: step.de',
      'lta\ndata: {"index":0,"delta":{"type":"text","text":"world."},"event_type":"step.delta"}\n\n',
      'event: done\ndata: [DONE]\n\n',
    ];
    queue.push({ status: 200, contentType: 'text/event-stream', body: '', chunks });
    const seen: string[] = [];
    const text = await refineText({
      apiKey: 'AIzaSyTESTKEY1234567890abcdef',
      baseUrl,
      model: 'gemini-3.5-flash-lite',
      systemInstruction: 'Edit it.',
      userText: 'raw words',
      onDelta: (_delta, full) => seen.push(full),
      maxRetries: 0,
    });

    expect(text).toBe('Hello, world.');
    expect(seen).toEqual(['Hello, ', 'Hello, world.']);
    const body = recorded[0].json as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.system_instruction).toBe('Edit it.');
    expect(body.generation_config).toEqual({ thinking_level: 'minimal' });
    expect(body.input).toEqual([{ type: 'text', text: 'raw words' }]);
  });

  it('uses the completed interaction when the stream carries no deltas', async () => {
    const completed = JSON.stringify({
      event_type: 'interaction.completed',
      interaction: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Whole answer.' }] }] },
    });
    queue.push({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
      chunks: [`event: interaction.completed\ndata: ${completed}\n\n`, 'event: done\ndata: [DONE]\n\n'],
    });
    const seen: string[] = [];
    const text = await refineText({
      apiKey: 'AIzaSyTESTKEY1234567890abcdef',
      baseUrl,
      model: 'gemini-3.5-flash-lite',
      systemInstruction: 'x',
      userText: 'y',
      onDelta: (_delta, full) => seen.push(full),
      maxRetries: 0,
    });
    expect(text).toBe('Whole answer.');
    expect(seen).toEqual(['Whole answer.']);
  });

  it('uses the non-streaming path when no delta callback is given', async () => {
    queue.push({ status: 200, body: completed('Polished.') });
    const text = await refineText({ apiKey: 'AIzaSyTESTKEY1234567890abcdef', baseUrl, model: 'gemini-3.8-flash', systemInstruction: 'x', userText: 'y', maxRetries: 0 });
    expect(text).toBe('Polished.');
    expect((recorded[0].json as Record<string, unknown>).generation_config).toEqual({ thinking_level: 'low' });
  });

  it('turns stream error events into GeminiErrors', async () => {
    queue.push({ status: 200, contentType: 'text/event-stream', body: '', chunks: ['event: error\ndata: {"event_type":"error","error":{"message":"overloaded"}}\n\n'] });
    const error = (await refineText({ apiKey: 'AIzaSyTESTKEY1234567890abcdef', baseUrl, model: 'gemini-3.5-flash', systemInstruction: 'x', userText: 'y', onDelta: () => undefined, maxRetries: 0 }).catch((e: unknown) => e)) as GeminiError;
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.message).toContain('overloaded');
  });
});

describe('testConnection', () => {
  it('round-trips a tiny prompt and reports latency', async () => {
    queue.push({ status: 200, body: completed('OK') });
    const result = await testConnection({ apiKey: 'AIzaSyTESTKEY1234567890abcdef', baseUrl, model: 'gemini-3.5-flash-lite', maxRetries: 0 });
    expect(result.reply).toBe('OK');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect((recorded[0].json as { store: boolean }).store).toBe(false);
  });
});

describe('helpers', () => {
  it('encodes large buffers to base64 correctly', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(Buffer.from(toBase64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });

  it('recognises plausible API keys and rejects obvious paste errors', () => {
    expect(looksLikeApiKey('AIzaSyD-1234567890abcdefghijklmnop')).toBe(true);
    expect(looksLikeApiKey('short')).toBe(false);
    expect(looksLikeApiKey('AIza with spaces inside the key')).toBe(false);
  });
});
