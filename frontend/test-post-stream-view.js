import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPostStream, bindPostStreamActions } from './src/postStreamView.js';
import { selectPostStream } from './src/postStream.js';

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
// Existing full-stream cases opt into all clues explicitly. Dedicated cases
// below verify the new default tutorial view and its reversible switch.
const app = () => ({postStreamView:'all',escapeHtml:escape, safeUrl:value => {try {const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';} catch {return '#';}}, formatTime:value => value});
const source = {id:'sopilot-ai', name:'SoPilot · AI', link_kind:'post', status:'ok'};
const post = (id, extra = {}) => ({id, title:`帖子 ${id}`, summary:'安装字幕工具的配置教程，第一步导出字幕文件。',
  source_refs:['sopilot-ai'], link_kind:'post', original_url:`https://x.com/builder/status/${id}`, author_name:'Builder', author_handle:'builder',
  published_at:'2026-10-08T00:00:00Z', source_item_time:'2026-10-08T01:00:00Z', captured_at:'2026-10-08T02:00:00Z', ...extra});
const state = items => ({allItems:items, sources:[source], hiddenItemIds:new Set(), savedItemIds:new Set(), archivedItemIds:new Set(), topics:[], profile:{}, refresh:{new_item_ids:[]}});

async function withAdapter(run) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:key => stored.get(key) || null, setItem:(key, value) => stored.set(key, value)}});
  try {
    const {FeedDataAdapter} = await import('./src/dataAdapter.js');
    await run(new FeedDataAdapter({publicPreview:true}));
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
  }
}

// Route the IDs actually painted in the HTML using the app's existing
// rememberDisplayedItems lookup, including preserved saved snapshots.
function rememberPaintedItems(adapter, input, html) {
  const visibleIds = new Set([...html.matchAll(/data-item-id="([^"]+)"/g)].map(match => match[1]));
  const candidates = new Map([...(input.allItems || []), ...(input.creatorItems || []), ...(input.savedItems || [])].map(item => [item.id, item]));
  adapter.setDisplayedItems([...visibleIds].map(id => candidates.get(id)
    || [...candidates.values()].find(item => item.alias_ids?.includes(id)) || adapter.displayedItems.get(id)).filter(Boolean));
}

function paintedSaveButton(html) {
  const match = /<button\b([^>]*id="post-stream-save-[^"]+"[^>]*)>([^<]+)<\/button>/.exec(html);
  assert.ok(match, 'expected the rendered stream save button');
  return {...Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])), label:match[2]};
}

test('one wide region renders exact original links, authors, tags and existing favorite and quickstart actions', () => {
  const input = state([post('123')]), html = renderPostStream(app(), input);
  assert.match(html, /id="post-stream" aria-labelledby="post-stream-heading"/); assert.match(html, /推特：值得看的线索/);
  assert.match(html, /来源标注作者：Builder · @builder/); assert.match(html, /SoPilot · AI/);
  assert.match(html, /href="https:\/\/x\.com\/builder\/status\/123"/);
  assert.match(html, /data-action="toggle-save" data-item-id="123"/);
  assert.match(html, /data-material-start="try" data-item-id="123"/); assert.match(html, /data-material-start="write" data-item-id="123"/);
  assert.match(html, /<details class="post-stream-excerpt"/); assert.match(html, /查看摘录与来源说明/);
  assert.match(html, /原帖发布/); assert.match(html, /榜单条目更新/); assert.match(html, /获取于/);
  assert.doesNotMatch(html, /AI 已筛选|实测通过|来源榜单位置|曝光\/小时/);
});

test('an exact resource group starts collapsed while every separate original retains its own actions', () => {
  const input = state([post('123', {summary:'工具教程：https://github.com/builder/tool'}), post('124', {summary:'工具教程：https://github.com/builder/tool'})]);
  const before = structuredClone(input), html = renderPostStream(app(), input);
  assert.equal([...html.matchAll(/class="post-stream-group"/g)].length, 1);
  assert.match(html, /同一 GitHub 项目 · 2 条原帖/);
  assert.match(html, /<details class="post-stream-originals" data-post-stream-group="repository:https:\/\/github.com\/builder\/tool" ><summary>查看另外 1 条原帖/);
  for (const id of ['123','124']) {
    assert.ok(html.includes(`data-action="toggle-save" data-item-id="${id}"`));
    assert.ok(html.includes(`href="https://x.com/builder/status/${id}"`));
  }
  assert.deepEqual(input, before);
});

