import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDailyHighlights } from './src/dailyHighlightsView.js';
import { renderSourceBoard } from './src/sourceBoard.js';
import { sourcePreferenceKey } from './src/sourcePreferences.js';
import { PRACTICAL_ITEMS, PRACTICAL_SOURCE } from './src/practicalMaterials.js';

const now='2026-10-01T17:00:00Z',updated='2026-10-01T16:30:00Z',captured='2026-10-01T16:35:00Z';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const preferences=(hidden=[])=>({version:1,hidden_source_ids:hidden,pinned_source_ids:[]});
const app=()=>({escapeHtml:escape,safeUrl:value=>{
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol) ? url.href : '#';}catch{return '#';}
},formatTime:value=>value,sourceLimits:{},boardGroup:'all',sourcePreferences:preferences(),sourcePreferenceKey:sourcePreferenceKey('live')});
const source=(id='github',group='tech')=>({id,name:'GitHub',kind:'repository',link_kind:'repository',group,status:'ok',last_success_at:captured,home_url:'https://github.com/'});
const item=(id='original-one',sourceId='github')=>({id,title:'[自动前缀] 原项目名',summary:'作者介绍的视频字幕工具，未提供费用说明。',source_refs:[sourceId],
  original_url:`https://github.com/example/${id}`,canonical_url:`https://github.com/example/${id}`,repository_name:`example/${id}`,
  link_kind:'repository',content_status:'metadata_only',verification_status:'not_tested',captured_at:captured,updated_at:updated,
  repository_guide:{summary:'可在本机识别视频语音并生成字幕，便于整理视频内容。',basis:'description',verification:'not_tested',
    source_url:`https://github.com/example/${id}`,recorded_at:captured}});
const state=(items=[item()],sources=[source()])=>({mode:'live',allItems:items,sources,profile:{interests:'',exclude:''},hiddenItemIds:new Set(),
  savedItemIds:new Set(),archivedItemIds:new Set(),topics:[],refresh:{new_item_ids:[]}});
const render=(viewApp,input)=>renderDailyHighlights(viewApp,input,{now:Date.parse(now)});

test('daily cards use Chinese source-based purpose, original repository name and unchanged material identities',()=>{
  const viewApp=app(),input=state(),before=structuredClone(input),html=render(viewApp,input);
  assert.match(html,/先挑一件值得做的事/);assert.match(html,/2026-10-02 整理/);
  assert.match(html,/可在本机识别视频语音并生成字幕/);assert.match(html,/example\/original-one/);
  assert.doesNotMatch(html,/\[自动前缀\]/);assert.match(html,/费用待确认/);assert.doesNotMatch(html,/免费使用|完全免费/);
  for (const label of ['能做什么','适合谁','入选理由','依据：','来源：']) assert.ok(html.includes(label));
  assert.match(html,/按已有说明自动初筛，未实测/);assert.match(html,/每次最多 3 条/);assert.match(html,/来源初筛 · 少而有用/);
  assert.ok(html.indexOf('class="daily-highlight-reason"')<html.indexOf('<details class="action-highlight-evidence"'));
  assert.match(html,/id="daily-collect-original-one" data-action="toggle-save" data-item-id="original-one"/);
  assert.match(html,/id="daily-try-original-one" data-material-start="try" data-item-id="original-one"/);
  assert.match(html,/id="daily-write-original-one" data-material-start="write" data-item-id="original-one"/);
  assert.match(html,/准备条件未说明/);
  assert.deepEqual(input,before);assert.equal(input.allItems[0].title,'[自动前缀] 原项目名');
  assert.equal(input.allItems[0].cost,undefined);assert.equal(input.allItems[0].purpose,undefined);
});

test('daily source text is escaped and original links go through the existing safe URL helper',()=>{
  const original=item();
  original.repository_guide.summary='可在本机生成视频字幕，方便整理素材。<script>bad</script>';
  const origin=source();origin.name='GitHub <img src=x onerror="bad">';
  const viewApp=app(),urls=[];viewApp.safeUrl=url=>{urls.push(url);return '#';};
  const html=render(viewApp,state([original],[origin]));
  assert.match(html,/data-daily-item-id="original-one"/);
  assert.match(html,/&lt;img src=x onerror=&quot;bad&quot;&gt;/);assert.doesNotMatch(html,/<script>|<img/);
  assert.match(html,/href="#" target="_blank" rel="noopener noreferrer"/);
  assert.deepEqual(urls,[original.original_url]);assert.doesNotMatch(html,/href="javascript:/);
});

test('daily bookmarks, archive restoration and existing-topic labels keep original IDs and unique DOM IDs',()=>{
  const viewApp=app(),input=state();input.savedItemIds.add('original-one');
  input.allItems[0].alias_ids=['old-one'];input.topics=[{materials:[{item:{id:'old-one'}}]}];
  const saved=render(viewApp,input);
  assert.match(saved,/id="daily-collect-original-one"[^>]+aria-pressed="true"/);assert.match(saved,/取消收藏/);assert.match(saved,/已在选题卡/);
  const ids=[...saved.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>id.startsWith('daily-')));
  input.savedItemIds.clear();input.archivedItemIds.add('original-one');
  const archived=render(viewApp,input);
  assert.match(archived,/id="daily-collect-original-one" data-action="restore-collection" data-item-id="original-one"/);
  assert.match(archived,/恢复收藏/);assert.match(archived,/data-material-start="write" data-item-id="original-one"/);
});

