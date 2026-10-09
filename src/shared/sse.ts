/** Minimal Server-Sent Events parser that tolerates arbitrary chunk boundaries. */

export interface SseEvent {
  /** Value of the `event:` field, or null when absent. */
  event: string | null;
  /** Joined `data:` lines. */
  data: string;
}

export interface SseParseResult {
  events: SseEvent[];
  /** Incomplete trailing text to prepend to the next chunk. */
  rest: string;
}

export function parseSseBuffer(buffer: string): SseParseResult {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];

  for (const block of blocks) {
    let eventName: string | null = null;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventName = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (eventName !== null || dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join('\n') });
    }
  }
  return { events, rest };
}

/** Parses whatever is left once the stream has ended (a final event may lack a blank line). */
export function flushSseRemainder(rest: string): SseEvent[] {
  return parseSseBuffer(`${rest}\n\n`).events;
}
