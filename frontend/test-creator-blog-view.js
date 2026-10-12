import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_BLOG_SOURCES, CREATOR_SOURCES } from './creator-sources.js';
import { CREATOR_CATALOG, CREATOR_MATERIALS } from './src/creatorCatalog.js';
import { classifyCreatorMaterial, selectCreatorTutorials } from './src/creatorTutorials.js';
import { renderCreatorPage } from './src/creatorViews.js';
import { makePublicFeed } from './public-feed-data.js';
import { makeBackup, parseBackup } from './src/backup.js';

const at='2026-10-03T10:00:00.000Z',published='2026-09-25T03:00:00.000Z';
const viking=CREATOR_BLOG_SOURCES.find(source=>source.creator_handle==='vikingmute');
const vista=CREATOR_BLOG_SOURCES.find(source=>source.creator_handle==='vista8');
const author=source=>CREATOR_CATALOG.find(creator=>creator.handle===source.creator_handle);
const article=(source=viking,patch={})=>({
  id:'news-'+(source===viking ? 'a' : 'b').repeat(24),title:'把网页截图保存为带箭头的 PNG：具体操作方法',
  summary:'打开截图工具并选择网页区域，保存图片后选择箭头按钮，最后把操作说明和图片放进笔记。附有实际页面的示例。',
  original_url:source.allowed_article_origin+'/screenshot-guide/',canonical_url:source.allowed_article_origin+'/screenshot-guide/',
  source_refs:[source.id],link_kind:'article',content_status:'excerpt_only',read_scope:'author-blog-feed',
  author_handle:source.creator_handle,author_name:source.creator_name,blog_method_hint:'steps-and-example',
  captured_at:at,published_at:published,updated_at:null,source_updated_at:null,
  excerpt_truncated:false,excerpt_original_length:60,...patch,
});
const feed=(items,sources=CREATOR_BLOG_SOURCES)=>({schema_version:'0.3',mode:'live',sources:sources.map(source=>({...source,status:'ok',last_success_at:at,last_attempt_at:at})),items,refresh:{new_item_ids:[]}});
const publish=items=>makePublicFeed(feed(items),{publishedAt:at});
const escape=value=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const app=(view='tutorials')=>({escapeHtml:escape,safeUrl:value=>value,formatTime:value=>value,creatorView:view,creatorAuthorFilter:'all',creatorQuery:''});
const state=(items)=>({creatorCatalog:[author(viking),author(vista)],creatorPreferences:{},creatorTutorials:selectCreatorTutorials(items),sources:[],sourceMap:new Map(),savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]});

test('own-blog practical excerpts qualify without AI keywords or heat, while news and promotions stay out',()=>{
  const item=article();assert.ok(!item.title.includes('AI'));assert.equal(item.heat_label,undefined);
  const selected=classifyCreatorMaterial(item);assert.equal(selected.kind,'method');assert.match(selected.scope,/作者博客订阅摘录/);
  assert.match(selected.scope,/未核对原文全文或实测/);assert.equal(selected.checkedAt,null);
  const actualTitle='『豆包工作』现教现学：从一份日文 PDF 到官网、视频、PPT 全搞定，打通飞书后太爽了！';
  const actualExcerpt='原来使用多个办公产品才能完成的事情，现在可以将资料交给同一套工作模式处理。作者展示了 PDF、官网、视频和 PPT 的实际操作安排。';
  assert.equal(classifyCreatorMaterial(article(vista,{title:actualTitle,summary:actualExcerpt})).kind,'method');
  assert.equal(classifyCreatorMaterial(article(vista,{title:'某大公司正式发布新模型，完成1亿美元融资',summary:'新闻介绍新模型的能力和工作流，没有可复现的操作说明。',blog_method_hint:'action-guide'})),null);
  assert.equal(classifyCreatorMaterial(article(vista,{summary:item.summary+'订阅会员，使用折扣码购买课程。'})),null);
  assert.equal(classifyCreatorMaterial(article(vista,{summary:'这款截图工具特别方便，值得关注。'.repeat(6),blog_method_hint:undefined})),null);
  // Two false positives found in the author's actual RSS on 2026-10-03.
  assert.equal(classifyCreatorMaterial(article(vista,{title:'从伽罗瓦到夸克：需要200年验证的想法，AI能产生吗？',
    summary:'一个 19 岁的少年，在监狱里写下了一套没人看懂的数学笔记。 他把笔记托付给朋友，请他转交给当时最伟大的数学家高斯，朋友尽力了，但没有成功。',blog_method_hint:'steps-and-example',
    original_url:'https://blog.qiaomu.ai/ai-generative-theory-from-galois-to-quarks'})),null);
  assert.equal(classifyCreatorMaterial(article(vista,{title:'Flask作者发出警告：AI Loop写的代码，正在变成没人能看懂的“生物”',
    summary:'Claude Code 之父 Boris Cherny 说过一句话，读完之后很难忘掉：我已经不再直接Prompt Claude了。我写的是Loop（循环），让循环去提示Claude，让循环去决定下一步做什么。',blog_method_hint:'steps-and-example',
    original_url:'https://blog.qiaomu.ai/flask-author-warns-ai-loop-code-becomes-unreadable'})),null);
});

