import test from 'node:test';
import assert from 'node:assert/strict';
import { DotInboxClient, DOT_INBOX_STORAGE_KEY, DOT_INBOX_PAGE_LIMIT, DOT_INBOX_IMPORT_LIMIT } from './src/dotInboxClient.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const time='2026-10-10T00:00:00.000Z', code='dot_read_'+'a'.repeat(64), otherCode='dot_read_'+'b'.repeat(64);
const id=n=>createHash('sha256').update(String(n)).digest('hex');
const material=n=>({category:'tutorial',original_url:`https://x.com/example/status/${n}`,author_handle:'example',published_at:null,
  title_zh:'【检查示例】整理公开字幕',summary_zh:'【检查示例】作者记录了三步流程，尚未实测。',bookmark_count:380,like_count:251,view_count:null,
  metric_display:'收藏380；点赞251；浏览未知',metrics_checked_at:time,metrics_source_url:`https://x.com/example/status/${n}`,read_scope:'main_post',
  selection_reason:'可对照自己的公开素材操作。',my_angle:'先试一小段。',unknowns:['没有观看视频','未实测']});
const payload=(items=[])=>({format:'woyun-feed:candidates',version:1,collector:'Dot',collected_at:time,items,alternatives:[]});
const batch=(n,items=[])=>({id:id(n),received_at:time,item_count:items.length,collector:'Dot',collected_at:time,payload:payload(items)});
const metadata=batch=>Object.fromEntries(['id','received_at','item_count','collector','collected_at'].map(key=>[key,batch[key]]));
const entry=batch=>({id:batch.id,received_at:batch.received_at,payload:batch.payload});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json;charset=utf-8'}});

function storageFixture() {
  const values=new Map();
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),key:n=>[...values.keys()][n]??null,get length(){return values.size;}};
  return {values,storage};
}
function config(seen=[]) {return {version:1,review_code:code,seen_batch_ids:seen,last_synced_at:null,scan_cursor:null};}
function fixture(batches=[],options={}) {
  const {values,storage}=storageFixture(),calls=[];
  const fetcher=async(path,request)=>{
    calls.push({path,request});
    const suffix=path.slice('/api/dot/inbox'.length).split('?')[0];
    if(!suffix) return response({batches:batches.map(metadata),next_cursor:null});
    const found=batches.find(batch=>`/${batch.id}`===suffix);
    return found ? response(entry(found)) : response({},404);
  };
  const client=new DotInboxClient({storage,fetcher,now:()=>time,...options});
  return {values,storage,calls,client};
}

test('one-time connection authenticates before storing, keeps reader outside UI state and sends only same-origin read requests',async()=>{
  const {client,storage,calls}=fixture([batch(1)]);
  assert.deepEqual(client.getState(),{connected:false,lastSyncedAt:null,warning:''});
  await client.connect(code);
  assert.equal(client.getState().connected,true);
  assert.ok(!JSON.stringify(client.getState()).includes(code));
  assert.deepEqual(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)),config());
  let imports=0; await client.sync(raw=>{imports++; assert.equal(JSON.parse(raw).format,'woyun-feed:candidates');return {added:0,duplicates:0,existing:0};});
  assert.equal(imports,1);
  for(const {path,request} of calls) {
    assert.ok(path.startsWith('/api/dot/inbox'));assert.ok(!path.includes(code));assert.equal(request.method,'GET');
    assert.equal(request.headers.Authorization,`Bearer ${code}`);assert.equal(request.credentials,'omit');assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');
    assert.equal(request.body,undefined);
  }
});

