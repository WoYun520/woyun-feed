import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { bindFeedSearchActions } from './src/feedSearchView.js';
import { feedAdapter } from './src/dataAdapter.js';
import { boardUpdateMessage, feedUpdateInfo } from './src/sourceBoard.js';
import { feedLoadMessage } from './src/feedLoadingView.js';
import { renderWorkspaceNavigation, renderWorkspaceResume, renderWorkspaceStorageNotice } from './src/workspaceShell.js';
import { DOT_FILTER_DEFAULTS } from './src/dotCandidateFilters.js';

const appSource = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
const bootstrap = '// 页面加载完成后启动应用';
assert.ok(appSource.includes(bootstrap));
// Run the production class without its imports or automatic page startup.
const classSource = appSource.split(bootstrap)[0].replace(/^import [^\n]*\n/gm, '')
  + '\nthis.PersonalFeedApp = PersonalFeedApp;';

async function withBackgroundSearch(run) {
  const originals = ['document', 'window', 'requestAnimationFrame']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const originalGetState = feedAdapter.getState;
  const frames = [], renders = [], focusCalls = [], toasts = [];
  const document = {activeElement:null, querySelectorAll:()=>[]};
  const node = id => ({id, isConnected:true, value:'', disabled:false, listeners:{},
    addEventListener(type, handler) {(this.listeners[type] ||= []).push(handler);},
    focus() {focusCalls.push(id);document.activeElement=this;},
    setSelectionRange(start, end) {this.selectionStart=start;this.selectionEnd=end;},
  });
  const input = node('feed-search'), button = node('btn-check-update');
  const content = node('feed-board-content'), clear = node('feed-search-clear');
  const body = node('body'), nodes = new Map([input,button,content,clear].map(value=>[value.id,value]));
  document.getElementById = id => nodes.get(id) || null;
  const window = {scrollY:0, scrollX:0, scrollTo(){}};
  const requestAnimationFrame = callback => frames.push(callback);
  let resolveRefresh, rejectRefresh;
  const refresh = new Promise((resolve,reject)=>{resolveRefresh=resolve;rejectRefresh=reject;});
  const adapter = {publicPreview:true, refreshFeed:()=>refresh};
  const sandbox = {document,window,requestAnimationFrame,feedAdapter:adapter,URL,renderWorkspaceNavigation,renderWorkspaceResume,renderWorkspaceStorageNotice,DOT_FILTER_DEFAULTS};
  vm.runInNewContext(classSource, sandbox, {filename:'src/app.js'});
  const app = Object.assign(Object.create(sandbox.PersonalFeedApp.prototype), {
    currentTab:'today', feedView:'sources', activeModal:null, refreshing:false,
    feedSearchComposing:false, feedSearchQuery:'', feedSearchPurpose:'all',
    feedSearchLimit:20, boardGroup:'all', onlyNew:false, pendingRender:false,
    sourcePreferences:{hidden_source_ids:[]},
  });
  app.render = function () {
    renders.push({composing:this.feedSearchComposing,active:document.activeElement?.id});
    this.pendingRender=false;
  };
  app.showToast = message => toasts.push(message);
  feedAdapter.getState = () => ({
    sources:[{id:'news',name:'公开来源',group:'tech'}], hiddenItemIds:new Set(),
    allItems:[{id:'public-one',title:'字幕工具',summary:'已有的视频字幕简介。',
      original_url:'https://example.com/subtitle',source_refs:['news']}],
    savedItemIds:new Set(), archivedItemIds:new Set(), topics:[], refresh:{new_item_ids:[]},
  });
  for (const [key,value] of Object.entries({document,window,requestAnimationFrame})) {
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const fire = (target,type,event={}) => {
    for (const handler of target.listeners[type] || []) handler(event);
  };
  const flushFrames = () => {while (frames.length) frames.shift()();};
  try {
    bindFeedSearchActions(app);
    await run({app,input,button,content,body,document,renders,focusCalls,toasts,
      fire,flushFrames,resolveRefresh,rejectRefresh});
  } finally {
    feedAdapter.getState=originalGetState;
    for (const [key,descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
}

test('a real refresh completing during Chinese composition preserves the input, draft and cursor until blur', async () => {
  await withBackgroundSearch(async ({app,input,button,content,body,document,renders,focusCalls,toasts,fire,flushFrames,resolveRefresh}) => {
    document.activeElement=button;
    const operation=app.refreshFeed();
    assert.equal(renders.length,1);
    assert.equal(app.refreshing,true);
    button.disabled=true;
    input.focus();input.value='字';input.setSelectionRange(1,1);
    fire(input,'compositionstart');fire(input,'input',{isComposing:true});
    resolveRefresh('已读取公开内容。');await operation;
    assert.equal(renders.length,1,'refresh completion must not redraw a composing input');
    assert.deepEqual(focusCalls,['feed-search'],'refresh completion must not steal focus');
    assert.equal(document.activeElement,input);assert.equal(document.getElementById('feed-search'),input);
    assert.equal(input.value,'字');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,1);
    assert.equal(app.feedSearchQuery,'字');assert.equal(app.feedSearchComposing,true);
    assert.equal(app.pendingRender,true);assert.equal(app.refreshing,false);
    assert.equal(button.disabled,false);assert.equal(button.textContent,'查看更新');
    assert.deepEqual(toasts,['已读取公开内容。']);

    input.value='字幕';input.setSelectionRange(1,1);fire(input,'compositionend');
    assert.equal(app.feedSearchComposing,false);assert.equal(app.feedSearchQuery,'字幕');
    assert.equal(renders.length,1);assert.equal(document.activeElement,input);
    assert.equal(input.selectionStart,1);assert.match(content.innerHTML,/找到 1 条材料/);
    document.activeElement=body;fire(input,'blur');flushFrames();
    assert.equal(renders.length,2,'the production blur handler must apply the deferred render');
    assert.equal(app.pendingRender,false);
  });
});

test('a failed real refresh also defers for focused plain input and renders after editing ends', async () => {
  await withBackgroundSearch(async ({app,input,button,body,document,renders,focusCalls,fire,flushFrames,rejectRefresh}) => {
    document.activeElement=button;
    const operation=app.refreshFeed();
    input.focus();input.value='字幕';input.setSelectionRange(1,1);
    fire(input,'input',{isComposing:false});
    assert.equal(app.feedSearchComposing,false);
    rejectRefresh(new Error('synthetic fetch failure'));await operation;
    assert.equal(renders.length,1,'the focused-input guard must apply independently of composition');
    assert.deepEqual(focusCalls,['feed-search']);assert.equal(document.activeElement,input);
    assert.equal(app.feedSearchQuery,'字幕');assert.equal(input.selectionStart,1);
    assert.equal(app.pendingRender,true);assert.equal(app.refreshing,false);
    assert.match(app.refreshError,/暂时无法更新/);
    document.activeElement=body;fire(input,'blur');flushFrames();
    assert.equal(renders.length,2);assert.equal(app.pendingRender,false);
  });
});


test('deferred source-board notices follow cached, loading, failure and completed reads without replacing the search input',()=>{
  const input={id:'feed-search',value:'尚未确认的中文输入',selectionStart:4,selectionEnd:4};
  const hiddenNotice={textContent:''},visibleText={textContent:''},classes=new Set();
  const visibleNotice={hidden:false,classList:{toggle(name,enabled){if(enabled) classes.add(name);else classes.delete(name);}},querySelector:selector=>selector==='span' ? visibleText : null};
  const button={disabled:false,textContent:''};
  const document={activeElement:input,getElementById:id=>id==='btn-check-update' ? button : null,
    querySelector:selector=>selector==='[data-feed-update-notice]' ? hiddenNotice : selector==='[data-board-update-message]' ? visibleNotice : null};
  const sandbox={document,feedUpdateInfo,boardUpdateMessage,feedLoadMessage,renderWorkspaceNavigation,renderWorkspaceResume,renderWorkspaceStorageNotice,DOT_FILTER_DEFAULTS};
  vm.runInNewContext(classSource,sandbox,{filename:'src/app.js'});
  const app=Object.assign(Object.create(sandbox.PersonalFeedApp.prototype),{
    currentTab:'today',feedView:'sources',activeModal:null,sourceManagerOpen:false,
    feedSearchComposing:true,refreshing:false,refreshError:'',pendingRender:false,
  });
  let renders=0;app.render=()=>{renders++;};
  const historicalSource={id:'news',status:'failed',last_success_at:'2026-10-01T12:00:00Z'};
  const state=phase=>({mode:'live',publicPreview:true,sources:[historicalSource],generated_at:'2026-10-01T12:00:00Z',
    refresh:{status:'partial',message:'历史来源部分更新失败'},loadStatus:{phase,fromCache:true,errorKind:phase==='error' ? 'timeout' : null}});
  app.onFeedStateChange(state('cached'));
  assert.match(visibleText.textContent,/尚未检查网站更新/);assert.equal(classes.has('update-failed'),false);
  app.onFeedStateChange(state('loading'));
  assert.match(visibleText.textContent,/正在读取网站更新/);assert.equal(button.disabled,true);
  app.onFeedStateChange(state('error'));
  assert.match(visibleText.textContent,/读取等待超时/);assert.equal(classes.has('update-failed'),true);
  assert.doesNotMatch(visibleText.textContent,/尚未检查|正在读取/);
  app.onFeedStateChange(state('ready'));
  assert.match(visibleText.textContent,/网站内容已读到，结束操作或关闭编辑后显示/);
  assert.equal(classes.has('update-failed'),false);assert.equal(button.disabled,false);
  assert.equal(renders,0);assert.equal(document.activeElement,input);assert.equal(input.value,'尚未确认的中文输入');
  assert.equal(input.selectionStart,4);assert.equal(input.selectionEnd,4);
  assert.equal(historicalSource.last_success_at,'2026-10-01T12:00:00Z');
  app.pendingRender=false;app.updateFeedStatus(state('ready'));
  assert.match(visibleText.textContent,/1 个来源最近一次未更新，旧内容仍可阅读/);
  assert.doesNotMatch(visibleText.textContent,/本轮|暂时无法连接|读取等待超时/);
  const completed={...state('ready'),sources:[{...historicalSource,status:'ok'}],refresh:{status:'ok'}};
  app.updateFeedStatus(completed);assert.equal(visibleNotice.hidden,true);assert.equal(visibleText.textContent,'');
});
