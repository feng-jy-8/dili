import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScratchpadStore } from './scratchpad.ts';
import { MAX_SCRATCHPAD_LENGTH } from '../shared/scratchpad.ts';
import { authorize } from './access.ts';

test('scratchpad survives reopening, preserves exact Markdown and rejects stale edits', t => {
  const directory = mkdtempSync(join(tmpdir(), 'sessiondeck-note-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, 'notes.sqlite');
  let db = new DatabaseSync(path);
  let store = new ScratchpadStore(db);
  const initial = store.read();
  const content = '# 今日\n\n- [ ] 实现笔记  \n\n```sh\npwd\n```\n';
  const saved = store.save({ ...initial, content });
  assert.equal(saved.content, content);
  assert.equal(saved.revision, 1);
  assert.equal(store.save({ ...initial, content }).revision, 1, 'lost acknowledgement retry is idempotent');
  assert.throws(() => store.save({ ...initial, content: 'outdated' }), { status: 409 });
  db.close();
  db = new DatabaseSync(path); store = new ScratchpadStore(db);
  t.after(() => db.close());
  assert.deepEqual(store.read(), saved);
  const cleared = store.save({ ...saved, content: '' });
  assert.equal(cleared.revision, 2);
  assert.throws(() => store.save({ ...saved, content }), { status: 409 }, 'a stale device cannot undo deletion');
  assert.equal(store.save({ ...cleared, content }).content, content, 'explicit undo uses the current revision');
});

test('scratchpad validates size and identity and remains private to the owner', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const store = new ScratchpadStore(db), note = store.read();
  for (const content of [null, 42, 'bad\0text', 'x'.repeat(MAX_SCRATCHPAD_LENGTH + 1)]) {
    assert.throws(() => store.save({ ...note, content }), { status: 400 });
  }
  assert.throws(() => store.save({ ...note, id: 'another-note', content: 'x' }), { status: 409 });
  for (const method of ['GET', 'PATCH']) {
    assert.equal(authorize({ kind: 'owner', local: false, deviceId: 'owner' }, true, method, '/api/scratchpad').allowed, true);
    assert.equal(authorize({ kind: 'share', deviceId: 'viewer', shareId: 'link', sessionId: 'a', mode: 'write', name: 'viewer' }, true, method, '/api/scratchpad').allowed, false);
    assert.equal(authorize(null, true, method, '/api/scratchpad').allowed, false);
  }
  assert.deepEqual(store.read(), note);
});
