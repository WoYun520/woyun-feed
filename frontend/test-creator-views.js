import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCreatorPage, bindCreatorActions } from './src/creatorViews.js';
import { feedAdapter } from './src/dataAdapter.js';

const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const app = () => ({escapeHtml:escape, safeUrl:value => {
  try {const url = new URL(value);return ['https:','http:'].includes(url.protocol) ? url.href : '#';} catch {return '#';}
}, formatTime:value => value, creatorView:'tutorials', creatorAuthorFilter:'all', creatorQuery:'',
  render(){this.renderCount=(this.renderCount || 0)+1;},showToast(value){(this.toasts ||= []).push(value);},renderModals(){this.modals=(this.modals || 0)+1;}});
const creator = (id='screen',handle='screenshots') => ({id,handle,name:'截图博主',category:'日常小工具',
  reason:'提供具体操作示例。',enabled_by_default:true,profile_url:`https://x.com/${handle}`,
  material_urls:[{url:'https://github.com/example/screenshot',title:'截图操作样本'}]});
const entry = (id='one',author=creator(),extra={}) => ({creator:author,kind:'tutorial',purpose:'截图后画箭头标注。',reason:'有操作步骤和截图示例。',scope:'作者说明',checkedAt:'2026-10-03T08:00:00Z',
  item:{id,title:'截图加箭头的操作方法',summary:'先截图，再选择箭头工具。\n示例：给产品按钮加指引。',original_url:`https://github.com/example/${id}`,
    source_refs:['creator-materials'],captured_at:'2026-10-03T08:00:00Z'},...extra});
const state = () => {const author=creator();return {creatorCatalog:[author],creatorPreferences:{},creatorTutorials:[entry('one',author)],sources:[],sourceMap:new Map(),savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]};};

test('tutorial cards preserve original material, explain utility and provenance, and expose existing collection workflow',() => {
  const viewApp=app(),input=state(),before=structuredClone(input),html=renderCreatorPage(viewApp,input);
  for(const text of ['实用教程','跟会做的人','能做什么','收录理由','截图后画箭头标注','已阅读作者说明，未实测','收藏','放进主题']) assert.ok(html.includes(text));
  assert.match(html,/data-creator-save="one"/);assert.match(html,/data-creator-topic="one"/);
  assert.match(html,/href="https:\/\/github.com\/example\/one" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html,/\sdata-action=/);assert.match(html,/不要求包含“AI”/);assert.match(html,/不搜索原帖全文/);
  assert.deepEqual(input,before);
});

test('guide cards lead with utility and audience while preparations and source evidence start collapsed',() => {
  const input=state(),row=input.creatorTutorials[0];
  row.item.published_at='2026-09-28T06:00:00Z';row.item.display_title='本地显示题';
  row.guide={purpose:'给产品截图添加指引箭头。',audience:'需要向别人解释页面操作的人。',requirements:'一张截图和支持箭头标注的工具。',
    first_step:'打开截图，选中箭头工具。',cost:'资料未说明工具费用；账号条件未知。',basis_label:'作者的操作说明',
    basis_url:'https://example.com/screenshot-guide',read_at:'2026-10-03T09:00:00Z',scope:'只阅读作者的操作说明，未实测。'};
  const before=structuredClone(input),html=renderCreatorPage(app(),input);
  const card=html.match(/<article class="creator-tutorial-card"[\s\S]*?<\/article>/)[0];
  const front=card.split('<details class="creator-preparation-details">')[0];
  assert.match(front,/<h3>给产品截图添加指引箭头。<\/h3>/);assert.match(front,/适合谁<\/span>需要向别人解释页面操作的人。/);
  assert.doesNotMatch(front,/截图加箭头的操作方法|本地显示题|收录理由|先截图，再选择/);
  assert.match(card,/<details class="creator-preparation-details"><summary>开始前看一下<\/summary>/);
  for(const [label,value] of [['需要什么',row.guide.requirements],['第一步',row.guide.first_step],['费用与条件',row.guide.cost]]) {
    assert.ok(card.includes(`<dt>${label}</dt><dd>${escape(value)}</dd>`));
  }
  assert.match(card,/<details class="creator-material-details"><summary>查看整理说明与依据<\/summary>/);assert.doesNotMatch(card,/<details[^>]*\sopen(?:\s|>)/);
  assert.equal(card.split(escape(row.item.title)).length-1,1);assert.match(card,/示例：给产品按钮加指引/);
  assert.match(card,/href="https:\/\/example.com\/screenshot-guide" target="_blank" rel="noopener noreferrer">作者的操作说明/);
  assert.match(card,/整理依据范围：只阅读作者的操作说明，未实测。/);
  assert.match(card,/原文发布 <time datetime="2026-09-28T06:00:00Z"/);assert.match(card,/整理依据阅读 <time datetime="2026-10-03T09:00:00Z"/);
  assert.match(card,/data-creator-save="one"/);assert.match(card,/data-creator-topic="one"/);assert.deepEqual(input,before);
});

