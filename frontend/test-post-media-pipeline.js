import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePostImage} from './src/postMedia.js';
import {FEED_CHANNELS, normalizeSubscription, mergeSourceItems} from './feed-sources.js';
import {makePublicFeed} from './public-feed-data.js';
import {makeBackup, parseBackup} from './src/backup.js';
import {refreshPublicFeed} from './cloud-feed-service.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MultiFeedService} from './multi-feed-service.js';

const url='https://x.com/demo_author/status/2105614023941316931';
const image={url:'https://pbs.twimg.com/media/public_sample.jpg',kind:'photo',source_url:url};
const at='2026-10-09T01:00:00.000Z';
const source=FEED_CHANNELS.find(source=>source.id==='sopilot-ai');
const rows=()=>({id:source.channel,status:'success',items:[{title:'截图工具操作教程',url,summary:'1. 打开软件设置。\n2. 点击按钮保存图片。',post_image:image}]});
const item=()=>normalizeSubscription(rows(),source,at,'public-source-test').items[0];
const feed=items=>makePublicFeed({schema_version:'0.3',mode:'live',sources:[{...source,status:'ok',last_success_at:at}],items},{publishedAt:at});
const local=item=>({saved_item_ids:[item.id],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{[item.id]:item}});

test('post preview accepts observed photo/poster paths and canonically binds them to the same original post',()=>{
  assert.deepEqual(normalizePostImage(image,url),image);
  const mixed={...image,source_url:url.replace('demo_author','Demo_Author')};
  assert.deepEqual(normalizePostImage(mixed,url.replace('x.com','twitter.com')+'?utm_source=public'),image);
  const poster={...image,kind:'video_poster',url:'https://pbs.twimg.com/amplify_video_thumb/2105614023941316931/img/public_sample.jpg'};
  assert.deepEqual(normalizePostImage(poster,url),poster);
  const format={...image,url:'https://pbs.twimg.com/media/public_sample?format=png&name=small'};
  assert.deepEqual(normalizePostImage(format,url),format);
});

test('untrusted media cannot become a browser request or borrow a different post identity',()=>{
  const invalid=[null,[],{...image,source_url:url.replace(/1$/,'2')},{...image,source_url:'https://x.com/other/status/2105614023941316931'},
    {...image,url:'http://pbs.twimg.com/media/public_sample.jpg'},
    {...image,url:'https://pbs.twimg.com.evil.example/media/public_sample.jpg'},
    {...image,url:'https://pbs.twimg.com/profile_images/2105614023941316931/avatar.jpg'},
    {...image,url:'https://video.twimg.com/video.mp4'},
    {...image,url:'https://pbs.twimg.com/media/public_sample.svg'},
    {...image,url:'https://pbs.twimg.com/media/public_sample'},
    {...image,url:image.url+'?token=private'}, {...image,url:image.url+'?name=small&name=large'},
    {...image,url:'https://user:pass@pbs.twimg.com/media/public_sample.jpg'},
    {...image,url:'https://pbs.twimg.com:8443/media/public_sample.jpg'},
    {...image,url:image.url+'#fragment'}, {...image,url:image.url+'?format=svg'},
    {...image,kind:'video_poster'}, {...image,kind:'verified'}];
  for (const value of invalid) assert.equal(normalizePostImage(value,url),null,JSON.stringify(value));
});

test('normalization and public output preserve one optional preview without adopting extra fields',()=>{
  const raw=rows();raw.items[0].post_image={...image,private_note:'PRIVATE_CANARY'};
  const normalized=normalizeSubscription(raw,source,at,'public-source-test').items[0];
  assert.deepEqual(normalized.post_image,image);
  const published=feed([normalized]);
  assert.deepEqual(published.items[0].post_image,image);
  assert.equal(published.items[0].verification_status,'not_tested');
  assert.equal(JSON.stringify(published).includes('PRIVATE_CANARY'),false);
  const corrupt={...normalized,post_image:{...image,source_url:url.replace(/1$/,'2')}};
  assert.equal(feed([corrupt]).items[0].post_image,undefined);
  assert.equal(feed([{...normalized,link_kind:'article'}]).items[0].post_image,undefined);
});