test('Viking description with an explicit workflow qualifies; a title about review alone does not',()=>{
  const e2e=article(viking,{title:'我是怎样使用 AI 构建 E2E 测试体系的？',summary:'项目每改一个功能，多个框架与数据库组合都可能出问题。作者总结 Spec → Code → Verify → Test → Green 五阶段流程，让助手完成 E2E 测试的整个生命周期。',blog_method_hint:undefined});
  assert.equal(classifyCreatorMaterial(e2e).kind,'method');
  const review=article(viking,{title:'我是怎样使用 AI 来做 Code Review 的？',summary:'作者介绍 Review Forge，讨论代码审查与个人项目维护中的体验。这篇文章提到几个助手和一些思考，但订阅摘要没有给出具体操作。',blog_method_hint:undefined});
  assert.equal(classifyCreatorMaterial(review),null);
});

test('blog authority requires registered author, exact HTTPS origin, article path and matching source scope',()=>{
  const item=article();
  for (const patch of [{origin:'user_added'},{author_handle:'unknown'},{author_handle:'vista8'},
    {source_refs:['creator-blog-vista8']},{source_refs:['sopilot-author-vikingmute']},
    {source_refs:['creator-blog-unlisted']},{read_scope:'author-7d-top10'},{read_scope:undefined},
    {link_kind:'post'},{content_status:'headline_only'},
    ...['https://vikingz.me.attacker.example/tutorial/','http://vikingz.me/tutorial/','https://vikingz.me:8443/tutorial/',
      'https://vikingz.me/','https://vikingz.me/rss.xml','https://name@vikingz.me/tutorial/'].map(original_url=>({original_url}))]) {
    assert.equal(classifyCreatorMaterial({...item,...patch}),null,JSON.stringify(patch));
  }
});

test('the exact known reading note wins duplicate URLs without changing feed order or original RSS timestamps',()=>{
  const fixed=CREATOR_MATERIALS.find(item=>item.original_url==='https://vikingz.me/ai-e2e/');
  const rss=article(viking,{original_url:fixed.original_url,canonical_url:fixed.original_url});
  const input=[rss,fixed],before=structuredClone(input),selected=selectCreatorTutorials(input);
  assert.equal(selected.length,1);assert.equal(selected[0].kind,'tutorial');assert.equal(selected[0].item.id,fixed.id);
  assert.equal(selected[0].item.published_at,null);assert.deepEqual(input,before);
});

test('public feed derives blog identity, caps description, discards full bodies and preserves only narrow hints',()=>{
  const summary='操作步骤与具体示例。'.repeat(130),input=article(vista,{summary,author_handle:'forged',author_name:'冒充作者',
    content:'DO NOT PUBLISH FULL BODY',body:'DO NOT PUBLISH FULL BODY',canonical_url:'https://other.example/path',
    excerpt_original_length:summary.length,blog_method_hint:'action-guide'});
  const output=publish([input]),item=output.items[0];assert.equal(output.publication.version,'0.42.0');
  assert.equal(item.summary,summary.slice(0,1000));assert.equal(item.author_handle,vista.creator_handle);assert.equal(item.author_name,vista.creator_name);
  assert.equal(item.canonical_url,input.original_url);assert.equal(item.read_scope,'author-blog-feed');assert.equal(item.blog_method_hint,'action-guide');
  assert.equal(item.excerpt_truncated,true);assert.equal(item.excerpt_original_length,summary.length);assert.equal(item.published_at,published);
  assert.equal(item.verification_status,'not_tested');assert.match(item.unknowns.join(''),/订阅摘录/);
  assert.equal(output.sources.find(source=>source.id===vista.id).creator_scope,'blog-feed');
  assert.doesNotMatch(JSON.stringify(output),/DO NOT PUBLISH FULL BODY|冒充作者|forged/);
  const unsafeHint=publish([article(vista,{blog_method_hint:'full-article-verified'})]).items[0];assert.equal(unsafeHint.blog_method_hint,undefined);
});

