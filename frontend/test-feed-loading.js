import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEED_CACHE_KEYS, MAX_FEED_CACHE_CHARS, writeFeedCache } from './src/feedCache.js';
import { parseBackup } from './src/backup.js';

globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
const { FeedDataAdapter } = await import('./src/dataAdapter.js');
const USER_KEY='personal-feed:live:v1';
const OLD_AT='2024-01-01T00:00:00.000Z';
const feed=(title='公开字幕材料')=>({schema_version:'0.3',mode:'live',profile:{interests:'',exclude:'',language:'中文'},generated_at:OLD_AT,
  sources:[{id:'news',name:'公开订阅',home_url:'https://example.com/',status:'ok',last_success_at:OLD_AT}],
  items:[{id:'news-one',title,summary:'来源公开摘录',source_refs:['news'],original_url:'https://example.com/one',
    published_at:OLD_AT,captured_at:OLD_AT,content_status:'excerpt_only',unknowns:[]}],
  sections:{daily:['news-one'],discover:[]},refresh:{status:'ok',message:'已读取来源',new_item_ids:['news-one']}});
const response=data=>({ok:true,json:async()=>structuredClone(data)});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function prepare() {
  const store=new Map();
  globalThis.localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
  globalThis.fetch=async()=>{throw Error('unexpected request');};
  return store;
}
function seed(scope='public-live',data=feed()) {
  const result=writeFeedCache(globalThis.localStorage,scope,data,Date.parse(OLD_AT));assert.equal(result.warning,false);
}

test('public preview waits 90s for /data/public-feed.json; local and demo stay on the 10s cap', async()=>{
  const {LOCAL_FEED_TIMEOUT_MS,PUBLIC_PREVIEW_FEED_TIMEOUT_MS}=await import('./src/dataAdapter.js');
  assert.equal(PUBLIC_PREVIEW_FEED_TIMEOUT_MS,90_000);
  assert.equal(LOCAL_FEED_TIMEOUT_MS,10_000);
  assert.equal(new FeedDataAdapter({publicPreview:true}).feedTimeoutMs,90_000);
  assert.equal(new FeedDataAdapter({publicPreview:true,feedTimeoutMs:120_000}).feedTimeoutMs,90_000);
  assert.equal(new FeedDataAdapter({publicPreview:true,feedTimeoutMs:20}).feedTimeoutMs,20);
  assert.equal(new FeedDataAdapter({publicPreview:false}).feedTimeoutMs,10_000);
  assert.equal(new FeedDataAdapter({mode:'demo',publicPreview:false}).feedTimeoutMs,10_000);
  assert.equal(new FeedDataAdapter({publicPreview:false,feedTimeoutMs:60_000}).feedTimeoutMs,10_000);
  assert.equal(new FeedDataAdapter({publicPreview:false,feedTimeoutMs:20}).feedTimeoutMs,20);
  for (const bad of [0,-1,NaN,Infinity,'90000']) {
    assert.equal(new FeedDataAdapter({publicPreview:true,feedTimeoutMs:bad}).feedTimeoutMs,90_000);
    assert.equal(new FeedDataAdapter({publicPreview:false,feedTimeoutMs:bad}).feedTimeoutMs,10_000);
  }
  const about=readFileSync(new URL('./public-build.mjs',import.meta.url),'utf8');
  assert.match(about,new RegExp(`读取超过${PUBLIC_PREVIEW_FEED_TIMEOUT_MS / 1000}秒会停止等待`));
  assert.doesNotMatch(about,/读取超过10秒会停止等待/);
  prepare();
  const delays=[];
  const realSetTimeout=globalThis.setTimeout;
  globalThis.setTimeout=(fn,delay,...args)=>{delays.push(delay);return realSetTimeout(fn,delay,...args);};
  try {
    globalThis.fetch=async()=>response(feed());
    await new FeedDataAdapter({publicPreview:true}).loadFeed();
    assert.ok(delays.includes(PUBLIC_PREVIEW_FEED_TIMEOUT_MS));
    assert.equal(delays.includes(LOCAL_FEED_TIMEOUT_MS),false);
    delays.length=0;
    await new FeedDataAdapter({publicPreview:false}).loadFeed();
    assert.ok(delays.includes(LOCAL_FEED_TIMEOUT_MS));
    assert.equal(delays.includes(PUBLIC_PREVIEW_FEED_TIMEOUT_MS),false);
    delays.length=0;
    const refreshing=new FeedDataAdapter({publicPreview:false});
    await refreshing.loadFeed();
    delays.length=0;
    await refreshing.refreshFeed();
    assert.ok(delays.includes(LOCAL_FEED_TIMEOUT_MS*2),'本机更新仍用两倍短时限，不必跟着公开预览等到 90 秒');
  } finally {globalThis.setTimeout=realSetTimeout;}
});