test('resource-group expansion survives saving or dialogs and ignores stale toggle events', () => {
  const input = state([post('123', {summary:'工具教程：https://github.com/builder/tool'}), post('124', {summary:'工具教程：https://github.com/builder/tool'})]);
  const viewApp = app(), group = selectPostStream(input).allGroups[0];
  const detail = {dataset:{postStreamGroup:group.key}, listeners:{}, open:false, isConnected:true,
    addEventListener(type, handler) {this.listeners[type] = handler;}};
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = {querySelectorAll:selector => selector === '[data-post-stream-group]' ? [detail] : []};
  try {
    bindPostStreamActions(viewApp); assert.equal(viewApp.openPostGroups.size, 0);
    detail.open = true; detail.listeners.toggle();
    input.savedItemIds.add('124');
    const html = renderPostStream(viewApp, input);
    assert.ok(viewApp.openPostGroups.has(group.key)); assert.match(html, /data-post-stream-group="[^"]+" open><summary>/);
    assert.match(html, /id="post-stream-save-124" data-action="toggle-save" data-item-id="124" aria-pressed="true"/);
    detail.isConnected = false; detail.open = false; detail.listeners.toggle(); assert.ok(viewApp.openPostGroups.has(group.key));
    detail.isConnected = true; detail.listeners.toggle(); assert.equal(viewApp.openPostGroups.has(group.key), false);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  }
});

test('folded promotion stays visible by count and can be opened without losing actions', () => {
  const raffle = post('123', {title:'国庆节准备了11份币安周边抽给大家！！', summary:'国庆节准备了11份币安周边抽给大家！！'}),
    input = state([raffle, post('124')]), viewApp = app();
  const closed = renderPostStream(viewApp, input);
  assert.match(closed, /查看折叠的 1 条/); assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /data-post-stream-item-id="123"/);
  viewApp.postShowFolded = true; const open = renderPostStream(viewApp, input);
  assert.match(open, /收起折叠的 1 条/); assert.match(open, /aria-expanded="true"/);
  assert.match(open, /data-post-stream-item-id="123"/); assert.match(open, /折叠提示：/);
  assert.match(open, /data-action="toggle-save" data-item-id="123"/); assert.match(open, /可能误筛/);
});

test('escaped titles, authors, membership names, excerpts and resource labels remain plain text', () => {
  const unsafe = post('123', {title:'教程 <img src=x onerror="bad">', author_name:'作者 <script>bad</script>',
    summary:'操作教程 <script>bad</script> https://github.com/builder/tool'}), input = state([unsafe]);
  input.sources = [{...source, name:'SoPilot <b>来源</b>'}];
  const html = renderPostStream(app(), input);
  assert.match(html, /&lt;img src=x onerror=&quot;bad&quot;&gt;/); assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /SoPilot &lt;b&gt;来源&lt;\/b&gt;/); assert.doesNotMatch(html, /<script>|<img src=x|<b>来源/);
  const guarded = app(); guarded.safeUrl = () => '#'; assert.match(renderPostStream(guarded, input), /href="#"/);
});

test('saved aliases and topic membership stay correctly labelled without copying data into the view', () => {
  const input = state([post('123', {alias_ids:['old-123']})]), viewApp = app();
  input.savedItemIds.add('old-123'); input.topics = [{materials:[{item:{id:'old-123'}}]}];
  assert.match(renderPostStream(viewApp, input), /aria-pressed="true"[^>]*>取消收藏/);
  assert.match(renderPostStream(viewApp, input), /id="post-stream-save-123" data-action="toggle-save" data-item-id="old-123"/);
  assert.match(renderPostStream(viewApp, input), /已在选题卡中/);
  input.savedItemIds.clear(); input.archivedItemIds.add('old-123');
  assert.match(renderPostStream(viewApp, input), /id="post-stream-save-123" data-action="restore-collection" data-item-id="old-123"/);
});

