import type { HistoryEntry } from './types';

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export interface DictationStats {
  totalDictations: number;
  totalWords: number;
  totalMinutes: number;
  averageWordsPerMinute: number;
  todayDictations: number;
  lastDictationAt: string | null;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function computeStats(entries: readonly HistoryEntry[], now: Date = new Date()): DictationStats {
  let totalWords = 0;
  let totalDurationMs = 0;
  let todayDictations = 0;
  let latest: string | null = null;

  for (const entry of entries) {
    totalWords += entry.words;
    totalDurationMs += entry.durationMs;
    const created = new Date(entry.createdAt);
    if (!Number.isNaN(created.getTime())) {
      if (sameLocalDay(created, now)) todayDictations += 1;
      if (!latest || created.getTime() > new Date(latest).getTime()) latest = entry.createdAt;
    }
  }

  const totalMinutes = totalDurationMs / 60_000;
  return {
    totalDictations: entries.length,
    totalWords,
    totalMinutes: Math.round(totalMinutes * 10) / 10,
    averageWordsPerMinute: totalMinutes >= 0.1 ? Math.round(totalWords / totalMinutes) : 0,
    todayDictations,
    lastDictationAt: latest,
  };
}
