import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCreatorPage, bindCreatorActions } from './src/creatorViews.js';
import { CREATOR_MATERIALS } from './src/creatorCatalog.js';

const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const app = (view='candidates') => ({escapeHtml:escape,creatorView:view,creatorQuery:'',creatorAuthorFilter:'all',
  safeUrl:value => {try {const url=new URL(value);return ['http:','https:'].includes(url.protocol) ? url.href : '#';} catch {return '#';}},
  // Deliberately hide the publication year as the live app's short formatter may.
  formatTime:()=> '刚刚',render(){this.renderCount=(this.renderCount || 0)+1;}});
const author = (id='writer') => ({id,name:'个人博客作者',profile_label:'作者博客',profile_url:'https://example.com/',
  source_id:`subscription-${id}`,enabled_by_default:true});
const candidate = (id='old',creator=author(),patch={}) => ({creator,kind:'method',purpose:'把资料整理成可复用的笔记。',
  reason:'摘录给出操作步骤。',scope:'作者博客订阅摘录；未阅读全文或实测。',candidateNew:false,
  item:{id,title:'Building a repeatable note workflow',summary:'打开文件，按项目分组，再把结果存成笔记。',
    original_url:`https://example.com/${id}`,source_refs:[creator.source_id],read_scope:'author-blog-feed',
    captured_at:'2026-10-03T04:00:00.000Z',published_at:'2020-01-08T04:00:00.000Z'},...patch});
const state = () => {const creator=author();return {creatorCatalog:[creator],creatorPreferences:{},creatorTutorials:[],creatorCandidates:[candidate('old',creator)],
  sources:[{id:creator.source_id,creator_id:creator.id,creator_scope:'blog-feed',format:'atom',status:'ok'}],sourceMap:new Map(),
  savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]};};

test('candidate cards expose original title, Chinese use, requirements and original publication year before details',()=>{
  const input=state(),before=structuredClone(input),html=renderCreatorPage(app(),input);
  const card=html.match(/<article class="creator-tutorial-card creator-candidate-card"[\s\S]*?<\/article>/)[0];
  const front=card.split('<details class="creator-preparation-details">')[0];
  for (const value of ['Building a repeatable note workflow','中文用途线索','把资料整理成可复用的笔记','准备条件','所需工具、账号或环境未知','个人博客作者','2020-01-08','取得摘录','读原文']) assert.ok(front.includes(value));
  assert.match(front,/href="https:\/\/example.com\/old" target="_blank" rel="noopener noreferrer">读原文/);
  assert.match(front,/原文发布 <time datetime="2020-01-08T04:00:00.000Z">2020-01-08<\/time>/);
  assert.match(front,/取得摘录 <time datetime="2026-10-03T04:00:00.000Z">刚刚<\/time>/);
  assert.match(card,/来源：作者博客订阅提供的标题与摘要/);assert.match(card,/未核对原文全文或实测/);
  assert.match(html,/旧文章这次收录不等于刚发布/);assert.match(card,/data-creator-save="old"/);assert.match(card,/data-creator-topic="old"/);
  assert.doesNotMatch(card,/<details[^>]*\sopen(?:\s|>)/);assert.deepEqual(input,before);
});

