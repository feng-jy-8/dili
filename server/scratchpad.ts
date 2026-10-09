import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { MAX_SCRATCHPAD_LENGTH, type Scratchpad } from '../shared/scratchpad.ts';

/** A private global note, included in the existing SQLite backup. */
export class ScratchpadStore {
  constructor(private db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS scratchpad (slot INTEGER PRIMARY KEY CHECK(slot = 1), id TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT)');
    db.prepare('INSERT OR IGNORE INTO scratchpad VALUES (1, ?, ?, 0, NULL)').run(randomUUID(), '');
  }
  read(): Scratchpad {
    const row = this.db.prepare('SELECT id, content, revision, updated_at FROM scratchpad WHERE slot = 1').get()!;
    return { id: String(row.id), content: String(row.content), revision: Number(row.revision), updatedAt: row.updated_at === null ? null : String(row.updated_at) };
  }
  save(input: { id?: unknown; content?: unknown; revision?: unknown }): Scratchpad {
    if (typeof input.content !== 'string' || input.content.length > MAX_SCRATCHPAD_LENGTH || input.content.includes('\0')) {
      throw Object.assign(new Error(`笔记无效（最多 ${MAX_SCRATCHPAD_LENGTH} 字符）`), { status: 400 });
    }
    if (typeof input.id !== 'string' || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) {
      throw Object.assign(new Error('笔记版本无效'), { status: 400 });
    }
    const current = this.read();
    if (input.id !== current.id) throw Object.assign(new Error('笔记来源已变化，请重新读取'), { status: 409 });
    // Resolve a retry after an acknowledgement was lost without creating a new version.
    if (input.content === current.content) return current;
    const result = this.db.prepare('UPDATE scratchpad SET content = ?, revision = revision + 1, updated_at = ? WHERE slot = 1 AND id = ? AND revision = ?')
      .run(input.content, new Date().toISOString(), input.id, Number(input.revision));
    if (!result.changes) throw Object.assign(new Error('笔记已在其他页面更新，请核对后再保存'), { status: 409 });
    return this.read();
  }
}
