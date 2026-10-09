import { describe, expect, it } from 'vitest';
import { flushSseRemainder, parseSseBuffer } from '../src/shared/sse';

describe('parseSseBuffer', () => {
  it('parses complete events and keeps the incomplete tail', () => {
    const first = parseSseBuffer('event: step.delta\ndata: {"a":1}\n\nevent: step.de');
    expect(first.events).toEqual([{ event: 'step.delta', data: '{"a":1}' }]);
    expect(first.rest).toBe('event: step.de');

    const second = parseSseBuffer(first.rest + 'lta\ndata: {"b":2}\n\n');
    expect(second.events).toEqual([{ event: 'step.delta', data: '{"b":2}' }]);
    expect(second.rest).toBe('');
  });

  it('joins multi-line data and ignores comments and CRLF endings', () => {
    const parsed = parseSseBuffer(': keep-alive\r\ndata: line one\r\ndata: line two\r\n\r\n');
    expect(parsed.events).toEqual([{ event: null, data: 'line one\nline two' }]);
  });

  it('flushes a final event that never received a blank line', () => {
    expect(flushSseRemainder('data: [DONE]')).toEqual([{ event: null, data: '[DONE]' }]);
  });
});
