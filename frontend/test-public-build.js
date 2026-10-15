import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makePublicFeed, publicUrl, buildPublic, PUBLIC_FILES, PUBLIC_TRIAL_FILES } from './public-build.mjs';
import { PRIVATE_CONTENT } from './public-feed-data.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { renderSourceBoard } from './src/sourceBoard.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const captured='2026-10-01T01:00:00Z', published='2026-10-01T02:00:00Z';
const base=()=>({schema_version:'0.3',mode:'live',profile:{interests:'PRIVATE_CANARY'},sources:[{id:'github',status:'ok',last_success_at:captured,message:'PRIVATE_CANARY'}],
  items:[{id:'github-1',title:'Public title',summary:'Public author description',source_refs:['github'],original_url:'https://github.com/example/tool',captured_at:captured,
    origin:'upstream',evidence_ref:'PRIVATE_CANARY',question:'PRIVATE_CANARY',repository_guide:{summary:'私人工作总结',basis:'readme'},alias_ids:['manual-secret','github-2'],
    source_links:[{source_id:'github',url:'https://github.com/example/tool',evidence_ref:'PRIVATE_CANARY',captured_at:captured}]}],
  followups:[{question:'PRIVATE_CANARY'}],source_buckets:{private:'PRIVATE_CANARY'},refresh:{new_item_ids:['github-1','private-id']}});

test('public snapshot excludes private records and preserves provenance/time without assuming tests passed',()=>{
  const input=base(),original=structuredClone(input);
  input.items.push({...input.items[0],id:'github-3',origin:'user_added',title:'PRIVATE_CANARY'});
  input.sources.push({id:'private-source',home_url:'http://localhost:3000',name:'PRIVATE_CANARY'});
  input.sources.push({id:'x',name:'X / Twitter',enabled:false,status:'not_connected',home_url:'https://x.com'});
  const cache={entries:{'example/tool':{summary:'整理公开资料的小工具。',fingerprint:createHash('sha256').update(input.items[0].summary).digest('hex'),recorded_at:captured}}};
  const out=makePublicFeed(input,{cache,publishedAt:published});
  assert.equal(out.items.length,1);assert.equal(out.sources.length,1);
  assert.equal(out.sources.some(source=>source.id==='x'),false,'an old public snapshot cannot publish the retired panel');
  assert.equal(out.items[0].repository_guide.basis,'description');assert.equal(out.items[0].verification_status,'not_tested');
  assert.equal(Date.parse(out.items[0].captured_at),Date.parse(captured));assert.equal(out.publication.published_at,'2026-10-01T02:00:00.000Z');
  assert.deepEqual(out.items[0].alias_ids,['github-2']);assert.deepEqual(out.refresh.new_item_ids,['github-1']);
  assert.equal(out.profile.interests,'');assert.ok(!JSON.stringify(out).includes('PRIVATE_CANARY'));
  assert.deepEqual(input.items[0],original.items[0]);assert.ok(!('evidence_ref' in out.items[0]));
});

test('unsafe URLs and private sources cannot become public links',()=>{
  for(const url of ['file:///private/note','http://127.0.0.1/test','http://2130706433/test','http://192.168.1.1/','http://[::1]/','https://user:pass@site.example','https://site.example?api_key=private','https://notes.local/'])assert.equal(publicUrl(url),null,url);
  assert.equal(publicUrl('https://fda.gov/news'),'https://fda.gov/news');
  const input=base();input.items[0].original_url='http://localhost:3000/private';
  assert.throws(()=>makePublicFeed(input),/没有可公开/);
});

test('stale translations and personal README reports are not reused in public introductions',()=>{
  const input=base(),out=makePublicFeed(input,{cache:{entries:{'example/tool':{summary:'私人工作总结',fingerprint:'old',recorded_at:captured}}}});
  assert.equal(out.items[0].repository_guide,undefined);
});

