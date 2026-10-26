import test from 'node:test';
import assert from 'node:assert/strict';
import qrcode from '../client/vendor/qrcode.js';
import decode from '../client/vendor/jsqr.js';

test('device QR encoder and camera decoder round-trip the full URL and Chinese device name', () => {
  const link = 'https://dili.discoverpaw.com/#/machines?add=' + encodeURIComponent('https://dili.discoverpaw.com/connect/d/abcdefghijklmnop/') + '&name=' + encodeURIComponent('我的开发电脑');
  const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
  const scale = 6, margin = 4, size = (qr.getModuleCount() + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin;
    if (row >= 0 && col >= 0 && row < qr.getModuleCount() && col < qr.getModuleCount() && qr.isDark(row, col)) pixels.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
  }
  assert.equal(decode(pixels, size, size)?.data, link);
});
