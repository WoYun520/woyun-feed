import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FEED_CHANNELS,parseSubscription,normalizeSubscription,mergeSourceItems } from './feed-sources.js';
import { MultiFeedService } from './multi-feed-service.js';
import { selectFeed } from './src/feedSelection.js';
import { matchesSource } from './src/sourceGroups.js';
import { makeBackup,parseBackup } from './src/backup.js';
const NOW='2026-09-29T01:00:00.000Z';
const fixtures={
 ithome:'<div id="list"><ul><li><a class="c" data-ot="2026-09-29T08:00:00+08:00">IT</a><a class="t" href="https://www.ithome.com/1/001/001.htm">AI &amp; tools</a></li></ul></div>',
 solidot:'<rss><channel><item><title>Science</title><link>https://www.solidot.org/story?sid=1</link><pubDate>Tue, 29 Sep 2026 08:00:00 +0800</pubDate><description><![CDATA[<p>A report</p>]]></description></item></channel></rss>',
 producthunt:'<feed><entry><title>Product</title><link rel="alternate" href="https://www.producthunt.com/products/example"/><published>2026-09-28T07:00:00Z</published><content type="html">&lt;p&gt;A writing tool&lt;/p&gt;</content><author>not retained</author></entry></feed>',
 'github-trending':'<article class="Box-row"><h2><a href="/maker/tool"><span>maker /</span> tool</a></h2><p>AI workflow &amp; notes</p></article>',
 juejin:JSON.stringify({err_no:0,data:[{content:{content_id:'1234567890123456789',title:'Coding'}}]}),
 hackernews:JSON.stringify({topstories:[123],items:[{id:123,type:'story',title:'New tools'}]}),
 zhihu:JSON.stringify({data:[{target:{title_area:{text:'Question'},link:{url:'https://www.zhihu.com/question/123'},excerpt_area:{text:'A question excerpt'},metrics_area:{text:'30 万热度'}}}]}),
 thepaper:JSON.stringify({resultCode:1,data:{hotNews:[{contId:'123',name:'News',pubTimeLong:1790640000000}]}}),
 toutiao:JSON.stringify({data:[{ClusterIdStr:'7690631904081117235',ClusterId:7690631904081117235,Title:'Topic'}]}),
 baidu:'<!--s-data:'+JSON.stringify({data:{cards:[{content:[{isTop:true,word:'Pinned',rawUrl:'https://www.baidu.com/s?wd=pinned'},{word:'Topic',rawUrl:'https://www.baidu.com/s?wd=topic',desc:'Summary'}]}]}})+'-->',
 'wallstreetcn-hot':JSON.stringify({code:20000,data:{day_items:[{title:'Market news',uri:'https://wallstreetcn.com/articles/123',display_time:1790640000}]}}),
 wired:'<rss><channel><item><title>AI tools in daily life</title><link>https://www.wired.com/story/ai-tools/</link><pubDate>Tue, 29 Sep 2026 08:00:00 +0800</pubDate><description><![CDATA[<p>The publisher\u2019s short summary</p>]]></description></item></channel></rss>',
 'mit-tech':'<rss><channel><item><title>New AI research</title><link>https://www.technologyreview.com/2026/09/29/research/</link><pubDate>Tue, 29 Sep 2026 08:00:00 +0800</pubDate><description><![CDATA[<p>Research news excerpt</p>]]></description></item></channel></rss>',
};
const youtubeFixture=(channel)=>`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><yt:channelId>${channel}</yt:channelId><entry><title>Getting started with AI</title><link href="https://www.youtube.com/watch?v=demo123" type="text/html" rel="alternate"/><published>2026-09-28T07:00:00Z</published><updated>2026-09-29T07:00:00Z</updated><media:group><media:description>Learn a practical AI workflow. &amp; Keep original links.</media:description><media:community><media:statistics views="100000"/></media:community></media:group></entry></feed>`;
// Reuse the RSS contract check with short synthetic titles and descriptions.
// Official responses checked 2026-10-02 use these same title/link/pubDate/description fields.
for (const [id,url] of [['36kr','https://36kr.com/p/123'],['ifanr','https://www.ifanr.com/123'],['appinn','https://www.appinn.com/example-tool/']]) {
 fixtures[id]=`<rss><channel><item><title>科技与工具资讯</title><link>${url}</link><pubDate>Fri, 02 Oct 2026 02:50:00 +0000</pubDate><description><![CDATA[<p>来源提供的简短摘要。</p>]]></description></item></channel></rss>`;
}
for (const source of FEED_CHANNELS.filter(s=>s.youtube_channel_id)) fixtures[source.id]=youtubeFixture(source.youtube_channel_id);
for (const source of FEED_CHANNELS.filter(s=>s.sopilot_category)) {
 const data={locale:'zh',range:'24h',category:source.sopilot_category,page:1,totalPages:1,risingTweets:[{id:'2105614023941316931',text:'一个公开工具的用法',authorName:'测试作者',screenName:'demo_author',sourceUrl:'https://x.com/demo_author/status/2105614023941316931',rank:1,tweetCreatedAt:'2026-09-28T07:00:00Z',lastSyncedAt:NOW,velocityScore:1000}],hotTweets:[]};
 fixtures[source.id]=`<main data-rank-page="true"></main><script>self.__next_f.push(${JSON.stringify([1,`6:${JSON.stringify(['$','$L39',null,data])}\n`])})</script>`;
}
const convert=(source,raw=fixtures[source.id])=>normalizeSubscription(parseSubscription(raw,source),source,NOW,'evidence-'+source.id).items;

