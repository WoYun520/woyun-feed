import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRows, renderSourceBoard, feedUpdateInfo, sourceStatusLabel, bindSourceBoardActions, boardUpdateMessage } from './src/sourceBoard.js';
import { matchesSource } from './src/sourceGroups.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { parseBackup } from './src/backup.js';
import { sourcePreferenceKey } from './src/sourcePreferences.js';
import { PRACTICAL_SOURCE, PRACTICAL_ITEMS } from './src/practicalMaterials.js';

const source = {id:'news',kind:'original',ranked:true,home_url:'https://news.example/'};
const base = {id:'one',title:'原标题',source_refs:['news'],original_url:'https://news.example/one',published_at:'2026-09-29T00:00:00Z'};
const state = items => ({allItems:items,hiddenItemIds:new Set(),refresh:{new_item_ids:[]}});

test('merged materials keep each board source URL and ranking without rewriting evidence',()=>{
  const merged={...base,source_refs:['news','discussion'],source_rank:1,link_kind:'discussion',source_links:[
    {source_id:'news',url:'https://news.example/article',source_rank:9},
    {source_id:'discussion',url:'https://community.example/thread',source_rank:2},
  ]};
  const input=state([merged,{...base,id:'two',source_rank:3}]),before=structuredClone(input.allItems);
  const rows=sourceRows(input,source);
  assert.deepEqual(rows.map(r=>r.item.id),['two','one']);
  assert.equal(rows[1].url,'https://news.example/article');assert.equal(rows[1].kind,'article');
  const discussion=sourceRows(input,{...source,id:'discussion',link_kind:'discussion'});
  assert.equal(discussion[0].url,'https://community.example/thread');assert.equal(discussion[0].rank,2);
  assert.equal(discussion[0].kind,'discussion');assert.deepEqual(input.allItems,before);
});

test('new-only and hidden aliases filter within source without inventing rank positions',()=>{
  const input=state([{...base,alias_ids:['old-id'],source_rank:1},{...base,id:'two',source_rank:5},{...base,id:'other',source_refs:['another']}]);
  input.hiddenItemIds.add('old-id');input.refresh.new_item_ids=['two','other'];
  assert.deepEqual(sourceRows(input,source,true).map(r=>[r.item.id,r.rank]),[['two',5]]);
  input.refresh.new_item_ids=[];assert.equal(sourceRows(input,source,true).length,0);
  assert.equal(sourceRows(input,source).length,1);
});

test('non-ranked sources sort by time, keep unknown ranks empty and distinguish search from articles',()=>{
  const input=state([base,{...base,id:'newer',published_at:'2026-09-29T04:00:00Z'}]);
  assert.deepEqual(sourceRows(input,{...source,ranked:false}).map(r=>r.item.id),['newer','one']);
  assert.equal(sourceRows(input,source)[0].rank,null);
  assert.equal(sourceRows(input,{...source,link_kind:'search'})[0].kind,'search');
  assert.equal(sourceRows(input,{...source,kind:'repository'})[0].kind,'repository');
});

test('video and post sources have their own category and open original links, without inventing hot-list ranks',()=>{
  const videoSource={id:'youtube-openai',name:'YouTube · OpenAI',kind:'original',group:'creators',link_kind:'video',ranked:false,status:'ok',home_url:'https://www.youtube.com/@OpenAI',last_success_at:'2026-10-02T01:00:00Z'};
  const video={...base,title:'作者的视频标题',source_refs:[videoSource.id],original_url:'https://www.youtube.com/watch?v=abc123def45',link_kind:'video',source_rank:null};
  const input={...state([video]),sources:[videoSource],savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]};
  const app={escapeHtml:v=>String(v||''),safeUrl:v=>v,formatTime:v=>v,sourceLimits:{},boardGroup:'creators'};
  assert.equal(matchesSource(video,'group:creators',input.sources),true);
  assert.equal(matchesSource(video,'group:tech',input.sources),false);
  const html=renderSourceBoard(app,input);
  assert.match(html,/视频与创作者/);assert.match(html,/观看|打开视频/);
  assert.match(html,/https:\/\/www\.youtube\.com\/watch\?v=abc123def45/);
  assert.match(html,/频道新视频 · 不是全站热榜/);assert.doesNotMatch(html,/来源榜单位置/);
  assert.equal(sourceRows(state([{...video,source_refs:['x']}]),{id:'x',link_kind:'post',home_url:'https://x.com/'} )[0].kind,'post');
});

test('X without access is visibly disconnected and a refresh cannot promise to connect it',()=>{
  const x={id:'x',name:'X / 推特',group:'creators',kind:'community',link_kind:'post',home_url:'https://x.com/',status:'not_connected',disabled:true,message:'尚未配置官方数据接入，暂不自动读取。'};
  const input={...state([]),sources:[x],publicPreview:true,savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]};
  const app={escapeHtml:v=>String(v||''),safeUrl:v=>v,formatTime:v=>v,sourceLimits:{},boardGroup:'all'};
  const html=renderSourceBoard(app,input);
  assert.match(html,/尚未接通/);assert.match(html,/暂不自动读取/);assert.match(html,/添加材料/);
  assert.doesNotMatch(html,/点击上方“更新内容”，读取这个来源/);assert.doesNotMatch(html,/自动更新/);
  assert.equal(sourceStatusLabel({...x,disabled:false,enabled:false},0),'尚未接通');
});

test('scheduled update labels use actual successful source times even when later attempts and publications fail',()=>{
  const previous='2026-10-01T12:00:00Z',attempt='2026-10-02T01:00:00Z';
  const input={...state([]),publicPreview:true,generated_at:previous,
    publication:{automatic_update:true,published_at:attempt,schedule_label:'每天 09:00、21:00（北京时间）'},
    refresh:{status:'failed',last_attempt_at:attempt,message:'本次未更新，保留上次内容。',new_item_ids:[]},
    sources:[{...source,name:'新闻',group:'tech',status:'failed',last_success_at:previous,last_attempt_at:attempt}],
    savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]};
  assert.equal(feedUpdateInfo(input).lastSuccess,previous);
  const app={escapeHtml:v=>String(v||''),safeUrl:v=>v,formatTime:v=>v,sourceLimits:{},boardGroup:'all'};
  const html=renderSourceBoard(app,input);
  assert.match(html,/每天 09:00、21:00（北京时间）自动更新/);
  assert.match(html,/最近有来源成功更新：2026-10-01T12:00:00Z/);assert.doesNotMatch(html,/最近有来源成功更新：2026-10-02/);
  assert.match(html,/保留上次内容/);
  assert.equal(feedUpdateInfo({...input,publicPreview:false}).automatic,false);
  assert.equal(feedUpdateInfo({...input,publication:{}}).automatic,false);
  assert.equal(sourceStatusLabel({status:'failed'},3),'3 条旧内容 · 本次未更新');
});

