import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSourceHealth } from './src/sourceBoard.js';
import { selectHomeSearch, renderFeedSearchResults } from './src/feedSearchView.js';
import { selectPostStream } from './src/postStream.js';
import { makePublicFeed } from './public-feed-data.js';
import { normalizeRepositories } from './repository-normalize.js';

const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const app=()=>({escapeHtml:escape,safeUrl:value=>value,formatTime:value=>value,feedSearchQuery:'工具',boardGroup:'all'});
const source={id:'sopilot-ai',name:'AI 榜',link_kind:'post',kind:'aggregator',status:'ok',home_url:'https://sopilot.net/zh/rank/tweets'};
const post=(id,summary)=>({id,title:'工具介绍',summary,link_kind:'post',source_refs:[source.id],original_url:`https://x.com/example/status/${id}`,canonical_url:`https://x.com/example/status/${id}`,content_status:'excerpt_only',captured_at:'2026-10-08T13:00:00Z'});
const state=items=>({mode:'live',sources:[source],allItems:items,hiddenItemIds:new Set(),savedItemIds:new Set(),archivedItemIds:new Set(),topics:[],refresh:{new_item_ids:[]}});

test('board and search fold the same promotion without modifying any original or existing saved record',()=>{
  const good=post('100','打开工具设置，配置快捷键。收费版价格未核对。'),promo=post('101','关注转发抽奖送软件工具周边，评论参与。');
  const input=state([good,promo]);input.savedItemIds.add(promo.id);const before=structuredClone(input),view=app();
  const stream=selectPostStream(input),search=selectHomeSearch(view,input);
  assert.equal(stream.foldedCount,1);assert.equal(search.foldedCount,1);assert.deepEqual(search.items,[good]);
  const hidden=renderFeedSearchResults(view,input,search);assert.match(hidden,/查看折叠的 1 条推文/);assert.doesNotMatch(hidden,/id="feed-search-result-101"/);
  view.feedSearchShowFolded=true;const restored=selectHomeSearch(view,input),html=renderFeedSearchResults(view,input,restored);
  assert.equal(restored.items[1],promo);assert.match(html,/重新折叠 1 条推文/);assert.match(html,/规则提示，可能误筛/);
  assert.match(html,/https:\/\/x.com\/example\/status\/101/);assert.match(html,/data-item-id="101" aria-pressed="true"/);
  assert.equal(view.feedSearchQuery,'工具');assert.deepEqual(input,before);
});

test('an all-folded search keeps a recovery button and manual material never becomes a public promotion verdict',()=>{
  const promo=post('200','评论关键词“工具”私信我领取软件安装包。');const input=state([promo]),view=app();
  const result=selectHomeSearch(view,input);assert.equal(result.items.length,0);assert.equal(result.foldedCount,1);
  assert.match(renderFeedSearchResults(view,input,result),/feed-search-fold-toggle/);
  view.feedSearchShowFolded=true;assert.equal(selectHomeSearch(view,input).items[0],promo);
  input.allItems=[{...promo,origin:'user_added'}];assert.equal(selectPostStream(input).foldedCount,0);
});

test('paused author-only posts stay out of search while category copies and unknown authors remain available',()=>{
  const author={...source,id:'sopilot-author-example',creator_handle:'example'},unknown={...source,id:'sopilot-author-unknown'};
  const known=post('250','工具使用教程'),category=post('251','工具配置教程'),other=post('252','工具安装教程');
  known.source_refs=[author.id];category.source_refs=[author.id,source.id];other.source_refs=[unknown.id];
  const input=state([known,category,other]);input.sources=[source,author,unknown];input.creatorCatalog=[{id:'example',handle:'example',source_id:author.id,enabled_by_default:true}];input.creatorPreferences={example:{enabled:false}};
  const selected=selectHomeSearch(app(),input);assert.deepEqual(selected.items,[category,other]);assert.equal(selectPostStream(input).originalPostCount,2);
  input.creatorPreferences.example.enabled=true;assert.equal(selectHomeSearch(app(),input).items.length,3);
});

test('source health explains old content and real dates without exposing exception messages or inventing old failure counts',()=>{
  const input=state([post('300','工具使用步骤')]);input.sources=[{...source,status:'failed',read_error:'TimeoutError',last_attempt_at:'2026-10-08T13:00:00Z',last_success_at:'2026-10-07T01:00:00Z',message:'token=private-secret'}];
  const before=structuredClone(input),html=renderSourceHealth(app(),input);
  assert.match(html,/1 条旧内容仍可阅读/);assert.match(html,/这次读取超过等待时间/);assert.match(html,/连续次数尚未记录/);
  assert.match(html,/2026-10-07T01:00:00Z/);assert.match(html,/2026-10-08T13:00:00Z/);assert.doesNotMatch(html,/private-secret|token=/);
  input.sources[0].consecutive_failures=2;assert.match(renderSourceHealth(app(),input),/连续 2 次未更新/);
  input.sources[0].read_error='token=private-secret';assert.match(renderSourceHealth(app(),input),/这次没有读到可用资料/);
  assert.deepEqual(input.allItems,before.allItems);
});

test('public health publishing is a strict allowlist and missing legacy fields stay unknown',()=>{
  const feed={schema_version:'0.3',mode:'live',sources:[{id:'github',status:'failed',consecutive_failures:2,last_failure_at:'2026-10-08T13:00:00Z',exception:'private-secret'}],items:normalizeRepositories([{id:123,full_name:'example/tool',html_url:'https://github.com/example/tool',description:'Example tool',pushed_at:'2026-10-07T01:00:00Z',stargazers_count:100}], '2026-10-08T13:00:00Z','test-evidence')};
  const published=makePublicFeed(feed).sources.find(source=>source.id==='github');assert.equal(published.consecutive_failures,2);assert.equal(published.last_failure_at,'2026-10-08T13:00:00.000Z');assert.ok(!('exception' in published));
  for (const invalid of [-1,1.5,'2',null]) {feed.sources[0].consecutive_failures=invalid;assert.ok(!('consecutive_failures' in makePublicFeed(feed).sources[0]));}
  delete feed.sources[0].consecutive_failures;feed.sources[0].last_failure_at='not a date';const old=makePublicFeed(feed).sources[0];assert.ok(!('consecutive_failures' in old));assert.ok(!('last_failure_at' in old));
});
