import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {feedLoadMessage,renderFeedLoadStatus,renderInitialFeedLoad} from './src/feedLoadingView.js';
import {feedUpdateInfo,renderSourceBoard} from './src/sourceBoard.js';
import {renderCollectionPanel} from './src/collectionViews.js';
import {FeedDataAdapter,feedAdapter} from './src/dataAdapter.js';
import {FEED_CACHE_KEYS} from './src/feedCache.js';
import {openTopicDialog} from './src/topicViews.js';
import {bindFeedSearchActions} from './src/feedSearchView.js';
import {renderWorkspaceNavigation,renderWorkspaceResume,renderWorkspaceStorageNotice} from './src/workspaceShell.js';
import {DOT_FILTER_DEFAULTS} from './src/dotCandidateFilters.js';

const olderTime='2026-10-02T01:00:00.000Z';
const newerTime='2026-10-02T13:00:00.000Z';
const escapeHtml=value=>String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const makeState=(phase='ready',extra={})=>({
  mode:'live',publicPreview:true,generated_at:olderTime,
  sources:[{id:'news',name:'公开来源',kind:'aggregator',status:'ok',last_success_at:olderTime}],
  refresh:{status:'ok',message:'旧记录：本次读取成功',new_item_ids:[]},update_notice:'旧记录：本次读取成功',
  publication:{automatic_update:true,schedule_label:'北京时间 09:00 / 21:00'},
  allItems:[],savedItems:[],activeSavedItems:[],archivedItems:[],topics:[],followups:[],
  savedItemIds:new Set(),archivedItemIds:new Set(),hiddenItemIds:new Set(),
  loadStatus:{phase,fromCache:false,cachedAt:null,errorKind:null,cacheWarning:null},...extra,
});
const viewApp={escapeHtml,formatTime:value=>value,renderedGeneratedAt:olderTime};

test('cached and pending reads explain the current load instead of repeating an old source-success notice',()=>{
  for(const phase of ['cached','loading','error']) {
    const state=makeState(phase,{loadStatus:{phase,fromCache:true,cachedAt:olderTime,errorKind:phase==='error' ? 'timeout' : null,cacheWarning:null}});
    const message=feedLoadMessage(state);
    const html=renderFeedLoadStatus(viewApp,state);
    assert.ok(message,'each current load state needs an honest message');
    assert.doesNotMatch(`${message}${html}`,/旧记录：本次读取成功/);
    assert.match(`${message}${html}`,/保存|缓存|旧内容|已有内容|已显示/);
    assert.doesNotMatch(feedUpdateInfo(state).notice,/旧记录：本次读取成功/,'the source board must not contradict the global loading state');
    assert.equal(feedUpdateInfo(state).lastSuccess,olderTime,'real historical source time remains distinct from the current read');
  }
});

test('a newer completed read can remain deferred while the status identifies the content still on screen',()=>{
  const state=makeState('ready',{generated_at:newerTime});
  const html=renderFeedLoadStatus(viewApp,state,{deferred:true});
  assert.match(`${feedLoadMessage(state,{deferred:true})}${html}`,/结束.*输入|关闭.*编辑|结束操作|操作结束|稍后显示|稍后刷新/);
  assert.ok(html.includes(new Date(olderTime).toLocaleString('zh-CN',{hour12:false})),'the current screen keeps its own saved timestamp');
  assert.ok(!html.includes(new Date(newerTime).toLocaleString('zh-CN',{hour12:false})),'deferred content must not be dated as if already displayed');
  assert.doesNotMatch(html,/已显示最近|画面已更新/);
});