test('video and public post materials can be saved, restored and taken to AI with their original evidence',()=>{
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const video={id:'news-123456789012345678901234',title:'频道原视频',summary:'视频说明，尚未观看。',source_refs:['youtube-openai'],original_url:'https://www.youtube.com/watch?v=abc123def45',canonical_url:'https://www.youtube.com/watch?v=abc123def45',link_kind:'video',evidence_ref:'public-feed:video',captured_at:'2026-10-02T01:00:00Z',verification_status:'not_tested',content_status:'media_unread'};
  const post={...video,id:'news-abcdefabcdefabcdefabcdef',title:'作者原帖',summary:'作者原帖说明',source_refs:['x'],original_url:'https://x.com/example/status/123',canonical_url:'https://x.com/example/status/123',link_kind:'post',content_status:'excerpt_only'};
  const feed={mode:'live',schema_version:'0.3',profile:{interests:'',exclude:'',language:'zh-CN'},items:[video,post],sources:[],sections:{daily:[],discover:[]}};
  const adapter=new FeedDataAdapter({publicPreview:true});adapter.feedData=structuredClone(feed);
  adapter.setSaved(video.id,true);adapter.setSaved(post.id,true);
  const topic=adapter.createTopic({title:'视频选题',goal:'先看原视频，再整理自己的想法'},video.id);
  adapter.addToTopic(topic.id,post.id);
  const out=adapter.createBackup(),parsed=parseBackup(out.raw,'live');
  assert.equal(parsed.state.item_snapshots[video.id].link_kind,'video');
  assert.equal(parsed.state.item_snapshots[post.id].link_kind,'post');
  const reload=new FeedDataAdapter({publicPreview:true});reload.feedData={...feed,items:[]};
  assert.equal(reload.getState().savedItems.length,2);
  const exported=reload.exportTopic(topic.id);assert.match(exported,/https:\/\/www\.youtube\.com\/watch\?v=abc123def45/);assert.match(exported,/https:\/\/x\.com\/example\/status\/123/);assert.match(exported,/尚未观看/);
  assert.match(exported,/- 材料类型：视频/);assert.match(exported,/- 材料类型：原帖/);
  assert.match(exported,/- 本站保存范围：频道标题与公开简介，未观看视频或读取字幕/);
  assert.doesNotMatch(exported,/- 材料类型：文章或项目/);
  assert.equal(reload.getState().topics[0].materials[0].item.verification_status,'not_tested');
  const videoTask=reload.saveFollowupDraft(video.id,'整理视频标题和简介，不补造观看记录。');
  const videoFollowup=reload.exportFollowupText(videoTask.id);
  assert.match(videoFollowup,/- 链接类型：视频/);assert.match(videoFollowup,/- 采集状态：频道标题与公开简介，未观看视频或读取字幕/);
  const postTask=reload.saveFollowupDraft(post.id,'整理原帖说明。');
  assert.match(reload.exportFollowupText(postTask.id),/- 链接类型：原帖/);
  const manual=reload.addManualMaterial({url:'https://www.youtube.com/watch?v=xyz123abc45',title:'我自己添加的视频链接'},{topicId:topic.id}).item;
  const manualSection=reload.exportTopic(topic.id).split('### 3.')[1];
  assert.match(manualSection,/- 材料类型：用户添加的网页链接，页面类型未核对/);
  assert.match(manualSection,/- 本站保存范围：用户填写的标题和链接，未自动读取全文/);
  assert.doesNotMatch(manualSection,/频道标题与公开简介/);
  const manualTask=reload.saveFollowupDraft(manual.id,'核对链接内容。');
  assert.match(reload.exportFollowupText(manualTask.id),/- 链接类型：用户添加的网页链接，页面类型未核对/);
});

test('successful SoPilot subscriptions share one stream with original author, excerpt, memberships and escaped text',()=>{
  const sopilot={id:'sopilot-ai',name:'SoPilot · AI',group:'creators',kind:'aggregator',link_kind:'post',ranked:true,status:'ok',home_url:'https://www.sopilot.com/',reading_note:'来自 SoPilot 公开榜单；本站未核对原帖与热度 <标签>'};
  const creatorSource={...sopilot,id:'sopilot-creators',name:'SoPilot · 创作者'};
  const post={...base,title:'榜单中的帖子摘录',summary:'来源提供的实际帖子摘录 <标签>',source_refs:[sopilot.id,creatorSource.id],original_url:'https://x.com/example/status/1234567890123456789',link_kind:'post',source_rank:4,author_name:'作者 <img src=x onerror="bad">',author_handle:'example',
    source_links:[{source_id:sopilot.id,url:'https://x.com/example/status/1234567890123456789',source_rank:4},
      {source_id:creatorSource.id,url:'https://x.com/example/status/1234567890123456789',source_rank:12}]};
  const input={...state([post]),sources:[sopilot,creatorSource],savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]};
  const before=structuredClone(input);
  const app={postStreamView:'all',escapeHtml:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),safeUrl:v=>v,formatTime:v=>v,sourceLimits:{},boardGroup:'creators'};
  const html=renderSourceBoard(app,input);
  assert.equal((html.match(/id="post-stream"/g)||[]).length,1);
  assert.equal((html.match(/data-post-stream-item-id="one"/g)||[]).length,1);
  assert.doesNotMatch(html,/data-source-panel="sopilot-(?:ai|creators)"/);
  assert.match(html,/推特：值得看的线索/);assert.match(html,/SoPilot · AI/);assert.match(html,/SoPilot · 创作者/);
  assert.match(html,/SoPilot 公开榜单摘录；未读取完整原帖。/);
  assert.match(html,/未核对原帖内容、作者身份或热度，未实测。/);
  assert.match(html,/来源提供的实际帖子摘录 &lt;标签&gt;/);
  assert.match(html,/post-stream-author/);assert.match(html,/@example/);
  assert.match(html,/作者 &lt;img src=x onerror=&quot;bad&quot;&gt;/);assert.doesNotMatch(html,/<img src=x/);
  assert.match(html,/https:\/\/x\.com\/example\/status\/1234567890123456789/);assert.match(html,/打开原帖/);
  assert.match(html,/id="post-stream-save-one" data-action="toggle-save" data-item-id="one"/);
  assert.doesNotMatch(html,/来源榜单位置|按来源榜单排序/);
  assert.equal(sourceRows(input,sopilot)[0].rank,4);assert.deepEqual(input,before);
  assert.equal(sourceRows(input,sopilot)[0].kind,'post');
  assert.equal(matchesSource(post,'group:creators',input.sources),true);
  const noAuthor=renderSourceBoard(app,{...input,allItems:[{...post,author_name:undefined,author_handle:undefined}]});
  assert.match(noAuthor,/来源未提供作者/);assert.doesNotMatch(noAuthor,/@example/);
});