test('public high-risk article URLs are not credentials, while actual key prefixes still match at separators',()=>{
  const input=base();
  input.items[0]={...input.items[0],id:'news-aaaaaaaaaaaaaaaaaaaaaaaa',source_refs:['wired'],
    title:'公开研究报道',summary:'公开文章的标题线索；未读取完整正文。',
    original_url:'https://www.wired.com/story/trillium-labs-wants-to-do-high-risk-ai-research-in-the-open/',
    source_links:[]};
  input.sources=[{id:'wired',status:'ok',last_success_at:captured}];
  const output=makePublicFeed(input,{publishedAt:published});
  assert.equal(output.items.length,1);assert.equal(output.items[0].original_url,input.items[0].original_url);
  assert.equal(PRIVATE_CONTENT.test(JSON.stringify(output)),false);
  for(const credential of ['sk-'+ 'x'.repeat(24),'ghp_'+ 'x'.repeat(24),'github_pat_'+ 'x'.repeat(24),'Bearer '+ 'x'.repeat(24)]) {
    for(const prefix of ['', 'key=', '"', '\n', '_']) assert.equal(PRIVATE_CONTENT.test(prefix+credential),true,prefix+credential.slice(0,8));
  }
  for(const privateValue of ['/Users/private/note','file:///private/note','-----BEGIN PRIVATE KEY-----']) {
    assert.equal(PRIVATE_CONTENT.test(privateValue),true);
  }
});

test('allowlist build accepts the public WIRED URL but rejects real keys and preserves its last clean build',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'feed-public-credential-boundary-'));
  try{
    await fs.cp(here,path.join(tmp,'frontend'),{recursive:true});await fs.mkdir(path.join(tmp,'data'));
    await fs.writeFile(path.join(tmp,'THIRD_PARTY_NOTICES.md'),'Public third party notice');
    const input=base();
    input.items[0]={...input.items[0],id:'news-aaaaaaaaaaaaaaaaaaaaaaaa',source_refs:['wired'],
      title:'公开研究报道',summary:'公开文章的标题线索；未读取完整正文。',
      original_url:'https://www.wired.com/story/trillium-labs-wants-to-do-high-risk-ai-research-in-the-open/',source_links:[]};
    input.sources=[{id:'wired',status:'ok',last_success_at:captured}];
    await fs.writeFile(path.join(tmp,'data/live-feed.json'),JSON.stringify(input));
    const result=await buildPublic({projectRoot:tmp,publishedAt:published});
    const clean=await fs.readFile(path.join(result.directory,'data/public-feed.json'),'utf8');
    assert.equal(JSON.parse(clean).items[0].original_url,input.items[0].original_url);
    for(const credential of ['sk-'+ 'x'.repeat(24),'ghp_'+ 'x'.repeat(24),'Bearer '+ 'x'.repeat(24)]) {
      const secret=structuredClone(input);secret.items[0].summary='不要发布这个测试凭据：'+credential;
      await fs.writeFile(path.join(tmp,'data/live-feed.json'),JSON.stringify(secret));
      await assert.rejects(buildPublic({projectRoot:tmp,publishedAt:published}),/私人路径或疑似凭据|疑似含有密码或密钥/);
      assert.equal(await fs.readFile(path.join(result.directory,'data/public-feed.json'),'utf8'),clean);
    }
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('allowlist build cannot publish extra project files and a failed audit retains the previous output',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'feed-public-build-'));
  try{
    await fs.cp(here,path.join(tmp,'frontend'),{recursive:true});await fs.mkdir(path.join(tmp,'data'));
    await fs.mkdir(path.join(tmp,'data/research/jobs'),{recursive:true});
    await fs.writeFile(path.join(tmp,'data/research/jobs/private.json'),'PRIVATE_CANARY');
    await fs.writeFile(path.join(tmp,'frontend/private.txt'),'PRIVATE_CANARY');
    await fs.writeFile(path.join(tmp,'THIRD_PARTY_NOTICES.md'),'Public third party notice');
    await fs.writeFile(path.join(tmp,'data/live-feed.json'),JSON.stringify(base()));
    const result=await buildPublic({projectRoot:tmp,publishedAt:published});
    const list=await fs.readdir(result.directory,{recursive:true});
    const files=list.filter(name=>PUBLIC_FILES.includes(name.replaceAll(path.sep,'/')));
    assert.equal(files.length,PUBLIC_FILES.length);
    for(const file of files)assert.ok(!(await fs.readFile(path.join(result.directory,file),'utf8')).includes('PRIVATE_CANARY'),file);
    await assert.rejects(fs.stat(path.join(result.directory,'serve.js')));await assert.rejects(fs.stat(path.join(result.directory,'private.txt')));
    await assert.rejects(fs.stat(path.join(result.directory,'review-admin.html')));
    await assert.rejects(fs.stat(path.join(result.directory,'local-review.js')));
    await assert.rejects(fs.stat(path.join(result.directory,'src/reviewAdminPage.js')));
    assert.match(await fs.readFile(path.join(result.directory,'src/siteConfig.js'),'utf8'),/true/);
    const secret=base();secret.items[0].summary='/Users/private/work/secret';await fs.writeFile(path.join(tmp,'data/live-feed.json'),JSON.stringify(secret));
    await assert.rejects(buildPublic({projectRoot:tmp}),/私人路径或疑似凭据/);
    const kept=JSON.parse(await fs.readFile(path.join(result.directory,'data/public-feed.json'),'utf8'));assert.equal(kept.items[0].summary,'Public author description');
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('public collections remain local through refresh/errors and no AI endpoints are requested',async()=>{
  const store=new Map(),calls=[],feed=makePublicFeed(base());
  globalThis.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)};
  globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>structuredClone(feed)};};
  const adapter=new FeedDataAdapter({publicPreview:true});await adapter.loadFeed();adapter.setSaved('github-1',true);
  const task=adapter.saveFollowupDraft('github-1','请根据原文整理步骤，不要补造实测。');
  const topic=adapter.createTopic({title:'公开来源主题',goal:'比较工具'},'github-1');
  assert.match(adapter.exportTopic(topic.id),/example\/tool/);
  assert.match(adapter.createBackup().raw,/公开来源主题/);
  await assert.rejects(adapter.startResearch(task.id),/不会连接/);await adapter.syncResearch();
  assert.equal(calls.length,1);assert.equal(adapter.getState().followups[0].status,'draft');
  assert.match(await adapter.refreshFeed(),/不实时采集/);assert.equal(adapter.getState().savedItems.length,1);
  assert.ok(calls.every(call=>call.url==='/data/public-feed.json' && !call.opts.method));
  const reload=new FeedDataAdapter({publicPreview:true});await reload.loadFeed();assert.equal(reload.getState().savedItems.length,1);
  globalThis.fetch=async()=>{throw Error('offline');};await assert.rejects(reload.refreshFeed(),/offline/);
  assert.equal(reload.getState().savedItems.length,1);assert.match(reload.exportFollowupText(task.id),/example\/tool/);
});