test('daily dates use Beijing time while code updates and capture retain their real separate timestamps',()=>{
  const html=render(app(),state());
  assert.match(html,/2026-10-02 整理 · 北京时间/);
  assert.match(html,/仓库更新/);assert.match(html,/datetime="2026-10-01T16:30:00.000Z"/);
  assert.match(html,/datetime="2026-10-01T16:35:00.000Z"/);assert.match(html,/采集于/);
  assert.match(html,/10(?:\/|月)2(?:日)? 00:30/);assert.doesNotMatch(html,/今日发布|今天发布/);
  const article={...item(),id:'article',title:'视频字幕制作工具介绍',repository_name:undefined,repository_guide:undefined,
    original_url:'https://news.example/article',canonical_url:'https://news.example/article',link_kind:'article',updated_at:undefined,
    summary:'介绍可在本机为视频生成字幕的工具，方便整理创作素材。'};
  const articleSource={...source(),kind:'original',link_kind:'article'};
  const unknown=render(app(),state([article],[articleSource]));
  assert.match(unknown,/data-daily-item-id="article"/);assert.match(unknown,/发布未知/);
  assert.match(unknown,/datetime="2026-10-01T16:35:00.000Z"/);assert.doesNotMatch(unknown,/仓库更新/);
});

test('daily selection respects saved source visibility, categories, hidden aliases and new-only scope without fallback',()=>{
  const first=item(),second=item('second','other');second.alias_ids=['old-second'];
  const input=state([first,second],[source(),source('other','community')]),viewApp=app();
  assert.match(render(viewApp,input),/data-daily-item-id="original-one"/);
  viewApp.sourcePreferences=preferences(['github']);
  const hidden=render(viewApp,input);assert.doesNotMatch(hidden,/data-daily-item-id="original-one"/);assert.match(hidden,/data-daily-item-id="second"/);
  viewApp.boardGroup='tech';const emptyCategory=render(viewApp,input);
  assert.match(emptyCategory,/daily-highlights-empty/);assert.doesNotMatch(emptyCategory,/data-daily-item-id=/);assert.match(emptyCategory,/仍可查看来源板块/);
  viewApp.boardGroup='community';input.hiddenItemIds.add('old-second');assert.doesNotMatch(render(viewApp,input),/data-daily-item-id=/);
  input.hiddenItemIds.clear();viewApp.onlyNew=true;assert.doesNotMatch(render(viewApp,input),/data-daily-item-id=/);
  input.refresh.new_item_ids=['second'];assert.match(render(viewApp,input),/data-daily-item-id="second"/);
  input.profile.exclude='字幕';assert.doesNotMatch(render(viewApp,input),/data-daily-item-id=/);
});

test('source board displays action highlights before original panels and does not apply an unsaved source draft',()=>{
  const current=new Date().toISOString(),input=state();
  input.sources[0].last_success_at=current;
  Object.assign(input.allItems[0],{updated_at:current,captured_at:current});input.allItems[0].repository_guide.recorded_at=current;
  const viewApp=app();viewApp.sourceManagerOpen=true;viewApp.sourcePreferenceDraft=preferences(['github']);
  const before=structuredClone(input),html=renderSourceBoard(viewApp,input);
  assert.match(html,/id="source-manager-form"/);assert.match(html,/data-daily-item-id="original-one"/);
  assert.ok(html.indexOf('id="daily-highlights"')>html.indexOf('class="board-status"'));
  assert.ok(html.indexOf('id="daily-highlights"')<html.indexOf('class="source-board"'));
  assert.doesNotMatch(html,/<details class="board-highlights"/);
  assert.match(html,/data-source-panel="github"/);assert.deepEqual(viewApp.sourcePreferenceDraft,preferences(['github']));
  viewApp.sourcePreferences=preferences(['github']);const hidden=renderSourceBoard(viewApp,input);
  assert.doesNotMatch(hidden,/data-daily-item-id=/);assert.doesNotMatch(hidden,/data-source-panel=/);
  assert.match(hidden,/id="source-manager-open"/);assert.match(hidden,/id="source-restore-all"/);
  assert.deepEqual(input,before);
});