test('explicit cache restore is synchronous, does not fetch, and preserves raw source dates and user collections', async()=>{
  const store=prepare(),original=feed();globalThis.fetch=async()=>response(original);
  const first=new FeedDataAdapter({publicPreview:true});await first.loadFeed();first.setSaved('news-one',true);
  const raw=store.get(FEED_CACHE_KEYS['public-live']),encoded=JSON.parse(raw);
  assert.deepEqual(encoded.feed,original);assert.equal(encoded.feed.items.length,1);assert.equal(encoded.feed.sources.length,1);
  assert.equal(encoded.feed.saved_item_notes,undefined);
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch for restore');};
  const restored=new FeedDataAdapter({publicPreview:true});assert.equal(restored.getState(),null);
  const state=restored.restoreCachedFeed();assert.ok(state && !(state instanceof Promise));assert.equal(calls,0);
  assert.equal(state.loadStatus.phase,'cached');assert.equal(state.loadStatus.fromCache,true);
  assert.equal(state.loadStatus.cachedAt,encoded.cachedAt);assert.equal(state.loadStatus.lastCheckedAt,null);
  assert.equal(state.generated_at,OLD_AT);assert.equal(state.sources[0].last_success_at,OLD_AT);
  assert.equal(state.savedItems[0].title,original.items[0].title);assert.equal(state.allItems.length,9);
  store.set(FEED_CACHE_KEYS['public-live'],'bad');assert.equal(restored.restoreCachedFeed().loadStatus.phase,'cached');
});

test('retired Bilibili entries disappear from old-cache browsing while saved copies and backups survive',()=>{
  const store=prepare(),original=feed();
  const retired={...original.items[0],id:'news-aaaaaaaaaaaaaaaaaaaaaaaa',title:'已收藏的旧热搜',
    source_refs:['bilibili-hot-search'],original_url:'https://search.bilibili.com/all?keyword=example',link_kind:'search'};
  const shared={...original.items[0],id:'news-bbbbbbbbbbbbbbbbbbbbbbbb',source_refs:['news','bilibili-hot-search']};
  original.sources.push({id:'bilibili-hot-search',name:'B站热搜',home_url:'https://www.bilibili.com',status:'failed',last_success_at:OLD_AT});
  original.items.push(retired,shared);
  original.sections.daily.push(retired.id,shared.id);
  const saved={saved_item_ids:[retired.id],item_snapshots:{[retired.id]:retired},
    saved_item_notes:{[retired.id]:{note:'保留自己的想法',updated_at:OLD_AT}}};
  store.set(USER_KEY,JSON.stringify(saved));seed('public-live',original);
  const cacheBefore=store.get(FEED_CACHE_KEYS['public-live']),savedBefore=store.get(USER_KEY);
  const adapter=new FeedDataAdapter({publicPreview:true}),state=adapter.restoreCachedFeed();
  assert.equal(state.sources.some(source=>source.id==='bilibili-hot-search'),false);
  for(const items of [state.allItems,state.dailyItems,state.discoverItems]) assert.equal(items.some(item=>item.id===retired.id),false);
  assert.ok(state.allItems.some(item=>item.id===shared.id),'other provenance remains visible');
  assert.deepEqual(state.savedItems.find(item=>item.id===retired.id),retired);
  assert.equal(state.sourceMap.get('bilibili-hot-search').name,'B站热搜');
  const backup=parseBackup(adapter.createBackup().raw,'live');
  assert.deepEqual(backup.state.item_snapshots[retired.id],retired);
  assert.equal(backup.state.saved_item_notes[retired.id].note,'保留自己的想法');
  assert.equal(store.get(USER_KEY),savedBefore);assert.equal(store.get(FEED_CACHE_KEYS['public-live']),cacheBefore);
  adapter.feedData={...adapter.feedData,sources:adapter.feedData.sources.filter(source=>source.id!=='bilibili-hot-search'),
    items:adapter.feedData.items.filter(item=>item.id!==retired.id)};
  assert.deepEqual(adapter.getState().savedItems.find(item=>item.id===retired.id),retired);
  assert.equal(adapter.getState().sourceMap.get('bilibili-hot-search').name,'B站热搜');
  assert.deepEqual(parseBackup(adapter.createBackup().raw,'live').state.item_snapshots[retired.id],retired);
});

