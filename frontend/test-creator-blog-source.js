import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_BLOG_SOURCES, NEW_CREATOR_BLOG_SOURCES } from './creator-sources.js';
import { parseSubscription, normalizeSubscription, mergeSourceItems, sourceBucketFromItems } from './feed-sources.js';
import { makePublicFeed } from './public-feed-data.js';
import { refreshPublicFeed, mergePublicSourceResults } from './cloud-feed-service.js';
import { makeBackup, parseBackup } from './src/backup.js';
import { buildTopicMaterial, blankTopic } from './src/topicWorkspace.js';

const source=CREATOR_BLOG_SOURCES.find(s=>s.creator_handle==='vista8');
const at='2026-10-03T10:00:00.000Z';
const article=({title='把外文 PDF 整理成演示文稿',url=source.allowed_article_origin+'/pdf-to-slides',description='一次处理外文资料的实际操作案例。',body='<p>第一步：上传外文 PDF 文件。</p><p>第二步：打开工作区，然后输入网站需求，最后保存生成的演示文稿。</p><p>示例：一份产品说明整理成五页 PPT。</p>',published='Tue, 18 Aug 2026 00:00:00 GMT'}={}) => `<item><title>${title}</title><link>${url}</link><description><![CDATA[${description}]]></description><content:encoded><![CDATA[${body}]]></content:encoded><pubDate>${published}</pubDate></item>`;
const rss=(items=article(),channel=source.allowed_article_origin) => `<rss version="2.0"><channel><title>作者博客</title><link>${channel}</link>${items}</channel></rss>`;
const items=(raw=rss())=>normalizeSubscription(parseSubscription(raw,source),source,at,'rss-evidence').items;
const seed=()=>makePublicFeed({schema_version:'0.3',mode:'live',sources:[{...source,status:'ok',last_success_at:at}],items:mergeSourceItems({[source.id]:items()}),refresh:{new_item_ids:[]}}, {publishedAt:at});
const esor=NEW_CREATOR_BLOG_SOURCES.find(source=>source.creator_id==='creator-esorhuang');
const fqzlr=NEW_CREATOR_BLOG_SOURCES.find(source=>source.creator_id==='creator-fqzlr');
const creatorAtom=(def=esor,{url=def.allowed_article_origin+'/post',home=def.home_url,title='如何設定網頁工作流程教學',summary='公開訂閱摘要，介紹如何開啟工具整理資料與工作流程。',content='<p>第一步：開啟瀏覽器設定。</p><p>第二步：點擊按鈕，然後輸入提示詞，最後儲存檔案。</p><p>示例：整理工作資料。</p>'}={})=>`<feed><title>作者訂閱</title><link href="${home}" rel="alternate" type="text/html"/><entry><title>${title}</title><link href="${url}" rel="alternate" type="text/html"/><summary><![CDATA[${summary}]]></summary><content type="html"><![CDATA[${content}]]></content><published>2020-01-01T00:00:00.000Z</published></entry></feed>`;
const creatorRss=(def,{title='网页工作流程教程',url=def.allowed_article_origin+'/post',body='<p>第一步：打开网页设置。</p><p>第二步：点击保存，然后创建文件。</p><p>示例：整理笔记。</p>',description='公开摘要，介绍如何配置网页工作流程及操作案例。',published='Wed, 01 Jan 2020 00:00:00 GMT',category=''}={})=>`<rss><channel><link>${def.home_url}</link><item><title>${title}</title><link>${url}</link><description><![CDATA[${description}]]></description><content:encoded><![CDATA[${body}]]></content:encoded><pubDate>${published}</pubDate>${category ? `<category>${category}</category>` : ''}</item></channel></rss>`;
const creatorItems=(def,raw=def.format==='atom' ? creatorAtom(def) : creatorRss(def),capturedAt=at)=>normalizeSubscription(parseSubscription(raw,def),def,capturedAt,'synthetic:'+def.id).items;

