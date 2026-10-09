import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, applySettingsPatch, normalizeVocabulary, sanitizeSettings, MAX_VOCABULARY_TERMS } from '../src/shared/settings';

describe('sanitizeSettings', () => {
  it('returns defaults for empty or garbage input', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ hotkey: 42, outputStyle: 'shouting', refineModel: 'gpt-5' })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and rejects invalid enums and hotkeys', () => {
    const result = sanitizeSettings({ hotkey: 'Ctrl+Shift+D', outputStyle: 'email', pillPlacement: 'cursor', refineModel: 'gemini-3.8-flash' });
    expect(result.hotkey).toBe('Ctrl+Shift+D');
    expect(result.outputStyle).toBe('email');
    expect(result.pillPlacement).toBe('cursor');
    expect(result.refineModel).toBe('gemini-3.8-flash');

    expect(sanitizeSettings({ hotkey: 'Space' }).hotkey).toBe(DEFAULT_SETTINGS.hotkey);
  });

  it('validates language codes and snaps recording limits to offered options', () => {
    expect(sanitizeSettings({ languageCode: 'en-US' }).languageCode).toBe('en-US');
    expect(sanitizeSettings({ languageCode: 'english; drop table' }).languageCode).toBe('');
    expect(sanitizeSettings({ maxRecordingSeconds: 45 }).maxRecordingSeconds).toBe(60);
    expect(sanitizeSettings({ maxRecordingSeconds: 9999 }).maxRecordingSeconds).toBe(300);
    expect(sanitizeSettings({ maxRecordingSeconds: Number.NaN }).maxRecordingSeconds).toBe(DEFAULT_SETTINGS.maxRecordingSeconds);
  });
});

describe('normalizeVocabulary', () => {
  it('trims, drops blanks and removes case-insensitive duplicates', () => {
    expect(normalizeVocabulary(['  Kubernetes ', '', 'kubernetes', 'AuraFlow', 42 as unknown as string])).toEqual(['Kubernetes', 'AuraFlow']);
  });

  it('accepts newline or comma separated text', () => {
    expect(normalizeVocabulary('Gemini\nBigQuery, Terraform')).toEqual(['Gemini', 'BigQuery', 'Terraform']);
  });

  it('caps the list at the transcriber-friendly limit', () => {
    const many = Array.from({ length: 300 }, (_, i) => `term${i}`);
    expect(normalizeVocabulary(many)).toHaveLength(MAX_VOCABULARY_TERMS);
  });
});

describe('applySettingsPatch', () => {
  it('only changes patched keys and re-validates them', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { outputStyle: 'bullets', hotkey: 'nonsense', unknownKey: true });
    expect(next.outputStyle).toBe('bullets');
    expect(next.hotkey).toBe(DEFAULT_SETTINGS.hotkey);
    expect(next.autoPaste).toBe(DEFAULT_SETTINGS.autoPaste);
    expect(next).not.toHaveProperty('unknownKey');
  });
});
