import fs from 'node:fs';
import path from 'node:path';
import { applySettingsPatch, DEFAULT_SETTINGS, sanitizeSettings } from '../shared/settings';
import type { ApiKeyStorage, HistoryEntry, Settings } from '../shared/types';

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Writes JSON via a temp file and rename so a crash never leaves a half-written store. */
export function writeJsonFileAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class SettingsStore {
  private current: Settings;

  constructor(private readonly file: string) {
    const raw = readJsonFile<unknown>(file, {});
    this.current = sanitizeSettings(raw);
    if (!fs.existsSync(file)) this.save();
  }

  get(): Settings {
    return this.current;
  }

  defaults(): Settings {
    return { ...DEFAULT_SETTINGS };
  }

  update(patch: unknown): Settings {
    this.current = applySettingsPatch(this.current, patch);
    this.save();
    return this.current;
  }

  private save(): void {
    writeJsonFileAtomic(this.file, this.current);
  }
}

/** Minimal surface of Electron's safeStorage, so the store stays testable. */
export interface CipherLike {
  isAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

interface SecretFileShape {
  storage: 'encrypted' | 'plain';
  value: string;
}

export class SecretStore {
  private cachedKey: string | null = null;
  private storage: 'encrypted' | 'plain' | null = null;

  constructor(
    private readonly file: string,
    private readonly cipher: CipherLike,
    private readonly environmentKey: () => string | undefined,
  ) {
    this.load();
  }

  private load(): void {
    const data = readJsonFile<Partial<SecretFileShape> | null>(this.file, null);
    if (!data || typeof data.value !== 'string') return;
    try {
      if (data.storage === 'encrypted') {
        this.cachedKey = this.cipher.decryptString(Buffer.from(data.value, 'base64'));
        this.storage = 'encrypted';
      } else if (data.storage === 'plain') {
        this.cachedKey = data.value;
        this.storage = 'plain';
      }
    } catch {
      // Keychain entry unreadable (e.g. user changed OS account). Treat as missing.
      this.cachedKey = null;
      this.storage = null;
    }
  }

  getApiKey(): string | undefined {
    if (this.cachedKey) return this.cachedKey;
    const fromEnv = this.environmentKey()?.trim();
    return fromEnv ? fromEnv : undefined;
  }

  storageKind(): ApiKeyStorage {
    if (this.cachedKey) return this.storage === 'encrypted' ? 'encrypted' : 'plain';
    if (this.environmentKey()?.trim()) return 'environment';
    return 'none';
  }

  setApiKey(key: string): ApiKeyStorage {
    const trimmed = key.trim();
    const encrypted = this.cipher.isAvailable();
    const payload: SecretFileShape = encrypted
      ? { storage: 'encrypted', value: this.cipher.encryptString(trimmed).toString('base64') }
      : { storage: 'plain', value: trimmed };
    writeJsonFileAtomic(this.file, payload);
    this.cachedKey = trimmed;
    this.storage = encrypted ? 'encrypted' : 'plain';
    return encrypted ? 'encrypted' : 'plain';
  }

  clear(): void {
    this.cachedKey = null;
    this.storage = null;
    try {
      fs.unlinkSync(this.file);
    } catch {
      // Already gone.
    }
  }
}

export class HistoryStore {
  private entries: HistoryEntry[];

  constructor(
    private readonly file: string,
    private readonly limit = 300,
  ) {
    this.entries = HistoryStore.sanitizeEntries(readJsonFile<unknown>(file, []));
  }

  private static sanitizeEntries(raw: unknown): HistoryEntry[] {
    if (!Array.isArray(raw)) return [];
    const result: HistoryEntry[] = [];
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue;
      const e = item as Partial<HistoryEntry>;
      if (typeof e.id !== 'string' || typeof e.text !== 'string' || typeof e.createdAt !== 'string') continue;
      result.push({
        id: e.id,
        createdAt: e.createdAt,
        text: e.text,
        raw: typeof e.raw === 'string' ? e.raw : e.text,
        style: typeof e.style === 'string' ? (e.style as HistoryEntry['style']) : 'clean',
        words: typeof e.words === 'number' ? e.words : 0,
        durationMs: typeof e.durationMs === 'number' ? e.durationMs : 0,
        model: typeof e.model === 'string' ? e.model : '',
      });
    }
    return result;
  }

  list(): HistoryEntry[] {
    return [...this.entries];
  }

  add(entry: Omit<HistoryEntry, 'id' | 'createdAt'> & { createdAt?: string; id?: string }): HistoryEntry {
    const record: HistoryEntry = {
      ...entry,
      id: entry.id ?? `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };
    this.entries = [record, ...this.entries].slice(0, this.limit);
    this.save();
    return record;
  }

  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) this.save();
    return this.entries.length !== before;
  }

  clear(): void {
    this.entries = [];
    this.save();
  }

  private save(): void {
    writeJsonFileAtomic(this.file, this.entries);
  }
}
