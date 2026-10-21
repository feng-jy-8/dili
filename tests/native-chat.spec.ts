import { test, expect, type Page } from '@playwright/test';
import type { AppState, ConversationMessage, Session } from '../shared/types';

async function fixture(page: Page, backend: 'claude' | 'dsh') {
  const seed = await (await page.request.get('/api/state')).json() as AppState;
  const contact: Session = {...seed.sessions[0], id:'native-chat-' + backend,backend,title:backend+' 图形发送',running:true,status:'running',statusSource:'native',nativeSessionId:'test-thread',forkPending:false};
  const state: AppState = {...seed,demo:false,sessions:[contact],groups:[],activities:[],backends:seed.backends.map(item=>item.id===backend?{...item,installed:true,capabilities:{...item.capabilities,terminal:true}}:item)};
  const result = {directSubmit:true,status:'accepted',reject:false,posts:[] as Record<string,unknown>[],wait:undefined as Promise<void>|undefined};
  await page.addInitScript(backend=>{
    localStorage.setItem('sessiondeck.private-view.'+backend,'conversation');
    const sources: EventTarget[] = [];
    Object.assign(window, { nativeChatSources: sources });
    class Source extends EventTarget {onopen: (()=>void)|null=null;onerror:(()=>void)|null=null;constructor(){super();sources.push(this);queueMicrotask(()=>this.onopen?.());}close(){sources.splice(sources.indexOf(this),1);}}
    Object.defineProperty(window,'EventSource',{value:Source});
  },backend);
  await page.route('**/api/state',route=>route.fulfill({json:state}));
  await page.route('**/api/config',route=>route.fulfill({json:{csrfToken:'test-token'}}));
  await page.route('**/api/sessions/'+contact.id+'/read',route=>route.fulfill({json:contact}));
  const transcript = {messages:[] as ConversationMessage[],truncated:false};
  await page.route('**/api/sessions/'+contact.id+'/conversation',route=>route.fulfill({json:transcript}));
  await page.route('**/api/sessions/'+contact.id+'/input*',async route=>{
    if(route.request().method()==='GET') return route.fulfill({json:{generation:'test-generation',directSubmit:result.directSubmit,submission:{status:result.status}}});
    result.posts.push(route.request().postDataJSON());
    if(result.wait) await result.wait;
    return route.fulfill(result.reject?{status:409,json:{error:'请先处理原生审批'}}:{status:result.status==='unknown'?202:200,json:{status:result.status,submitted:result.status==='accepted'}});
  });
  await page.route('**/api/sessions/'+contact.id+'/attachments',route=>route.fulfill({status:201,json:{id:'image-1',name:'图片.png',type:'image/png',size:68}}));
  await page.goto('/#/contacts?session='+contact.id);
  await expect(page.getByLabel('原生会话消息草稿')).toBeVisible();
  return {contact,state,result,transcript,input:page.getByLabel('原生会话消息草稿'),send:page.getByRole('button',{name:'发送',exact:true}),publish:async()=>{
    state.revision=(state.revision??0)+1;
    await page.evaluate(state=>{for(const source of (window as unknown as {nativeChatSources:EventTarget[]}).nativeChatSources) source.dispatchEvent(new MessageEvent('state',{data:JSON.stringify(state)}));},state);
  }};
}