test('a same-status current card cancels the actual old saved record without creating another collection', async () => {
  for (const retainOldFeedRecord of [true, false]) await withAdapter(adapter => {
    const old = post('news-111122223333444455556666', {original_url:'https://twitter.com/old_handle/status/123', canonical_url:'https://twitter.com/old_handle/status/123',
      author_handle:'old_handle', summary:'旧的来源摘录。'});
    const current = post('news-aaaabbbbccccddddeeeeffff', {original_url:'https://x.com/new_handle/status/123', canonical_url:'https://x.com/new_handle/status/123',
      author_handle:'new_handle', summary:'更新后的来源摘录更长，包含安装字幕工具的具体配置教程与操作说明。'});
    adapter.feedData = {schema_version:'0.3', mode:'live', profile:{interests:'', exclude:'', language:'zh-CN'},
      sources:[source], items:[old], sections:{daily:[], discover:[]}};
    adapter.setSaved(old.id, true);
    adapter.feedData.items = retainOldFeedRecord ? [old, current] : [current];
    const input = adapter.getState(), beforeFeed = structuredClone(adapter.feedData), beforeSnapshot = structuredClone(input.savedItems[0]);
    const html = renderPostStream(app(), input), button = paintedSaveButton(html);
    assert.equal(button.id, `post-stream-save-${current.id}`); assert.equal(button.label, '取消收藏');
    assert.equal(button['data-item-id'], old.id); assert.equal(button['data-action'], 'toggle-save'); assert.equal(button['aria-pressed'], 'true');
    for (const intent of ['try','write']) assert.ok(html.includes(`data-material-start="${intent}" data-item-id="${current.id}"`));
    rememberPaintedItems(adapter, input, html);
    assert.deepEqual(adapter.displayedItems.get(old.id), beforeSnapshot); assert.equal(adapter.topicItem(old.id).original_url, old.original_url);
    const selectedId = button['data-item-id'], currentlySaved = adapter.getState().savedItemIds.has(selectedId);
    adapter.setSaved(selectedId, !currentlySaved); // The app's toggleSaved contract.
    assert.deepEqual(adapter.localState.saved_item_ids, []); assert.equal(adapter.getState().savedItems.length, 0);
    assert.deepEqual(adapter.localState.item_snapshots[old.id], beforeSnapshot); assert.deepEqual(adapter.feedData, beforeFeed);
    const nextButton = paintedSaveButton(renderPostStream(app(), adapter.getState()));
    assert.equal(nextButton.id, button.id); assert.equal(nextButton.label, '收藏'); assert.equal(nextButton['data-item-id'], current.id);
  });
});

test('a same-status current card restores the actual old archive snapshot and keeps one saved material', async () => {
  await withAdapter(adapter => {
    const old = post('news-111122223333444455556666', {original_url:'https://twitter.com/old_handle/status/123', canonical_url:'https://twitter.com/old_handle/status/123',
      author_handle:'old_handle', summary:'旧的来源摘录。'});
    const current = post('news-aaaabbbbccccddddeeeeffff', {original_url:'https://x.com/new_handle/status/123', canonical_url:'https://x.com/new_handle/status/123',
      author_handle:'new_handle', summary:'更新后的来源摘录更长，包含安装字幕工具的具体配置教程与操作说明。'});
    adapter.feedData = {schema_version:'0.3', mode:'live', profile:{interests:'', exclude:'', language:'zh-CN'},
      sources:[source], items:[old], sections:{daily:[], discover:[]}};
    adapter.setSaved(old.id, true); adapter.setArchived(old.id, true); adapter.feedData.items = [current];
    const input = adapter.getState(), snapshot = structuredClone(input.savedItems[0]), html = renderPostStream(app(), input), button = paintedSaveButton(html);
    assert.equal(button.id, `post-stream-save-${current.id}`); assert.equal(button.label, '恢复收藏');
    assert.equal(button['data-action'], 'restore-collection'); assert.equal(button['data-item-id'], old.id);
    rememberPaintedItems(adapter, input, html); assert.deepEqual(adapter.displayedItems.get(old.id), snapshot);
    adapter.setArchived(button['data-item-id'], false);
    assert.deepEqual(adapter.localState.saved_item_ids, [old.id]); assert.deepEqual(adapter.localState.archived_item_ids, []);
    assert.equal(adapter.getState().savedItems.length, 1); assert.deepEqual(adapter.getState().savedItems[0], snapshot);
    const nextButton = paintedSaveButton(renderPostStream(app(), adapter.getState()));
    assert.equal(nextButton.id, button.id); assert.equal(nextButton.label, '取消收藏'); assert.equal(nextButton['data-item-id'], old.id);
  });
});

test('pagination starts at five and the binder only changes ephemeral view fields', () => {
  const input = state(Array.from({length:12}, (_, index) => post(String(index + 100)))), viewApp = app();
  assert.equal([...renderPostStream(viewApp, input).matchAll(/data-post-stream-item-id=/g)].length, 5);
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), before = structuredClone(input);
  const controls = {fold:{listeners:{}, addEventListener(type, handler) {this.listeners[type] = handler;}, focus() {}},
    more:{listeners:{}, addEventListener(type, handler) {this.listeners[type] = handler;}, focus() {}}};
  globalThis.document = {querySelectorAll:selector => selector === '[data-post-stream-fold-toggle]' ? [controls.fold]
    : selector === '[data-post-stream-more]' ? [controls.more] : [],
    getElementById:id => id === 'post-stream-more' ? controls.more : controls.fold};
  viewApp.renderCount = 0; viewApp.render = () => {viewApp.renderCount++;};
  try {
    bindPostStreamActions(viewApp); controls.more.listeners.click();
    assert.equal(viewApp.postStreamLimit, 10); assert.equal(viewApp.renderCount, 1);
    assert.equal([...renderPostStream(viewApp, input).matchAll(/data-post-stream-item-id=/g)].length, 10);
    controls.fold.listeners.click(); assert.equal(viewApp.postShowFolded, true); assert.equal(viewApp.renderCount, 2);
    controls.fold.listeners.click(); assert.equal(viewApp.postShowFolded, false); assert.deepEqual(input, before);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  }
});

