import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { lazyArray } from './history';

/** Index the large observation array without constructing a whole-file string.
 * Each observation still goes through JSON.parse and the normal replay checks.
 * The caller owns the descriptor until every lazy element has been consumed.
 */
export function openReplayJson(path: string, maxValueBytes = 64 * 1024 * 1024) {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  const buffer = Buffer.alloc(64 * 1024);
  let bufferStart = -1, bufferLength = 0, position = 0, closed = false;
  const close = () => { if (!closed) { closed = true; closeSync(fd); } };
  const peek = (): number => {
    if (position >= size) return -1;
    if (position < bufferStart || position >= bufferStart + bufferLength) {
      bufferStart = position;
      bufferLength = readSync(fd, buffer, 0, buffer.length, position);
      if (bufferLength === 0) throw new Error('Unexpected end of replay JSON');
    }
    return buffer[position - bufferStart]!;
  };
  const whitespace = () => {
    while ([9, 10, 13, 32].includes(peek())) position += 1;
  };
  const expect = (byte: number) => {
    whitespace();
    if (peek() !== byte) throw new Error(`Malformed replay JSON at byte ${position}`);
    position += 1;
  };
  const string = () => {
    expect(34);
    let escaped = false;
    for (;;) {
      const byte = peek();
      if (byte < 0) throw new Error('Unterminated replay JSON string');
      position += 1;
      if (escaped) escaped = false;
      else if (byte === 92) escaped = true;
      else if (byte === 34) return;
    }
  };
  const scanValue = (): [number, number] => {
    whitespace();
    const start = position;
    const first = peek();
    if (first === 34) string();
    else if (first === 123 || first === 91) {
      const stack = [first === 123 ? 125 : 93];
      position += 1;
      while (stack.length) {
        const byte = peek();
        if (byte < 0) throw new Error('Unterminated replay JSON value');
        if (byte === 34) { string(); continue; }
        if (byte === 123 || byte === 91) stack.push(byte === 123 ? 125 : 93);
        else if (byte === 125 || byte === 93) {
          if (stack.pop() !== byte) throw new Error('Mismatched replay JSON delimiter');
        }
        position += 1;
      }
    } else {
      while (peek() >= 0 && ![9, 10, 13, 32, 44, 93, 125].includes(peek())) position += 1;
      if (position === start) throw new Error(`Missing replay JSON value at byte ${position}`);
    }
    return [start, position - start];
  };
  const parse = ([start, length]: [number, number]): unknown => {
    if (closed) throw new Error('Replay JSON is closed');
    if (length > maxValueBytes) throw new Error(`Replay JSON value exceeds ${maxValueBytes} bytes`);
    const bytes = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const count = readSync(fd, bytes, read, length - read, start + read);
      if (count === 0) throw new Error('Unexpected end of replay JSON');
      read += count;
    }
    return JSON.parse(bytes.toString('utf8'));
  };
  try {
    const value: Record<string, unknown> = {};
    expect(123);
    whitespace();
    if (peek() !== 125) {
      for (;;) {
        whitespace();
        if (peek() !== 34) throw new Error('Expected replay JSON property name');
        const key = parse(scanValue()) as string;
        if (Object.hasOwn(value, key)) throw new Error(`Duplicate replay JSON property: ${key}`);
        expect(58);
        whitespace();
        let child: unknown;
        if (key === 'observationTrace' && peek() === 91) {
          position += 1;
          const spans: Array<[number, number]> = [];
          whitespace();
          if (peek() !== 93) {
            for (;;) {
              spans.push(scanValue());
              whitespace();
              if (peek() !== 44) break;
              position += 1;
            }
          }
          expect(93);
          child = lazyArray(spans.length, index => parse(spans[index]!));
        } else child = parse(scanValue());
        Object.defineProperty(value, key, { value: child, enumerable: true, writable: true, configurable: true });
        whitespace();
        if (peek() !== 44) break;
        position += 1;
      }
    }
    expect(125);
    whitespace();
    if (position !== size) throw new Error('Trailing data after replay JSON');
    return { value, close };
  } catch (error) {
    close();
    throw error;
  }
}
