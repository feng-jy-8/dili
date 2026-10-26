import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayBandwidth, parseNetworkCounters } from './relay-bandwidth.ts';
const row = (name: string, rx: number, tx: number) => `${name}: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0`;
test('network rates exclude loopback, respect interface selection and recover from reset or read failure', () => {
  let now = 0, source = row('eth0', 100, 200) + '\n' + row('lo', 900, 900) + '\n' + row('docker0', 400, 400), failed = false;
  const sampler = new RelayBandwidth(['eth0'], 100, () => { if (failed) throw Error(); return source; }, () => now);
  assert.equal(parseNetworkCounters(source).length, 2);
  sampler.sample(); assert.equal(sampler.snapshot().current, null);
  now = 5000; source = row('eth0', 5100, 10200); sampler.sample();
  assert.deepEqual(sampler.snapshot().current, { at: 5000, inbound: 1000, outbound: 2000 });
  now += 5000; source = row('eth0', 1, 1); sampler.sample();
  assert.equal(sampler.snapshot().current?.inbound, 0);
  failed = true; sampler.sample(); assert.equal(sampler.snapshot().available, false); assert.equal(sampler.snapshot().current, null);
  now += 5000; failed = false; sampler.sample(); assert.equal(sampler.snapshot().available, true); assert.equal(sampler.snapshot().current, null);
  now += 5000; source = row('docker0', 123, 456); sampler.sample(); assert.equal(sampler.snapshot().available, false);
});
test('bandwidth history is bounded to thirty minutes and missing Linux metrics are unavailable', () => {
  let now = 0;
  const sampler = new RelayBandwidth([], null, () => row('eth0', now, now * 2), () => now);
  for (let i = 0; i < 500; i++) { now += 5000; sampler.sample(); }
  assert.equal(sampler.snapshot().history.length, 360);
  assert.equal(sampler.snapshot().current?.inbound, 1000);
  const missing = new RelayBandwidth([], null, () => 'not network counters');
  missing.sample(); assert.equal(missing.snapshot().available, false);
});