test('missing decision fields stay unknown and a source title cannot become a utility explanation',() => {
  const input=state(),row=input.creatorTutorials[0];row.purpose=row.item.title;
  let html=renderCreatorPage(app(),input);
  assert.match(html,/<h3>用途待整理，先查看原文<\/h3>/);
  for(const value of ['适用人群未知','所需工具、账号或环境未知','第一步未知，请先查看原文','费用与使用条件未知']) assert.ok(html.includes(value));
  assert.doesNotMatch(html,/免费|适合新手|注册账号/);
  row.item.title='超长原标题'.repeat(50);row.purpose=row.item.title.slice(0,200);row.item.read_scope='author-blog-feed';
  html=renderCreatorPage(app(),input);assert.match(html,/<h3>用途待整理，先查看原文<\/h3>/);
  row.guide={purpose:'独立整理的用途。'};html=renderCreatorPage(app(),input);
  assert.match(html,/<h3>独立整理的用途。<\/h3>/);assert.match(html,/适用人群未知/);assert.match(html,/费用与使用条件未知/);
  row.guide=null;row.purpose='已有用途与原标题不同。';html=renderCreatorPage(app(),input);
  assert.match(html,/<h3>已有用途与原标题不同。<\/h3>/);
});

test('guide reading scope and dates stay separate from an acquired blog excerpt and original publication',() => {
  const input=state(),row=input.creatorTutorials[0];row.item.read_scope='author-blog-feed';row.item.published_at='2026-09-20T01:00:00Z';
  row.item.captured_at='2026-10-01T02:00:00Z';row.checkedAt='2026-10-02T03:00:00Z';
  row.guide={purpose:'用作者提供的例子整理截图。',basis_label:'另附的作者说明',basis_url:'https://example.com/author-notes',
    read_at:'2026-10-03T04:00:00Z',scope:'已阅读另附作者说明全文，未实测。'};
  let html=renderCreatorPage(app(),input);
  assert.match(html,/<p class="creator-material-scope">作者博客订阅摘录；按订阅提供的操作线索初筛，未核对原文全文或实测。<\/p>/);
  assert.match(html,/<p class="creator-guide-scope">整理依据范围：已阅读另附作者说明全文，未实测。<\/p>/);
  assert.match(html,/原文发布 <time datetime="2026-09-20T01:00:00Z"/);
  assert.match(html,/取得摘录 <time datetime="2026-10-01T02:00:00Z"/);
  assert.match(html,/整理依据阅读 <time datetime="2026-10-03T04:00:00Z"/);assert.doesNotMatch(html,/datetime="2026-10-02T03:00:00Z"|说明阅读/);
  delete row.item.read_scope;row.item.link_kind='post';row.scope='第三方摘录';html=renderCreatorPage(app(),input);
  assert.match(html,/<p class="creator-material-scope">第三方推文摘录，未核对完整原帖或实测。<\/p>/);
  assert.match(html,/整理依据阅读 <time datetime="2026-10-03T04:00:00Z"/);
});

