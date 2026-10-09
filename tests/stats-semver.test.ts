import { describe, expect, it } from 'vitest';
import { computeStats, countWords } from '../src/shared/stats';
import { compareVersions } from '../src/shared/semver';
import type { HistoryEntry } from '../src/shared/types';

const entry = (overrides: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'x',
  createdAt: new Date(2026, 9, 9, 10, 0, 0).toISOString(),
  text: 'hi',
  raw: 'hi',
  style: 'clean',
  words: 10,
  durationMs: 60_000,
  model: 'gemini-3.5-transcribe',
  ...overrides,
});

describe('computeStats', () => {
  it('aggregates counts, words, minutes and words-per-minute', () => {
    const now = new Date(2026, 9, 9, 18, 0, 0);
    const stats = computeStats([entry({}), entry({ createdAt: new Date(2026, 9, 8, 9).toISOString(), words: 30, durationMs: 60_000 })], now);
    expect(stats.totalDictations).toBe(2);
    expect(stats.totalWords).toBe(40);
    expect(stats.totalMinutes).toBe(2);
    expect(stats.averageWordsPerMinute).toBe(20);
    expect(stats.todayDictations).toBe(1);
  });

  it('is zeroed for an empty history', () => {
    expect(computeStats([])).toMatchObject({ totalDictations: 0, averageWordsPerMinute: 0, lastDictationAt: null });
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('  one two\nthree  ')).toBe(3);
    expect(countWords('   ')).toBe(0);
  });
});

describe('compareVersions', () => {
  it('orders numeric segments and v-prefixes', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
  });

  it('ranks a release above its pre-releases', () => {
    expect(compareVersions('1.2.0', '1.2.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0-rc.2', '1.2.0-rc.10')).toBeLessThan(0);
  });
});