test('three author-owned subscriptions carry fixed creator IDs without fabricated X handles',()=>{
  assert.equal(NEW_CREATOR_BLOG_SOURCES.length,3);
  for(const def of NEW_CREATOR_BLOG_SOURCES) {
    assert.equal(def.source_id,def.id);assert.equal(def.creator_handle,undefined);
    assert.deepEqual(def.allowed_channel_urls,[def.home_url]);
    const item=creatorItems(def)[0],publicFeed=makePublicFeed({schema_version:'0.3',mode:'live',
      sources:[{...def,status:'ok',last_success_at:at}],items:[item]}, {publishedAt:at});
    assert.equal(item.creator_id,def.creator_id);assert.equal(item.author_handle,undefined);
    assert.equal(publicFeed.items[0].creator_id,def.creator_id);assert.equal(publicFeed.items[0].author_handle,undefined);
    assert.equal(publicFeed.sources[0].creator_id,def.creator_id);
    assert.equal(publicFeed.items[0].published_at,'2020-01-01T00:00:00.000Z');
    const forged=makePublicFeed({schema_version:'0.3',mode:'live',sources:publicFeed.sources,
      items:[{...item,creator_id:'creator-other'}]}, {publishedAt:at}).items[0];
    assert.equal(forged.creator_id,undefined);assert.equal(forged.read_scope,undefined);
  }
});

test('author Atom checks channel and article identity, safely upgrades only configured same-host HTTP links',()=>{
  const item=creatorItems(esor,creatorAtom(esor,{home:'http://www.playpcesor.com/',url:'http://www.playpcesor.com/2026/09/workflow.html'}))[0];
  assert.equal(item.original_url,'https://www.playpcesor.com/2026/09/workflow.html');
  assert.equal(item.canonical_url,item.original_url);assert.equal(item.blog_method_hint,'steps-and-example');
  for(const home of ['https://other.example/','https://www.playpcesor.com/wrong/','https://www.playpcesor.com/?token=secret']) {
    assert.throws(()=>creatorItems(esor,creatorAtom(esor,{home})),/频道不匹配/);
  }
  for(const url of ['http://www.playpcesor.com:8080/post','http://playpcesor.com/post','https://other.example/post',
    'https://user:pass@www.playpcesor.com/post','https://www.playpcesor.com/feeds/posts/default','https://www.playpcesor.com/post?api_key=secret']) {
    assert.throws(()=>creatorItems(esor,creatorAtom(esor,{url})),/文章不匹配/);
  }
  assert.throws(()=>creatorItems(esor,'<!DOCTYPE feed [<!ENTITY secret SYSTEM "file:///private">]>'+creatorAtom()),/格式不正确/);
  const wrongRelation=creatorAtom().replace('rel="alternate"','rel="self"');
  assert.throws(()=>creatorItems(esor,wrongRelation),/频道不匹配/);
  const rssDef=NEW_CREATOR_BLOG_SOURCES.find(def=>def.format==='rss');
  assert.throws(()=>creatorItems(rssDef,creatorRss(rssDef,{url:rssDef.allowed_article_origin.replace('https:','http:')+'/post'})),/文章不匹配/);
});

test('original article href preserves slash, fragment and tracking while valid canonical identity stays independent',()=>{
  const original=source.allowed_article_origin+'/screenshot-guide/?utm_source=feed#steps',item=items(rss(article({url:original})))[0];
  assert.equal(item.original_url,original);assert.equal(item.canonical_url,source.allowed_article_origin+'/screenshot-guide');
  const publish=value=>makePublicFeed({schema_version:'0.3',mode:'live',sources:[{...source,status:'ok',last_success_at:at}],items:[value]}, {publishedAt:at}).items[0];
  const published=publish(item);assert.equal(published.original_url,original);assert.equal(published.canonical_url,item.canonical_url);
  const forged=publish({...item,canonical_url:'https://other.example/unrelated'});
  assert.equal(forged.original_url,original);assert.equal(forged.canonical_url,original,'unrelated supplied canonical falls back to the original href');
  const upgraded=creatorItems(esor,creatorAtom(esor,{url:'http://www.playpcesor.com/post/?utm_source=feed#steps'}))[0];
  assert.equal(upgraded.original_url,'https://www.playpcesor.com/post/?utm_source=feed#steps');
  assert.equal(upgraded.canonical_url,'https://www.playpcesor.com/post');
});