for(const backend of ['claude','dsh'] as const) {
  test(`${backend} immediately acknowledges sending, bridges delayed native status and stops on completion or approval`,async({page})=>{
    const app=await fixture(page,backend),activity=page.getByRole('status',{name:'会话响应状态'});
    app.contact.status='waiting_input';app.contact.statusSource='native';await app.publish();
    await expect(activity).toHaveCount(0);
    let release!:()=>void;app.result.wait=new Promise<void>(resolve=>{release=resolve;});
    await app.input.fill('需要长时间思考的任务');await app.send.click();
    await expect(activity).toHaveText('正在发送…');
    await expect.poll(()=>app.result.posts.length).toBe(1);release();
    await expect(app.input).toHaveValue('');await expect(activity).toContainText('正在等待后端响应');
    app.contact.status='running';await app.publish();await expect(activity).toHaveText('正在处理任务…');
    await page.setViewportSize({width:390,height:844});
    await expect(activity).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:'artifacts/'+backend+'-chat-activity-mobile.png'});
    app.contact.status='waiting_approval';await app.publish();await expect(activity).toHaveCount(0);
    app.contact.status='running';await app.publish();await expect(activity).toBeVisible();
    app.transcript.messages.push({id:'answer',role:'assistant',text:'完成任务。'});
    app.contact.status='waiting_input';app.contact.lastAttentionKey='completed-turn';await app.publish();
    await expect(activity).toHaveCount(0);await expect(page.locator('.conversation-text')).toHaveText('完成任务。');
    expect(app.result.posts).toHaveLength(1);
  });

  test(`${backend} does not resurrect thinking when completion precedes send acknowledgement or submission fails`,async({page})=>{
    const app=await fixture(page,backend),activity=page.getByRole('status',{name:'会话响应状态'});
    app.contact.status='waiting_input';app.contact.statusSource='native';await app.publish();
    let release!:()=>void;app.result.wait=new Promise<void>(resolve=>{release=resolve;});
    await app.input.fill('很快完成');await app.send.click();await expect.poll(()=>app.result.posts.length).toBe(1);
    app.contact.lastAttentionKey='fast-completion';await app.publish();release();
    await expect(app.input).toHaveValue('');await expect(activity).toHaveCount(0);
    app.result.wait=undefined;app.result.reject=true;
    await app.input.fill('失败时保留');await app.send.click();await expect(page.getByRole('alert')).toContainText('请先处理原生审批');
    await expect(activity).toHaveCount(0);await expect(app.input).toHaveValue('失败时保留');
    app.result.reject=false;app.result.status='unknown';await app.send.click();
    await expect(page.getByRole('button',{name:'核对发送结果',exact:true})).toBeVisible();
    app.result.status='accepted';await page.getByRole('button',{name:'核对发送结果',exact:true}).click();
    await expect(app.input).toHaveValue('');await expect(activity).toHaveCount(0);
  });

  test(`${backend} queues, edits and cancels messages and releases only on native completion`,async({page})=>{
    const app=await fixture(page,backend),queue=page.getByRole('region',{name:'待发送消息'});
    await app.input.fill('排队任务一');await page.getByRole('button',{name:'加入队列',exact:true}).click();
    await expect(queue).toContainText('排队任务一');await expect(app.input).toHaveValue('');
    await queue.getByRole('button',{name:'编辑',exact:true}).click();await expect(app.input).toHaveValue('排队任务一');
    await app.input.fill('修改后的任务');await page.getByRole('button',{name:'加入队列',exact:true}).click();
    await app.input.fill('取消的任务');await page.getByRole('button',{name:'加入队列',exact:true}).click();
    await queue.getByRole('button',{name:'取消排队：取消的任务',exact:true}).click();
    app.contact.status='waiting_input';app.contact.statusSource='terminal';await page.reload();
    await expect(queue).toContainText('修改后的任务');expect(app.result.posts).toHaveLength(0);
    app.contact.statusSource='native';await page.reload();
    await expect(app.input).toBeVisible();
    await expect.poll(()=>app.result.posts.length).toBe(1);
    await expect(queue).toHaveCount(0);
    expect(app.result.posts[0]).toMatchObject({text:'修改后的任务',submit:true});
  });

  test(`${backend} leaves uncertain queued sends paused and preserves a newer editor`,async({page})=>{
    const app=await fixture(page,backend),queue=page.getByRole('region',{name:'待发送消息'});
    await app.input.fill('只发一次');await page.getByRole('button',{name:'加入队列',exact:true}).click();
    await expect(queue).toContainText('只发一次');await app.input.fill('正在编辑的新草稿');
    app.result.status='unknown';await queue.getByRole('button',{name:'立即发送',exact:true}).click();
    await expect(queue).toContainText('已暂停');await page.reload();await expect(queue).toBeVisible();
    expect(app.result.posts).toHaveLength(1);await expect(app.input).toHaveValue('正在编辑的新草稿');
    app.result.status='accepted';await page.getByRole('button',{name:'核对发送结果',exact:true}).click();
    await expect(queue).toHaveCount(0);await expect(app.input).toHaveValue('正在编辑的新草稿');
    expect(app.result.posts).toHaveLength(1);
  });

  test(`${backend} sends directly with IME and multiline support and keeps edits made during sending`,async({page})=>{
    const app=await fixture(page,backend);
    await app.input.fill('中文候选');
    await app.input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});
    expect(app.result.posts).toEqual([]);
    await app.input.press('End'); await app.input.press('Shift+Enter'); await app.input.pressSequentially('second line');
    await expect(app.input).toHaveValue('中文候选\nsecond line');
    let release!:()=>void; app.result.wait=new Promise<void>(resolve=>{release=resolve;});
    await app.input.press('Enter');
    await expect.poll(()=>app.result.posts.length).toBe(1);
    await expect(page.getByRole('button',{name:'正在发送…',exact:true})).toBeDisabled();
    await app.input.fill('发送期间写下一条');
    release();
    await expect(app.send).toBeEnabled();
    await expect(app.input).toHaveValue('发送期间写下一条');
    await expect(page.getByRole('button',{name:'对话记录',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(app.result.posts[0]).toMatchObject({text:'中文候选\nsecond line',submit:true,generation:'test-generation'});
    await page.screenshot({path:'artifacts/'+backend+'-direct-graphical-chat.png'});
  });

  test(`${backend} image-only sends and uncertain results recover without another submission`,async({page})=>{
    const app=await fixture(page,backend);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
    await page.locator('.image-composer input[type=file]').setInputFiles({name:'图片.png',mimeType:'image/png',buffer:png});
    await expect(page.getByLabel('待发送图片')).toBeVisible();
    app.result.status='unknown'; await app.send.click();
    await expect(page.getByRole('button',{name:'核对发送结果',exact:true})).toBeVisible();
    expect(app.result.posts).toHaveLength(1);
    expect(app.result.posts[0]).toMatchObject({text:'',attachments:['image-1'],submit:true});
    await app.input.fill('核对期间的新草稿');
    await page.reload(); await expect(app.input).toHaveValue('核对期间的新草稿');
    await expect(app.send).toBeDisabled();
    app.result.status='accepted'; await page.getByRole('button',{name:'核对发送结果',exact:true}).click();
    await expect(page.getByLabel('待发送图片')).toHaveCount(0);
    await expect(app.input).toHaveValue('核对期间的新草稿'); await expect(app.send).toBeEnabled();
    expect(app.result.posts).toHaveLength(1);
  });

  test(`${backend} rejects old backends and pending approvals without discarding drafts`,async({page})=>{
    const app=await fixture(page,backend);
    await app.input.fill('必须保留的草稿');
    app.result.directSubmit=false; await app.send.click();
    await expect(page.getByRole('alert')).toContainText('尚未加载直接发送功能');
    expect(app.result.posts).toEqual([]); await expect(app.input).toHaveValue('必须保留的草稿');
    app.result.directSubmit=true; app.result.reject=true; await app.send.click();
    await expect(page.getByRole('alert')).toContainText('请先处理原生审批');
    await expect(app.send).toBeEnabled(); await expect(app.input).toHaveValue('必须保留的草稿');
    app.contact.status='waiting_approval'; await page.reload();
    await expect(app.send).toBeDisabled(); await expect(app.input).toHaveValue('必须保留的草稿');
    expect(app.result.posts).toHaveLength(1);
  });
}