test('load warnings and initial errors are escaped without inventing saved content or hiding the retry',()=>{
  const state=makeState('error',{loadStatus:{phase:'error',fromCache:true,cachedAt:olderTime,errorKind:'network',cacheWarning:'<img src=x onerror=alert(1)>'}});
  const html=renderFeedLoadStatus(viewApp,state);
  assert.doesNotMatch(html,/<img|onerror="/);
  const initial=renderInitialFeedLoad(viewApp,new Error('<script>synthetic error</script>'));
  assert.match(initial,/btn-retry-load/);
  assert.doesNotMatch(initial,/<script>/);
  assert.match(initial,/收藏|浏览器/);
  const pending=renderInitialFeedLoad(viewApp,null,{slow:true});
  assert.match(pending,/载入|加载|读取/);
  assert.doesNotMatch(pending,/已显示.*保存|读取成功/);
});

function withApp(run,{cached=true,editor=null,realAdapter=null}={}) {
  const source=readFileSync(new URL('./src/app.js',import.meta.url),'utf8');
  const bootstrap='// 页面加载完成后启动应用';
  assert.ok(source.includes(bootstrap));
  const classSource=source.split(bootstrap)[0].replace(/^import [^\n]*\n/gm,'')+'\nthis.PersonalFeedApp=PersonalFeedApp;';
  const nodes=new Map(),timers=new Map(),listeners=new Set(),calls={render:0,subscribe:0,restore:0,load:0,research:0};
  const document={activeElement:null,querySelectorAll:()=>[],querySelector:()=>null,contains:node=>nodes.get(node.id)===node};
  const node=id=>({id,value:'',disabled:false,listeners:{},isConnected:true,_html:'',
    get innerHTML(){return this._html;},
    set innerHTML(value){this._html=value;for(const id of ['btn-retry-load','feed-retry-load','btn-retry-feed','feed-load-retry']) {if(value.includes(`id="${id}"`)) nodes.set(id,node(id));}},
    addEventListener(type,handler){(this.listeners[type] ||= []).push(handler);},
    focus(){document.activeElement=this;},
  });
  for(const id of ['app','feed-load-status','btn-check-update','modal-root']) nodes.set(id,node(id));
  const draft=node(editor || 'draft');draft.value='尚未保存的中文字';nodes.set(draft.id,draft);document.activeElement=node('body');
  document.getElementById=id=>nodes.get(id) || null;
  const cachedState=cached ? makeState('cached',{loadStatus:{phase:'cached',fromCache:true,cachedAt:olderTime}}) : null;
  let state=null;
  let resolveRead,rejectRead;
  let read=new Promise((resolve,reject)=>{resolveRead=resolve;rejectRead=reject;});
  const adapter=realAdapter || {publicPreview:true,mode:'live',loadStatus:{phase:'idle'},
    getState:()=>state,
    subscribe(handler){calls.subscribe++;listeners.add(handler);return ()=>listeners.delete(handler);},
    restoreCachedFeed(){calls.restore++;if(!state && cachedState) {state=cachedState;this.loadStatus=state.loadStatus;for(const handler of listeners) handler(state);}return state;},
    loadFeed(){calls.load++;this.loadStatus={phase:'loading',fromCache:!!state,cachedAt:state?.loadStatus?.cachedAt};
      if(state) {state={...state,loadStatus:this.loadStatus};for(const handler of listeners) handler(state);}
      return read;
    },
    syncResearch(){calls.research++;return Promise.resolve();},
  };
  let timerId=0;
  const setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;};
  const clearTimeout=id=>timers.delete(id);
  const sandbox={document,window:{addEventListener(){},scrollTo(){},setTimeout,clearTimeout},
    feedAdapter:adapter,feedLoadMessage,renderFeedLoadStatus,renderInitialFeedLoad,feedUpdateInfo,
    needsWelcome:()=>false,localStorage:{getItem:()=>null},setTimeout,clearTimeout,setInterval:()=>0,
    renderSourceBoard,renderCollectionPanel,
    renderWorkspaceNavigation,renderWorkspaceResume,renderWorkspaceStorageNotice,DOT_FILTER_DEFAULTS,
    requestAnimationFrame:callback=>callback(),URL,console:{error(){},warn(){},log(){}},Promise};
  vm.runInNewContext(classSource,sandbox,{filename:'src/app.js'});
  const app=Object.assign(Object.create(sandbox.PersonalFeedApp.prototype),{
    currentTab:'today',feedView:'sources',activeModal:null,feedSearchComposing:false,sourceManagerOpen:false,
    feedSearchQuery:'',collectionQuery:'',refreshing:false,refreshError:'',pendingRender:false,loadingInitial:false,
    renderedGeneratedAt:olderTime,welcomeVisible:false,
  });
  app.render=function(){calls.render++;this.pendingRender=false;this.renderedGeneratedAt=state?.generated_at;};
  app.showToast=()=>{};
  const useRealRendering=()=>{
    Object.assign(app,{sourceLimits:{},boardGroup:'all',sourceFilter:'all',onlyNew:false,feedSearchPurpose:'all',feedSearchLimit:20,savedSubTab:'items'});
    app.bindContentActions=()=>{};app.renderModals=()=>{};
    app.renderMainContent=function(current){return this.currentTab==='saved' ? renderCollectionPanel(this,current) : renderSourceBoard(this,current);};
    const render=Object.getPrototypeOf(app).render;
    app.render=function(){calls.render++;return render.call(this);};
  };
  const emit=next=>{state=next;adapter.loadStatus=next?.loadStatus || adapter.loadStatus;for(const handler of listeners) handler(state);};
  const complete=()=>{emit(makeState('ready',{generated_at:newerTime}));resolveRead(state);};
  const fail=error=>{if(state) emit({...state,loadStatus:{phase:'error',fromCache:true,cachedAt:olderTime,errorKind:'timeout'}});adapter.loadStatus={phase:'error',fromCache:!!state,errorKind:'timeout'};rejectRead(error);};
  const newRead=()=>{read=new Promise((resolve,reject)=>{resolveRead=resolve;rejectRead=reject;});};
  return run({app,adapter,nodes,draft,document,calls,timers,emit,complete,fail,newRead,useRealRendering});
}

