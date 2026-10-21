import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

// Real container decoding, with a tiny model double: no pip installs, network,
// owner model cache or microphone. CI without Python/FFmpeg skips explicitly.
for (const format of ['webm', 'ogg', 'mp4']) test(`voice Python worker streams ${format} before stop and finalizes decoded audio`, { timeout: 15000 }, async t => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
  catch { t.skip('Python3 and FFmpeg are required for decoder fixture'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'dili-voice-worker-'));
  // Stub only ML dependencies. FFmpeg processes the real compressed bytes.
  await writeFile(join(directory, 'torch.py'), 'def set_num_threads(n): pass\n');
  await writeFile(join(directory, 'imageio_ffmpeg.py'), 'import shutil\ndef get_ffmpeg_exe(): return shutil.which("ffmpeg")\n');
  await writeFile(join(directory, 'numpy.py'), `float32 = 'float32'
class Samples:
    def __init__(self, size): self.size = size
    def __len__(self): return self.size
    def astype(self, _): return self
    def __truediv__(self, _): return self
def frombuffer(raw, dtype): return Samples(len(raw) // 2)
def zeros(size, dtype): return Samples(size)
`);
  await writeFile(join(directory, 'funasr.py'), `class AutoModel:
    def __init__(self, **kwargs): pass
    def generate(self, input, cache, is_final, **kwargs):
        assert len(input) > 0 and len(input) <= 9600
        cache['frames'] = cache.get('frames', 0) + 1
        return [{'text': '结束' if is_final else '语音'}]
`);
  const codec = format === 'mp4' ? ['-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '250000'] : ['-c:a', 'libopus', '-b:a', '24k'];
  const audio = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4.2', '-ac', '1', '-ar', '16000', ...codec, '-f', format, 'pipe:1']);
  const child = spawn('python3', ['-u', 'server/voice-worker.py'], { env: { ...process.env, PYTHONPATH: directory + (process.env.PYTHONPATH ? delimiter + process.env.PYTHONPATH : '') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data.toString(); });
  const messages: { type: string; text?: string; final?: boolean }[] = [];
  createInterface({ input: child.stdout }).on('line', line => { messages.push(JSON.parse(line)); });
  t.after(async () => { child.stdin.end(); if (child.exitCode === null) { const exited = once(child, 'exit'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000); await exited; clearTimeout(timer); } await rm(directory, { recursive: true, force: true }); });
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) { if (Date.now() > deadline || child.exitCode !== null) assert.fail(`worker timeout/exit: ${stderr} ${JSON.stringify(messages)}`); await new Promise(resolve => setTimeout(resolve, 15)); }
  };
  await until(() => messages.some(message => message.type === 'ready'));
  const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
  send({ type: 'start', id: 'recording', mime: format === 'mp4' ? 'audio/mp4' : `audio/${format};codecs=opus` });
  const split = Math.floor(audio.length * .8);
  send({ type: 'audio', id: 'recording', audio: audio.subarray(0, split).toString('base64') });
  await until(() => messages.some(message => message.type === 'transcript' && !message.final));
  assert.ok(!messages.some(message => message.final), 'interim arrives while stream remains open');
  send({ type: 'audio', id: 'recording', audio: audio.subarray(split).toString('base64') });
  send({ type: 'stop', id: 'recording' });
  await until(() => messages.some(message => message.final));
  assert.ok(messages.at(-1)?.text?.endsWith('结束'));
  assert.ok(!messages.some(message => message.type === 'fatal' || message.type === 'error'), stderr);
});