test('malformed, oversized, wrong-version, wrong-scope and unsafe-shaped caches are ignored without touching user data',()=>{
  const mutations=[cache=>{cache.version=2;},cache=>{cache.scope='local-live';},cache=>{cache.feed.mode='demo';},
    cache=>{cache.feed.items[0].source_refs={news:true};},cache=>{cache.feed.sources[0].name={text:'bad'};},
    cache=>{cache.feed.items[0].summary={text:'bad'};},cache=>{cache.feed.items[0].alias_ids={bad:true};},
    cache=>{cache.feed.items[0].captured_at={date:'bad'};},cache=>{cache.feed.items[0].source_links={news:{}};},
    cache=>{cache.feed.items[0].evidence_refs={one:true};},
    cache=>{cache.feed.sources[0].last_success_at='not-a-date';},
    cache=>{cache.feed.items[0].source_links=[{source_id:'news',source_rank:'1'}];},
    cache=>{cache.feed.items[0].source_links=[{source_id:'news',source_rank:{rank:1}}];},
    cache=>{cache.feed.repository_guide_status={status:{working:true},message:'bad'};},
    cache=>{cache.feed.sections.daily={one:true};},cache=>{cache.feed.repository_guide_status={constructor:'bad'};}];
  for (const mutate of mutations) {
    const store=prepare();seed();const cache=JSON.parse(store.get(FEED_CACHE_KEYS['public-live']));mutate(cache);
    store.set(FEED_CACHE_KEYS['public-live'],JSON.stringify(cache));store.set(USER_KEY,'{"saved_item_ids":[]}');
    const before=store.get(USER_KEY),adapter=new FeedDataAdapter({publicPreview:true});let warnings=0;
    adapter.subscribe(()=>{if(adapter.loadStatus.cacheWarning) warnings++;});
    assert.equal(adapter.restoreCachedFeed(),null);assert.equal(adapter.loadStatus.cacheWarning,true);assert.equal(store.get(USER_KEY),before);
    assert.equal(warnings,1);
  }
  for (const raw of ['{broken', 'x'.repeat(MAX_FEED_CACHE_CHARS+1)]) {
    const store=prepare();store.set(FEED_CACHE_KEYS['public-live'],raw);
    const adapter=new FeedDataAdapter({publicPreview:true});assert.equal(adapter.restoreCachedFeed(),null);assert.equal(adapter.loadStatus.cacheWarning,true);
  }
});

test('public and local live caches are isolated; demo neither restores nor writes a feed cache', async()=>{
  const store=prepare();seed('public-live',feed('公开版材料'));seed('local-live',feed('本机材料'));
  assert.equal(new FeedDataAdapter({publicPreview:true}).restoreCachedFeed().allItems[0].title,'公开版材料');
  assert.equal(new FeedDataAdapter({publicPreview:false}).restoreCachedFeed().allItems[0].title,'本机材料');
  const keys=[...store.keys()],demo=new FeedDataAdapter({mode:'demo',publicPreview:false});assert.equal(demo.restoreCachedFeed(),null);
  globalThis.fetch=async()=>response({...feed(),mode:'demo',schema_version:'0.1'});await demo.loadFeed();
  assert.deepEqual([...store.keys()],keys);assert.equal(demo.getState().loadStatus.cachedAt,null);
});

test('a new instance never silently restores or substitutes demo after an initial network failure',async()=>{
  const store=prepare();seed();const before=store.get(FEED_CACHE_KEYS['public-live']),urls=[];
  globalThis.fetch=async url=>{urls.push(url);throw Error('offline');};
  const adapter=new FeedDataAdapter({publicPreview:true});await assert.rejects(adapter.loadFeed(),/offline/);
  assert.equal(adapter.getState(),null);assert.deepEqual(urls,['/data/public-feed.json']);
  assert.equal(adapter.loadStatus.phase,'error');assert.equal(adapter.loadStatus.errorKind,'network');
  assert.equal(store.get(FEED_CACHE_KEYS['public-live']),before);
});