test('startup paints cached material synchronously and repeated attempts install one subscription and one initial read',async()=>{
  await withApp(async({app,calls,complete})=>{
    const first=app.loadAndRender();
    assert.ok(calls.render>0,'cached material must be available before the unresolved request');
    assert.equal(calls.restore,1,'a cold startup restores cache before waiting for the network');
    assert.equal(calls.subscribe,1);
    const second=app.loadAndRender();
    assert.equal(calls.subscribe,1);assert.equal(calls.load,1,'double retry must not duplicate startup requests');
    complete();await Promise.all([first,second]);
    app.setupFeedSubscription();assert.equal(calls.subscribe,1,'subscription installation remains idempotent after success');
    assert.equal(app.loadingInitial,false);
  });
});

test('loading notifications only patch status and the existing update control',()=>{
  withApp(({app,nodes,calls,emit,draft})=>{
    app.setupFeedSubscription();
    emit(makeState('loading',{loadStatus:{phase:'loading',fromCache:true,cachedAt:olderTime}}));
    assert.equal(calls.render,0);assert.equal(nodes.get(draft.id),draft);assert.equal(draft.value,'尚未保存的中文字');
    assert.ok(nodes.get('feed-load-status').innerHTML);
    assert.equal(nodes.get('btn-check-update').disabled,true);
  });
});

test('completed and failed startup background reads preserve search, collection, profile, source drafts and modal inputs',async()=>{
  const contexts=[
    {editor:'feed-search',set:app=>{app.feedSearchQuery='尚未保存的中文字';}},
    {editor:'collection-search',set:app=>{app.currentTab='saved';app.collectionQuery='尚未保存的中文字';}},
    {editor:'profile-interests-input',set:app=>{app.currentTab='profile';}},
    {editor:'topic-note',set:app=>{app.activeModal='topic';}},
    {editor:'source-visible-news',set:app=>{app.sourceManagerOpen=true;app.sourcePreferenceDraft={hidden_source_ids:['news'],pinned_source_ids:[]};}},
    {editor:'draft',set:app=>{app.feedSearchComposing=true;app.feedSearchQuery='字';}},
  ];
  for(const context of contexts) for(const outcome of ['ready','error']) {
    await withApp(async({app,nodes,draft,document,calls,complete,fail})=>{
      const operation=app.loadAndRender();const initiallyPainted=calls.render;
      context.set(app);document.activeElement=draft;
      const beforeDraft=JSON.stringify(app.sourcePreferenceDraft);
      if(outcome==='ready') complete();else fail(new Error('synthetic timeout'));
      await operation;
      assert.equal(calls.render,initiallyPainted,`${context.editor}/${outcome}: terminal startup must respect the active editor`);
      assert.equal(nodes.get(draft.id),draft);assert.equal(document.activeElement,draft);assert.equal(draft.value,'尚未保存的中文字');
      assert.equal(JSON.stringify(app.sourcePreferenceDraft),beforeDraft);
      assert.equal(app.pendingRender,true);
      assert.ok(nodes.get('feed-load-status').innerHTML);
      assert.equal(nodes.get('btn-check-update').disabled,false);
    },{editor:context.editor});
  }
});

