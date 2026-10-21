"""Optional FunASR streaming worker. No network listener and no audio files.

stdin/stdout are a private NDJSON protocol to the owning Dili process. FunASR
and FFmpeg logs go to stderr, never into transcript frames.
"""
import base64
import contextlib
import json
import queue
import subprocess
import sys
import threading

protocol = sys.stdout
sys.stdout = sys.stderr
output_lock = threading.Lock()
inference_lock = threading.Lock()


def emit(value):
    with output_lock:
        protocol.write(json.dumps(value, ensure_ascii=False) + '\n')
        protocol.flush()


try:
    import numpy as np
    import torch
    import imageio_ffmpeg
    from funasr import AutoModel

    torch.set_num_threads(2)
    model = AutoModel(model='paraformer-zh-streaming', model_revision='v2.0.4',
                      device='cpu', ncpu=2, disable_update=True,
                      disable_pbar=True, trust_remote_code=False)
    decoder = imageio_ffmpeg.get_ffmpeg_exe()
    emit({'type': 'ready'})
except Exception as error:
    print(str(error), file=sys.stderr)
    emit({'type': 'fatal', 'error': 'FunASR 加载失败，请检查模型下载和 Python 依赖'})
    sys.exit(1)


class Recording:
    def __init__(self, identity, mime):
        self.identity = identity
        self.cancelled = False
        self.finishing = False
        self.audio = queue.Queue(maxsize=16)
        self.cache = {}
        self.text = ''
        container = 'mp4' if mime == 'audio/mp4' else 'ogg' if 'ogg' in mime else 'webm'
        self.process = subprocess.Popen(
            [decoder, '-hide_banner', '-loglevel', 'error', '-probesize', '4096',
             '-analyzeduration', '1', '-f', container, '-i', 'pipe:0',
             '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        threading.Thread(target=self.consume, daemon=True).start()
        threading.Thread(target=self.write_audio, daemon=True).start()

    def enqueue(self, raw):
        if self.cancelled:
            return
        try:
            self.audio.put_nowait(raw)
        except queue.Full:
            emit({'type': 'error', 'id': self.identity,
                  'error': '主机识别速度不足，请缩短录音后重试'})
            self.cancel()

    def write_audio(self):
        try:
            while not self.cancelled:
                try:
                    raw = self.audio.get(timeout=0.2)
                except queue.Empty:
                    continue
                if raw is None:
                    self.process.stdin.close()
                    return
                self.process.stdin.write(raw)
                self.process.stdin.flush()
        except Exception:
            if not self.cancelled:
                emit({'type': 'error', 'id': self.identity,
                      'error': '音频解码连接失败，请重试'})
                self.cancel()

    def recognize(self, raw, final):
        if self.cancelled:
            return
        samples = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
        if not len(samples):
            samples = np.zeros(800, dtype=np.float32)
        with inference_lock:
            if self.cancelled:
                return
            result = model.generate(input=samples, cache=self.cache, is_final=final,
                                    chunk_size=[0, 10, 5], encoder_chunk_look_back=4,
                                    decoder_chunk_look_back=1, disable_pbar=True)
        piece = ''.join(item.get('text', '') for item in result)
        self.text += piece
        if not self.cancelled and (piece or final):
            emit({'type': 'transcript', 'id': self.identity,
                  'text': self.text[:30000], 'final': final})

    def consume(self):
        try:
            # 600 ms at 16 kHz, 16-bit mono. Small reads are joined into actual
            # model chunks; read() is permitted to return short pipe reads.
            pending = b''
            while True:
                raw = self.process.stdout.read(19200 - len(pending))
                if not raw:
                    break
                pending += raw
                if len(pending) == 19200:
                    self.recognize(pending, False)
                    pending = b''
            code = self.process.wait(timeout=10)
            if not self.cancelled:
                if code != 0:
                    raise RuntimeError('音频格式无法解码，请重试录音或更换浏览器')
                self.recognize(pending, True)
        except Exception as error:
            print(str(error), file=sys.stderr)
            if not self.cancelled:
                emit({'type': 'error', 'id': self.identity, 'error': '语音识别失败，请重试或检查主机语音设置'})
        finally:
            self.cancel()

    def cancel(self):
        self.cancelled = True
        if self.process.poll() is None:
            self.process.kill()
        with contextlib.suppress(Exception):
            self.process.stdin.close()
        with contextlib.suppress(Exception):
            self.process.wait(timeout=5)
        with contextlib.suppress(Exception):
            self.process.stdout.close()


recording = None
try:
    for line in sys.stdin:
        message = json.loads(line)
        kind = message.get('type')
        if kind == 'start':
            if recording:
                recording.cancel()
            recording = Recording(message['id'], message['mime'])
        elif recording and message.get('id') == recording.identity:
            if kind == 'audio' and not recording.finishing:
                recording.enqueue(base64.b64decode(message['audio']))
            elif kind == 'stop':
                recording.finishing = True
                recording.enqueue(None)
            elif kind == 'cancel':
                recording.cancel()
except Exception as error:
    print(str(error), file=sys.stderr)
    emit({'type': 'fatal', 'error': '语音工作进程连接中断，请重试'})
finally:
    if recording:
        recording.cancel()