test('public source text uses the existing backup credential guard without weakening it',()=>{
  const valid=item(),suspect={...valid,id:'news-bbbbbbbbbbbbbbbbbbbbbbbb',summary:'token: '+ 'x'.repeat(30)};
  const output=feed([valid,suspect]);
  assert.equal(output.items.length,1);assert.equal(output.items[0].id,valid.id);
  assert.equal(JSON.stringify(output).includes('x'.repeat(30)),false);
});

test('absent or malformed optional media never drops valid text or a readable post',()=>{
  for (const value of [undefined,null,{...image,url:'https://private.local/picture.jpg'}]) {
    const raw=rows();raw.items[0].post_image=value;
    const normalized=normalizeSubscription(raw,source,at,'public-source-test').items;
    assert.equal(normalized.length,1);assert.equal(normalized[0].post_image,undefined);
    assert.equal(feed(normalized).items[0].summary,raw.items[0].summary);
  }
});

test('same post dedup can retain the available image without mutating records or borrowing another post image',()=>{
  const one=item(),without={...one,source_refs:['sopilot-creators']};delete without.post_image;
  const before=structuredClone([one,without]);
  const merged=mergeSourceItems({first:[without],second:[one]});
  assert.equal(merged.length,1);assert.deepEqual(merged[0].post_image,image);
  assert.deepEqual([one,without],before);
  const wrong={...one,post_image:{...image,source_url:url.replace(/1$/,'2')}};
  assert.equal(mergeSourceItems({first:[without],second:[wrong]})[0].post_image,undefined);
});

test('saved optional media survives a restorable backup; invalid or unbound media is rejected',()=>{
  const post=feed([item()]).items[0];
  const {raw}=makeBackup(local(post),{items:[post]},'live');
  assert.deepEqual(parseBackup(raw,'live').state.item_snapshots[post.id].post_image,image);
  const backup=JSON.parse(raw);backup.state.item_snapshots[post.id].post_image.url='https://127.0.0.1/private';
  assert.throws(()=>parseBackup(JSON.stringify(backup),'live'),/帖子附图/);
  backup.state.item_snapshots[post.id].post_image={...image,extra:'not-public'};
  assert.throws(()=>parseBackup(JSON.stringify(backup),'live'),/帖子附图/);
  const legacy={...post};delete legacy.post_image;
  assert.doesNotThrow(()=>makeBackup(local(legacy),{items:[legacy]},'live'));
});

test('a failed source update retains the exact old preview and its original successful timestamp',async()=>{
  const previous=feed([item()]);
  const next=await refreshPublicFeed(previous,{definitions:[source],now:()=>new Date('2026-10-09T13:00:00Z'),retryDelayMs:0,
    fetchImpl:async()=>{throw Error('public network unavailable');}});
  assert.deepEqual(next.items.find(item=>item.link_kind==='post').post_image,image);
  assert.equal(next.sources.find(entry=>entry.id===source.id).last_success_at,at);
});

test('local source evidence preserves only the validated image attached to the main post',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'post-image-evidence-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const row={id:'2105614023941316931',text:'公开教程测试摘录。',screenName:'demo_author',authorName:'测试作者',sourceUrl:url,
    mediaUrls:[image.url,'https://video.twimg.com/video.mp4'],mediaTypes:['photo','video']};
  const props={locale:'zh',range:'24h',category:'AI',page:1,totalPages:1,risingTweets:[row],hotTweets:[]};
  const raw='<main data-rank-page="true"></main><script>self.__next_f.push('+JSON.stringify([1,'6:'+JSON.stringify(['$','$L39',null,props])+'\n'])+')</script>';
  const service=new MultiFeedService({dataDir:dir,newsChannels:[source],now:()=>new Date(at),fetchImpl:async()=>new Response(raw)});
  const result=await service.readNews({...source,status:'not_connected'});
  assert.equal(result.source.status,'ok');assert.deepEqual(result.items[0].post_image,image);
  const [name]=await fs.readdir(path.join(dir,'source-snapshots'));
  const evidence=JSON.parse(await fs.readFile(path.join(dir,'source-snapshots',name),'utf8'));
  assert.deepEqual(evidence.items[0].post_image,image);
  assert.equal(result.items[0].evidence_ref,name.replace(/\.json$/,''));
  assert.equal(JSON.stringify(evidence).includes('video.twimg.com'),false);
});
