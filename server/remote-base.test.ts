import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteHtml, remoteManifest } from './remote-base.ts';

test('installed machine launcher retains the relay device scope and local icon paths', () => {
  const base = '/connect/d/0123456789abcdef';
  const manifest = JSON.parse(remoteManifest(JSON.stringify({ start_url: './#/machines', scope: './', icons: [{ src: '/icon-192.png' }] }), base));
  assert.equal(manifest.start_url, `${base}/#/machines`);
  assert.equal(manifest.scope, `${base}/`);
  assert.equal(manifest.id, `${base}/`);
  assert.equal(manifest.icons[0].src, `${base}/icon-192.png`);
  assert.match(remoteHtml('<head><link href="/manifest.webmanifest"><script src="/assets/main.js"></script>', base), /sessiondeck-base/);
});