test('SoPilot authors and distinct post and list times survive save, topic, backup restore and both exports',()=>{
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const post={id:'news-112233445566778899aabbcc',title:'榜单中的帖子标题',summary:'公开榜单提供的帖子摘录',source_refs:['sopilot-creators'],original_url:'https://x.com/Ada01/status/123',canonical_url:'https://x.com/Ada01/status/123',link_kind:'post',source_rank:2,author_name:'Ada <Builder>',author_handle:'Ada01',evidence_ref:'public-feed:sopilot-creators',published_at:'2026-10-01T08:00:00Z',source_item_time:'2026-10-02T00:00:00Z',captured_at:'2026-10-02T01:00:00Z',verification_status:'not_verified',content_status:'excerpt_only'};
  const feed={mode:'live',schema_version:'0.3',profile:{interests:'',exclude:'',language:'zh-CN'},items:[post],sources:[{id:'sopilot-creators',name:'SoPilot · 创作者',home_url:'https://www.sopilot.com/'}],sections:{daily:[],discover:[]}};
  const adapter=new FeedDataAdapter({publicPreview:true});adapter.feedData=structuredClone(feed);
  adapter.setSaved(post.id,true);
  const topic=adapter.createTopic({title:'帖子选题',goal:'先核对原帖'},post.id);
  const draft=adapter.saveFollowupDraft(post.id,'整理榜单摘录，并列出待核对事项。');
  const backup=adapter.createBackup(),parsed=parseBackup(backup.raw,'live');
  assert.equal(parsed.state.item_snapshots[post.id].author_name,post.author_name);
  assert.equal(parsed.state.item_snapshots[post.id].author_handle,post.author_handle);
  assert.equal(parsed.state.topics[0].materials[0].item.author_handle,post.author_handle);
  assert.equal(parsed.state.topics[0].materials[0].item.source_item_time,post.source_item_time);
  storage.clear();
  const restored=new FeedDataAdapter({publicPreview:true});restored.feedData={...feed,items:[]};
  const preview=restored.previewBackup(backup.raw);assert.equal(preview.summary.saved,1);assert.equal(preview.summary.topics,1);
  restored.restoreBackup(preview);
  const reloaded=new FeedDataAdapter({publicPreview:true});reloaded.feedData={...feed,items:[]};
  assert.equal(reloaded.getState().savedItems[0].author_name,post.author_name);
  assert.equal(reloaded.getState().topics[0].materials[0].item.author_handle,post.author_handle);
  for(const exported of [reloaded.exportTopic(topic.id),reloaded.exportTopic(topic.id,{forAI:false}),reloaded.exportFollowupText(draft.id)]) {
    assert.match(exported,/- 帖子摘录来源：SoPilot 公开榜单/);
    assert.match(exported,/- 来源标注作者：Ada &lt;Builder&gt; · @Ada01/);
    assert.match(exported,/未读取完整原帖，未核对原帖内容与热度/);
    assert.match(exported,/- 榜单条目更新于：2026-10-02T00:00:00Z/);
    assert.match(exported,/2026-10-01T08:00:00Z/);assert.match(exported,/2026-10-02T01:00:00Z/);
    assert.match(exported,/https:\/\/x\.com\/Ada01\/status\/123/);
    assert.doesNotMatch(exported,/<Builder>/);
  }
  const another={...post,id:'news-aabbccddeeff112233445566',source_refs:['another-list'],source_item_time:undefined,canonical_url:'https://x.com/Ada01/status/124',original_url:'https://x.com/Ada01/status/124'};
  reloaded.feedData.items.push(another);
  const otherDraft=reloaded.saveFollowupDraft(another.id,'核对原帖。'),otherExport=reloaded.exportFollowupText(otherDraft.id);
  assert.match(otherExport,/- 帖子摘录来源：公开来源提供的帖子标题或摘录/);
  assert.match(otherExport,/未读取完整原帖，未核对内容事实/);
  assert.doesNotMatch(otherExport,/SoPilot|榜单条目更新于/);
});

test('author metadata in snapshots and topic materials is bounded plain text with handles stored without @',()=>{
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const post={id:'news-abcdefabcdefabcdefabcdef',title:'帖子标题',summary:'榜单摘录',source_refs:['sopilot-ai'],original_url:'https://x.com/example/status/123',link_kind:'post',author_name:'作者',author_handle:'example'};
  const adapter=new FeedDataAdapter({publicPreview:true});adapter.feedData={mode:'live',profile:{interests:'',exclude:'',language:'zh-CN'},items:[post],sources:[],sections:{daily:[],discover:[]}};
  adapter.setSaved(post.id,true);adapter.createTopic({title:'作者信息'},post.id);
  const backup=adapter.createBackup().backup;
  for(const invalid of [{author_name:42},{author_name:'x'.repeat(101)},{author_name:'作者\n额外一行'},{author_handle:'@example'},{author_handle:'x'.repeat(16)},{author_handle:'https://x.com/example'},{author_handle:[]}]) {
    for(const locate of [b=>b.state.item_snapshots[post.id],b=>b.state.topics[0].materials[0].item]) {
      const candidate=structuredClone(backup);Object.assign(locate(candidate),invalid);
      assert.throws(()=>parseBackup(JSON.stringify(candidate),'live'),/作者/);
    }
  }
});

