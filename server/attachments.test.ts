import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Attachments } from './attachments.ts';
import { ChatSubmissions } from './chat-submissions.ts';
import { sendTerminalInput } from '../client/terminal-input.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9V8AAAAASUVORK5CYII=','base64');

test('uploaded images stay private, persist across readers, and cannot cross contacts or accept arbitrary paths', async t => {
  const directory = await mkdtemp(join(tmpdir(),'dili-attachments-'));
  const db = new DatabaseSync(':memory:');
  t.after(async()=>{ db.close(); await rm(directory,{recursive:true,force:true}); });
  const files = new Attachments(db,directory);
  const item = await files.add('contact-a','image/png',png,'截图.png');
  assert.equal(item.name,'截图.png');
  assert.equal((await stat(files.path(item))).mode & 0o777,0o600);
  assert.deepEqual(files.resolve('contact-a',[item.id]),[files.path(item)]);
  assert.deepEqual(new Attachments(db,directory).get('contact-a',item.id),item);
  assert.throws(()=>files.resolve('contact-b',[item.id]),/不属于/);
  assert.throws(()=>files.resolve('contact-a',['/etc/passwd']),/标识/);
  assert.throws(()=>files.resolve('contact-a',[item.id,item.id]),/不可重复/);
  assert.throws(()=>files.resolve('contact-a',Array.from({length:9},()=>item.id)),/最多/);
  await assert.rejects(files.add('contact-a','image/png',Buffer.from('<svg onload="alert(1)"/>'),'fake.png'),/格式/);
  await assert.rejects(files.add('contact-a','image/png',Buffer.alloc(10*1024*1024+1),'large.png'),/超过/);
  const attempts = new ChatSubmissions(db);
  const hash = JSON.stringify(['',[item.id]]);
  assert.equal(attempts.begin('contact-a','same-request','native-a',hash).created,true);
  assert.equal(attempts.begin('contact-a','same-request','native-a',hash).created,false);
  assert.throws(()=>attempts.begin('contact-a','same-request','native-a',JSON.stringify(['',[]])),/其他内容/);
});

test('long terminal paste is sent in bounded frames with Unicode and control bytes preserved exactly',()=>{
  const frames:string[]=[];
  const text='\x1b[200~'+'中文🙂'.repeat(25000)+'\n尾行\x1b[201~';
  sendTerminalInput({send:data=>frames.push(String(data))},text);
  const chunks=frames.map(frame=>JSON.parse(frame).data as string);
  assert.equal(chunks.join(''),text);
  assert.ok(chunks.every(chunk=>chunk.length<=4096));
  assert.ok(chunks.every(chunk=>!/[\uD800-\uDBFF]$/.test(chunk)));
});