test('empty new-only range and missing author or time do not promise unknown information', () => {
  const viewApp = app(), input = state([post('123', {author_name:undefined, author_handle:undefined, published_at:undefined})]);
  assert.match(renderPostStream(viewApp, input), /来源未提供作者/); assert.match(renderPostStream(viewApp, input), /原帖发布时间未提供/);
  viewApp.onlyNew = true; assert.match(renderPostStream(viewApp, input), /当前范围最近一次没有新增原帖/);
});

test('the default tutorial view shows real instruction signals, accurate scope counts and a route to all clues',()=>{
  const tutorial=post('700',{title:'给截图加箭头',summary:'1. 打开截图工具，选择图片文件。\n2. 点击箭头按钮，再保存图片。'}),
    news=post('701',{title:'普通公共新闻',summary:'活动现场新闻报道。'}),
    raffle=post('702',{title:'转发抽周边',summary:'关注转发抽周边！'});
  const input=state([tutorial,news,raffle]),before=structuredClone(input),viewApp=app();delete viewApp.postStreamView;
  const html=renderPostStream(viewApp,input);
  assert.match(html,/推特：操作教程 <small>1 条可读原帖/);
  assert.match(html,/id="post-stream-view-tutorials"[^>]+aria-pressed="true">操作教程<span>1<\/span>/);
  assert.match(html,/id="post-stream-view-all"[^>]+aria-pressed="false">全部线索<span>3<\/span>/);
  assert.match(html,/摘录含具体操作步骤/);assert.match(html,/可能漏掉图片或线程中的步骤/);
  assert.match(html,/入选不代表实测或自动精选/);assert.doesNotMatch(html,/data-post-stream-item-id="(?:701|702)"/);
  viewApp.postStreamView='all';const all=renderPostStream(viewApp,input);
  assert.match(all,/data-post-stream-item-id="701"/);assert.match(all,/查看折叠的 1 条/);assert.deepEqual(input,before);
});

test('an empty tutorial range stays empty instead of showing news and lets readers recover all clues',()=>{
  const input=state([post('710',{title:'普通新闻',summary:'这是公共新闻报道，没有提供操作过程。'})]),viewApp=app();viewApp.postStreamView='tutorials';
  const html=renderPostStream(viewApp,input);
  assert.match(html,/没有识别到可跟着做的教程/);assert.match(html,/data-post-stream-view="all">查看全部线索/);
  assert.doesNotMatch(html,/data-post-stream-item-id="710"/);assert.match(html,/全部线索<span>1<\/span>/);
});

test('view switching resets pagination and folded expansion, restores focus and never touches material state',()=>{
  const input=state([post('720')]),before=structuredClone(input),viewApp=app();
  viewApp.postStreamLimit=15;viewApp.postShowFolded=true;viewApp.renderCount=0;viewApp.render=()=>viewApp.renderCount++;
  let focused='';
  const control=view=>({dataset:{postStreamView:view},listeners:{},addEventListener(type,callback){this.listeners[type]=callback;},focus(){focused=view;}});
  const tutorials=control('tutorials'),all=control('all'),invalid=control('invalid'),disabled=control('all');disabled.disabled=true;
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  globalThis.document={querySelectorAll:selector=>selector==='[data-post-stream-view]' ? [tutorials,all,invalid,disabled]:[],
    getElementById:id=>id==='post-stream-view-tutorials' ? tutorials : id==='post-stream-view-all' ? all:null};
  try {
    bindPostStreamActions(viewApp);tutorials.listeners.click();
    assert.equal(viewApp.postStreamView,'tutorials');assert.equal(viewApp.postStreamLimit,5);assert.equal(viewApp.postShowFolded,false);assert.equal(focused,'tutorials');
    all.listeners.click();assert.equal(viewApp.postStreamView,'all');assert.equal(focused,'all');assert.equal(viewApp.renderCount,2);
    invalid.listeners.click();disabled.listeners.click();assert.equal(viewApp.renderCount,2);assert.deepEqual(input,before);
  } finally {
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else delete globalThis.document;
  }
});