test('public source board offers original links and local collections rather than site-owner AI controls',()=>{
  const feed=makePublicFeed(base()),state={...feed,publicPreview:true,allItems:feed.items,hiddenItemIds:new Set(),savedItemIds:new Set(),archivedItemIds:new Set(),topics:[]};
  const app={escapeHtml:v=>String(v||''),safeUrl:v=>v,formatTime:v=>v,sourceLimits:{},boardGroup:'all'};
  const html=renderSourceBoard(app,state);assert.match(html,/查看更新/);assert.match(html,/到项目页读完整说明/);
  assert.ok(!html.includes('repository-intros-btn'));assert.ok(!html.includes('让 AI 读完整说明'));
  assert.match(html,/headline-save/);
});


test('source failures show useful public reasons while retaining captured content and dates',()=>{
  for(const code of [412,419,500,404]) {
    const input=base();Object.assign(input.sources[0],{status:'failed',read_error:`upstream ${code}`,last_attempt_at:published});
    const out=makePublicFeed(input,{publishedAt:published});
    assert.equal(out.items.length,1);assert.equal(out.items[0].captured_at,new Date(captured).toISOString());
    assert.equal(out.sources[0].last_success_at,new Date(captured).toISOString());
    assert.match(out.sources[0].message,code>=500 ? /原站这次返回错误/ : code===404 ? /公开订阅暂时不可用/ : /暂时不允许/);
    assert.equal(out.sources[0].read_error,`upstream ${code}`);
  }
});


test('public trial publish list contains only the synthetic case page and its two media files',()=>{
  assert.deepEqual(PUBLIC_TRIAL_FILES,['trials/ffmpeg-frame-20261003/index.html','trials/ffmpeg-frame-20261003/input.mp4','trials/ffmpeg-frame-20261003/frame.jpg']);
  for(const file of PUBLIC_TRIAL_FILES) assert.ok(PUBLIC_FILES.includes(file));
  assert.ok(!PUBLIC_FILES.some(file=>/report\.json|run\.py|raw|logs|trial.*README/i.test(file)));
});