test('an uncached initial read has a bounded slow placeholder, failure and a working deduplicated retry',async()=>{
  await withApp(async({app,nodes,calls,timers,fail,newRead,complete})=>{
    const first=app.loadAndRender();
    assert.equal(calls.render,0,'no content must not be invented from an empty state');
    const slowTimer=[...timers.values()].find(timer=>timer.delay===3000);
    assert.ok(slowTimer,'slow loading is announced before the ten-second adapter deadline');slowTimer.callback();
    assert.match(nodes.get('app').innerHTML,/载入|加载|读取/);
    fail(new Error('synthetic timeout'));await first;
    assert.equal(app.loadingInitial,false);assert.match(nodes.get('app').innerHTML,/btn-retry-load/);
    assert.equal(timers.size,0,'a completed initial read clears its slow timer');
    newRead();const retry=app.retryFeedRead();const duplicate=app.retryFeedRead();
    assert.equal(calls.subscribe,1);assert.equal(calls.load,2,'both retry calls share one additional read');
    complete();await Promise.all([retry,duplicate]);assert.equal(app.loadingInitial,false);assert.ok(calls.render>0);
  },{cached:false});
});

test('retrying a cached failure starts a read without replacing the current editor or subscribing again',async()=>{
  await withApp(async({app,adapter,nodes,draft,document,calls,complete})=>{
    adapter.restoreCachedFeed();app.setupFeedSubscription();app.activeModal='collection-note';document.activeElement=draft;
    const operation=app.retryFeedRead();
    assert.equal(calls.render,0);assert.equal(calls.subscribe,1);assert.equal(calls.load,1);
    assert.equal(nodes.get(draft.id),draft);assert.equal(draft.value,'尚未保存的中文字');
    complete();await operation;
    assert.equal(calls.render,0);assert.equal(app.pendingRender,true);assert.equal(document.activeElement,draft);
  },{editor:'topic-note'});
});

test('closing a guide applies pending content only after the unsaved full profile editor is left',()=>{
  withApp(({app,draft,document,calls})=>{
    app.currentTab='profile';app.activeModal='guide';app.pendingRender=true;
    document.activeElement=draft;
    app.closeModal();
    assert.equal(app.activeModal,null);
    assert.equal(calls.render,0,'closing a guide must not reset the unsaved profile form behind it');
    assert.equal(app.pendingRender,true);assert.equal(draft.value,'尚未保存的中文字');
    app.switchTab('today');
    assert.equal(calls.render,1);assert.equal(app.pendingRender,false,'leaving the protected editor applies the pending content');
  },{editor:'profile-interests-input'});
});

