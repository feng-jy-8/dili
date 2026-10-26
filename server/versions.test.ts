import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, latestStableTag, stableVersion } from '../shared/versions';

test('stable updates compare numeric versions and ignore previews and malformed tags', () => {
  assert.equal(compareVersions('v0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.5.2', 'v1.0.0'), -1);
  for (const tag of ['v01.0.0', 'v1.0', 'v2.0.0-beta.1', 'latest', '1.0.0+build']) assert.equal(stableVersion(tag), null);
  assert.equal(latestStableTag([{ name: 'v0.9.9' }, null, { name: 'v5.0.0-beta' }, { name: 'v0.10.0' }]), 'v0.10.0');
  assert.equal(latestStableTag([]), null);
  assert.throws(() => latestStableTag({ message: 'API limit' }));
});
