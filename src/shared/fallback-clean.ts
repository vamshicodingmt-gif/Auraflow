/**
 * Offline rule-based cleanup. Used only when the Gemini refinement pass fails, so a
 * network hiccup still produces readable text instead of an error.
 */

const SPOKEN_SYMBOLS: [RegExp, string][] = [
  [/[ \t]*\bexclamation (?:point|mark)\b[.,]?[ \t]*/gi, '! '],
  [/[ \t]*\bquestion mark\b[.,]?[ \t]*/gi, '? '],
  [/[ \t]*\b(?:full stop|period)\b[.,]?[ \t]*/gi, '. '],
  [/[ \t]*\bcomma\b[.,]?[ \t]*/gi, ', '],
  [/[ \t]*\bsemicolon\b[.,]?[ \t]*/gi, '; '],
  [/[ \t]*\bcolon\b[.,]?[ \t]*/gi, ': '],
];

export function fallbackClean(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  // Fillers and hedges that only appear as verbal tics.
  text = text.replace(/\b(?:um+|uhm+|uh+|erm+|hmm+)\b[,.]?[ \t]*/gi, '');
  text = text.replace(/\b(?:you know|i mean),[ \t]*/gi, '');

  // Stutters: "I I think" -> "I think", "the the" -> "the".
  text = text.replace(/\b([A-Za-z']+)(?:\s+\1\b)+/gi, '$1');

  // Explicit paragraph/line commands first, then punctuation words.
  text = text.replace(/[ \t]*\bnew paragraph\b[.,]?[ \t]*/gi, '\n\n');
  text = text.replace(/[ \t]*\bnew line\b[.,]?[ \t]*/gi, '\n');
  for (const [pattern, replacement] of SPOKEN_SYMBOLS) {
    text = text.replace(pattern, replacement);
  }

  // Spacing: no space before punctuation, single spaces elsewhere, space after punctuation between words.
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/ +([,.!?;:])/g, '$1');
  text = text.replace(/([A-Za-z])([,;:!?])(?=[A-Za-z])/g, '$1$2 ');
  text = text.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  text = text.replace(/^[ ,;:]+/, '').trim();

  // Capitalise sentence starts, the first character and line starts.
  text = text.replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (_m, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
  return text;
}