test('Atom content supplies only a bounded excerpt and method hint without leaking the full supplied body',()=>{
  const content='<script>PRIVATE_SCRIPT_CANARY</script><p>第一步：開啟瀏覽器設定。第二步：點擊按鈕，然後儲存檔案。示例：整理資料。</p>'
    +'<p>'+ '公開訂閱摘錄。'.repeat(200) +'</p><p>PRIVATE_FULL_BODY_CANARY</p>';
  const item=creatorItems(esor,creatorAtom(esor,{summary:'',content}))[0];
  assert.equal(item.summary.length,1000);assert.equal(item.excerpt_truncated,true);
  assert.ok(item.excerpt_original_length>1000);assert.equal(item.blog_method_hint,'steps-and-example');
  assert.doesNotMatch(JSON.stringify(item),/PRIVATE_(?:SCRIPT|FULL_BODY)_CANARY|<script|content:encoded/);
  const published=makePublicFeed({schema_version:'0.3',mode:'live',sources:[{...esor,status:'ok',last_success_at:at}],items:[item]}, {publishedAt:at});
  assert.equal(published.items[0].summary.length,1000);assert.doesNotMatch(JSON.stringify(published),/PRIVATE_(?:SCRIPT|FULL_BODY)_CANARY/);
});

test('author RSS excludes locked and sample notes before selecting thirty genuine latest publication dates',()=>{
  const rawEntries=Array.from({length:40},(_,index)=>{
    const date=new Date(Date.UTC(2025,0,index+1)).toUTCString();
    return creatorRss(fqzlr,{url:fqzlr.allowed_article_origin+'/posts/tech/article-'+index,published:date})
      .match(/<item>[\s\S]*<\/item>/)[0];
  }).join('');
  const filtered=[{title:'🔒 这是一个测试笔记',url:fqzlr.allowed_article_origin+'/posts/notes/locked'},
    {title:'测试1234',url:fqzlr.allowed_article_origin+'/posts/notes/test'},
    {title:'一条普通标题',url:fqzlr.allowed_article_origin+'/posts/cheshi0001/'},
    {title:'一条示例文章',url:fqzlr.allowed_article_origin+'/posts/example-category',category:'示例'}]
    .map(options=>creatorRss(fqzlr,{...options,published:'Tue, 01 Sep 2026 00:00:00 GMT'}).match(/<item>[\s\S]*<\/item>/)[0]).join('');
  const raw=`<rss><channel><link>${fqzlr.home_url}</link>${filtered}${rawEntries}</channel></rss>`,normalized=creatorItems(fqzlr,raw);
  assert.equal(normalized.length,30);assert.equal(normalized[0].original_url,fqzlr.allowed_article_origin+'/posts/tech/article-39');
  assert.equal(normalized.at(-1).original_url,fqzlr.allowed_article_origin+'/posts/tech/article-10');
  assert.ok(normalized.every(item=>item.captured_at===at && item.published_at.startsWith('2025-')));
  assert.ok(!normalized.some(item=>/🔒|测试1234|cheshi/.test(item.title+item.original_url)));
  const first=creatorRss(fqzlr,{url:fqzlr.allowed_article_origin+'/post?utm_source=feed'}).match(/<item>[\s\S]*<\/item>/)[0];
  const duplicate=creatorRss(fqzlr,{url:fqzlr.allowed_article_origin+'/post'}).match(/<item>[\s\S]*<\/item>/)[0];
  assert.equal(creatorItems(fqzlr,`<rss><channel><link>${fqzlr.home_url}</link>${first}${duplicate}</channel></rss>`).length,1);
});

test('merging only three genuinely captured subscriptions preserves every unrelated source and exact item evidence',()=>{
  const previous=seed(),copy=structuredClone(previous),publishedAt='2026-10-03T11:00:00.000Z';
  const results=NEW_CREATOR_BLOG_SOURCES.map(def=>({source:{...def,status:'ok',last_success_at:publishedAt},
    items:creatorItems(def,undefined,publishedAt)}));
  const next=mergePublicSourceResults(previous,results,{publishedAt});
  assert.deepEqual(previous,copy);assert.deepEqual(next.sources.find(def=>def.id===source.id),previous.sources[0]);
  assert.deepEqual(next.items.find(item=>item.id===previous.items[0].id),previous.items[0]);
  assert.equal(next.refresh.new_count,3);assert.ok(next.items.every(item=>item.published_at.startsWith('2020-') || item.published_at.startsWith('2026-08-')));
  const repeated=mergePublicSourceResults(next,results,{publishedAt});assert.equal(repeated.refresh.new_count,0);
  assert.ok(next.items.filter(item=>NEW_CREATOR_BLOG_SOURCES.some(def=>item.source_refs.includes(def.id))).every(item=>item.verification_status==='not_tested'));
});

