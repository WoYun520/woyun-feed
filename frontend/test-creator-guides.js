import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CREATOR_CATALOG, CREATOR_MATERIALS } from './src/creatorCatalog.js';
import { creatorGuideFor } from './src/creatorGuides.js';
import { selectCreatorTutorials, classifyCreatorMaterial } from './src/creatorTutorials.js';
import { renderCreatorPage } from './src/creatorViews.js';
import { blankTopic, buildTopicMaterial } from './src/topicWorkspace.js';

const excerpts=JSON.parse(fs.readFileSync(new URL('./fixtures/creator-guide-evidence.json',import.meta.url),'utf8'));
const all=[...CREATOR_MATERIALS,...excerpts];
const escaped=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const app={escapeHtml:escaped,safeUrl:v=>v,formatTime:v=>v,creatorView:'tutorials',creatorAuthorFilter:'all',creatorQuery:''};
const viewState=items=>({creatorCatalog:CREATOR_CATALOG,creatorTutorials:selectCreatorTutorials(items),creatorPreferences:{},savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]});
const topic=item=>({...blankTopic(),title:'说明与原始摘录',id:'topic-guide-check',created_at:'2026-10-03T11:00:00Z',updated_at:'2026-10-03T11:00:00Z',materials:[{item,note:'想先读条件',added_at:'2026-10-03T11:00:00Z'}]});

test('all fourteen prepared materials get practical notes without mutating original evidence',()=>{
  const before=structuredClone(all),selected=selectCreatorTutorials(all);
  assert.equal(selected.length,14);assert.equal(selected.filter(entry=>entry.guide).length,14);
  for(const item of all) {
    const guide=creatorGuideFor(item);assert.ok(guide);
    for(const key of ['purpose','audience','requirements','first_step','cost','basis_url','scope','read_at']) assert.ok(guide[key],item.id+':'+key);
    assert.notEqual(guide.purpose,item.title);assert.match(guide.scope,/未.*实测|未实测/);assert.ok(Number.isFinite(Date.parse(guide.read_at)));
    assert.equal(new URL(guide.basis_url).protocol,'https:');assert.match(guide.cost,/未知/);
  }
  assert.deepEqual(all,before);
  const note=creatorGuideFor(all[0]);note.purpose='changed';assert.notEqual(creatorGuideFor(all[0]).purpose,'changed');
});

test('changed, forged and user-added evidence cannot inherit an old companion note',()=>{
  for(const item of all) for(const patch of [{id:'unknown'},{origin:'user_added'},{title:item.title+'编辑'},
    {summary:item.summary+'编辑'},{original_url:item.original_url+'?changed=yes'},{author_handle:'another'},
    {source_refs:[]},{read_scope:'full-article-verified'},{content_status:'headline_only'}]) {
    assert.equal(creatorGuideFor({...item,...patch}),null,item.id+JSON.stringify(patch));
  }
  assert.equal(creatorGuideFor(null),null);assert.equal(creatorGuideFor({id:'toString'}),null);
});

test('unread future articles remain method leads with explicit unknown preparation',()=>{
  const item={...excerpts[0],id:'news-new-blog',original_url:'https://blog.qiaomu.ai/new-screenshot-guide',
    title:'截图加箭头的操作教程',summary:'1. 打开截图工具，选择网页区域，然后添加箭头，再保存 PNG 图片。这里提供具体操作过程与示例。'};
  assert.ok(classifyCreatorMaterial(item));assert.equal(creatorGuideFor(item),null);
  const html=renderCreatorPage(app,viewState([item]));
  assert.match(html,/用途待整理，先查看原文/);assert.match(html,/适用人群未知/);
  assert.match(html,/所需工具、账号或环境未知/);assert.match(html,/第一步未知/);assert.match(html,/费用与使用条件未知/);
  assert.doesNotMatch(html,/已阅读全文|免费使用|补充的上手提示/);
});