test('new acquisition badge depends on refresh metadata and capture never borrows a guide read date',()=>{
  const input=state(),row=input.creatorCandidates[0];row.candidateNew=true;
  row.item.published_at=null;row.item.captured_at=null;row.checkedAt='2026-10-03T05:00:00.000Z';
  row.guide={purpose:'用现有资料开始整理笔记。',requirements:'一份公开的资料。',read_at:'2026-10-03T06:00:00.000Z',
    scope:'AI 阅读作者文章全文',trial_url:'https://example.com/some-other-trial'};
  let html=renderCreatorPage(app(),input);
  assert.match(html,/creator-candidate-badge is-new">最近一次更新新收录/);
  assert.match(html,/原文发布时间未知/);assert.match(html,/取得摘录时间未知/);assert.match(html,/一份公开的资料/);
  assert.doesNotMatch(html,/AI 阅读作者文章全文|整理依据阅读|说明阅读|some-other-trial|2026-10-03T05:|2026-10-03T06:/);
  row.candidateNew=false;html=renderCreatorPage(app(),input);assert.match(html,/creator-candidate-badge">已收录线索/);
  assert.doesNotMatch(html,/creator-candidate-badge is-new/);
  // Even a real bundled trial is a separate reading record, not an RSS candidate trial.
  const known=CREATOR_MATERIALS.find(item=>item.original_url==='https://www.ruanyifeng.com/blog/2020/01/ffmpeg.html');
  assert.ok(known);row.item={...known,read_scope:'author-blog-feed'};
  assert.doesNotMatch(renderCreatorPage(app(),input),/creator-guide-trial|查看本站截图实测/);
});

test('candidate payloads are escaped and unsafe original links cannot execute',()=>{
  const input=state(),row=input.creatorCandidates[0],payload='<img src=x onerror="bad">';
  row.creator.name=payload;row.item.title=payload;row.item.summary='<script>bad</script>';row.item.original_url='javascript:alert(1)';
  row.reason=payload;row.guide={purpose:payload,audience:payload,requirements:payload,first_step:payload,cost:payload};
  row.item.published_at='" onmouseover="bad';
  const html=renderCreatorPage(app(),input);
  assert.match(html,/&lt;img src=x onerror=&quot;bad&quot;&gt;/);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html,/href="#" target="_blank" rel="noopener noreferrer">读原文/);assert.match(html,/原文发布时间未知/);
  assert.doesNotMatch(html,/<img|<script|href="javascript:|onmouseover=/);
});

test('candidate search, author choice, paused authors and paging operate on candidates independently',()=>{
  const input=state(),view=app(),second=author('second');input.creatorCatalog.push(second);
  input.creatorTutorials=[candidate('tutorial-only',second,{purpose:'旧教程专属内容。'})];
  input.creatorCandidates=Array.from({length:30},(_,index)=>candidate(`candidate-${index}`,index===29 ? second : input.creatorCatalog[0]));
  let html=renderCreatorPage(view,input);assert.equal([...html.matchAll(/data-creator-material-id=/g)].length,24);assert.match(html,/再看 6 条/);assert.doesNotMatch(html,/tutorial-only/);
  view.creatorTutorialLimit=48;html=renderCreatorPage(view,input);assert.equal([...html.matchAll(/data-creator-material-id=/g)].length,30);
  view.creatorAuthorFilter='second';html=renderCreatorPage(view,input);assert.equal([...html.matchAll(/data-creator-material-id=/g)].length,1);assert.match(html,/data-creator-material-id="candidate-29"/);
  view.creatorQuery='整理 笔记';assert.match(renderCreatorPage(view,input),/data-creator-material-id="candidate-29"/);
  view.creatorQuery='旧教程专属';html=renderCreatorPage(view,input);assert.match(html,/没有找到匹配候选/);assert.doesNotMatch(html,/data-creator-material-id=/);
  view.creatorQuery='';input.creatorPreferences.second={enabled:false};input.savedItemIds.add('candidate-29');
  assert.doesNotMatch(renderCreatorPage(view,input),/data-creator-material-id=/);assert.equal(input.savedItemIds.has('candidate-29'),true);
});

test('empty candidates give honest explanation and links back to tutorials and author library',()=>{
  const input=state();input.creatorCandidates=[];
  const html=renderCreatorPage(app(),input);assert.match(html,/暂时没有合格的新教程线索/);assert.match(html,/0 条候选/);
  assert.match(html,/data-creator-view="tutorials" data-creator-reset="true">查看教程/);assert.match(html,/data-creator-view="authors">查看博主库/);
  assert.doesNotMatch(html,/data-creator-material-id=/);
  const tutorialPage=renderCreatorPage(app('tutorials'),input);assert.match(tutorialPage,/查看新教程候选 · 0 条/);
  assert.match(tutorialPage,/data-creator-view="tutorials" aria-pressed="true"/);assert.match(tutorialPage,/data-creator-view="candidates" aria-pressed="false"/);
});

test('non-X authors retain real profiles and source identity, Atom and RSS coverage, and cached failure explanation',()=>{
  const input=state(),creator=input.creatorCatalog[0],view=app('authors');creator.handle='legacy';
  input.sources=[
    {id:creator.source_id,creator_id:creator.id,creator_scope:'blog-feed',format:'atom',status:'failed',last_success_at:'2026-10-02T05:00:00.000Z',message:'获取失败 <timeout>'},
    {id:'rss-subscription',creator_id:creator.id,creator_scope:'blog-feed',format:'rss',status:'ok'},
    {id:'foreign-source',creator_id:'different-author',creator_handle:'legacy',status:'failed'},
  ];
  let html=renderCreatorPage(view,input);
  assert.match(html,/href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer">作者博客/);
  assert.match(html,/data-creator-source-id="subscription-writer"/);assert.match(html,/data-creator-source-id="rss-subscription"/);
  assert.match(html,/订阅格式：Atom/);assert.match(html,/订阅格式：RSS/);assert.match(html,/保留上次成功获取的内容/);
  assert.match(html,/已收录线索不代表本次更新成功/);assert.match(html,/&lt;timeout&gt;/);assert.doesNotMatch(html,/x\.com|data-creator-source-id="foreign-source"/);
  html=renderCreatorPage(app(),input);assert.match(html,/来源本次更新失败；这条是已收录的旧线索/);assert.match(html,/creator-candidate-badge">已收录线索/);
  delete creator.handle;input.sourceMap=new Map([[creator.source_id,input.sources[0]]]);input.sources=[];
  assert.match(renderCreatorPage(view,input),/data-creator-source-id="subscription-writer"/);
});

test('candidate view switch and pagination bind existing controls without falling back to tutorials',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),view=app('tutorials'),input=state();
  const makeNode=(dataset={})=>({dataset,listeners:{},addEventListener(type,handler){this.listeners[type]=handler;}});
  const switchButton=makeNode({creatorView:'candidates'}),more=makeNode(),root={
    querySelector:()=>null,querySelectorAll:selector=>selector==='[data-creator-view]' ? [switchButton] : selector==='#creator-more' ? [more] : [],
  };
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>id==='creator-page' ? root : null,querySelector:()=>null}});
  try {
    bindCreatorActions(view,input);switchButton.listeners.click({currentTarget:switchButton});assert.equal(view.creatorView,'candidates');
    more.listeners.click();assert.equal(view.creatorTutorialLimit,48);assert.equal(view.renderCount,2);
    switchButton.dataset.creatorReset='true';view.creatorQuery='笔记';view.creatorAuthorFilter='writer';
    switchButton.listeners.click({currentTarget:switchButton});assert.equal(view.creatorQuery,'');assert.equal(view.creatorAuthorFilter,'all');assert.equal(view.creatorTutorialLimit,24);
  } finally {if(previous) Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}
});
