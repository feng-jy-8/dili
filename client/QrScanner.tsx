import { useEffect, useRef, useState } from 'react';

export default function QrScanner({ found, close }: { found: (value: string) => void; close: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false, stream: MediaStream | undefined, frame = 0;
    const stop = () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); };
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('此浏览器不能开启相机，请使用系统相机扫码，或手动填写机器链接。');
      const decode = (await import('./vendor/jsqr')).default;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (stopped) { stop(); return; }
      const element = video.current!; element.srcObject = stream; await element.play();
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true })!;
      let last = 0;
      const scan = (now: number) => {
        if (stopped) return;
        if (element.readyState >= 2 && now - last > 250) {
          last = now; canvas.width = Math.min(720, element.videoWidth); canvas.height = Math.round(canvas.width * element.videoHeight / element.videoWidth);
          context.drawImage(element, 0, 0, canvas.width, canvas.height);
          const code = decode(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
          if (code?.data) { stop(); found(code.data); return; }
        }
        frame = requestAnimationFrame(scan);
      };
      frame = requestAnimationFrame(scan);
    })().catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : '相机不可用'); stop(); });
    return stop;
  }, [found]);
  return <section className="machine-scanner" aria-label="扫描设备二维码"><div><strong>扫描 Dili 设备二维码</strong><button className="text-button" onClick={close}>关闭相机</button></div>{error ? <p role="alert">{error}</p> : <><video ref={video} autoPlay muted playsInline /><p>将电脑显示的二维码放入取景框</p></>}</section>;
}