for (const source of FEED_CHANNELS.filter(s=>s.format==='sopilot-author')) {
 const data={locale:'zh',page:'1',query:'',backHref:'/zh/rank/creators',detail:{account:{screenName:source.creator_handle},timeRange:'7d',posts:[{id:'2105614023941316931',text:'网页截图的操作步骤',authorName:'测试作者',screenName:source.creator_handle,sourceUrl:`https://x.com/${source.creator_handle}/status/2105614023941316931`,tweetCreatedAt:'2026-09-28T07:00:00Z',lastSyncedAt:NOW,viewsCount:42}]}};
 fixtures[source.id]=`<main data-rank-page="true"></main><script>self.__next_f.push(${JSON.stringify([1,`6:${JSON.stringify(['$','$L39',null,data])}\n`])})</script>`;
}

for (const source of FEED_CHANNELS.filter(source=>source.creator_scope==='blog-feed')) {
 fixtures[source.id]=source.format==='atom'
  ? `<feed><link href="${source.home_url}" rel="alternate" type="text/html"/><entry><title>网页截图的具体步骤</title><link href="${source.allowed_article_origin}/screenshots" rel="alternate"/><summary>先打开截图工具，再点击保存。示例：说明网站按钮。</summary><published>2026-09-28T07:00:00.000Z</published></entry></feed>`
  : `<rss><channel><title>作者博客</title><link>${source.home_url}</link><item><title>网页截图的具体步骤</title><link>${source.allowed_article_origin}/screenshots</link><description>先打开截图工具，再点击保存。示例：说明网站按钮。</description><pubDate>Mon, 28 Sep 2026 07:00:00 GMT</pubDate></item></channel></rss>`;
}

for (const source of FEED_CHANNELS.slice(2).filter(source=>source.enabled!==false)) test(`${source.id}: read actual format, preserve evidence and fail closed on upstream format drift`,()=>{
 const [item]=convert(source);assert.ok(item.title);assert.ok(item.original_url.startsWith('https://'));assert.deepEqual(item.source_refs,[source.id]);assert.equal(item.evidence_ref,'evidence-'+source.id);assert.equal(item.captured_at,NOW);assert.equal(item.verification_status,'not_tested');
 assert.equal(item.updated_at,null);assert.ok(item.published_at!==NOW);assert.ok(!JSON.stringify(item).includes('not retained'));
 assert.throws(()=>convert(source,source.format==='public-json' ? '{}' : '<html>temporary failure</html>'));
 if (source.ranked) assert.ok(Number.isSafeInteger(item.source_rank));
});

