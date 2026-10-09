import { DEFAULT_HOTKEY, isValidAccelerator } from './hotkey';
import {
  MAX_RECORDING_OPTIONS,
  OUTPUT_STYLES,
  PILL_PLACEMENTS,
  REFINE_MODEL_IDS,
  type OutputStyle,
  type PillPlacement,
  type RefineModelId,
  type Settings,
} from './types';

export const MAX_VOCABULARY_TERMS = 100;
export const MAX_VOCABULARY_TERM_LENGTH = 60;

export const DEFAULT_SETTINGS: Settings = {
  hotkey: DEFAULT_HOTKEY,
  outputStyle: 'clean',
  customVocabulary: [],
  refineModel: 'gemini-3.5-flash-lite',
  languageCode: '',
  microphoneId: '',
  autoPaste: true,
  restoreClipboard: true,
  soundCues: true,
  saveHistory: true,
  launchAtLogin: false,
  pillPlacement: 'bottom',
  maxRecordingSeconds: 120,
  onboardingDone: false,
};

const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Normalises a vocabulary list: trims, drops blanks, removes case-insensitive duplicates,
 * truncates over-long terms and caps the list at MAX_VOCABULARY_TERMS.
 */
export function normalizeVocabulary(input: unknown): string[] {
  let items: unknown[];
  if (Array.isArray(input)) items = input;
  else if (typeof input === 'string') items = input.split(/[\n,]/);
  else return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const term = item.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_VOCABULARY_TERM_LENGTH);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(term);
    if (result.length >= MAX_VOCABULARY_TERMS) break;
  }
  return result;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, maxLength);
}

function pickSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.round(Math.min(300, Math.max(10, value)));
  // Snap to the closest offered option so the UI always has a matching choice.
  let best = MAX_RECORDING_OPTIONS[0] as number;
  for (const option of MAX_RECORDING_OPTIONS) {
    if (Math.abs(option - clamped) < Math.abs(best - clamped)) best = option;
  }
  return best;
}

/** Produces a fully valid Settings object from arbitrary (possibly corrupt) input. */
export function sanitizeSettings(raw: unknown): Settings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const hotkey = typeof source.hotkey === 'string' && isValidAccelerator(source.hotkey) ? source.hotkey : DEFAULT_HOTKEY;
  const languageCode = typeof source.languageCode === 'string' && LANGUAGE_PATTERN.test(source.languageCode)
    ? source.languageCode
    : DEFAULT_SETTINGS.languageCode;

  return {
    hotkey,
    outputStyle: pickEnum<OutputStyle>(source.outputStyle, OUTPUT_STYLES, DEFAULT_SETTINGS.outputStyle),
    customVocabulary: normalizeVocabulary(source.customVocabulary),
    refineModel: pickEnum<RefineModelId>(source.refineModel, REFINE_MODEL_IDS, DEFAULT_SETTINGS.refineModel),
    languageCode,
    microphoneId: pickString(source.microphoneId, DEFAULT_SETTINGS.microphoneId, 300),
    autoPaste: pickBool(source.autoPaste, DEFAULT_SETTINGS.autoPaste),
    restoreClipboard: pickBool(source.restoreClipboard, DEFAULT_SETTINGS.restoreClipboard),
    soundCues: pickBool(source.soundCues, DEFAULT_SETTINGS.soundCues),
    saveHistory: pickBool(source.saveHistory, DEFAULT_SETTINGS.saveHistory),
    launchAtLogin: pickBool(source.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin),
    pillPlacement: pickEnum<PillPlacement>(source.pillPlacement, PILL_PLACEMENTS, DEFAULT_SETTINGS.pillPlacement),
    maxRecordingSeconds: pickSeconds(source.maxRecordingSeconds, DEFAULT_SETTINGS.maxRecordingSeconds),
    onboardingDone: pickBool(source.onboardingDone, DEFAULT_SETTINGS.onboardingDone),
  };
}

/**
 * Applies a partial patch from the UI on top of the current settings.
 * Unknown keys are ignored and every value is re-validated.
 */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  if (typeof patch !== 'object' || patch === null) return current;
  const merged: Record<string, unknown> = { ...current };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key in (patch as Record<string, unknown>)) {
      merged[key] = (patch as Record<string, unknown>)[key];
    }
  }
  return sanitizeSettings(merged);
}