test('native Window-style fetch retains its required browser receiver for connect and automatic reads',async()=>{
  const one=batch(1),{storage}=storageFixture();let calls=0;
  async function receiverSensitiveFetch(path) {
    if(this!==globalThis) throw new TypeError('Illegal invocation: fetch requires the Window receiver');
    calls++;
    return path.includes(one.id) ? response(entry(one)) : response({batches:[metadata(one)],next_cursor:null});
  }
  // This models the old object-method invocation and proves the fixture catches
  // the failure that arrow fetch mocks and Node's fetch otherwise hide.
  await assert.rejects(({fetcher:receiverSensitiveFetch}).fetcher('/api/dot/inbox'),/Illegal invocation/);
  const client=new DotInboxClient({storage,fetcher:receiverSensitiveFetch,now:()=>time});
  await client.connect(code);
  const result=await client.sync(()=>({added:1,duplicates:0,existing:0}));
  assert.equal(result.added,1);assert.equal(client.getState().connected,true);assert.equal(calls,3);
});

test('unreadable configuration remains byte-for-byte unchanged until explicit disconnect',async()=>{
  for(const raw of ['not-json',JSON.stringify({...config(),seen_batch_ids:['bad']}),JSON.stringify({...config(),unknown_field:'sensitive'})]) {
    const {storage}=storageFixture();storage.setItem(DOT_INBOX_STORAGE_KEY,raw);
    let requests=0;const client=new DotInboxClient({storage,fetcher:()=>{requests++;throw Error('must not request');}});
    assert.match(client.getState().warning,/暂停自动接收/);
    assert.equal((await client.sync(()=>{})).disconnected,true);assert.equal(requests,0);
    await assert.rejects(client.connect(code),/清除/);assert.equal(storage.getItem(DOT_INBOX_STORAGE_KEY),raw);
    client.disconnect();assert.equal(storage.getItem(DOT_INBOX_STORAGE_KEY),null);assert.equal(client.getState().warning,'');
  }
});

test('blocked browser storage getter warns without aborting the app constructor',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('SecurityError');}});
  try {
    let client;assert.doesNotThrow(()=>{client=new DotInboxClient();});assert.equal(client.getState().connected,false);assert.match(client.getState().warning,/暂停自动接收/);
  } finally {if(original) Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;}
});

test('invalid or unauthorized replacement never replaces an existing usable connection or echoes server secrets',async()=>{
  const {client,storage}=fixture();await client.connect(code);const before=storage.getItem(DOT_INBOX_STORAGE_KEY);
  for(const invalid of ['','Bearer '+code,'https://example.test/'+code,code+'\n']) await assert.rejects(client.connect(invalid),/完整的接收码/);
  client.fetcher=async()=>response({error:code},401);
  const failure=await client.connect(otherCode).catch(error=>error);
  assert.match(failure.message,/接收码无效/);assert.ok(!failure.message.includes(code));assert.equal(storage.getItem(DOT_INBOX_STORAGE_KEY),before);
});

test('successful import acknowledges batch after transaction; reload skips it but does not use a permanent date watermark',async()=>{
  const one=batch(1),{client,storage,calls}=fixture([one]);await client.connect(code);
  let saved=false;const first=await client.sync(()=>{assert.deepEqual(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).seen_batch_ids,[]);saved=true;return {added:1,duplicates:2,existing:3};});
  assert.equal(saved,true);assert.deepEqual({added:first.added,duplicates:first.duplicates,existing:first.existing,batches:first.batches},{added:1,duplicates:2,existing:3,batches:1});
  const reload=new DotInboxClient({storage,fetcher:client.fetcher,now:()=>time});
  const second=await reload.sync(()=>{throw Error('already acknowledged');});
  assert.equal(second.batches,0);assert.equal(second.skipped,1);assert.equal(calls.filter(call=>call.path===`/api/dot/inbox/${one.id}`).length,1);
  assert.equal(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).scan_cursor,null);
  assert.ok(calls.every(call=>!call.path.includes('since=')));
});

test('failed local transaction remains unseen and retry receives it once',async()=>{
  const {client,storage}=fixture([batch(1)]);await client.connect(code);
  await assert.rejects(client.sync(()=>{throw Error('quota exhausted '+code);}),/尚未保存/);
  assert.deepEqual(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).seen_batch_ids,[]);
  assert.equal(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).last_synced_at,null);
  const retry=await client.sync(()=>({added:1,duplicates:0,existing:0}));assert.equal(retry.added,1);
  assert.deepEqual(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).seen_batch_ids,[id(1)]);
});