test('36kr accepts article HTML inside a description and still rejects a challenge page',()=>{
  const source=FEED_CHANNELS.find(entry=>entry.id==='36kr');
  const raw=`<rss version="2.0"><channel><title>36氪</title><link>http://36kr.com</link><item><title>公开文章</title><link><![CDATA[https://36kr.com/p/123?f=rss]]></link><pubDate>2026-11-11 19:31:07  +0800</pubDate><description><![CDATA[<p class="image-wrapper"><!DOCTYPE html></p><p>来源摘要，提到 <!ENTITY example> 也不是文档声明。</p>]]></description></item></channel></rss>`;
  const [item]=convert(source, raw);
  assert.equal(item.original_url,'https://36kr.com/p/123?f=rss');
  assert.equal(item.title,'公开文章');
  assert.match(item.summary,/来源摘要/);
  assert.equal(item.source_refs[0],'36kr');
  assert.throws(()=>convert(source,'<!DOCTYPE html><html><script id="__waf_verification_challenge"></script><p>正在进行安全检测</p></html>'),/格式不正确/);
  assert.throws(()=>convert(source,'<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///secret">]><rss><channel><item><title>x</title><link>https://36kr.com/p/1</link></item></channel></rss>'),/格式不正确/);
});

test('Atom links accept arbitrary attribute order and omitted alternate rel without reading self or enclosure',()=>{
 const source=FEED_CHANNELS.find(s=>s.id==='producthunt');
 for (const link of ['<link href="https://example.com/page?a=1&amp;b=2" rel="alternate" type="text/html"/>',"<link type='text/html' href='https://example.com/page?a=1&amp;b=2'/>"]) {
  const [item]=convert(source,`<feed><entry><title>Title</title><link rel="self" href="https://example.com/feed"/><link rel="enclosure" href="https://example.com/video.mp4"/>${link}<summary>&lt;p&gt;Excerpt&lt;/p&gt;</summary></entry></feed>`);
  assert.equal(item.original_url,'https://example.com/page?a=1&b=2');assert.equal(item.summary,'Excerpt');
 }
 assert.throws(()=>convert(source,'<feed><entry><title>Title</title><link rel="self" href="https://example.com/feed"/></entry></feed>'));
});

test('YouTube reads channel-owned metadata only and cannot invent video engagement or transcripts',()=>{
 const source=FEED_CHANNELS.find(s=>s.id==='youtube-anthropic'),[item]=convert(source);
 assert.equal(item.link_kind,'video');assert.match(item.summary,/Learn a practical AI workflow/);assert.equal(item.published_at,'2026-09-28T07:00:00.000Z');assert.equal(item.source_item_time,'2026-09-29T07:00:00.000Z');
 assert.ok(item.unknowns.some(text=>text.includes('未观看视频或读取字幕')));assert.match(item.suggested_question,/原视频/);
 assert.equal(item.heat_label,null);assert.equal(item.source_rank,null);assert.ok(!JSON.stringify(item).includes('100000'));
 assert.throws(()=>convert(source,youtubeFixture('UCwrong-channel')),/频道不匹配/);
 assert.throws(()=>convert(source,'<!DOCTYPE feed [<!ENTITY secret SYSTEM "file:///secret">]>'+fixtures[source.id]));
});

test('YouTube channel identity accepts only the exact complete ID or its exact bare Atom form',()=>{
 // Bare IDs observed in the official Cloudflare-fetched Atom on 2026-10-02:
 // DeepMind: P7jMXSY2xbc3KCAE0MHQ-A; Anthropic: rDwWp7EBBv4NwvScIpBDOA.
 for (const source of FEED_CHANNELS.filter(s=>s.youtube_channel_id)) {
  const full=source.youtube_channel_id, bare=full.slice(2);
  for (const channelId of [full,bare]) assert.equal(convert(source,youtubeFixture(channelId))[0].link_kind,'video');
  for (const channelId of ['',bare.slice(1),bare.slice(0,-1),'X'+bare,bare+'X','prefix'+full,full+'suffix','uc'+bare]) {
   assert.throws(()=>convert(source,youtubeFixture(channelId)),/频道不匹配/);
  }
  assert.throws(()=>convert({...source,youtube_channel_id:bare},youtubeFixture(bare)),/频道不匹配/);
 }
});

test('official X placeholder is retired while public tweet and author sources remain configured',()=>{
 assert.equal(FEED_CHANNELS.some(source=>source.id==='x'),false);
 assert.equal(FEED_CHANNELS.filter(source=>source.sopilot_category).length,4);
 assert.equal(FEED_CHANNELS.filter(source=>source.format==='sopilot-author').length,4);
});