test('usage and audience search works in selection and visible view without bypassing author or hidden filters',()=>{
  const query='外贸';assert.ok(!excerpts[0].title.includes(query));assert.ok(!excerpts[0].summary.includes(query));
  assert.equal(selectCreatorTutorials(all,{query}).length,1);
  const html=renderCreatorPage({...app,creatorQuery:query},viewState(all));assert.match(html,/1 条材料/);assert.match(html,/日文产品 PDF/);
  assert.equal(selectCreatorTutorials(all,{query,author:'vikingmute'}).length,0);
  const creator=CREATOR_CATALOG.find(c=>c.handle==='vista8');
  assert.equal(selectCreatorTutorials(all,{query,preferences:{[creator.id]:{enabled:false}}}).length,0);
  assert.equal(selectCreatorTutorials(all,{query,hiddenItemIds:[excerpts[0].id]}).length,0);
  assert.equal(selectCreatorTutorials(all,{query:'互动 课件'}).length,1);
});

test('export distinguishes current companion reading from saved blog excerpt and retains original dates',()=>{
  const item={...excerpts[0],captured_at:'2026-10-03T10:45:25.121Z',published_at:'2026-08-24T08:00:00Z'},input=topic(item),before=structuredClone(input);
  const text=buildTopicMaterial(input,{forAI:false});
  assert.match(text,/本站当前补充的上手提示 · AI 整理，未实测/);assert.match(text,/不是收藏时的来源原文或用户确认/);
  assert.match(text,/作者博客订阅标题和摘要/);assert.match(text,/未核对原文全文或实测/);
  assert.ok(text.includes(item.title));assert.ok(text.includes(item.summary));assert.ok(text.includes(item.original_url));
  assert.ok(text.includes(item.published_at));assert.ok(text.includes(item.captured_at));assert.ok(text.includes(creatorGuideFor(item).read_at));
  assert.match(text,/适合谁（本站建议）/);assert.match(text,/第一步（本站建议）/);assert.deepEqual(input,before);
});

test('post README supplementation stays separate from excerpt source, and unsafe or stale evidence exports no note',()=>{
  const item=excerpts.at(-1),text=buildTopicMaterial(topic(item));
  assert.ok(text.includes(item.original_url));assert.ok(text.includes('https://github.com/joeseesun/qiaomu-obsidian-dev'));
  assert.match(text,/未读取完整原帖/);assert.match(text,/另读项目 README/);
  const changed={...item,summary:item.summary+'另加的个人观点'};
  assert.doesNotMatch(buildTopicMaterial(topic(changed)),/本站当前补充的上手提示/);
});

test('source and current reading dates remain independent on a real prepared blog card',()=>{
  const item={...excerpts[0],captured_at:'2026-10-03T10:45:25.121Z',published_at:'2026-08-24T08:00:00Z'},html=renderCreatorPage(app,viewState([item]));
  assert.match(html,/开始前看一下/);assert.match(html,/作者博客订阅摘录/);assert.match(html,/整理依据范围：AI 阅读作者文章文字/);
  assert.ok(html.includes('原文发布'));assert.ok(html.includes('取得摘录'));assert.ok(html.includes('整理依据阅读'));
  assert.ok(html.includes(item.published_at));assert.ok(html.includes(item.captured_at));assert.ok(html.includes(creatorGuideFor(item).read_at));
});

test('source-specific requirements do not apply a developer environment to installed radio or a dated offer as current free use',()=>{
  const radio=creatorGuideFor(CREATOR_MATERIALS.find(i=>i.original_url.endsWith('/qiaomu-radio')));
  assert.doesNotMatch(radio.requirements,/Node|编译器|20/);assert.match(radio.requirements,/不要求编译环境/);
  assert.match(creatorGuideFor(excerpts[1]).cost,/八月.*不能当成现在/);
  assert.match(creatorGuideFor(excerpts[4]).requirements,/不要与同名 Obsidian 插件混用/);
});
