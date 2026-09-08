import { openAsBlob } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { ReplayPackage, ReplayZip } from '../replay/package';

const reportPath = process.argv[2]!;
const report = JSON.parse(await readFile(reportPath, 'utf8'));
if (!report.ok) throw new Error('Session fixture did not complete');
const file = await openAsBlob(`${report.artifact.path}.zip`);
const signal = new AbortController().signal;
const start = performance.now();
const pkg = await new ReplayPackage(new ReplayZip(file, signal)).open();
const loadMs = performance.now() - start;
if (pkg.index.length < 1000) throw new Error('Expected at least 1,000 Decisions');
const timings = [];
for (const index of [0, pkg.index.length - 1, Math.floor(pkg.index.length / 2), 1, pkg.index.length - 1]) {
  const started = performance.now();
  const decision = await pkg.decision(index);
  if (decision.record.decision !== index + 1) throw new Error('Seek selected the wrong Decision');
  timings.push({ index, ms: performance.now() - started });
}
const cancel = new AbortController();
const interrupted = new ReplayPackage(new ReplayZip(file, cancel.signal)).open();
setTimeout(() => cancel.abort(), 10);
let cancelled = false;
try { await interrupted; } catch (error) { cancelled = error instanceof Error && error.name === 'AbortError'; }
if (!cancelled) throw new Error('Loading could not be cancelled');
await writeFile(reportPath.replace(/\.json$/, '-viewer.json'), JSON.stringify({
  ok: true, decisions: pkg.index.length, zipBytes: file.size,
  zipDeclaredExpandedBytes: [...pkg.zip.entries.values()].reduce((sum, entry) => sum + entry.size, 0),
  internalPayloadReadExpandedBytes: pkg.internalExpandedBytes,
  observationReadCumulativeBytes: pkg.observationCumulativeBytes,
  loadMs, seeks: timings, cancelled, rssBytes: process.memoryUsage().rss,
  environment: { node: process.version, platform: process.platform, browser: false },
  note: 'Uses the same browser-safe reader with a disk-backed Blob; browser UI and physical mobile RAM are separate checks.',
}, null, 2));
