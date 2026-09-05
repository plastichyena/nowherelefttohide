import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [cliPath, ...args] = process.argv.slice(2);
if (!cliPath) throw new Error('benchmark worker requires the bundled Session CLI path');
const cli = await import(pathToFileURL(resolve(cliPath)).href);
const exitCode = await cli.runSessionCli(args);
const memory = process.memoryUsage();
const resources = process.resourceUsage();
process.stderr.write(`NLTH_BENCHMARK ${JSON.stringify({ rss: memory.rss, heapTotal: memory.heapTotal, heapUsed: memory.heapUsed, external: memory.external, arrayBuffers: memory.arrayBuffers, maxRSS: resources.maxRSS, fsRead: resources.fsRead, fsWrite: resources.fsWrite })}\n`);
process.exitCode = exitCode;
