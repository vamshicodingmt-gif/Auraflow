import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryStore, SecretStore, SettingsStore, type CipherLike } from '../src/main/store';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auraflow-store-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const reversibleCipher = (available: boolean): CipherLike => ({
  isAvailable: () => available,
  encryptString: (plain: string) => Buffer.from(plain.split('').reverse().join(''), 'utf8'),
  decryptString: (cipher: Buffer) => cipher.toString('utf8').split('').reverse().join(''),
});

describe('SettingsStore', () => {
  it('creates the file with defaults and persists updates', () => {
    const file = path.join(dir, 'settings.json');
    const store = new SettingsStore(file);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    store.update({ outputStyle: 'formal', customVocabulary: ['AuraFlow', 'auraflow', 'Gemini'] });

    const reloaded = new SettingsStore(file);
    expect(reloaded.get().outputStyle).toBe('formal');
    expect(reloaded.get().customVocabulary).toEqual(['AuraFlow', 'Gemini']);
  });

  it('recovers from corrupt JSON with defaults', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{not json');
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('SecretStore', () => {
  it('encrypts the key on disk and reads it back', () => {
    const file = path.join(dir, 'secrets.json');
    const store = new SecretStore(file, reversibleCipher(true), () => undefined);
    expect(store.storageKind()).toBe('none');
    expect(store.setApiKey('  AIzaSyPLAINTEXTKEY1234567890  ')).toBe('encrypted');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('AIzaSyPLAINTEXTKEY');

    const reopened = new SecretStore(file, reversibleCipher(true), () => undefined);
    expect(reopened.getApiKey()).toBe('AIzaSyPLAINTEXTKEY1234567890');
    expect(reopened.storageKind()).toBe('encrypted');
  });

  it('falls back to plain storage when the OS keychain is unavailable', () => {
    const file = path.join(dir, 'secrets.json');
    const store = new SecretStore(file, reversibleCipher(false), () => undefined);
    expect(store.setApiKey('AIzaSyPLAINTEXTKEY1234567890')).toBe('plain');
    expect(store.storageKind()).toBe('plain');
  });

  it('uses the GEMINI_API_KEY environment variable when nothing is stored', () => {
    const store = new SecretStore(path.join(dir, 'secrets.json'), reversibleCipher(true), () => 'AIzaSyFROMENVIRONMENT123456');
    expect(store.getApiKey()).toBe('AIzaSyFROMENVIRONMENT123456');
    expect(store.storageKind()).toBe('environment');
  });

  it('clears the stored key', () => {
    const file = path.join(dir, 'secrets.json');
    const store = new SecretStore(file, reversibleCipher(true), () => undefined);
    store.setApiKey('AIzaSyPLAINTEXTKEY1234567890');
    store.clear();
    expect(store.getApiKey()).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('HistoryStore', () => {
  it('stores newest first, removes entries and enforces the limit', () => {
    const file = path.join(dir, 'history.json');
    const store = new HistoryStore(file, 3);
    const base = { text: 't', raw: 't', style: 'clean' as const, words: 1, durationMs: 1000, model: 'm' };
    const first = store.add({ ...base, text: 'one' });
    store.add({ ...base, text: 'two' });
    store.add({ ...base, text: 'three' });
    store.add({ ...base, text: 'four' });
    expect(store.list().map((e) => e.text)).toEqual(['four', 'three', 'two']);

    expect(store.remove(first.id)).toBe(false);
    const reopened = new HistoryStore(file, 3);
    expect(reopened.list()).toHaveLength(3);
    const target = reopened.list()[0];
    expect(reopened.remove(target.id)).toBe(true);
    reopened.clear();
    expect(new HistoryStore(file).list()).toEqual([]);
  });

  it('ignores malformed entries in a damaged file', () => {
    const file = path.join(dir, 'history.json');
    fs.writeFileSync(file, JSON.stringify([{ id: 'ok', text: 'hi', createdAt: new Date().toISOString() }, { nope: true }, 42]));
    const entries = new HistoryStore(file).list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'ok', text: 'hi', style: 'clean' });
  });
});