test('connection marker storage failure cannot falsely acknowledge an imported batch; retry safely deduplicates',async()=>{
  const {client,storage}=fixture([batch(1)]);await client.connect(code);const setItem=storage.setItem;
  let saved=false;
  storage.setItem=()=>{throw Error('blocked '+code);};
  await assert.rejects(client.sync(()=>{saved=true;return {added:1,duplicates:0,existing:0};}),/连接设置未能保存/);
  assert.equal(saved,true);assert.deepEqual(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).seen_batch_ids,[]);
  storage.setItem=setItem;
  const retry=await client.sync(()=>({added:0,duplicates:1,existing:0}));assert.equal(retry.duplicates,1);
});

test('malformed metadata, mismatched entry and invalid material are rejected before local import or acknowledgement',async()=>{
  const one=batch(1,[material('2108148604447883464')]);
  const variants=[
    {list:{batches:[{...metadata(one),id:'bad'}],next_cursor:null}},
    {list:{batches:[{...metadata(one),item_count:101}],next_cursor:null}},
    {list:{batches:[metadata(one),metadata(one)],next_cursor:null}},
    {list:{batches:[metadata(one)],next_cursor:'\n'}},
    {document:{...entry(one),id:id(2)}},
    {document:{...entry(one),received_at:'2026-10-09T00:00:00Z'}},
    {document:{...entry(one),payload:payload([{...one.payload.items[0],bookmark_count:-1}])}},
    {document:{...entry(one),payload:payload([])}},
  ];
  for(const variant of variants) {
    const {client,storage}=fixture([one]);await client.connect(code);
    client.fetcher=async path=>path.includes(one.id) ? response(variant.document || entry(one)) : response(variant.list || {batches:[metadata(one)],next_cursor:null});
    let imported=false;await assert.rejects(client.sync(()=>{imported=true;}),/内容不完整/);
    assert.equal(imported,false);assert.deepEqual(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).seen_batch_ids,[]);
  }
});

test('network, timeout, oversized and non-JSON responses leave private state intact and expose no response content',async()=>{
  const {client,storage}=fixture();await client.connect(code);const before=storage.getItem(DOT_INBOX_STORAGE_KEY);
  const variants=[
    async()=>{throw Error(code);},
    async()=>response({secret:code},500),
    async()=>new Response('malformed '+code,{headers:{'Content-Type':'text/html'}}),
    async()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(3*1024*1024)}}),
    async()=>new Response(JSON.stringify({huge:'x'.repeat(2*1024*1024+4100)}),{headers:{'Content-Type':'application/json'}}),
  ];
  for(const fetcher of variants) {
    client.fetcher=fetcher;const error=await client.sync(()=>{}).catch(error=>error);assert.ok(error instanceof Error);assert.ok(!error.message.includes(code));assert.equal(storage.getItem(DOT_INBOX_STORAGE_KEY),before);
  }
  client.timeoutMs=5;client.fetcher=(_path,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout '+code)),{once:true}));
  await assert.rejects(client.sync(()=>{}),/暂时无法连接/);assert.equal(storage.getItem(DOT_INBOX_STORAGE_KEY),before);
});

test('pagination loops stop and previously imported batches remain recoverable',async()=>{
  const one=batch(1),{client,storage}=fixture();await client.connect(code);let listCalls=0,imports=0;
  client.fetcher=async path=>path.includes(one.id) ? response(entry(one)) : response(listCalls++===0 ? {batches:[metadata(one)],next_cursor:'loop'} : {batches:[],next_cursor:'loop'});
  await assert.rejects(client.sync(()=>{imports++;return {added:1,duplicates:0,existing:0};}),/内容不完整/);
  assert.equal(imports,1);assert.equal(listCalls,2);assert.deepEqual(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).seen_batch_ids,[one.id]);
  assert.equal(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).scan_cursor,'loop');
});

