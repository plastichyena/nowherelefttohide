import { Zip, ZipPassThrough } from 'fflate';
import { closeSync, existsSync, fsyncSync, openSync, readSync, renameSync, statSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { assertSafeInputFile, assertSafeOutputPath, createSafePathRoot, ensureSafeOutputDirectory, type SafePathRoot } from './safe-path';

const MAX_ENTRIES = 200_000;
const MAX_DIRECTORY = 32 * 1024 * 1024;
const MAX_LINE = 4 * 1024 * 1024;
const BLOCK = 64 * 1024;
function safeName(name: string): string {
  if (!name || name.includes('\\') || name.includes(':') || name.includes('\0') || name.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Unsafe Artifact entry path');
  return name;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => { let value = index; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); return value >>> 0; });
function crcUpdate(crc: number, bytes: Uint8Array): number { for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!; return crc; }
interface Entry { offset: number; compressed: number; size: number; method: number; crc: number }

/** Random-access ZIP index; neither the ZIP nor its NDJSON stream is loaded in memory. */
export class ArtifactSource {
  private fd: number | null = null;
  private root: SafePathRoot | null = null;
  private entries = new Map<string, Entry>();
  private centralOffset = 0;
  constructor(path: string, private signal?: AbortSignal) {
    const absolute = resolve(path);
    if (statSync(absolute).isDirectory()) { this.root = createSafePathRoot(absolute); return; }
    this.fd = openSync(assertSafeInputFile(createSafePathRoot(dirname(absolute)), absolute), 'r');
    try {
      const size = statSync(absolute).size;
      const tail = this.at(Math.max(0, size - 65557), Math.min(size, 65557));
      let end = tail.length - 22;
      while (end >= 0 && !(tail.readUInt32LE(end) === 0x06054b50 && end + 22 + tail.readUInt16LE(end + 20) === tail.length)) end--;
      if (end < 0) throw new Error('Artifact ZIP end record is missing');
      const count = tail.readUInt16LE(end + 10), bytes = tail.readUInt32LE(end + 12);
      this.centralOffset = tail.readUInt32LE(end + 16);
      if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || count === 65535 || count > MAX_ENTRIES || bytes > MAX_DIRECTORY || this.centralOffset + bytes !== size - tail.length + end) throw new Error('Unsupported or oversized Artifact ZIP directory');
      const directory = this.at(this.centralOffset, bytes);
      let cursor = 0;
      for (let i = 0; i < count; i++) {
        if (cursor + 46 > bytes || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid Artifact ZIP directory');
        const length = directory.readUInt16LE(cursor + 28), extra = directory.readUInt16LE(cursor + 30), comment = directory.readUInt16LE(cursor + 32);
        if (cursor + 46 + length + extra + comment > bytes) throw new Error('Truncated Artifact ZIP directory');
        const name = safeName(directory.subarray(cursor + 46, cursor + 46 + length).toString('utf8'));
        const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10), mode = directory.readUInt32LE(cursor + 38) >>> 16;
        const entry = { offset: directory.readUInt32LE(cursor + 42), compressed: directory.readUInt32LE(cursor + 20), size: directory.readUInt32LE(cursor + 24), method, crc: directory.readUInt32LE(cursor + 16) };
        if (this.entries.has(name) || flags & 1 || ![0, 8].includes(method) || (mode & 0xf000) === 0xa000 || directory.readUInt16LE(cursor + 34) || entry.offset >= this.centralOffset || entry.size === 0xffffffff || entry.compressed === 0xffffffff) throw new Error('Unsafe or unsupported Artifact ZIP entry');
        this.entries.set(name, entry);
        cursor += 46 + length + extra + comment;
      }
      if (cursor !== bytes) throw new Error('Artifact ZIP directory size mismatch');
    } catch (error) { this.close(); throw error; }
  }
  private check(): void { this.signal?.throwIfAborted(); }
  private at(offset: number, length: number): Buffer {
    this.check();
    const data = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) { const n = readSync(this.fd!, data, read, length - read, offset + read); if (!n) throw new Error('Truncated Artifact ZIP'); read += n; }
    return data;
  }
  *stream(name: string, limit = Number.MAX_SAFE_INTEGER): Generator<Buffer> {
    safeName(name); this.check();
    if (this.root) {
      const path = assertSafeInputFile(this.root, join(this.root.lexicalPath, name));
      if (statSync(path).size > limit) throw new Error('Artifact entry exceeds its bound');
      const fd = openSync(path, 'r');
      try { const buffer = Buffer.allocUnsafe(BLOCK); let count: number; while ((count = readSync(fd, buffer)) > 0) { this.check(); yield Buffer.from(buffer.subarray(0, count)); } } finally { closeSync(fd); }
      return;
    }
    const entry = this.entries.get(name);
    if (!entry || entry.size > limit) throw new Error('Missing or oversized Artifact ZIP entry');
    const local = this.at(entry.offset, 30);
    if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== entry.method || local.readUInt16LE(6) & 1) throw new Error('Artifact ZIP local header mismatch');
    const nameLength = local.readUInt16LE(26), start = entry.offset + 30 + nameLength + local.readUInt16LE(28);
    if (this.at(entry.offset + 30, nameLength).toString('utf8') !== name || start + entry.compressed > this.centralOffset) throw new Error('Artifact ZIP entry bounds mismatch');
    let crc = 0xffffffff;
    if (entry.method === 8) {
      if (!Number.isSafeInteger(limit) || limit > 64 * 1024 * 1024 || entry.compressed > 64 * 1024 * 1024) throw new Error('Artifact NDJSON must use ZIP store compression');
      const data = inflateRawSync(this.at(start, entry.compressed), { maxOutputLength: Math.max(1, Math.min(limit, entry.size)) });
      if (data.length !== entry.size) throw new Error('Artifact ZIP decompressed size mismatch');
      crc = crcUpdate(crc, data); yield data;
    } else {
      if (entry.size !== entry.compressed) throw new Error('Artifact ZIP stored size mismatch');
      for (let offset = 0; offset < entry.size; offset += BLOCK) { const data = this.at(start + offset, Math.min(BLOCK, entry.size - offset)); crc = crcUpdate(crc, data); yield data; }
    }
    if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw new Error('Artifact ZIP CRC mismatch');
  }
  read(name: string, limit: number): Buffer { return Buffer.concat([...this.stream(name, limit)]); }
  *lines(name: string): Generator<string> {
    const decoder = new StringDecoder('utf8'); let pending = '';
    for (const block of this.stream(name)) {
      pending += decoder.write(block);
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (Buffer.byteLength(line) > MAX_LINE) throw new Error('Artifact NDJSON line exceeds its bound');
        if (line.trim()) yield line;
      }
      if (Buffer.byteLength(pending) > MAX_LINE) throw new Error('Artifact NDJSON line exceeds its bound');
    }
    pending += decoder.end(); if (pending.trim()) yield pending;
  }
  close(): void { if (this.fd !== null) { closeSync(this.fd); this.fd = null; } }
}