test('unsupported article metadata cannot acquire author blog scope during a public rebuild',()=>{
  for (const patch of [{original_url:'https://other.example/tutorial/'},{source_refs:[viking.id],original_url:vista.allowed_article_origin+'/tutorial/'},
    {read_scope:undefined},{link_kind:'repository'},{content_status:'metadata_only'}]) {
    const item=publish([article(vista,patch)]).items[0];assert.ok(item);assert.equal(item.read_scope,undefined);assert.equal(item.blog_method_hint,undefined);
    assert.equal(item.author_handle,undefined);assert.equal(classifyCreatorMaterial(item),null);
  }
  assert.throws(()=>publish([article(vista,{origin:'user_added'})]),/没有可公开/);
});

test('blog original dates, unknown dates and source-bound metadata survive public backup round trip',()=>{
  const output=publish([article(viking),article(vista,{published_at:null})]);
  const saved={saved_item_ids:output.items.map(item=>item.id),hidden_item_ids:[],followups:[],profile_override:null,
    item_snapshots:Object.fromEntries(output.items.map(item=>[item.id,item]))};
  const restored=parseBackup(makeBackup(saved,output,'live').raw,'live').state;
  assert.deepEqual(restored.item_snapshots,saved.item_snapshots);assert.equal(restored.item_snapshots[article(viking).id].published_at,published);
  assert.equal(restored.item_snapshots[article(vista).id].published_at,null);
});

test('blog cards show an excerpt capture rather than full reading and identify original blog links',()=>{
  const item=article(vista,{published_at:null,excerpt_truncated:true}),input=state([item]),html=renderCreatorPage(app(),input);
  assert.match(html,/向阳乔木 · 作者博客/);assert.match(html,/作者博客订阅摘录；按订阅提供的操作线索初筛，未核对原文全文或实测/);
  assert.match(html,/取得摘录/);assert.match(html,/原文发布时间未知/);assert.match(html,/请到原文查看全文/);
  assert.ok(html.includes(`href="${item.original_url}"`));assert.doesNotMatch(html,/已阅读作者说明|说明阅读|第三方推文摘录|近7日/);
  assert.match(html,/data-creator-save=/);assert.match(html,/data-creator-topic=/);
});

test('author library shows blog and SoPilot failures and freshness separately, with honest reading ranges',()=>{
  const input=state([article(vista)]),sopilot=CREATOR_SOURCES.find(source=>source.creator_handle===vista.creator_handle);
  input.sources=[{...vista,status:'ok',last_success_at:at},{...sopilot,status:'failed',last_success_at:published,message:'上次读取失败 <timeout>'}];
  const before=structuredClone(input),html=renderCreatorPage(app('authors'),input);
  assert.ok(html.includes(`data-creator-source-id="${vista.id}"`));assert.ok(html.includes(`data-creator-source-id="${sopilot.id}"`));
  assert.match(html,/作者博客订阅/);assert.match(html,/公开热门帖 · 更新失败/);assert.match(html,/保留上次成功获取/);
  assert.match(html,/最近最多30篇，按原文时间；不按热度，只保留操作线索/);assert.match(html,/近 7 天热门帖，最多 10 条/);
  assert.ok(html.includes(at));assert.ok(html.includes(published));assert.match(html,/&lt;timeout&gt;/);assert.deepEqual(input,before);
  input.sources[0]={...vista,status:'not_connected',last_success_at:null};input.sources[1]={...sopilot,status:'ok',last_success_at:published};
  const waiting=renderCreatorPage(app('authors'),input);assert.match(waiting,/作者博客订阅 · 等待首次读取/);assert.match(waiting,/最近成功获取时间未知/);
});