test('action picks distinguish fixed official reading, keep full fee evidence and never promise a successful trial',()=>{
  const input=state(structuredClone(PRACTICAL_ITEMS),[{...PRACTICAL_SOURCE}]);
  const html=renderDailyHighlights(app(),input,{now:Date.parse('2026-10-07T03:00:00Z')});
  assert.match(html,/读过官方说明 · 未实测/);assert.match(html,/固定说明 · 非今日更新/);
  assert.match(html,/说明阅读时间/);assert.match(html,/未安装、未实测/);
  assert.match(html,/免费范围及额外费用需核对/);assert.match(html,/在线.*收费/);
  assert.doesNotMatch(html,/今日发布|已经试用|本站验证通过/);
  assert.equal([...html.matchAll(/data-material-start="try"/g)].length,2);
  assert.equal([...html.matchAll(/data-material-start="write"/g)].length,2);
});

test('daily cards cancel or restore the actual old same-status collection snapshot without duplicate saving',async()=>{
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try {
    for(const archived of [false,true]) {
      const stored=new Map();
      Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)}});
      const {FeedDataAdapter}=await import('./src/dataAdapter.js');
      const adapter=new FeedDataAdapter({publicPreview:true});
      const origin={id:'sopilot-ai',name:'SoPilot · AI',kind:'aggregator',group:'posts',link_kind:'post',status:'ok',last_success_at:captured};
      const old={id:'news-111122223333444455556666',title:'字幕处理教程',summary:'来源提供的旧摘录。',
        source_refs:[origin.id],link_kind:'post',content_status:'excerpt_only',verification_status:'not_tested',
        original_url:'https://twitter.com/old_handle/status/1234567890123456789',canonical_url:'https://twitter.com/old_handle/status/1234567890123456789',
        author_name:'旧账号名称',author_handle:'old_handle',published_at:updated,captured_at:captured};
      const current={...old,id:'news-aaaabbbbccccddddeeeeffff',title:'视频字幕工具配置教程',
        summary:'可以提取视频音频并转录生成字幕文件。\n第一步安装字幕工具，第二步导出字幕文件。\n安装指令：\nnpx skills add builder/subtitle-tool',
        original_url:'https://x.com/new_handle/status/1234567890123456789',canonical_url:'https://x.com/new_handle/status/1234567890123456789',
        author_name:'当前账号名称',author_handle:'new_handle'};
      adapter.feedData={schema_version:'0.3',mode:'live',sources:[origin],items:[old],profile:{interests:'',exclude:'',language:'zh-CN'},sections:{daily:[],discover:[]}};
      adapter.setSaved(old.id,true);if(archived) adapter.setArchived(old.id,true);
      adapter.feedData.items=[current];
      const input=adapter.getState(),snapshot=structuredClone(input.savedItems[0]),beforeFeed=structuredClone(adapter.feedData);
      const html=render(app(),input),match=/<button\b([^>]*id="daily-collect-[^"]+"[^>]*)>([^<]+)<\/button>/.exec(html);
      assert.ok(match,'the current practical post should appear as a daily card');
      const button=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute=>[attribute[1],attribute[2]]));
      assert.equal(button.id,`daily-collect-${current.id}`);assert.equal(button['data-item-id'],old.id);
      assert.equal(match[2],archived ? '恢复收藏' : '取消收藏');
      assert.equal(button['data-action'],archived ? 'restore-collection' : 'toggle-save');
      for(const intent of ['try','write']) assert.ok(html.includes(`data-material-start="${intent}" data-item-id="${current.id}"`));
      assert.equal(current.alias_ids,undefined);assert.equal(old.alias_ids,undefined);
      // The app's displayed-item lookup can route this painted old ID through
      // savedItems even though the old record is absent from the current feed.
      const visibleIds=new Set([...html.matchAll(/data-item-id="([^"]+)"/g)].map(attribute=>attribute[1]));
      const candidates=new Map([...input.allItems,...input.creatorItems,...input.savedItems].map(entry=>[entry.id,entry]));
      adapter.setDisplayedItems([...visibleIds].map(id=>candidates.get(id) || [...candidates.values()].find(entry=>entry.alias_ids?.includes(id))).filter(Boolean));
      assert.deepEqual(adapter.displayedItems.get(old.id),snapshot);
      if(archived) adapter.setArchived(button['data-item-id'],false);
      else adapter.setSaved(button['data-item-id'],!adapter.getState().savedItemIds.has(button['data-item-id']));
      const after=adapter.getState();
      assert.deepEqual(adapter.localState.saved_item_ids,archived ? [old.id] : []);
      assert.deepEqual(adapter.localState.archived_item_ids,[]);assert.equal(after.savedItems.length,archived ? 1 : 0);
      if(archived) assert.deepEqual(after.savedItems[0],snapshot);
      assert.deepEqual(adapter.localState.item_snapshots[old.id],snapshot);assert.equal(Object.hasOwn(adapter.localState.item_snapshots,current.id),false);
      assert.deepEqual(adapter.feedData,beforeFeed);
      const next=render(app(),after);
      assert.ok(next.includes(`id="daily-collect-${current.id}"`));
      assert.ok(next.includes(`data-action="toggle-save" data-item-id="${archived ? old.id : current.id}"`));
    }
  } finally {
    if(previousStorage) Object.defineProperty(globalThis,'localStorage',previousStorage);else delete globalThis.localStorage;
  }
});