test('fetch timeout aborts and a late response cannot replace a later successful retry or its cache',async()=>{
  const store=prepare(),old=deferred();let signal;
  globalThis.fetch=(_url,options)=>{signal=options.signal;return old.promise;};
  const adapter=new FeedDataAdapter({publicPreview:true,feedTimeoutMs:20});
  await assert.rejects(adapter.loadFeed(),error=>error.errorKind==='timeout');assert.equal(signal.aborted,true);
  assert.equal(adapter.getState(),null);assert.equal(adapter.loadStatus.phase,'error');
  globalThis.fetch=async()=>response(feed('重试得到的内容'));await adapter.loadFeed(true);
  const raw=store.get(FEED_CACHE_KEYS['public-live']);old.resolve(response(feed('过期晚回内容')));await tick();
  assert.equal(adapter.getState().allItems[0].title,'重试得到的内容');assert.equal(store.get(FEED_CACHE_KEYS['public-live']),raw);
  assert.equal(adapter.loadStatus.phase,'ready');assert.equal(adapter.loadStatus.errorKind,null);
});

test('the same deadline covers a hanging JSON body and rejects late parsing without overwriting current content',async()=>{
  const store=prepare();seed();const body=deferred();let signal;
  globalThis.fetch=async(_url,options)=>{signal=options.signal;return {ok:true,json:()=>body.promise};};
  const adapter=new FeedDataAdapter({publicPreview:true,feedTimeoutMs:20});adapter.restoreCachedFeed();
  const raw=store.get(FEED_CACHE_KEYS['public-live']);await assert.rejects(adapter.loadFeed(true),error=>error.errorKind==='timeout');
  assert.equal(signal.aborted,true);body.resolve(feed('晚解析内容'));await tick();
  assert.equal(adapter.getState().allItems[0].title,feed().items[0].title);assert.equal(store.get(FEED_CACHE_KEYS['public-live']),raw);
  assert.equal(adapter.getState().loadStatus.fromCache,true);assert.equal(adapter.getState().loadStatus.cachedAt,OLD_AT);
});

test('a real streaming response body also times out after headers, without accepting a late finished stream',async()=>{
  prepare();let writer,signal;const stream=new ReadableStream({start(controller){writer=controller;}});
  globalThis.fetch=async(_url,options)=>{signal=options.signal;return new Response(stream);};
  const adapter=new FeedDataAdapter({publicPreview:true,feedTimeoutMs:20});
  await assert.rejects(adapter.loadFeed(),error=>error.errorKind==='timeout');assert.equal(signal.aborted,true);
  writer.enqueue(new TextEncoder().encode(JSON.stringify(feed())));writer.close();await tick();
  assert.equal(adapter.getState(),null);assert.equal(adapter.loadStatus.phase,'error');
});

test('force, ordinary loads, public refresh and a loading listener share one request and emit state changes',async()=>{
  prepare();seed();const waiting=deferred();let calls=0,nested;
  globalThis.fetch=()=>{calls++;return waiting.promise;};
  const adapter=new FeedDataAdapter({publicPreview:true});adapter.restoreCachedFeed();const phases=[];
  adapter.subscribe(state=>{phases.push(state.loadStatus.phase);if(state.loadStatus.phase==='loading'&&!nested) nested=adapter.loadFeed();});
  const operation=adapter.loadFeed(true);assert.equal(nested,operation);assert.equal(adapter.loadFeed(false),operation);
  const refresh=adapter.refreshFeed();await tick();assert.equal(calls,1);
  waiting.resolve(response(feed('新公开内容')));await operation;await refresh;
  assert.deepEqual(phases,['loading','ready']);assert.equal(adapter.getState().loadStatus.fromCache,false);
  assert.equal(adapter.getState().allItems[0].title,'新公开内容');
});

test('failed background refresh preserves readable content, times, publication, cache bytes and a save made while loading',async()=>{
  const store=prepare(),data={...feed(),publication:{version:'old',automatic_update:true}};seed('public-live',data);
  const adapter=new FeedDataAdapter({publicPreview:true});adapter.restoreCachedFeed();const before=adapter.feedData;
  const raw=store.get(FEED_CACHE_KEYS['public-live']),waiting=deferred();globalThis.fetch=()=>waiting.promise;
  const operation=adapter.loadFeed(true);assert.equal(adapter.getState().loadStatus.phase,'loading');
  adapter.setSaved('news-one',true);waiting.reject(Error('offline'));await assert.rejects(operation,/offline/);
  const state=adapter.getState();assert.equal(adapter.feedData,before);assert.equal(state.savedItems.length,1);
  assert.equal(state.sources[0].last_success_at,OLD_AT);assert.equal(state.generated_at,OLD_AT);assert.deepEqual(state.publication,data.publication);
  assert.equal(state.loadStatus.cachedAt,OLD_AT);assert.equal(state.loadStatus.fromCache,true);assert.equal(state.loadStatus.phase,'error');
  assert.ok(state.loadStatus.lastCheckedAt);assert.equal(store.get(FEED_CACHE_KEYS['public-live']),raw);
  globalThis.fetch=async()=>response({...data,items:[],sections:{daily:[],discover:[]}});await adapter.loadFeed(true);
  assert.equal(adapter.getState().savedItems[0].title,data.items[0].title);assert.equal(adapter.loadStatus.phase,'ready');
});

