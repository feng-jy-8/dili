import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFrpArchive } from './frp-install.ts';

test('FRP download falls back after an invalid archive and verifies the next source', async t => {
  const payload = Buffer.from('verified fixture archive');
  const server = createServer((req, res) => res.end(req.url === '/valid' ? payload : 'corrupted'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const directory = await mkdtemp(join(tmpdir(), 'sessiondeck-frp-download-'));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const archive = join(directory, 'archive'), base = `http://127.0.0.1:${address.port}`;
  const hash = createHash('sha256').update(payload).digest('hex');
  await downloadFrpArchive(archive, [`${base}/invalid`, `${base}/valid`], hash, 2000);
  assert.deepEqual(await readFile(archive), payload);
  await assert.rejects(downloadFrpArchive(archive, [`${base}/invalid`], hash, 2000), /校验失败/);
});

test('a stalled FRP source has a shared deadline and releases its HTTP connection', async t => {
  let requests = 0;
  const server = createServer(() => { requests++; /* never respond */ });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const directory = await mkdtemp(join(tmpdir(), 'sessiondeck-frp-timeout-'));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const start = Date.now(), source = `http://127.0.0.1:${address.port}/stalled`;
  await assert.rejects(downloadFrpArchive(join(directory, 'archive'), [source, source], 'unused', 150), /超时/);
  assert.ok(Date.now() - start < 2000);
  assert.equal(requests, 1, 'the exhausted deadline must not start another source');
});