test('every guide field is escaped and unsafe evidence links or invalid reading dates add no executable markup',() => {
  const input=state(),row=input.creatorTutorials[0],payload='<script>bad</script>';
  row.guide=Object.fromEntries(['purpose','audience','requirements','first_step','cost','basis_label','scope'].map(key=>[key,`${key}: ${payload}`]));
  row.guide.basis_url='javascript:alert(1)';row.guide.read_at='\" onmouseover=\"bad';
  let html=renderCreatorPage(app(),input);
  for(const key of ['purpose','audience','requirements','first_step','cost','basis_label','scope']) assert.ok(html.includes(`${key}: &lt;script&gt;bad&lt;/script&gt;`));
  assert.match(html,/整理依据：<a href="#" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html,/<script>|href="javascript:|onmouseover=|整理依据阅读 <time/);
  row.guide.read_at='2026-10-03T05:00:00Z';row.guide.basis_url='https://example.com/guide?x=%22';html=renderCreatorPage(app(),input);
  assert.match(html,/href="https:\/\/example.com\/guide\?x=%22"/);assert.match(html,/整理依据阅读 <time datetime="2026-10-03T05:00:00Z"/);
});

test('all supplied fields are escaped and unsafe source URLs are rejected',() => {
  const input=state(),viewApp=app();input.creatorCatalog[0].name='<img src=x onerror="bad">';input.creatorTutorials[0].purpose='<script>bad</script>';
  input.creatorTutorials[0].item.original_url='javascript:bad';input.creatorTutorials[0].item.summary='<b>step</b>';viewApp.creatorQuery='"><script>bad</script>';
  let html=renderCreatorPage(viewApp,input);assert.match(html,/value="&quot;&gt;&lt;script&gt;bad&lt;\/script&gt;"/);
  viewApp.creatorQuery='';html=renderCreatorPage(viewApp,input);
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);assert.match(html,/&lt;b&gt;step&lt;\/b&gt;/);assert.match(html,/href="#"/);
  assert.doesNotMatch(html,/<img|<script>|href="javascript:/);
  viewApp.creatorView='authors';input.creatorCatalog[0].profile_url='javascript:bad';input.creatorPreferences.screen={reason:'</textarea><script>bad</script>'};
  html=renderCreatorPage(viewApp,input);assert.match(html,/&lt;\/textarea&gt;&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|href="javascript:/);
});

test('paused authors and simultaneous query tokens hide results without mutating saved records',() => {
  const input=state(),viewApp=app(),other=creator('notes','notemaker');input.creatorCatalog.push(other);input.creatorTutorials.push(entry('two',other,{purpose:'整理读书笔记。',reason:'有笔记分类方法。',item:{id:'two',title:'读书笔记的分类',summary:'按主题分类笔记。',original_url:'https://example.com/notes',source_refs:[]}}));
  input.savedItemIds.add('one');viewApp.creatorQuery='截图 箭头';let html=renderCreatorPage(viewApp,input);
  assert.match(html,/data-creator-material-id="one"/);assert.doesNotMatch(html,/data-creator-material-id="two"/);
  viewApp.creatorQuery='';viewApp.creatorAuthorFilter='notes';html=renderCreatorPage(viewApp,input);assert.doesNotMatch(html,/data-creator-material-id="one"/);assert.match(html,/data-creator-material-id="two"/);
  input.creatorPreferences.notes={enabled:false};html=renderCreatorPage(viewApp,input);assert.doesNotMatch(html,/data-creator-material-id=/);assert.equal(input.savedItemIds.has('one'),true);
  viewApp.creatorAuthorFilter='all';input.creatorPreferences.screen={enabled:false};html=renderCreatorPage(viewApp,input);assert.match(html,/还没有启用的博主/);assert.match(html,/原来的收藏和主题仍保留/);
});

test('third party excerpts and truncated posts never claim complete reading or tested results',() => {
  const input=state();input.creatorTutorials[0].item.link_kind='post';input.creatorTutorials[0].scope='第三方摘录';input.creatorTutorials[0].truncated=true;
  const html=renderCreatorPage(app(),input);assert.match(html,/查看已取得的摘录/);assert.match(html,/第三方推文摘录，未核对完整原帖或实测/);
  assert.match(html,/摘录已截短，操作步骤可能不完整/);assert.doesNotMatch(html,/已阅读作者说明|测试通过|完整原帖已核验/);
  input.creatorTutorials[0].item.link_kind='article';input.creatorTutorials[0].scope='';assert.match(renderCreatorPage(app(),input),/未核对全文或实测/);
});

test('author source failures show cached coverage, successful read time and editable local reasons separately',() => {
  const input=state(),viewApp=app();viewApp.creatorView='authors';input.creatorPreferences.screen={reason:'我想用它制作教程截图。'};
  input.sources=[{id:'sopilot-author-screenshots',creator_handle:'screenshots',status:'failed',last_success_at:'2026-10-02T00:00:00Z',message:'本次读取超时 <timeout>'}];
  let html=renderCreatorPage(viewApp,input);assert.match(html,/更新失败/);assert.match(html,/保留上次成功获取/);assert.match(html,/最近成功获取/);assert.match(html,/&lt;timeout&gt;/);
  assert.match(html,/我想用它制作教程截图/);assert.match(html,/暂停只隐藏这里的材料，不删除收藏和主题/);assert.match(html,/不停止公共来源更新/);
  assert.doesNotMatch(html,/完整动态已接通|已同步全部/);input.sources[0].status='ok';html=renderCreatorPage(viewApp,input);assert.match(html,/近 7 天热门帖，最多 10 条/);
  input.sources=[];html=renderCreatorPage(viewApp,input);assert.match(html,/固定说明样本/);assert.match(html,/尚未读取这位作者的完整动态/);
});

test('archive restoration and topic state use original IDs and details retain all available summary text',() => {
  const input=state();input.archivedItemIds.add('one');input.savedItemIds.add('one');input.topics=[{materials:[{item:{id:'old'}}]}];input.creatorTutorials[0].item.alias_ids=['old'];
  const html=renderCreatorPage(app(),input);assert.match(html,/data-creator-save-mode="restore"/);assert.match(html,/恢复收藏/);assert.match(html,/已在主题/);
  assert.match(html,/示例：给产品按钮加指引/);assert.match(html,/aria-pressed="false" aria-label="恢复收藏/);
});

test('large tutorial collections page in groups of 24 and search applies before limiting',() => {
  const input=state(),viewApp=app();input.creatorTutorials=Array.from({length:30},(_,index)=>entry(`item-${index}`,input.creatorCatalog[0]));
  let html=renderCreatorPage(viewApp,input);assert.equal([...html.matchAll(/data-creator-material-id=/g)].length,24);assert.match(html,/再看 6 条/);
  viewApp.creatorTutorialLimit=48;html=renderCreatorPage(viewApp,input);assert.equal([...html.matchAll(/data-creator-material-id=/g)].length,30);
});

function withDocument(run) {
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const methods=['getState','setSaved','setArchived','topicItem'];const originals=Object.fromEntries(methods.map(key=>[key,feedAdapter[key]]));
  const viewApp=app(),input=state(),controls=new Map();
  const control=(id,dataset={})=>{const node={id,dataset,value:'',listeners:{},focus(){doc.activeElement=this;},addEventListener(type,handler){(this.listeners[type] ||= []).push(handler);}};controls.set(id,node);return node;};
  const query=control('creator-search');
  const searchForm=control('creator-search-form');
  const filter=control('creator-author-filter');filter.value='all';
  const toggle=control('creator-toggle-screen',{creatorToggle:'screen'});
  const reason=control('creator-reason-screen',{creatorReason:'screen'});reason.value='先保留这个输入。';
  const reasonForm=control('creator-reason-form',{creatorReasonForm:'screen'});reasonForm.querySelector=()=>reason;
  const save=control('creator-save-one',{creatorSave:'one',creatorSaveMode:'toggle'});
  const topic=control('creator-topic-one',{creatorTopic:'one'});
  const authors=control('creator-view-authors',{creatorView:'authors'}),more=control('creator-more');
  const selectors={'[data-creator-view]':[authors],'#creator-search-form':[searchForm],'#creator-author-filter':[filter],
    '[data-creator-toggle]':[toggle],'[data-creator-reason-form]':[reasonForm],'[data-creator-save]':[save],'[data-creator-topic]':[topic],'#creator-more':[more]};
  const root={querySelector(selector){return selector==='#creator-search' ? query : null;},querySelectorAll(selector){return selectors[selector] || [];}};
  const doc={getElementById(id){return id==='creator-page' ? root : controls.get(id);},querySelector(){return null;},activeElement:null};
  Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  feedAdapter.getState=()=>input;feedAdapter.topicItem=id=>structuredClone(input.creatorTutorials.find(row=>row.item.id===id).item);
  feedAdapter.setSaved=(id,value)=>{(viewApp.savedCalls ||= []).push([id,value]);if(value) input.savedItemIds.add(id);else input.savedItemIds.delete(id);};
  feedAdapter.setArchived=(id,value)=>{(viewApp.archiveCalls ||= []).push([id,value]);};
  viewApp.setCreatorPreference=(id,patch)=>{(viewApp.preferenceCalls ||= []).push([id,patch]);input.creatorPreferences[id]={...input.creatorPreferences[id],...patch};viewApp.render();};
  const fire=(id,type,values={})=>{const node=controls.get(id);assert.ok(node);let prevented=false;const event={currentTarget:node,preventDefault(){prevented=true;},...values};for(const handler of node.listeners[type] || []) handler(event);return prevented;};
  try {bindCreatorActions(viewApp,input);run({app:viewApp,input,doc,controls,fire,root});}
  finally {for(const key of methods) feedAdapter[key]=originals[key];if(originalDocument) Object.defineProperty(globalThis,'document',originalDocument);else delete globalThis.document;}
}

test('typing preserves focus and does not rerender, while commit, author choice and views update the page',() => withDocument(({app,controls,fire})=>{
  controls.get('creator-search').value='截图';fire('creator-search','input');assert.equal(app.creatorQuery,'截图');assert.equal(app.renderCount,undefined);
  assert.equal(fire('creator-search-form','submit'),true);assert.equal(app.renderCount,1);
  controls.get('creator-author-filter').value='screen';fire('creator-author-filter','change');assert.equal(app.creatorAuthorFilter,'screen');assert.equal(app.renderCount,2);
  fire('creator-view-authors','click');assert.equal(app.creatorView,'authors');assert.equal(app.renderCount,3);
  fire('creator-more','click');assert.equal(app.creatorTutorialLimit,48);
}));

test('local enable and reason changes preserve other fields and failures keep the drafted reason',() => withDocument(({app,input,controls,fire})=>{
  fire('creator-toggle-screen','click');assert.deepEqual(app.preferenceCalls,[['screen',{enabled:false}]]);
  controls.get('creator-reason-screen').value='想收教程样本';fire('creator-reason-form','submit');assert.equal(input.creatorPreferences.screen.enabled,false);assert.equal(input.creatorPreferences.screen.reason,'想收教程样本');
  app.setCreatorPreference=()=>{throw Error('存储被禁用');};controls.get('creator-reason-screen').value='还没有保存的理由';
  fire('creator-reason-form','submit');assert.equal(controls.get('creator-reason-screen').value,'还没有保存的理由');assert.deepEqual(app.toasts,['存储被禁用']);
}));

test('collection actions are single bound, use latest state and restore without a duplicate save',() => withDocument(({app,input,controls,fire})=>{
  bindCreatorActions(app,input);assert.equal(controls.get('creator-save-one').listeners.click.length,1);
  fire('creator-save-one','click');assert.deepEqual(app.savedCalls,[['one',true]]);
  fire('creator-save-one','click');assert.deepEqual(app.savedCalls,[['one',true],['one',false]]);
  controls.get('creator-save-one').dataset.creatorSaveMode='restore';fire('creator-save-one','click');assert.deepEqual(app.archiveCalls,[['one',false]]);assert.equal(app.savedCalls.length,2);
  feedAdapter.setArchived=()=>{throw Error('容量不足');};fire('creator-save-one','click');assert.equal(app.toasts.at(-1),'未保存：容量不足');
}));

test('topic action opens existing snapshot dialog with correct material and focus trigger',() => withDocument(({app,fire})=>{
  fire('creator-topic-one','click');assert.equal(app.activeModal,'topic-collect');assert.equal(app.topicContext.kind,'collect');assert.equal(app.topicContext.itemId,'one');
  assert.equal(app.topicContext.itemSnapshot.title,'截图加箭头的操作方法');assert.equal(app.triggerInfo.selector,'#creator-topic-one');assert.equal(app.modals,1);
}));