test('new RSS and Atom source failures retain their previous article, source evidence and successful read time',async()=>{
  const attemptedAt='2026-10-03T11:00:00.000Z';
  for(const def of NEW_CREATOR_BLOG_SOURCES) {
    const previous=makePublicFeed({schema_version:'0.3',mode:'live',sources:[{...def,status:'ok',last_success_at:at}],
      items:mergeSourceItems({[def.id]:creatorItems(def)})}, {publishedAt:at}),copy=structuredClone(previous);
    for(const failure of ['403','empty','identity','timeout']) {
      const next=await refreshPublicFeed(previous,{definitions:[def],now:()=>new Date(attemptedAt),timeoutMs:6,retryDelayMs:0,
        fetchImpl:async(url,{signal})=>{
          if(new URL(url).hostname==='api.github.com' || failure==='403') return new Response('',{status:403});
          if(failure==='timeout') return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('stop','AbortError')),{once:true}));
          if(failure==='empty') return new Response(def.format==='atom' ? `<feed><link href="${def.home_url}" rel="alternate"/></feed>` : `<rss><channel><link>${def.home_url}</link></channel></rss>`);
          return new Response(def.format==='atom' ? creatorAtom(def,{url:'https://other.example/post'}) : creatorRss(def,{url:'https://other.example/post'}));
        }});
      assert.deepEqual(next.items,previous.items,failure+': '+def.id);
      const failed=next.sources.find(row=>row.id===def.id);
      assert.equal(failed.status,'failed');assert.equal(failed.last_success_at,at);assert.equal(failed.last_attempt_at,attemptedAt);
      assert.deepEqual(next.refresh.new_item_ids,[]);assert.deepEqual(previous,copy);
    }
  }
});

test('author RSS derives operation hint from supplied body but exports only subscription description',()=>{
  const raw=rss(article({body:'<script>PRIVATE_SCRIPT_CANARY</script><img src="https://example.com?token=PRIVATE_IMAGE_CANARY"><p>第一步：上传 PDF 文件。</p><p>第二步：点击保存，然后输入标题。</p><p>示例：整理产品说明。PRIVATE_BODY_CANARY</p>'}));
  const item=items(raw)[0];
  assert.equal(item.summary,'一次处理外文资料的实际操作案例。');assert.equal(item.blog_method_hint,'steps-and-example');
  assert.equal(item.read_scope,'author-blog-feed');assert.equal(item.author_handle,'vista8');assert.equal(item.author_name,'向阳乔木');
  assert.equal(item.published_at,'2026-08-18T00:00:00.000Z');assert.equal(item.captured_at,at);assert.equal(item.checked_at,undefined);
  assert.equal(item.link_kind,'article');assert.equal(item.verification_status,'not_tested');
  assert.doesNotMatch(JSON.stringify(item),/PRIVATE_(?:BODY|SCRIPT|IMAGE)_CANARY|content:encoded/);
  const published=seed().items[0];assert.equal(published.blog_method_hint,'steps-and-example');assert.equal(published.read_scope,'author-blog-feed');
  assert.ok(!JSON.stringify(published).includes('完整原文已读取'));
});

test('foreign channel, foreign article, credentials and mixed author links reject the source transaction',()=>{
  assert.throws(()=>items(rss(article(),'https://other.example')),/频道不匹配/);
  for(const url of ['https://other.example/post',source.allowed_article_origin+'/',source.allowed_article_origin+'/post?token=private','http://blog.qiaomu.ai/post','https://user:pass@blog.qiaomu.ai/post']) {
    assert.throws(()=>items(rss(article()+article({url}))),/文章不匹配/);
  }
  assert.throws(()=>items('<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///private">]>'+rss()),/格式不正确/);
});