test('HTTP, malformed JSON and mode mismatch fail closed with distinct format/network statuses and unchanged cache',async()=>{
  const store=prepare();seed();const adapter=new FeedDataAdapter({publicPreview:true});adapter.restoreCachedFeed();const raw=store.get(FEED_CACHE_KEYS['public-live']);
  for (const [result,kind] of [[()=>new Response('unavailable',{status:503}),'network'],[()=>new Response('{broken'),'format'],
    [()=>response({...feed(),mode:'demo'}),'format']]) {
    globalThis.fetch=async()=>result();await assert.rejects(adapter.loadFeed(true));assert.equal(adapter.loadStatus.errorKind,kind);
    assert.equal(adapter.getState().allItems[0].id,'news-one');assert.equal(store.get(FEED_CACHE_KEYS['public-live']),raw);
  }
});

test('cache quota failures only warn; reading and writing collections still succeed without touching their existing notes',async()=>{
  const store=prepare();store.set(USER_KEY,JSON.stringify({saved_item_notes:{unrelated:'自己的判断'}}));
  const setItem=globalThis.localStorage.setItem;globalThis.localStorage.setItem=(key,value)=>{
    if(key===FEED_CACHE_KEYS['public-live']) throw Object.assign(Error('full'),{name:'QuotaExceededError'});setItem(key,value);
  };
  globalThis.fetch=async()=>response(feed());const adapter=new FeedDataAdapter({publicPreview:true});await adapter.loadFeed();
  assert.equal(adapter.loadStatus.phase,'ready');assert.equal(adapter.loadStatus.cacheWarning,true);assert.equal(adapter.loadStatus.errorKind,null);
  adapter.setSaved('news-one',true);assert.equal(adapter.getState().savedItems.length,1);
  assert.equal(JSON.parse(store.get(USER_KEY)).saved_item_notes.unrelated,'自己的判断');assert.equal(store.has(FEED_CACHE_KEYS['public-live']),false);
});

test('collection quota pressure removes only disposable feed cache and retries, preserving other applications and demo data',async()=>{
  const store=prepare();store.set('another-app','keep');store.set('personal-feed:demo:v1','keep-demo');globalThis.fetch=async()=>response(feed());
  const adapter=new FeedDataAdapter({publicPreview:true});await adapter.loadFeed();
  const setItem=globalThis.localStorage.setItem;globalThis.localStorage.setItem=(key,value)=>{
    if(key===USER_KEY && store.has(FEED_CACHE_KEYS['public-live'])) throw Object.assign(Error('full'),{name:'QuotaExceededError'});setItem(key,value);
  };
  adapter.setSaved('news-one',true);assert.equal(adapter.getState().savedItems.length,1);assert.equal(adapter.loadStatus.cacheWarning,true);
  assert.equal(store.has(FEED_CACHE_KEYS['public-live']),false);assert.equal(store.get('another-app'),'keep');assert.equal(store.get('personal-feed:demo:v1'),'keep-demo');
});

test('non-quota collection failures never evict cache or claim a save',async t=>{
  const store=prepare();globalThis.fetch=async()=>response(feed());const adapter=new FeedDataAdapter({publicPreview:true});await adapter.loadFeed();
  const raw=store.get(FEED_CACHE_KEYS['public-live']),setItem=globalThis.localStorage.setItem;t.mock.method(console,'error',()=>{});
  globalThis.localStorage.setItem=(key,value)=>{if(key===USER_KEY) throw Object.assign(Error('denied'),{name:'SecurityError'});setItem(key,value);};
  assert.throws(()=>adapter.setSaved('news-one',true),/本地存储/);assert.equal(adapter.getState().savedItems.length,0);
  assert.equal(store.get(FEED_CACHE_KEYS['public-live']),raw);
});