test('bounded page scans resume next poll and reset after completion so late-visible batches can still arrive',async()=>{
  const {client,storage}=fixture();await client.connect(code);let pages=0;
  client.fetcher=async path=>{
    const cursor=new URL(path,'https://example.test').searchParams.get('cursor');const page=cursor ? Number(cursor.slice(1)) : 0;pages++;
    return response({batches:[],next_cursor:page===DOT_INBOX_PAGE_LIMIT ? null : `p${page+1}`});
  };
  const first=await client.sync(()=>{});assert.equal(first.more,true);assert.equal(pages,DOT_INBOX_PAGE_LIMIT);
  assert.equal(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).scan_cursor,`p${DOT_INBOX_PAGE_LIMIT}`);
  const second=await client.sync(()=>{});assert.equal(second.more,undefined);assert.equal(pages,DOT_INBOX_PAGE_LIMIT+1);
  assert.equal(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).scan_cursor,null);
  const late=batch('late');client.fetcher=async path=>path.includes(late.id) ? response(entry(late)) : response({batches:[metadata(late)],next_cursor:null});
  assert.equal((await client.sync(()=>({added:1,duplicates:0,existing:0}))).added,1);
});

test('expired cursor recovers from page one next poll while keeping all acknowledged batch IDs',async()=>{
  const {client,storage}=fixture();await client.connect(code);
  storage.setItem(DOT_INBOX_STORAGE_KEY,JSON.stringify({...config([id(1)]),scan_cursor:'expired'}));
  const calls=[];client.fetcher=async path=>{calls.push(path);return path.includes('cursor=expired') ? response({error:'invalid_cursor'},400) : response({batches:[],next_cursor:null});};
  await assert.rejects(client.sync(()=>{}),/暂时无法连接/);
  assert.deepEqual(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).seen_batch_ids,[id(1)]);assert.equal(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).scan_cursor,null);
  await client.sync(()=>{});assert.deepEqual(calls,['/api/dot/inbox?cursor=expired','/api/dot/inbox']);
});

test('at most twenty new batches are downloaded each poll; a partial page resumes without starving later batches',async()=>{
  const many=Array.from({length:DOT_INBOX_IMPORT_LIMIT+2},(_,n)=>batch(n)),{client,storage}=fixture(many);await client.connect(code);let imports=0;
  const save=()=>{imports++;return {added:0,duplicates:0,existing:0};};
  const first=await client.sync(save);assert.equal(first.more,true);assert.equal(first.batches,DOT_INBOX_IMPORT_LIMIT);assert.equal(imports,DOT_INBOX_IMPORT_LIMIT);
  assert.equal(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).scan_cursor,null);
  const second=await client.sync(save);assert.equal(second.batches,2);assert.equal(imports,many.length);assert.equal(second.more,undefined);
});