test('news, unsupported broad review and promotions cannot become method hints just because author is known',()=>{
  assert.equal(items(rss(article({title:'一家工具公司完成融资',body:'<p>第一步：下载代码。</p><p>示例：发布会消息。</p>'})))[0].blog_method_hint,undefined);
  assert.equal(items(rss(article({title:'最近的项目感想',body:'<p>我在整理代码并思考工作流。</p>'})))[0].blog_method_hint,undefined);
  assert.equal(items(rss(article({body:'<p>第一步：下载插件。示例：私信我领取。</p>'})))[0].blog_method_hint,undefined);
  assert.equal(items(rss(article({title:'想法需要多少年验证？',body:'<p>选择数学作为研究方向，然后记录笔记。第一步是思考。</p><p>示例：一项理论任务。</p>'})))[0].blog_method_hint,undefined);
  assert.equal(items(rss(article({title:'代码正在变成没人能看懂的东西',body:'<p>生产问题出现后的第一步，是让机器读日志。</p><p>示例：行业任务与测试体系。</p>'})))[0].blog_method_hint,undefined);
});

test('bounded RSS description and thirty articles preserve their actual publication dates and truncation',()=>{
  const long='一份外文资料的导语。'.repeat(160),normalized=items(rss(Array.from({length:35},(_,i)=>article({url:source.allowed_article_origin+'/post-'+i,description:long,published:i ? 'not-a-date' : undefined})).join('')));
  assert.equal(normalized.length,30);assert.equal(normalized[0].summary.length,1000);assert.equal(normalized[0].excerpt_truncated,true);
  assert.equal(normalized[0].excerpt_original_length,long.length);assert.equal(normalized[1].published_at,null);
  assert.throws(()=>items(rss('')),/没有可用条目/);
});

test('dedup and restored buckets cannot give an unrelated source author blog scope or an operation hint',()=>{
  const item=items()[0],other={...item,source_refs:['sspai'],read_scope:undefined,blog_method_hint:undefined,summary:'其他订阅摘要'};
  const merged=mergeSourceItems({other:[other],blog:[item]});assert.equal(merged.length,1);assert.equal(merged[0].summary,item.summary);
  const restored=sourceBucketFromItems(merged,'sspai')[0];assert.equal(restored.read_scope,undefined);assert.equal(restored.blog_method_hint,undefined);
  const own=sourceBucketFromItems(merged,source.id)[0];assert.equal(own.read_scope,'author-blog-feed');assert.equal(own.blog_method_hint,'steps-and-example');
  assert.equal(merged[0].source_links.length,2);
});

test('blog metadata survives public sanitizer and collection backup without becoming a user confirmation',()=>{
  const feed=seed(),item=feed.items[0];
  const state={saved_item_ids:[item.id],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{[item.id]:item}};
  const result=parseBackup(makeBackup(state,feed,'live').raw,'live').state.item_snapshots[item.id];
  assert.equal(result.read_scope,'author-blog-feed');assert.equal(result.author_handle,'vista8');assert.equal(result.summary,item.summary);
  assert.equal(result.published_at,item.published_at);assert.equal(result.verification_status,'not_tested');
  const exported=buildTopicMaterial({...blankTopic(),id:'blog-topic',title:'整理外文材料',created_at:at,updated_at:at,materials:[{item:result,note:'先读原文，再决定是否尝试',added_at:at}]});
  assert.match(exported,/作者博客订阅/);assert.match(exported,/@vista8/);assert.match(exported,/未核对原文全文或实测/);
  assert.ok(exported.includes(result.original_url));assert.ok(exported.includes(result.published_at));
});

test('a mismatched fresh blog feed keeps previous article, source success time and evidence',async()=>{
  const before=seed(),old=before.items[0];
  const next=await refreshPublicFeed(before,{definitions:[source],now:()=>new Date('2026-10-03T10:15:00Z'),retryDelayMs:0,fetchImpl:async url=>{
    if(String(url)===source.feed_url) return new Response(rss(article(),'https://other.example'));
    return new Response('not found',{status:404});
  }});
  assert.equal(next.sources.find(s=>s.id===source.id).status,'failed');assert.equal(next.sources.find(s=>s.id===source.id).last_success_at,at);
  assert.equal(next.items[0].id,old.id);assert.equal(next.items[0].summary,old.summary);assert.equal(next.items[0].captured_at,old.captured_at);
});
