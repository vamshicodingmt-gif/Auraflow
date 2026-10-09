import { describe, expect, it } from 'vitest';
import { fallbackClean } from '../src/shared/fallback-clean';

describe('fallbackClean', () => {
  it('removes fillers and stutters and capitalises sentences', () => {
    expect(fallbackClean('um so I I think we should, uh, ship it. you know, it is ready')).toBe('So I think we should, ship it. It is ready');
  });

  it('turns spoken punctuation and line commands into symbols', () => {
    expect(fallbackClean('hello comma world period new paragraph next question mark')).toBe('Hello, world.\n\nNext?');
  });

  it('keeps numbers and decimals untouched', () => {
    expect(fallbackClean('the total is 3.14 dollars')).toBe('The total is 3.14 dollars');
  });

  it('handles empty input', () => {
    expect(fallbackClean('   ')).toBe('');
  });
});