test('local POST refresh shares concurrent callers and updates the same raw local cache after full parsing',async()=>{
  const store=prepare();globalThis.fetch=async()=>response(feed());const adapter=new FeedDataAdapter({publicPreview:false});await adapter.loadFeed();
  const waiting=deferred(),calls=[];globalThis.fetch=(url,options)=>{calls.push({url,options});return waiting.promise;};
  const operation=adapter.refreshFeed();assert.equal(adapter.refreshFeed(),operation);await tick();
  const sharedLoad=adapter.loadFeed(true);assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/feed/refresh');assert.equal(calls[0].options.method,'POST');
  const updated={...feed('本机更新内容'),update_notice:'本机更新成功'};waiting.resolve(response(updated));
  assert.equal(await operation,'本机更新成功');await sharedLoad;
  assert.deepEqual(JSON.parse(store.get(FEED_CACHE_KEYS['local-live'])).feed,updated);assert.equal(store.has(FEED_CACHE_KEYS['public-live']),false);
  assert.equal(adapter.loadStatus.phase,'ready');assert.equal(adapter.getState().sources[0].last_success_at,OLD_AT);
});

test('local collection POST queues after an in-flight GET instead of silently treating a read as a source refresh',async()=>{
  prepare();const get=deferred(),calls=[];
  globalThis.fetch=(url)=>{calls.push(url);return url==='/api/feed' ? get.promise : Promise.resolve(response({...feed('实际POST内容'),update_notice:'POST完成'}));};
  const adapter=new FeedDataAdapter({publicPreview:false}),loading=adapter.loadFeed(),refresh=adapter.refreshFeed();await tick();
  assert.deepEqual(calls,['/api/feed']);get.resolve(response(feed('GET内容')));await loading;assert.equal(await refresh,'POST完成');
  assert.deepEqual(calls,['/api/feed','/api/feed/refresh']);assert.equal(adapter.getState().allItems[0].title,'实际POST内容');
});

test('local POST body timeout uses its longer whole-response deadline and preserves current cache and source state',async()=>{
  const store=prepare();globalThis.fetch=async()=>response(feed());const adapter=new FeedDataAdapter({publicPreview:false,feedTimeoutMs:20});await adapter.loadFeed();
  const raw=store.get(FEED_CACHE_KEYS['local-live']);let signal;globalThis.fetch=async(_url,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(()=>{})};};
  await assert.rejects(adapter.refreshFeed(),error=>error.errorKind==='timeout');assert.equal(signal.aborted,true);
  assert.equal(adapter.loadStatus.phase,'error');assert.equal(adapter.loadStatus.fromCache,false);assert.equal(adapter.getState().sources[0].last_success_at,OLD_AT);
  assert.equal(store.get(FEED_CACHE_KEYS['local-live']),raw);
});

test('a failed local collection response cannot refresh cache dates or success state, while partial success keeps its actual source times',async()=>{
  const store=prepare();seed('local-live');const adapter=new FeedDataAdapter({publicPreview:false});adapter.restoreCachedFeed();
  const raw=store.get(FEED_CACHE_KEYS['local-live']);
  globalThis.fetch=async()=>response({...feed('失败包不能覆盖'),refresh:{status:'failed',message:'来源全失败'}});
  await assert.rejects(adapter.refreshFeed(),/暂时无法更新/);assert.equal(adapter.getState().allItems[0].title,feed().items[0].title);
  assert.equal(adapter.loadStatus.cachedAt,OLD_AT);assert.equal(adapter.loadStatus.phase,'error');assert.equal(store.get(FEED_CACHE_KEYS['local-live']),raw);
  const partial={...feed('部分来源成功包'),refresh:{status:'partial',message:'保留失败来源旧内容'}};
  globalThis.fetch=async()=>response(partial);assert.equal(await adapter.refreshFeed(),partial.refresh.message);
  assert.equal(adapter.loadStatus.phase,'ready');assert.equal(adapter.getState().sources[0].last_success_at,OLD_AT);
  assert.deepEqual(JSON.parse(store.get(FEED_CACHE_KEYS['local-live'])).feed,partial);
});


test('large readable responses do not inherit the smaller browser-cache capacity', async()=>{
  prepare();const original=feed();
  const raw=JSON.stringify(original)+' '.repeat(MAX_FEED_CACHE_CHARS+1);
  globalThis.fetch=async()=>({ok:true,text:async()=>raw});
  const adapter=new FeedDataAdapter({publicPreview:true});
  const state=await adapter.loadFeed();
  assert.equal(state.loadStatus.phase,'ready');assert.equal(state.allItems[0].title,original.items[0].title);
  adapter.setSaved('news-one',true);assert.equal(adapter.getState().savedItems.length,1);
});