const escapeText=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// These existing board cases exercise every original, pagination and excerpts.
// Opt into the full clue view; the separate integration below checks defaults.
const previewApp=()=>({postStreamView:'all',escapeHtml:escapeText,safeUrl:value=>value,formatTime:value=>value,sourceLimits:{},boardGroup:'all'});
const previewState=(items,sources)=>({...state(items),sources,savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]});

test('source board defaults to tutorial clues without ordinary news and preserves full view, favorites and source evidence',()=>{
  const posts={...source,id:'sopilot-ai',name:'SoPilot · AI',group:'posts',status:'ok',link_kind:'post'};
  const tutorial={...base,id:'tutorial-default',title:'给截图加箭头',summary:'1. 打开截图工具，选择图片文件。\n2. 点击箭头按钮，再导出图片文件。',
    source_refs:[posts.id],link_kind:'post',original_url:'https://x.com/example/status/730'};
  const news={...base,id:'ordinary-news',title:'海巡活动新闻',summary:'公共活动现场的新闻报道，没有提供操作过程。',
    source_refs:[posts.id],link_kind:'post',original_url:'https://x.com/example/status/731'};
  const input=previewState([news,tutorial],[posts]);input.savedItemIds.add(news.id);input.savedItems=[news];
  const before=structuredClone(input),app=previewApp();delete app.postStreamView;
  const html=renderSourceBoard(app,input);
  assert.match(html,/推特：操作教程 <small>1 条可读原帖/);
  assert.match(html,/data-post-stream-view="tutorials" aria-pressed="true"/);
  assert.match(html,/data-post-stream-item-id="tutorial-default"/);
  assert.doesNotMatch(html,/data-post-stream-item-id="ordinary-news"/);
  assert.match(html,/摘录含具体操作步骤/);assert.match(html,/全部线索<span>2<\/span>/);
  app.postStreamView='all';const all=renderSourceBoard(app,input);
  assert.match(all,/推特：值得看的线索 <small>2 条可读原帖/);
  assert.match(all,/data-post-stream-item-id="ordinary-news"/);
  assert.match(all,/id="post-stream-save-ordinary-news" data-action="toggle-save" data-item-id="ordinary-news" aria-pressed="true"/);
  assert.match(all,/href="https:\/\/x\.com\/example\/status\/731"/);
  assert.equal(sourceRows(input,posts).length,2);assert.deepEqual(input,before);
});

