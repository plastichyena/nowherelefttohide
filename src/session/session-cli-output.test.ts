import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { writeJsonToWritable } from '../agent/json-stream';
import { executeSessionCommand } from './session-cli';
import type { SessionService } from './service';

describe('bounded Session CLI output', () => {
  it('streams Unicode JSON through a slow pipe while respecting backpressure', async () => {
    const chunks: Buffer[] = [];
    let largestQueued = 0;
    const sink = new Writable({ highWaterMark: 1024, write(chunk, _encoding, callback) {
      largestQueued = Math.max(largestQueued, this.writableLength);
      chunks.push(Buffer.from(chunk));
      setTimeout(callback, 1);
    } });
    const value = { text: 'a'.repeat(8191) + '🧟'.repeat(70_000), items: [null, true, { quote: '"\n' }] };
    await writeJsonToWritable(sink, value);
    await new Promise<void>((resolve) => sink.end(resolve));
    expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual(value);
    expect(chunks.length).toBeGreaterThan(3);
    expect(largestQueued).toBeLessThan(150_000);
  });

  it('writes a requested full snapshot file and returns its retrieval metadata without overwriting', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nlth-query-output-'));
    const path = join(directory, 'snapshot.json');
    const result = { sessionId: 'test', revision: 2, target: 'full-snapshot', count: 1, total: 1,
      hasMore: false, nextCursor: null, value: { observation: { turn: 3 }, legalActions: [{ type: 'EndTurn' }] } };
    const dependencies = { createService: () => ({ query: () => result }) as unknown as SessionService, readStdin: () => '' };
    const args = ['query', '--session=test', '--target=full-snapshot', `--out=${path}`];
    expect(executeSessionCommand(args, dependencies)).toMatchObject({ ok: true, command: 'query', outputPath: path, revision: 2 });
    const file = readFileSync(path, 'utf8');
    expect(JSON.parse(file)).toEqual({ ok: true, command: 'query', ...result });
    expect(() => executeSessionCommand(args, dependencies)).toThrow('Refusing to overwrite');
    expect(readFileSync(path, 'utf8')).toBe(file);
  });
});