test('only one sync runs concurrently and disconnect aborts read without clearing any saved feed records',async()=>{
  const {client,storage}=fixture([batch(1)]);await client.connect(code);let release;
  const real=client.fetcher;client.fetcher=(path,options)=>new Promise(resolve=>{release=()=>resolve(real(path,options));});
  let imports=0;const save=()=>{imports++;return {added:0,duplicates:0,existing:0};};
  const first=client.sync(save),second=client.sync(save);assert.equal(first,second);release();
  // The payload request also waits on this controlled fetcher.
  await new Promise(resolve=>setImmediate(resolve));release();await first;assert.equal(imports,1);
  storage.setItem('personal-feed:live:v1','saved records');
  client.fetcher=(_path,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  const receiving=client.sync(save);client.disconnect();await assert.rejects(receiving,/暂时无法连接|连接设置已/);
  assert.equal(storage.getItem(DOT_INBOX_STORAGE_KEY),null);assert.equal(storage.getItem('personal-feed:live:v1'),'saved records');
});

test('connection changed in another tab stops the old receiver before import and does not overwrite the new setting',async()=>{
  const one=batch(1),{client,storage}=fixture([one]);await client.connect(code);
  client.fetcher=async()=>{storage.setItem(DOT_INBOX_STORAGE_KEY,JSON.stringify({...config(),review_code:otherCode}));return response({batches:[metadata(one)],next_cursor:null});};
  let imported=false;await assert.rejects(client.sync(()=>{imported=true;}),/其他页面更改/);assert.equal(imported,false);
  assert.equal(JSON.parse(storage.getItem(DOT_INBOX_STORAGE_KEY)).review_code,otherCode);
});

test('actual adapter import keeps manual feature and dismiss choices, adds only pending and excludes connection from all exports',async()=>{
  const before=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const {client,storage}=fixture();Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:storage});
  try {
    const adapter=new FeedDataAdapter();adapter.feedData={mode:'live',schema_version:'0.3',profile:{},items:[],sources:[],sections:{daily:[],discover:[]}};
    const existing=[material('2108148604447883464'),material('2108148604447883465')];
    const ids=adapter.importDotCandidates(JSON.stringify(payload(existing))).importedIds;
    adapter.setDotCandidateStatus([ids[0]],'featured');adapter.setDotCandidateStatus([ids[1]],'dismissed');
    const originals=structuredClone(adapter.localState.dot_candidates);const arriving=batch(1,[...existing,material('2108148604447883466')]);
    await client.connect(code);client.fetcher=async path=>path.includes(arriving.id) ? response(entry(arriving)) : response({batches:[metadata(arriving)],next_cursor:null});
    const result=await client.sync(raw=>adapter.importDotCandidates(raw));assert.equal(result.added,1);assert.equal(result.duplicates,2);
    assert.deepEqual(adapter.localState.dot_candidates.slice(0,2),originals);assert.equal(adapter.localState.dot_candidates[2].status,'pending');
    assert.equal(adapter.getState().dotFeaturedItems.length,1);assert.equal(adapter.getState().dotPendingCandidates.length,1);assert.equal(adapter.getState().dailyItems.length,0);
    for(const output of [adapter.createBackup().raw,adapter.createDotFeaturedExport().raw,JSON.stringify(adapter.getState())]) {
      assert.ok(!output.includes(code));assert.ok(!output.includes(DOT_INBOX_STORAGE_KEY));assert.ok(!output.includes('review_code'));
    }
  } finally {if(before) Object.defineProperty(globalThis,'localStorage',before);else delete globalThis.localStorage;}
});

test('automatic reception preserves active review selection and open details by deferring list redraw',async()=>{
  const source=readFileSync(new URL('./src/app.js',import.meta.url),'utf8').split('// 页面加载完成后启动应用')[0].replace(/^import [^\n]*\n/gm,'')+'\nthis.App=PersonalFeedApp;';
  const details={open:true},checkbox={dataset:{dotSelect:'dot-x-check'},closest:()=>({})};
  const badge={textContent:''};
  const document={activeElement:checkbox,querySelector:selector=>selector==='.dot-candidate-details[open]' ? details : selector==='#nav-candidates .nav-badge' ? badge : null,getElementById:()=>null};
  const state={mode:'live',dotPendingCandidates:[{id:'dot-x-new'}]};const adapter={getState:()=>state,importDotCandidates:()=>({added:1,duplicates:0,existing:0})};
  const sandbox={document,window:{},feedAdapter:adapter};vm.runInNewContext(source,sandbox);
  const selected=new Set(['dot-x-check']);let renders=0,panels=0;
  const app=Object.assign(Object.create(sandbox.App.prototype),{
    currentTab:'candidates',dotSelectedIds:selected,dotInboxBusy:false,dotBusy:false,dotInboxPendingNew:0,
    dotInbox:{reload(){},getState:()=>({connected:true}),sync:async save=>{save('{}');return {added:1,batches:1};}},
    renderDotInboxResults:()=>renders++,updateDotInboxPanel:()=>panels++,shouldDeferBackgroundRender:()=>false,
  });
  await app.syncDotInbox();assert.equal(renders,0);assert.ok(panels>=2);assert.equal(app.dotInboxPendingNew,1);
  assert.equal(app.dotSelectedIds,selected);assert.equal(document.activeElement,checkbox);assert.equal(details.open,true);
});
