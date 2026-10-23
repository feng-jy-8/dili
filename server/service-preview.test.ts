import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServicePreviewInput, parseServicePreviewUrl } from '../shared/service-preview.ts';

test('service preview accepts loopback and private LAN shortcuts', () => {
  assert.equal(normalizeServicePreviewInput(':5173'), 'http://127.0.0.1:5173');
  assert.equal(normalizeServicePreviewInput('3000'), 'http://127.0.0.1:3000');
  assert.deepEqual(parseServicePreviewUrl('http://10.11.1.111:5173/'), { ok: true, url: 'http://10.11.1.111:5173/' });
  assert.deepEqual(parseServicePreviewUrl('192.168.1.8:8080'), { ok: true, url: 'http://192.168.1.8:8080/' });
  assert.deepEqual(parseServicePreviewUrl('https://127.0.0.1:4173/app'), { ok: true, url: 'https://127.0.0.1:4173/app' });
  assert.equal(parseServicePreviewUrl('http://172.16.0.2:3000').ok, true);
});

test('service preview rejects public hosts, credentials and non-http schemes', () => {
  assert.equal(parseServicePreviewUrl('https://example.com').ok, false);
  assert.equal(parseServicePreviewUrl('http://8.8.8.8:80').ok, false);
  assert.equal(parseServicePreviewUrl('file:///etc/passwd').ok, false);
  assert.equal(parseServicePreviewUrl('javascript:alert(1)').ok, false);
  assert.equal(parseServicePreviewUrl('http://user:pass@127.0.0.1:5173').ok, false);
  assert.equal(parseServicePreviewUrl('').ok, false);
});