/** Each entry is finished before the next starts, avoiding fflate's queued-entry buffering. */
export class ArtifactWriter {
  private fd: number;
  private zip: Zip;
  private root: SafePathRoot;
  private directoryRoot: SafePathRoot | null = null;
  private names = new Set<string>();
  private complete = false;
  readonly partialPath: string;
  constructor(readonly path: string, readonly directoryPath: string | null, private signal?: AbortSignal) {
    let parent = dirname(path); while (!existsSync(parent)) parent = dirname(parent);
    this.root = createSafePathRoot(parent);
    ensureSafeOutputDirectory(this.root, dirname(path));
    this.partialPath = `${path}.partial`;
    for (const target of [path, this.partialPath, ...(directoryPath ? [directoryPath] : [])]) { assertSafeOutputPath(this.root, target); if (existsSync(target)) throw new Error(`Refusing to overwrite Artifact output ${target}`); }
    if (directoryPath) { ensureSafeOutputDirectory(this.root, directoryPath); this.directoryRoot = createSafePathRoot(directoryPath); }
    this.fd = openSync(this.partialPath, 'wx');
    this.zip = new Zip((error, data, final) => { if (error) throw error; writeSync(this.fd, data); if (final) this.complete = true; });
  }
  has(name: string): boolean { return this.names.has(name); }
  add(name: string, chunks: Iterable<Uint8Array>): void {
    this.signal?.throwIfAborted();
    safeName(name); if (this.names.has(name)) throw new Error('Duplicate Artifact output entry'); this.names.add(name);
    const entry = new ZipPassThrough(name); this.zip.add(entry);
    let fd: number | null = null;
    if (this.directoryRoot) { const path = join(this.directoryRoot.lexicalPath, name); ensureSafeOutputDirectory(this.directoryRoot, dirname(path)); fd = openSync(assertSafeOutputPath(this.directoryRoot, path), 'wx'); }
    try { for (const chunk of chunks) { this.signal?.throwIfAborted(); entry.push(chunk); if (fd !== null) writeSync(fd, chunk); } entry.push(new Uint8Array(), true); }
    finally { if (fd !== null) closeSync(fd); }
  }
  finish(validate?: (path: string) => void): void {
    this.signal?.throwIfAborted();
    this.zip.end(); if (!this.complete) throw new Error('Artifact ZIP did not finish');
    fsyncSync(this.fd); this.close();
    const check = new ArtifactSource(this.partialPath, this.signal); check.close();
    validate?.(this.partialPath);
    assertSafeOutputPath(this.root, this.path); assertSafeInputFile(this.root, this.partialPath);
    if (existsSync(this.path)) throw new Error(`Refusing to overwrite Artifact output ${this.path}`);
    renameSync(this.partialPath, this.path);
  }
  close(): void { if (this.fd >= 0) { closeSync(this.fd); this.fd = -1; } }
}