test('compact overview limits article sources and the unified post stream to five entries without dropping originals',()=>{
  const news={...source,name:'新闻',group:'tech',status:'ok',link_kind:'article'};
  const posts={...news,id:'sopilot-test',name:'作者榜单',group:'posts',link_kind:'post'};
  const items=[news,posts].flatMap(origin=>Array.from({length:12},(_,index)=>({...base,id:`${origin.id}-${index+1}`,title:`${origin.name} ${index+1}`,source_refs:[origin.id],source_rank:index+1,link_kind:origin.link_kind,
    original_url:origin.link_kind==='post' ? `https://x.com/example/status/${1234567890123456000n+BigInt(index+1)}` : `https://example.com/${origin.id}/${index+1}`})));
  const input=previewState(items,[news,posts]),before=structuredClone(input.allItems),html=renderSourceBoard(previewApp(),input);
  assert.equal((html.match(/class="source-headline /g)||[]).length,5);
  assert.equal((html.match(/data-post-stream-item-id=/g)||[]).length,5);
  assert.match(html,/id="source-row-news-news-5"/);assert.doesNotMatch(html,/id="source-row-news-news-6"/);
  assert.match(html,/data-source-more="news"/);assert.match(html,/data-post-stream-more/);
  assert.match(html,/data-post-stream-item-id="sopilot-test-5"/);assert.doesNotMatch(html,/data-post-stream-item-id="sopilot-test-6"/);
  assert.doesNotMatch(html,/data-source-panel="sopilot-test"|data-source-more="sopilot-test"/);
  for(const origin of [news,posts]) assert.equal(sourceRows(input,origin).length,12);
  assert.match(html,/再看 5 条线索/);
  assert.ok(html.indexOf('id="daily-highlights"')<html.indexOf('class="source-board"'));
  assert.doesNotMatch(html,/<details class="board-highlights"/);
  assert.deepEqual(input.allItems,before);
});

test('unified post pagination reaches every original after five entries through source-board handlers',()=>{
  const posts={...source,id:'sopilot-ai',name:'SoPilot · AI',group:'posts',status:'ok',link_kind:'post'};
  const items=Array.from({length:12},(_,index)=>({...base,id:`post-${index+1}`,title:`原帖 ${index+1}`,summary:'来源提供的原帖摘录。',source_refs:[posts.id],link_kind:'post',
    original_url:`https://x.com/example/status/${1234567890123456000n+BigInt(index+1)}`}));
  const input=previewState(items,[posts]),before=structuredClone(input),app=previewApp(),oldDocument=globalThis.document;
  let more,focused='';
  const heading={focus(){focused='heading';}};
  globalThis.document={getElementById:id=>id==='post-stream-more' ? more : id==='post-stream-heading' ? heading : null,
    querySelector:()=>null,querySelectorAll:selector=>selector==='[data-post-stream-more]' ? [more].filter(Boolean) : []};
  app.render=()=>{
    app.lastHtml=renderSourceBoard(app,input);
    more=app.lastHtml.includes('data-post-stream-more') ? {listeners:{},addEventListener(type,handler){this.listeners[type]=handler;},focus(){focused='more';}} : null;
    bindSourceBoardActions(app);
  };
  try {
    app.render();assert.equal((app.lastHtml.match(/data-post-stream-item-id=/g)||[]).length,5);
    more.listeners.click();assert.equal(app.postStreamLimit,10);assert.equal((app.lastHtml.match(/data-post-stream-item-id=/g)||[]).length,10);assert.equal(focused,'more');
    more.listeners.click();assert.equal((app.lastHtml.match(/data-post-stream-item-id=/g)||[]).length,12);assert.equal(more,null);assert.equal(focused,'heading');
    for(const item of items) {assert.ok(app.lastHtml.includes(`data-post-stream-item-id="${item.id}"`));assert.ok(app.lastHtml.includes(`href="${item.original_url}"`));}
    assert.deepEqual(input,before);
  }finally{if(oldDocument===undefined) delete globalThis.document;else globalThis.document=oldDocument;}
});

test('source pagination reaches every item, focuses the next row and can collapse before the final page',()=>{
  const news={...source,name:'新闻',group:'tech',status:'ok',link_kind:'article'};
  const items=Array.from({length:12},(_,index)=>({...base,id:`entry-${index+1}`,title:`文章 ${index+1}`,source_rank:index+1}));
  const input=previewState(items,[news]),app=previewApp(),oldDocument=globalThis.document;
  let focused='',more,collapse,links=[];
  const control=dataset=>({dataset,listeners:{},addEventListener(type,handler){this.listeners[type]=handler;}});
  globalThis.document={getElementById:()=>null,querySelector:selector=>selector==='[data-source-panel="news"] h3 a' ? {focus(){focused='heading';}} : null,
    querySelectorAll:selector=>selector==='[data-source-more]' ? [more].filter(Boolean) : selector==='[data-source-collapse]' ? [collapse].filter(Boolean)
      : selector==='[data-source-panel="news"] .headline-link' ? links : []};
  app.render=()=>{
    app.lastHtml=renderSourceBoard(app,input);
    more=app.lastHtml.includes('data-source-more="news"') ? control({sourceMore:'news'}) : null;
    collapse=app.lastHtml.includes('data-source-collapse="news"') ? control({sourceCollapse:'news'}) : null;
    links=Array.from({length:(app.lastHtml.match(/class="source-headline /g)||[]).length},(_,index)=>({focus(){focused=index+1;}}));
    bindSourceBoardActions(app);
  };
  try {
    app.render();assert.equal(links.length,5);assert.equal(collapse,null);
    more.listeners.click();assert.equal(links.length,10);assert.equal(focused,6);
    assert.ok(more);assert.ok(collapse); // returning to the overview does not require opening all twelve
    more.listeners.click();assert.equal(links.length,12);assert.equal(focused,11);assert.equal(more,null);
    collapse.listeners.click();assert.equal(links.length,5);assert.equal(focused,'heading');assert.ok(more);
    assert.equal(sourceRows(input,news).length,12);
  }finally{if(oldDocument===undefined) delete globalThis.document;else globalThis.document=oldDocument;}
});

test('board notices keep connection state distinct from historical source failure and retain a hidden patch target',()=>{
  const input=previewState([],[{...source,name:'新闻',group:'tech',status:'ok'}]);
  input.loadStatus={phase:'ready'};input.refresh={status:'ok'};
  assert.deepEqual(boardUpdateMessage(input),{message:'',failed:false});
  const html=renderSourceBoard(previewApp(),input);
  assert.match(html,/data-board-update-message hidden><span><\/span><\/p>/);
  const historical={...input,sources:[{...input.sources[0],status:'failed'}]};
  assert.match(boardUpdateMessage(historical).message,/最近一次未更新，旧内容仍可阅读/);
  assert.match(boardUpdateMessage(historical).message,/原因和上次成功时间见“更新详情”/);
  assert.doesNotMatch(boardUpdateMessage(historical).message,/本轮|暂时无法连接/);
  assert.equal(boardUpdateMessage(historical).failed,true);
  assert.match(boardUpdateMessage(historical,{deferred:true}).message,/结束操作或关闭编辑后显示/);
});

test('compact source notes preserve provenance while source failure details and loading notices remain accessible',()=>{
  const news={...source,name:'新闻',group:'tech',status:'failed',link_kind:'article',last_success_at:'2026-10-01T12:00:00Z',last_attempt_at:'2026-10-02T01:00:00Z',read_error:'HTTP_429',consecutive_failures:2,message:'更新未成功，正在保留旧内容。',reading_note:'来源提供摘要；未读取全文 <原始说明>'};
  const input=previewState([{...base,summary:'已有的来源摘要'}],[news]);
  input.loadStatus={phase:'loading'};
  const html=renderSourceBoard(previewApp(),input);
  const updateDetails=html.match(/<details class="board-updates" id="board-updates"[^>]*>([\s\S]*?)<\/details>/)?.[1] || '';
  assert.match(updateDetails,/class="source-health" aria-label="未更新来源详情"/);
  assert.match(updateDetails,/原站暂时限制读取 · 连续 2 次未更新/);
  assert.match(updateDetails,/1 条旧内容仍可阅读 · 上次成功：2026-10-01T12:00:00Z/);
  assert.match(updateDetails,/最近尝试：2026-10-02T01:00:00Z/);
  assert.match(html,/<p class="source-panel-warning">1 条旧内容 · 本次未更新<\/p>/);
  assert.match(html,/id="source-row-news-one"/);assert.match(html,/已有的来源摘要/);
  assert.match(html,/<details class="source-reading-details" data-source-reading="news" ><summary>来源说明/);
  assert.match(html,/来源提供摘要；未读取全文 &lt;原始说明&gt;/);
  assert.match(html,/class="board-update-message [^"]*" role="status" data-board-update-message ><span>正在读取网站内容，当前资料仍可阅读。<\/span><\/p>/);
  assert.match(html,/<span data-feed-update-notice>正在读取网站内容，当前资料仍可阅读。<\/span>/);
  assert.match(html,/最近成功获取：2026-10-01T12:00:00Z/);
});

test('source previews show only actual distinct excerpts and preserve original link and bookmark actions',()=>{
  const news={...source,name:'新闻',group:'tech',status:'ok',link_kind:'article'};
  const actual={...base,summary:'来源提供的一段实际摘要。'};
  const other=[{...base,id:'empty',summary:'  '},{...base,id:'same',summary:'  原标题\n'},
    {...base,id:'fallback',content_status:'headline_only',summary:'来自新闻的标题线索，正文尚未读取。'},
    {...base,id:'manual',origin:'user_added',summary:'用户填写的标题和链接，没有自动读取页面。'},
    {...base,id:'missing'}];
  const input=previewState([actual,...other],[news]),before=structuredClone(input.allItems);
  const html=renderSourceBoard(previewApp(),input);
  assert.equal((html.match(/data-excerpt-details=/g)||[]).length,1);
  assert.match(html,/<details class="headline-preview" data-excerpt-details="news:one"/);
  assert.match(html,/<summary>看摘录 <span>· 文章摘要<\/span><\/summary>/);
  assert.match(html,/来源提供的一段实际摘要。/);assert.match(html,/来源提供的摘要，本站未读取全文。/);
  assert.match(html,/href="https:\/\/news\.example\/one"/);
  assert.match(html,/data-action="toggle-save" data-item-id="one"/);
  assert.doesNotMatch(html,/data-excerpt-full=/);assert.deepEqual(input.allItems,before);
  const repository={...actual,id:'github-1',original_url:'https://github.com/example/tool',source_refs:['github'],link_kind:'repository',repository_name:'example/tool'};
  const repoHtml=renderSourceBoard(previewApp(),previewState([repository],[{...news,id:'github',kind:'repository',link_kind:'repository'}]));
  assert.match(repoHtml,/核心重点/);assert.doesNotMatch(repoHtml,/data-excerpt-details=/);
});

test('tweet and video excerpts have accurate boundaries and long source text remains escaped and available',()=>{
  const sopilot={...source,id:'sopilot-ai',name:'SoPilot',group:'creators',link_kind:'post',status:'ok'};
  const videoSource={...sopilot,id:'youtube-example',name:'视频频道',link_kind:'video'};
  const summary='<script>不要执行这段来源文字</script>\n'+('真实来源摘录。'.repeat(40))+' https://example.com/'+('x'.repeat(250));
  const post={...base,original_url:'https://x.com/example/status/1234567890123456789',source_refs:[sopilot.id],link_kind:'post',summary,author_name:'作者',author_handle:'example'};
  const video={...base,id:'video',title:'原视频标题',original_url:'https://www.youtube.com/watch?v=abc123def45',source_refs:[videoSource.id],link_kind:'video',summary:'频道提供的公开视频简介。'};
  const app=previewApp(),input=previewState([post,video],[sopilot,videoSource]);
  const html=renderSourceBoard(app,input);
  assert.match(html,/class="post-stream-excerpt" data-excerpt-details="post-stream:one"/);
  assert.match(html,/SoPilot 公开榜单摘录；未读取完整原帖。/);assert.match(html,/未核对原帖内容、作者身份或热度，未实测。/);
  assert.match(html,/· 视频简介/);assert.match(html,/未观看视频或读取字幕/);
  assert.match(html,/查看摘录与来源说明/);assert.match(html,/&lt;script&gt;不要执行这段来源文字&lt;\/script&gt;/);
  assert.match(html,/href="https:\/\/x\.com\/example\/status\/1234567890123456789"/);
  assert.doesNotMatch(html,/<script>/);assert.ok(html.includes(escapeText(summary)));
  app.openExcerptDetails=new Set(['post-stream:one']);
  const openHtml=renderSourceBoard(app,input);
  assert.match(openHtml,/data-excerpt-details="post-stream:one" open/);
  assert.match(openHtml,/class="post-stream-excerpt-text"/);assert.ok(openHtml.includes(escapeText(summary)));
});

test('practical source panels show AI documentation reading, complete instructions and no invented live source success',()=>{
  const items=structuredClone(PRACTICAL_ITEMS),input=previewState(items,[{...PRACTICAL_SOURCE}]),viewApp=previewApp();
  input.generated_at='2026-10-02T16:00:00Z';input.publicPreview=true;
  viewApp.openExcerptDetails=new Set([`${PRACTICAL_SOURCE.id}:${items[0].id}`]);
  viewApp.sourceLimits[PRACTICAL_SOURCE.id]=items.length;
  const before=structuredClone(input),html=renderSourceBoard(viewApp,input);
  assert.match(html,/8 条实用材料/);assert.match(html,/AI 按官方说明整理，未实测 · 不自动更新/);
  assert.match(html,/中文标题与说明由本站整理/);assert.match(html,/说明阅读时间：/);
  assert.equal(feedUpdateInfo(input).lastSuccess,null);
  assert.doesNotMatch(html,/公开列表已读取|最近成功获取|最近有来源成功更新|尚未成功获取|作者原始简介|用途待整理/);
  assert.match(html,/data-excerpt-details="practical-materials:[^"]+" open/);
  assert.doesNotMatch(html,/data-excerpt-full=|headline-preview-text is-shortened/);
  for (const material of items) {assert.ok(html.includes(escapeText(material.title)));assert.ok(html.includes(escapeText(material.summary)));}
  assert.deepEqual(input,before);
  assert.equal(sourceStatusLabel(PRACTICAL_SOURCE,8),'8 条实用材料');
});

test('native excerpt toggles retain both open levels across bookmarks and group redraws with separate source keys',()=>{
  const sources=[{...source,name:'科技',group:'tech',status:'ok',link_kind:'article'},
    {...source,id:'other',name:'社区',group:'community',status:'ok',link_kind:'article'}];
  const item={...base,source_refs:['news','other'],summary:'很长的实际摘要。'.repeat(30)};
  const input=previewState([item],sources),app=previewApp();
  const control=(dataset={})=>({dataset,open:false,isConnected:true,listeners:{},addEventListener(event,handler){this.listeners[event]=handler;}});
  const detail=control({excerptDetails:'news:one'}),otherDetail=control({excerptDetails:'other:one'});
  const full=control({excerptFull:'news:one'});full.previousElementSibling={hidden:false,classList:{contains:name=>name==='headline-preview-text'}};
  const group=control({boardGroup:'community'});
  const oldDocument=globalThis.document;
  globalThis.document={getElementById:()=>null,querySelector:()=>({focus(){}}),querySelectorAll:selector=>({
    '[data-excerpt-details]':[detail,otherDetail],'[data-excerpt-full]':[full],'[data-board-group]':[group],
  })[selector] || []};
  app.render=()=>{app.lastHtml=renderSourceBoard(app,input);};
  try {
    bindSourceBoardActions(app);
    detail.open=true;detail.listeners.toggle();full.open=true;full.listeners.toggle();
    assert.equal(full.previousElementSibling.hidden,true);
    input.savedItemIds.add(item.id);app.render();
    assert.match(app.lastHtml,/data-excerpt-details="news:one" open/);assert.match(app.lastHtml,/data-excerpt-full="news:one" open/);
    assert.match(app.lastHtml,/data-excerpt-details="other:one" >/);assert.doesNotMatch(app.lastHtml,/data-excerpt-details="other:one" open/);
    group.listeners.click();assert.equal(app.boardGroup,'community');assert.doesNotMatch(app.lastHtml,/data-excerpt-details="news:one"/);
    app.boardGroup='all';app.render();assert.match(app.lastHtml,/data-excerpt-details="news:one" open/);
    detail.isConnected=false;detail.open=false;detail.listeners.toggle();assert.equal(app.openExcerptDetails.has('news:one'),true);
    detail.isConnected=true;detail.listeners.toggle();assert.equal(app.openExcerptDetails.has('news:one'),false);
    full.open=false;full.listeners.toggle();assert.equal(full.previousElementSibling.hidden,false);assert.equal(app.openFullExcerpts.has('news:one'),false);
    app.render();assert.doesNotMatch(app.lastHtml,/data-excerpt-details="news:one" open/);assert.doesNotMatch(app.lastHtml,/data-excerpt-full="news:one" open/);
  }finally{if(oldDocument===undefined) delete globalThis.document;else globalThis.document=oldDocument;}
});

const managedSources=[
  {...source,id:'news',name:'科技新闻',group:'tech',link_kind:'article',status:'ok'},
  {...source,id:'community',name:'社区讨论',group:'community',link_kind:'discussion',status:'ok'},
  {...source,id:'video',name:'视频频道',group:'creators',link_kind:'video',status:'ok'},
  {...source,id:'new-source',name:'新来源',group:'tech',link_kind:'article',status:'ok'},
];
const sourcePreferences=(hidden=[],pinned=[])=>({version:1,hidden_source_ids:hidden,pinned_source_ids:pinned});

// Exercise handlers through a small document double: every render replaces controls like app.render does.
function withSourceManager(run,{raw=null,storageGetter}={}) {
  const globals=['document','window','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  const values=new Map(raw===null ? [] : [[sourcePreferenceKey('live'),raw]]);
  const store={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const input={...previewState([{...base,summary:'实际来源摘要。'}],structuredClone(managedSources)),mode:'live'};
  const app={...previewApp(),currentTab:'today',feedView:'sources',activeModal:null,renderCount:0,toasts:[]};
  let nodes=new Map(),visibility=[],pins=[],groups=[];
  const doc={activeElement:null,getElementById:id=>nodes.get(id)||null,
    querySelector:selector=>selector==='[data-source-visibility]' ? visibility[0] : null,
    querySelectorAll:selector=>selector==='[data-source-visibility],[data-source-pin]' ? [...visibility,...pins]
      : selector==='[data-board-group]' ? groups : []};
  const events=new Map();
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:doc});
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{addEventListener:(type,handler)=>events.set(type,handler)}});
  Object.defineProperty(globalThis,'localStorage',storageGetter
    ? {configurable:true,get:storageGetter} : {configurable:true,writable:true,value:store});
  const control=(id,dataset={})=>{
    const node={id,dataset,listeners:{},addEventListener(type,handler){this.listeners[type]=handler;},focus(){doc.activeElement=this;}};
    nodes.set(id,node);return node;
  };
  app.showToast=message=>app.toasts.push(message);
  app.render=()=>{
    app.renderCount++;app.lastHtml=renderSourceBoard(app,input);nodes=new Map();visibility=[];pins=[];
    control('source-manager-open');
    groups=['all','tech','community','creators'].map(group=>control(`group-${group}`,{boardGroup:group}));
    if (app.sourceManagerOpen) {
      for (const id of ['source-manager-form','source-manager-cancel','source-manager-show-all','source-preference-error']) control(id);
      const draft=app.sourcePreferenceDraft || sourcePreferences();
      for (const source of input.sources) {
        const visible=control(`source-visible-${source.id}`,{sourceVisibility:source.id});
        visible.checked=!draft.hidden_source_ids.includes(source.id);visibility.push(visible);
        const pin=control(`source-pin-${source.id}`,{sourcePin:source.id});
        pin.checked=draft.pinned_source_ids.includes(source.id);pins.push(pin);
      }
    }
    if (app.lastHtml.includes('id="source-restore-all"')) control('source-restore-all');
    bindSourceBoardActions(app);
  };
  const fire=(id,type,extra={})=>{
    const node=nodes.get(id);assert.ok(node,`expected control ${id}`);
    const event={prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};
    assert.equal(typeof node.listeners[type],'function',`expected ${type} handler on ${id}`);
    node.listeners[type](event);return event;
  };
  const change=(id,checked)=>{nodes.get(id).checked=checked;fire(id,'change');};
  try {app.render();run({app,input,store,values,doc,fire,change,storageEvent:event=>events.get('storage')(event)});}
  finally {for (const [key,descriptor] of globals) {if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('source layout hides only homepage panels, pins within the current category and shows newly configured sources',()=>{
  withSourceManager(({app,input,fire})=>{
    const before=structuredClone(input);
    assert.doesNotMatch(app.lastHtml,/data-source-panel="news"/);
    assert.ok(app.lastHtml.indexOf('data-source-panel="video"')<app.lastHtml.indexOf('data-source-panel="community"'));
    assert.match(app.lastHtml,/data-source-panel="new-source"/);assert.match(app.lastHtml,/首页隐藏了 1 个来源/);
    assert.match(app.lastHtml,/全部来源 <small>3 \/ 4<\/small>/);
    fire('group-tech','click');
    assert.match(app.lastHtml,/data-source-panel="new-source"/);assert.doesNotMatch(app.lastHtml,/data-source-panel="video"/);
    assert.deepEqual(input,before);assert.equal(input.allItems.length,1);
    fire('source-manager-open','click');
    assert.match(app.lastHtml,/id="source-visible-news" data-source-visibility="news" >/);
    assert.match(app.lastHtml,/id="source-pin-news"[^>]+disabled/);assert.match(app.lastHtml,/保存在此浏览器/);
  },{raw:JSON.stringify(sourcePreferences(['news','unknown'],['video','community']))});
});

test('source manager saves checked choices, preserves unrelated open details and restores focus after saving',()=>{
  withSourceManager(({app,input,store,doc,fire,change})=>{
    const before=structuredClone(input);
    app.openExcerptDetails.add('news:one');app.openRepositoryDetails.add('github-one');
    app.sourceLimits.news=16;
    fire('source-manager-open','click');assert.equal(doc.activeElement.id,'source-visible-news');
    change('source-pin-video',true);change('source-visible-community',false);
    assert.deepEqual(app.sourcePreferenceDraft,sourcePreferences(['community'],['video']));
    assert.match(app.lastHtml,/data-source-panel="community"/);assert.equal(store.getItem(sourcePreferenceKey()),null);
    app.render();assert.deepEqual(app.sourcePreferenceDraft,sourcePreferences(['community'],['video']));
    const submitted=fire('source-manager-form','submit');assert.equal(submitted.prevented,true);
    assert.equal(app.sourceManagerOpen,false);assert.equal(app.sourcePreferenceDraft,null);
    assert.deepEqual(JSON.parse(store.getItem(sourcePreferenceKey())),sourcePreferences(['community'],['video']));
    assert.doesNotMatch(app.lastHtml,/data-source-panel="community"/);
    assert.ok(app.lastHtml.indexOf('data-source-panel="video"')<app.lastHtml.indexOf('data-source-panel="news"'));
    assert.equal(doc.activeElement.id,'source-manager-open');assert.deepEqual(app.toasts,['来源设置已保存在此浏览器。']);
    assert.equal(app.openExcerptDetails.has('news:one'),true);assert.equal(app.openRepositoryDetails.has('github-one'),true);
    assert.equal(app.sourceLimits.news,16);assert.deepEqual(input,before);
  });
});

test('cancel and Escape discard unsaved choices while show-all remains a draft until saved',()=>{
  const original=JSON.stringify(sourcePreferences(['community'],['video']));
  withSourceManager(({app,store,doc,fire,change})=>{
    fire('source-manager-open','click');change('source-visible-news',false);
    fire('source-manager-show-all','click');assert.deepEqual(app.sourcePreferenceDraft,sourcePreferences([],['video']));
    assert.equal(store.getItem(sourcePreferenceKey()),original);
    const escaped=fire('source-manager-form','keydown',{key:'Escape'});
    assert.equal(escaped.prevented,true);assert.equal(escaped.stopped,true);
    assert.equal(app.sourceManagerOpen,false);assert.deepEqual(app.sourcePreferences,sourcePreferences(['community'],['video']));
    assert.equal(doc.activeElement.id,'source-manager-open');assert.deepEqual(app.toasts,[]);
    fire('source-manager-open','click');change('source-visible-news',false);fire('source-manager-cancel','click');
    assert.equal(store.getItem(sourcePreferenceKey()),original);assert.equal(app.sourcePreferenceDraft,null);
  },{raw:original});
});

test('storage failures keep the applied layout, draft and error without a success toast',()=>{
  withSourceManager(({app,store,doc,fire,change})=>{
    fire('source-manager-open','click');change('source-visible-news',false);
    store.setItem=()=>{throw Error('quota');};fire('source-manager-form','submit');
    assert.equal(app.sourceManagerOpen,true);assert.deepEqual(app.sourcePreferences,sourcePreferences());
    assert.deepEqual(app.sourcePreferenceDraft,sourcePreferences(['news']));assert.match(app.sourcePreferenceError,/没有保存/);
    assert.match(app.lastHtml,/data-source-panel="news"/);assert.equal(doc.activeElement.id,'source-preference-error');
    assert.deepEqual(app.toasts,[]);assert.equal(store.getItem(sourcePreferenceKey()),null);
  });
});

test('all-hidden homepage keeps management and a working restore-all action',()=>{
  withSourceManager(({app,input,store,fire})=>{
    assert.match(app.lastHtml,/首页来源都已隐藏/);assert.match(app.lastHtml,/id="source-manager-open"/);
    assert.match(app.lastHtml,/id="source-restore-all"/);assert.doesNotMatch(app.lastHtml,/data-source-panel=/);
    fire('source-restore-all','click');
    for (const source of input.sources) assert.ok(app.lastHtml.includes(`data-source-panel="${source.id}"`));
    assert.deepEqual(JSON.parse(store.getItem(sourcePreferenceKey())),sourcePreferences());
  },{raw:JSON.stringify(sourcePreferences(managedSources.map(source=>source.id),[]))});
});

test('a denied localStorage getter falls back to all sources and reports unreadable preferences',()=>{
  withSourceManager(({app,input,fire})=>{
    for (const source of input.sources) assert.ok(app.lastHtml.includes(`data-source-panel="${source.id}"`));
    assert.equal(app.sourcePreferenceReadable,false);assert.match(app.lastHtml,/无法读取此浏览器的来源设置/);
    fire('source-manager-open','click');fire('source-manager-form','submit');
    assert.match(app.sourcePreferenceError,/暂时无法读取/);assert.equal(app.sourceManagerOpen,true);assert.deepEqual(app.toasts,[]);
  },{storageGetter(){throw Error('SecurityError');}});
});

test('another page refreshes saved layout without redrawing active editors and never overwrites an open draft',()=>{
  withSourceManager(({app,values,doc,fire,change,storageEvent})=>{
    const key=sourcePreferenceKey(),remote=JSON.stringify(sourcePreferences(['news'],['video']));
    values.set(key,remote);
    for (const editing of [{activeModal:'topic-edit'},{currentTab:'profile'},{currentTab:'saved'},{feedView:'selected'},{focus:'feed-search'}]) {
      const {focus,...fields}=editing;
      Object.assign(app,{currentTab:'today',feedView:'sources',activeModal:null},fields);
      doc.activeElement=focus ? {id:focus} : null;
      const renders=app.renderCount;storageEvent({key});assert.equal(app.renderCount,renders);
      assert.deepEqual(app.sourcePreferences,sourcePreferences(['news'],['video']));
      if (editing.activeModal || focus==='feed-search') assert.equal(app.pendingRender,true);
    }
    Object.assign(app,{currentTab:'today',feedView:'sources',activeModal:null});
    doc.getElementById('source-manager-open').focus();const renders=app.renderCount;storageEvent({key});
    assert.equal(app.renderCount,renders+1);assert.equal(doc.activeElement.id,'source-manager-open');
    const unchanged=app.renderCount;storageEvent({key:'unrelated-storage'});assert.equal(app.renderCount,unchanged);
    fire('source-manager-open','click');change('source-visible-community',false);
    const draft=structuredClone(app.sourcePreferenceDraft);
    values.set(key,JSON.stringify(sourcePreferences([],['community'])));storageEvent({key});
    assert.deepEqual(app.sourcePreferenceDraft,draft);assert.match(app.sourcePreferenceError,/另一个页面/);
    fire('source-manager-form','submit');assert.match(app.sourcePreferenceError,/另一个页面/);assert.deepEqual(app.toasts,[]);
    assert.deepEqual(JSON.parse(values.get(key)),sourcePreferences([],['community']));
    fire('source-manager-cancel','click');assert.deepEqual(app.sourcePreferences,sourcePreferences([],['community']));
  });
});
