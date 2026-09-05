import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs';
import { once } from 'node:events';
import type { Writable } from 'node:stream';

/** JSON fragments with bounded strings; never builds a serialized whole array. */
function* jsonFragments(item: unknown): Generator<string> {
  if (typeof item === 'string') {
    yield '"';
    for (let offset = 0; offset < item.length; offset += 8192) yield JSON.stringify(item.slice(offset, offset + 8192)).slice(1, -1);
    yield '"';
  } else if (Array.isArray(item)) {
    yield '[';
    for (let index = 0; index < item.length; index += 1) { if (index) yield ','; yield* jsonFragments(item[index] ?? null); }
    yield ']';
  } else if (item !== null && typeof item === 'object') {
    yield '{'; let first = true;
    for (const key of Object.keys(item)) {
      const child = (item as Record<string, unknown>)[key];
      if (child === undefined) continue;
      if (!first) yield ','; first = false;
      yield* jsonFragments(key); yield ':'; yield* jsonFragments(child);
    }
    yield '}';
  } else yield JSON.stringify(item) ?? 'null';
}

/** Honor stdout/pipe backpressure instead of queuing an entire large response. */
export async function writeJsonToWritable(stream: Writable, value: unknown): Promise<void> {
  let buffer = '';
  for (const fragment of jsonFragments(value)) {
    buffer += fragment;
    if (buffer.length >= 32768) {
      if (!stream.write(buffer, 'utf8')) await once(stream, 'drain');
      buffer = '';
    }
  }
  if (!stream.write(`${buffer}\n`, 'utf8')) await once(stream, 'drain');
}

/** Bounded serialization: never stringify a complete run, history, or report. */
export function writeJsonStream(path: string, value: unknown): void {
  const temporary = `${path}.pending`;
  const fd = openSync(temporary, 'w');
  let buffer = '';
  const flush = () => {
    if (buffer) { writeSync(fd, buffer, undefined, 'utf8'); buffer = ''; }
  };
  const emit = (text: string) => {
    buffer += text;
    if (buffer.length >= 32768) flush();
  };
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      emit('"');
      for (let offset = 0; offset < item.length; offset += 8192) emit(JSON.stringify(item.slice(offset, offset + 8192)).slice(1, -1));
      emit('"');
    } else if (Array.isArray(item)) {
      emit('[');
      for (let index = 0; index < item.length; index += 1) { if (index) emit(','); visit(item[index] ?? null); }
      emit(']');
    } else if (item !== null && typeof item === 'object') {
      emit('{'); let first = true;
      for (const key of Object.keys(item)) {
        const child = (item as Record<string, unknown>)[key];
        if (child === undefined) continue;
        if (!first) emit(','); first = false; visit(key); emit(':'); visit(child);
      }
      emit('}');
    } else emit(JSON.stringify(item) ?? 'null');
  };
  try { visit(value); emit('\n'); flush(); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, path);
}
