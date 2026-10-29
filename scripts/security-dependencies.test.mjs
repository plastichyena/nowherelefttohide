import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, resolveConfig } from 'vite';

const require = createRequire(import.meta.url);

test('invalid indexed offsets are rejected promptly and valid source maps still work', () => {
  // Run the exact same input against the saved baseline via this optional path.
  // A child bounds the old synchronous loop without hanging the test runner.
  const modulePath = process.env.NLTH_SOURCE_MAP_MODULE || require.resolve('source-map-js');
  const code = `
    const assert=require('node:assert/strict');
    const {SourceMapConsumer,SourceNode}=require(process.argv[1]);
    const map={version:3,sections:[{offset:{line:1e12,column:0},map:{version:3,sources:['input.js'],names:[],mappings:'AAAA',sourcesContent:['x']}}]};
    assert.throws(()=>SourceNode.fromStringWithSourceMap('x',new SourceMapConsumer(map)), /Section offset line must not exceed/);
    map.sections[0].offset.line=0;
    const result=SourceNode.fromStringWithSourceMap('x',new SourceMapConsumer(map));
    if(result.toString()!=='x')throw new Error('Generated code changed');
    process.stdout.write('completed');
  `;
  const result = spawnSync(process.execPath, ['-e', code, modulePath], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(result.error, undefined, `Source map conversion must finish: ${result.error?.message}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'completed');
});

test('development binds to loopback by default; explicit LAN testing remains available', async () => {
  const normal = await resolveConfig({}, 'serve');
  assert.equal(normal.server.host, '127.0.0.1');
  const lan = await resolveConfig({ server: { host: '0.0.0.0' } }, 'serve');
  assert.equal(lan.server.host, '0.0.0.0');
});

test('Vite does not serve a denied synthetic file through raw queries', async () => {
  // Keep fixtures as local evidence; never inspect an existing user's .env.
  const root = resolve('output/security-tests', `deny-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const marker = 'NLTH_SYNTHETIC_DENY_MARKER';
  writeFileSync(resolve(root, '.env'), `${marker}=test-only\n`);
  const server = await createServer({ configFile: false, root, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, watch: null } });
  try {
    await server.listen();
    const { port } = server.httpServer.address();
    for (const query of ['', '?raw', '?import&raw', '?import&url&inline']) {
      const response = await fetch(`http://127.0.0.1:${port}/.env${query}`);
      const body = await response.text();
      assert.equal(response.status, 403, query);
      assert.equal(body.includes(marker), false, query);
    }
  } finally {
    await server.close();
  }
});