test('topic/search links stay typed, large topic IDs are exact and unsupported URLs cannot enter feed',()=>{
 const source=id=>FEED_CHANNELS.find(s=>s.id===id);
 assert.equal(convert(source('toutiao'))[0].original_url,'https://www.toutiao.com/trending/7690631904081117235/');
 assert.equal(convert(source('hackernews'))[0].link_kind,'discussion');assert.equal(convert(source('github-trending'))[0].repository_name,undefined,'Trending entry is not automatically a supported README research item');
 assert.equal(convert(source('zhihu'))[0].heat_label,'30 万热度');
 assert.throws(()=>convert(source('juejin'),JSON.stringify({err_no:403,data:[]})));
 assert.throws(()=>convert(source('zhihu'),JSON.stringify({data:[{target:{title_area:{text:'Bad'},link:{url:'javascript:alert(1)'}}}]})));
});

test('category filters include merged provenance; each hot source keeps its own order, not a cross-platform score',()=>{
 const item=(id,rank)=>({id,title:'AI',summary:'AI',source_refs:['zhihu'],source_rank:rank,captured_at:NOW});
 const one=item('a',2),two=item('b',1);
 assert.deepEqual(selectFeed([one,two],{interests:'AI 工具'},[],{rankSource:'zhihu'}).candidates.map(i=>i.id),['b','a']);
 const mixed={...one,source_refs:['github','zhihu'],source_links:[{source_id:'zhihu',source_rank:1},{source_id:'github',source_rank:null}]};
 assert.ok(matchesSource(mixed,'group:hot',FEED_CHANNELS));assert.ok(!matchesSource(mixed,'group:finance',FEED_CHANNELS));assert.ok(matchesSource(mixed,'github',FEED_CHANNELS));
 assert.equal(convert(FEED_CHANNELS.find(x=>x.id==='hackernews'))[0].published_at,null,'Ranked lists must not invent publication times');
});

test('expanded catalog migrates old cache without network, and new-source failure leaves old reading and user data independent',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'public-source-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 // Saved feed is a minimal previous release; browser collections are not owned by this service.
 const old={schema_version:'0.3',mode:'live',generated_at:NOW,items:[],source_buckets:{github:[]},sources:[{id:'github',status:'ok',last_success_at:NOW,next_allowed_at:'2026-10-01T00:00:00Z'}],sections:{daily:[],discover:[]},refresh:{status:'ok'}};
 await fs.writeFile(path.join(dir,'live-feed.json'),JSON.stringify(old));let calls=0;
 const service=new MultiFeedService({dataDir:dir,now:()=>new Date(NOW),fetchImpl:async url=>{calls++;
  if(String(url)==='https://hacker-news.firebaseio.com/v0/topstories.json') return new Response('[123]');
  if(String(url)==='https://hacker-news.firebaseio.com/v0/item/123.json') return new Response('{"id":123,"type":"story","title":"New tools"}');
  const source=FEED_CHANNELS.find(s=>s.feed_url===String(url));return new Response(fixtures[source?.id] || '',{status:source?.id==='thepaper' ? 503 : fixtures[source?.id] ? 200 : 403});}});
 assert.equal((await service.current()).sources.length,FEED_CHANNELS.length+1);assert.equal(calls,0);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'live-feed.json'))).sources.length,1);
 const result=await service.refresh();assert.equal(result.refresh.status,'partial');assert.equal(result.sources.find(x=>x.id==='github').group,'tech');assert.equal(result.sources.find(x=>x.id==='thepaper').status,'failed');assert.ok(result.items.length>=10);
 assert.equal(result.sources.some(source=>source.id==='x'),false);
 assert.deepEqual((await new MultiFeedService({dataDir:dir}).current()).items,result.items);
});

test('new rank and heat fields survive backup; malformed rank fields are rejected before display',()=>{
 const source=FEED_CHANNELS.find(s=>s.id==='zhihu'),item=mergeSourceItems({zhihu:convert(source)})[0];
 const local={saved_item_ids:[item.id],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{[item.id]:item}};
 const out=makeBackup(local,{items:[item]},'live');assert.equal(parseBackup(out.raw,'live').state.item_snapshots[item.id].source_rank,1);
 for (const value of ['<img onerror=alert(1)>',-1,1.5,Infinity]) {const bad=structuredClone(out.backup);bad.state.item_snapshots[item.id].source_links[0].source_rank=value; if(value!==Infinity) assert.throws(()=>parseBackup(JSON.stringify(bad),'live'));}
});
