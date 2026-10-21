import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { FunAsr, VoiceConnections, type VoiceEngine } from './voice.ts';
import { VOICE_MAX_FRAME, type VoiceServerEvent } from '../shared/voice.ts';
import { authorize } from './access.ts';

async function fixture(t: TestContext, limits?: { bytes: number; seconds: number }) {
  let sink: (event: VoiceServerEvent) => void = () => {};
  let ready: () => Promise<void> = async () => {};
  const audio: Buffer[] = [], cancelled: string[] = [];
  let stops = 0, begins = 0;
  const engine: VoiceEngine = { ready: () => ready(), begin(_id, _mime, result) { begins++; sink = result; }, audio(_id, chunk) { audio.push(chunk); }, stop() { stops++; }, cancel(id) { cancelled.push(id); } };
  const server = createServer();
  const wss = new WebSocketServer({ server, maxPayload: VOICE_MAX_FRAME });
  const connections = new VoiceConnections(engine, limits);
  wss.on('connection', ws => connections.attach(ws, 'device'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const clients: WebSocket[] = [];
  t.after(async () => { connections.close(); for (const ws of clients) ws.terminate(); for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
    const queue: VoiceServerEvent[] = [];
    let wait: (() => void) | undefined;
    ws.on('message', raw => { queue.push(JSON.parse(raw.toString())); wait?.(); });
    ws.on('error', () => {}); clients.push(ws);
    await once(ws, 'open');
    return { ws, async event(): Promise<VoiceServerEvent> { if (!queue.length) await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('no voice response')), 3000); wait = () => { clearTimeout(timer); resolve(); }; }); wait = undefined; return queue.shift()!; } };
  };
  return { connect, audio, cancelled, connections, emit: (event: VoiceServerEvent) => sink(event), readiness: (value: typeof ready) => { ready = value; }, counts: () => ({ stops, begins }) };
}

test('voice plugin is absent and inert until explicitly installed and enabled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dili-voice-'));
  const engine = new FunAsr(dir, { enabled: () => false, enable: () => assert.fail('must not enable') });
  try {
    assert.deepEqual(engine.status(), { enabled: false, installed: false, phase: 'not_installed', message: '', maxSeconds: 120 });
    await assert.rejects(engine.ready(), /安装并启用/);
    assert.equal(engine.status().installed, false);
  } finally { await engine.close(); await rm(dir, { recursive: true, force: true }); }
});

test('voice permissions require writable access to the correct session; installation stays local', () => {
  const share = { kind: 'share', deviceId: 'd', shareId: 's', sessionId: 'mine', mode: 'write', name: 'A' } as const;
  assert.equal(authorize(null, true, 'GET', '/api/sessions/mine/voice').allowed, false);
  assert.equal(authorize(share, true, 'GET', '/api/sessions/mine/voice').allowed, true);
  assert.equal(authorize({ ...share, mode: 'read' }, true, 'GET', '/api/sessions/mine/voice').allowed, false);
  assert.equal(authorize(share, true, 'GET', '/api/sessions/other/voice').allowed, false);
  for (const path of ['/api/voice', '/api/voice/install', '/api/voice/warmup']) assert.equal(authorize({ kind: 'owner', local: false, deviceId: 'owner' }, true, 'POST', path).allowed, false);
});

test('binary audio streams in order, interim text replaces and stop flushes a final result', async t => {
  const app = await fixture(t), client = await app.connect();
  client.ws.send(JSON.stringify({ type: 'start', mime: 'audio/webm;codecs=opus' }));
  assert.equal((await client.event()).type, 'ready');
  const received = new Promise<void>(resolve => { const timer = setInterval(() => { if (app.audio.length === 2) { clearInterval(timer); resolve(); } }, 5); });
  client.ws.send(Buffer.from([1, 2])); client.ws.send(Buffer.from([3, 4])); await received;
  assert.deepEqual(Buffer.concat(app.audio), Buffer.from([1, 2, 3, 4]));
  app.emit({ type: 'transcript', text: '你', final: false });
  assert.deepEqual(await client.event(), { type: 'transcript', text: '你', final: false });
  app.emit({ type: 'transcript', text: '你好', final: false });
  assert.deepEqual(await client.event(), { type: 'transcript', text: '你好', final: false });
  client.ws.send(JSON.stringify({ type: 'stop' }));
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(app.counts().stops, 1);
  app.emit({ type: 'transcript', text: '你好世界', final: true });
  assert.deepEqual(await client.event(), { type: 'transcript', text: '你好世界', final: true });
  assert.equal(app.cancelled.length, 1);
});

test('voice bounds bytes, rejects bad control order and releases a canceled loading connection', async t => {
  const app = await fixture(t, { bytes: 3, seconds: 120 });
  const first = await app.connect(); first.ws.send(Buffer.from([1]));
  assert.match(JSON.stringify(await first.event()), /尚未就绪/);
  const second = await app.connect(); second.ws.send(JSON.stringify({ type: 'start', mime: 'audio/mp4' }));
  await second.event(); second.ws.send(Buffer.from([1, 2, 3, 4]));
  assert.match(JSON.stringify(await second.event()), /大小上限/); assert.equal(app.audio.length, 0);
  let release!: () => void; app.readiness(() => new Promise<void>(resolve => { release = resolve; }));
  const loading = await app.connect(); loading.ws.send(JSON.stringify({ type: 'start', mime: 'audio/ogg;codecs=opus' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  loading.ws.send(JSON.stringify({ type: 'cancel' })); await once(loading.ws, 'close'); release();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(app.counts().begins, 1);
});

test('voice host concurrency and revoked devices cannot keep streaming', async t => {
  const app = await fixture(t), first = await app.connect(), other = await app.connect();
  assert.match(JSON.stringify(await other.event()), /另一段录音/);
  first.ws.send(JSON.stringify({ type: 'start', mime: 'audio/webm;codecs=opus' })); await first.event();
  app.connections.revalidate(() => false);
  assert.match(JSON.stringify(await first.event()), /访问已撤销/);
  const next = await app.connect(); next.ws.send(JSON.stringify({ type: 'start', mime: 'audio/webm;codecs=opus' }));
  assert.equal((await next.event()).type, 'ready');
});

test('oversized WebSocket frames close only that voice connection and free the host slot', async t => {
  const app = await fixture(t), first = await app.connect();
  first.ws.send(JSON.stringify({ type: 'start', mime: 'audio/webm;codecs=opus' })); await first.event();
  const closed = once(first.ws, 'close'); first.ws.send(Buffer.alloc(VOICE_MAX_FRAME + 1)); await closed;
  assert.equal(app.audio.length, 0);
  const second = await app.connect(); second.ws.send(JSON.stringify({ type: 'start', mime: 'audio/mp4' }));
  assert.equal((await second.event()).type, 'ready');
});