async function withRealPendingRead(run) {
  const originals=['localStorage','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  const store=new Map();
  globalThis.localStorage={getItem:key=>store.get(key) ?? null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
  let release;
  const network=new Promise(resolve=>{release=resolve;});
  globalThis.fetch=()=>network;
  const data={schema_version:'0.3',mode:'live',generated_at:olderTime,
    profile:{interests:'',exclude:'',language:'zh'},sections:{daily:['news-aaaaaaaaaaaaaaaaaaaaaaaa'],discover:[]},
    sources:[{id:'news',name:'公开来源',home_url:'https://example.com/',group:'tech',kind:'original',link_kind:'article',status:'ok',last_success_at:olderTime}],
    items:[{id:'news-aaaaaaaaaaaaaaaaaaaaaaaa',title:'一条公开材料',summary:'来源提供的摘要，尚未读取全文。',origin:'rss',content_status:'excerpt_only',link_kind:'article',source_refs:['news'],original_url:'https://example.com/one',captured_at:olderTime,published_at:olderTime,unknowns:[]}],
  };
  const adapter=new FeedDataAdapter({mode:'live',publicPreview:true});
  adapter.feedData=data;adapter.loadStatus={phase:'ready',fromCache:false,cachedAt:olderTime,cacheWarning:false};
  let operation;
  try {
    await withApp(async context=>{
      context.useRealRendering();
      context.app.setupFeedSubscription();
      await run({...context,startRead:()=>{operation=adapter.loadFeed(true);return operation;}});
    },{realAdapter:adapter});
  } finally {
    release({ok:true,text:async()=>JSON.stringify(data)});
    await operation?.catch(()=>{});
    for(const [key,descriptor] of originals) {
      if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    }
  }
}

test('real bookmark clicks update the original icon and saved count while a background read remains pending',async()=>{
  await withRealPendingRead(async({app,adapter,nodes,calls,startRead})=>{
    app.render();const firstRender=calls.render;
    startRead();
    assert.equal(calls.render,firstRender,'the loading-status notification itself must only patch status');
    const button={id:'collect-news-news-aaaaaaaaaaaaaaaaaaaaaaaa'};
    app.toggleSaved('news-aaaaaaaaaaaaaaaaaaaaaaaa',button);
    let html=nodes.get('app').innerHTML;
    assert.equal(adapter.getState().savedItems.length,1);assert.equal(calls.render,firstRender+1);
    assert.match(html,/id="collect-news-news-aaaaaaaaaaaaaaaaaaaaaaaa"[^>]*aria-pressed="true"/);
    assert.match(html.match(/id="nav-saved"([\s\S]*?)<\/button>/)?.[1] || '',/nav-badge">1<\/span>/);
    assert.equal(adapter.loadStatus.phase,'loading');assert.equal(nodes.get('btn-check-update').disabled,true);
    app.toggleSaved('news-aaaaaaaaaaaaaaaaaaaaaaaa',button);
    html=nodes.get('app').innerHTML;
    assert.equal(adapter.getState().savedItems.length,0);assert.equal(calls.render,firstRender+2);
    assert.match(html,/id="collect-news-news-aaaaaaaaaaaaaaaaaaaaaaaa"[^>]*aria-pressed="false"/);
    assert.doesNotMatch(html.match(/id="nav-saved"([\s\S]*?)<\/button>/)?.[1] || '',/nav-badge/);
    assert.equal(adapter.loadStatus.phase,'loading');
  });
});

test('real archive and restore immediately update collection cards and counts during the same pending read',async()=>{
  await withRealPendingRead(async({app,adapter,nodes,calls,startRead})=>{
    adapter.setSaved('news-aaaaaaaaaaaaaaaaaaaaaaaa',true);
    app.currentTab='saved';app.savedSubTab='items';app.render();const firstRender=calls.render;
    assert.match(nodes.get('app').innerHTML,/1 条收藏。/);
    startRead();assert.equal(calls.render,firstRender);
    adapter.setArchived('news-aaaaaaaaaaaaaaaaaaaaaaaa',true);
    assert.equal(calls.render,firstRender+1);assert.match(nodes.get('app').innerHTML,/0 条收藏。/);
    assert.doesNotMatch(nodes.get('app').innerHTML,/id="collection-topic-news-aaaaaaaaaaaaaaaaaaaaaaaa"/);
    assert.equal(adapter.getState().archivedItems.length,1);assert.equal(adapter.loadStatus.phase,'loading');
    app.savedSubTab='archived';app.render();const archiveRender=calls.render;
    assert.match(nodes.get('app').innerHTML,/1 条归档材料。/);
    adapter.setArchived('news-aaaaaaaaaaaaaaaaaaaaaaaa',false);
    assert.equal(calls.render,archiveRender+1);assert.match(nodes.get('app').innerHTML,/0 条归档材料。/);
    assert.equal(adapter.getState().activeSavedItems.length,1);assert.equal(adapter.getState().archivedItems.length,0);
    assert.equal(adapter.loadStatus.phase,'loading');assert.equal(adapter.getState().sources[0].last_success_at,olderTime);
  });
});

async function withRotatingFeed(run) {
  const originals=['localStorage','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  const store=new Map();
  globalThis.localStorage={getItem:key=>store.get(key) ?? null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
  const firstId='news-aaaaaaaaaaaaaaaaaaaaaaaa',removedId='news-bbbbbbbbbbbbbbbbbbbbbbbb';
  const item=(id,summary)=>({id,title:id===firstId ? '仍在画面上的材料' : '稍后被移出的材料',summary,source_refs:['news'],original_url:`https://example.com/${id}`,captured_at:olderTime,origin:'rss',content_status:'excerpt_only',link_kind:'article',unknowns:[]});
  const original={schema_version:'0.3',mode:'live',generated_at:olderTime,
    profile:{interests:'',exclude:'',language:'zh'},sections:{daily:[firstId,removedId],discover:[]},
    sources:[{id:'news',name:'公开来源',kind:'original',group:'tech',home_url:'https://example.com/',status:'ok',last_success_at:olderTime}],
    items:[item(firstId,'画面上的旧摘要'),item(removedId,'已移出来源的旧摘要')],
  };
  let payload=original;
  globalThis.fetch=async()=>({ok:true,text:async()=>JSON.stringify(payload)});
  const adapter=new FeedDataAdapter({mode:'live',publicPreview:true});
  adapter.feedData=original;adapter.loadStatus={phase:'ready',fromCache:false,cachedAt:null,cacheWarning:false};
  const update=async summary=>{
    payload={...original,generated_at:newerTime,sections:{daily:[firstId],discover:[]},items:[item(firstId,summary)]};
    await adapter.loadFeed(true);
  };
  try {await run({adapter,store,original,firstId,removedId,update});}
  finally {for(const [key,descriptor] of originals) {if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('two unpainted real updates preserve removed screen material and an opened theme source snapshot',async()=>{
  await withRotatingFeed(async({adapter,store,original,firstId,removedId,update})=>{
    adapter.setDisplayedItems(original.items);
    const opened=adapter.topicItem(firstId);
    await update('后台第二包摘要');await update('后台第三包摘要');
    assert.equal(adapter.getState().allItems.find(item=>item.id===firstId).summary,'后台第三包摘要');
    assert.equal(adapter.topicItem(firstId).summary,'画面上的旧摘要');
    assert.equal(adapter.topicItem(removedId).summary,'已移出来源的旧摘要');
    assert.equal(store.get('personal-feed:live:v1'),undefined,'displayed copies alone must not enter user storage');
    const rawCache=store.get(FEED_CACHE_KEYS['public-live']);
    const cache=JSON.parse(rawCache);
    assert.equal(cache.feed.items.find(item=>item.id===firstId).summary,'后台第三包摘要');
    assert.ok(!cache.feed.items.some(item=>item.id===removedId),'the current feed cache must not absorb removed screen copies');
    assert.doesNotMatch(rawCache,/画面上的旧摘要|已移出来源的旧摘要/);
    const removedTopic=adapter.createTopic({title:'保留眼前已移出的材料'},removedId,'','');
    assert.equal(removedTopic.materials[0].item.summary,'已移出来源的旧摘要');
    adapter.setDisplayedItems(adapter.getState().allItems);
    assert.equal(adapter.topicItem(firstId).summary,'后台第三包摘要','a real new paint replaces the screen map');
    const openedTopic=adapter.createTopic({title:'保留打开表单时的说明'},firstId,'','',opened);
    assert.equal(openedTopic.materials[0].item.summary,'画面上的旧摘要','the open dialog keeps its explicit copy even after a new paint');
    const existingTopic=adapter.createTopic({title:'放进已有主题'});
    const added=adapter.addToTopic(existingTopic.id,firstId,'','',opened);
    assert.equal(added.materials[0].item.summary,'画面上的旧摘要');
    assert.equal(store.get(FEED_CACHE_KEYS['public-live']),rawCache,'choosing a source copy only writes user material, not the feed cache');
    assert.throws(()=>adapter.topicItem(firstId,{...opened,id:removedId}),/不一致/,'an explicit copy must retain the selected identity');
  });
});

test('a new paint clears uncollected copies while saved sources keep priority and cancelled copies do not mask the current feed',async()=>{
  await withRotatingFeed(async({adapter,store,original,firstId,removedId,update})=>{
    adapter.setDisplayedItems(original.items);
    await update('后台第二包摘要');await update('后台第三包摘要');
    assert.equal(store.get('personal-feed:live:v1'),undefined);
    const rawCache=store.get(FEED_CACHE_KEYS['public-live']);
    adapter.setSaved(firstId,true);
    assert.equal(adapter.getState().savedItems[0].summary,'画面上的旧摘要');
    adapter.setDisplayedItems(adapter.getState().allItems);
    assert.equal(adapter.topicItem(firstId).summary,'画面上的旧摘要','an already-saved source remains a stable original copy');
    assert.throws(()=>adapter.topicItem(removedId),/暂不可用/,'a new paint discards removed, uncollected screen copies');
    adapter.setSaved(firstId,false);
    assert.equal(adapter.getState().savedItems.length,0);
    assert.equal(adapter.topicItem(firstId).summary,'后台第三包摘要','a cancelled snapshot must not override the newly displayed feed');
    adapter.setDisplayedItems([]);
    assert.equal(adapter.topicItem(firstId).summary,'后台第三包摘要','leaving this paint falls back to the current feed before cancelled snapshots');
    assert.equal(store.get(FEED_CACHE_KEYS['public-live']),rawCache);
  });
});

test('a collected source merged under a new canonical ID opens and saves its original dialog copy',async()=>{
  await withRotatingFeed(async({adapter,original,firstId,removedId})=>{
    adapter.setSaved(firstId,true);
    const merged={...original.items[0],id:removedId,alias_ids:[firstId],summary:'新包合并后的摘要'};
    adapter.feedData={...original,items:[merged],sections:{daily:[removedId],discover:[]}};
    adapter.setDisplayedItems([merged]);
    const descriptor=Object.getOwnPropertyDescriptor(feedAdapter,'topicItem');
    feedAdapter.topicItem=adapter.topicItem.bind(adapter);
    const toasts=[],app={renderModals(){},showToast:message=>toasts.push(message)};
    try {
      openTopicDialog(app,'collect',{itemId:removedId},{id:'merged-row-theme'});
      assert.deepEqual(toasts,[]);assert.equal(app.topicContext.itemId,firstId);
      assert.equal(app.topicContext.itemSnapshot.id,firstId);
      assert.equal(adapter.topicItem(app.topicContext.itemId,app.topicContext.itemSnapshot).summary,'画面上的旧摘要');
      const topic=adapter.createTopic({title:'保留归并前的收藏来源'},app.topicContext.itemId,'','',app.topicContext.itemSnapshot);
      assert.equal(topic.materials[0].item.id,firstId);assert.equal(topic.materials[0].item.summary,'画面上的旧摘要');
      assert.equal(adapter.getState().savedItems[0].summary,'画面上的旧摘要');
    } finally {if(descriptor) Object.defineProperty(feedAdapter,'topicItem',descriptor);else delete feedAdapter.topicItem;}
  });
});

test('a displayed old search result still obeys newly hidden sources and aliases before saving',async()=>{
  await withRotatingFeed(async({adapter,original,firstId})=>{
    const aliasId='news-dddddddddddddddddddddddd';
    original.items[0].alias_ids=[aliasId];adapter.setDisplayedItems(original.items);
    await withApp(async({app,nodes,document})=>{
      const globalDescriptors=['document','window','requestAnimationFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
      const adapterDescriptors=['getState','displayedItems'].map(key=>[key,Object.getOwnPropertyDescriptor(feedAdapter,key)]);
      const element=id=>({id,value:'',hidden:false,listeners:{},addEventListener(type,handler){(this.listeners[type] ||= []).push(handler);},focus(){document.activeElement=this;}});
      const input=element('feed-search'),content=element('feed-board-content'),clear=element('feed-search-clear');
      const button={id:'old-visible-save',dataset:{feedSearchAction:'save',itemId:firstId},closest(){return this;}};
      content.contains=candidate=>candidate===button;
      for(const element of [input,content,clear]) nodes.set(element.id,element);
      Object.assign(app,{feedSearchQuery:'材料',feedSearchPurpose:'all',feedSearchLimit:20,boardGroup:'all',onlyNew:false,sourcePreferences:{hidden_source_ids:['news']}});
      globalThis.document=document;globalThis.window={scrollY:0,scrollX:0,scrollTo(){}};globalThis.requestAnimationFrame=callback=>callback();
      feedAdapter.getState=adapter.getState.bind(adapter);feedAdapter.displayedItems=adapter.displayedItems;
      const originalToggle=app.toggleSaved,saved=[];
      app.toggleSaved=function(id,trigger){saved.push(id);return originalToggle.call(this,id,trigger);};
      const click=()=>{for(const handler of content.listeners.click || []) handler({target:button,preventDefault(){}});};
      try {
        bindFeedSearchActions(app);
        click();assert.deepEqual(saved,[]);assert.equal(adapter.getState().savedItems.length,0,'a browser source preference change must deny stale result actions');
        app.sourcePreferences.hidden_source_ids=[];adapter.localState.hidden_item_ids=[aliasId];
        click();assert.deepEqual(saved,[]);assert.equal(adapter.getState().savedItems.length,0,'an existing hidden alias must still deny an old screen copy');
        adapter.localState.hidden_item_ids=[];adapter.feedData={...original,items:original.items.filter(item=>item.id!==firstId)};
        click();assert.deepEqual(saved,[firstId]);assert.equal(adapter.getState().savedItems[0].summary,'画面上的旧摘要','a still-eligible old result can be saved after it rotates out of the network feed');
      } finally {
        for(const [key,descriptor] of adapterDescriptors) {if(descriptor) Object.defineProperty(feedAdapter,key,descriptor);else delete feedAdapter[key];}
        for(const [key,descriptor] of globalDescriptors) {if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
      }
    },{realAdapter:adapter});
  });
});
