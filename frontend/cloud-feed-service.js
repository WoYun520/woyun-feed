import { createHash } from 'node:crypto';
import { FEED_CHANNELS, parseSubscription, normalizeSubscription, mergeSourceItems, sourceLinkIdentity, sourceBucketFromItems } from './feed-sources.js';
import { normalizeRepositories } from './repository-normalize.js';
import { makePublicFeed, publicUrl, PRIVATE_CONTENT } from './public-feed-data.js';
import { attachKosxApproved } from './kosx-public-posts.js';
import { refreshKosxPoolCache } from './kosx-pool-cache.js';
import { readHackerNewsApi } from './hackernews-source-reader.js';
import { readSopilotRank } from './sopilot-source-reader.js';
import { readSopilotAuthor } from './sopilot-author-reader.js';
import { createSourceFetch, publicRetryBudget, publicRequestPlan } from './source-retry.js';

export const PUBLIC_FEED_KEY = 'public-feed:current:v1';
export const SCHEDULE_LABEL = '每天 09:00、21:00（北京时间）';
const github = {id:'github',name:'GitHub 小型工具',kind:'repository',group:'tech',home_url:'https://github.com/topics/productivity'};
const sha = text => createHash('sha256').update(text || '').digest('hex');

// Fixed public sources only. No caller-supplied URLs, cookies, user notes or private AI tasks.
export async function readBoundedText(response, maxBytes = 2 * 1024 * 1024) {
  if (Number(response.headers.get('content-length')) > maxBytes) {await response.body?.cancel().catch(()=>{});throw Error('oversize');}
  const reader=response.body.getReader(), chunks=[]; let length=0;
  try {
    for (;;) { const {done,value}=await reader.read(); if (done) break;
      length+=value.byteLength; if(length>maxBytes) throw Error('oversize'); chunks.push(value);
    }
  } catch(error) { await reader.cancel().catch(()=>{}); throw error; }
  const bytes=new Uint8Array(length); let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}

function reusedGuides(previous) {
  const entries={};
  for(const item of previous.items || []) {
    const guide=item.repository_guide;
    if(item.repository_name && guide?.basis==='description' && guide.verification==='not_tested') entries[item.repository_name.toLowerCase()]={
      summary:guide.summary,fingerprint:sha(item.summary?.slice(0,1000)),recorded_at:guide.recorded_at
    };
  }
  return {entries};
}

function retainedBucket(previous, id) {
  return sourceBucketFromItems(previous.items || [],id);
}

function successfulSourceHealth(previous) {
  // Missing counters in an older snapshot do not imply a failure history.
  const lastFailureAt=previous?.last_failure_at;
  return {consecutive_failures:0,
    ...(typeof lastFailureAt==='string' && Number.isFinite(Date.parse(lastFailureAt)) ? {last_failure_at:lastFailureAt} : {})};
}

function failedSourceHealth(previous, failedAt) {
  const count=Number.isSafeInteger(previous?.consecutive_failures) && previous.consecutive_failures>=0
    ? previous.consecutive_failures : 0;
  return {consecutive_failures:Math.min(count+1,Number.MAX_SAFE_INTEGER),last_failure_at:failedAt};
}

// Maintenance can add genuinely captured new sources without refetching or
// changing any other source. This helper has no network or storage side effects.
export function mergePublicSourceResults(previous, results, {publishedAt=new Date().toISOString()}={}) {
  if(!Array.isArray(previous?.items) || !Array.isArray(previous?.sources) || !Array.isArray(results) || !results.length) throw Error('invalid public source update');
  const definitions=new Map([github,...FEED_CHANNELS].map(def=>[def.id,def])), replaced=new Set();
  const sources=structuredClone(previous.sources), buckets=Object.fromEntries(sources.map(source=>[source.id,retainedBucket(previous,source.id)]));
  for(const result of results) {
    const def=definitions.get(result?.source?.id), at=result?.source?.last_success_at;
    if(!def || def.enabled===false || replaced.has(def.id) || result.source.status!=='ok' || !Number.isFinite(Date.parse(at)) || !Array.isArray(result.items) || (!result.items.length && def.format!=='sopilot-author')
      || result.items.some(item=>item.source_refs?.length!==1 || item.source_refs[0]!==def.id || !publicUrl(item.original_url))) throw Error('invalid public source update');
    const index=sources.findIndex(entry=>entry.id===def.id);
    const source={...def,status:'ok',last_success_at:at,last_attempt_at:result.source.last_attempt_at || at,
      ...successfulSourceHealth(index<0 ? null : sources[index])};
    if(index<0) sources.push(source);else sources[index]=source;
    buckets[def.id]=result.items;replaced.add(def.id);
  }
  const items=mergeSourceItems(buckets), seen=new Set(previous.items.map(item=>sourceLinkIdentity(item.original_url) || item.id));
  const input={schema_version:previous.schema_version,mode:'live',sources,items,
    refresh:{status:'ok',last_attempt_at:publishedAt,new_item_ids:items.filter(item=>!seen.has(sourceLinkIdentity(item.original_url) || item.id)).map(item=>item.id)}};
  const output=makePublicFeed(input,{cache:reusedGuides(previous),publishedAt,automaticUpdate:previous.publication?.automatic_update===true});
  if([...replaced].some(id=>definitions.get(id).format!=='sopilot-author' && !output.items.some(item=>item.source_refs.includes(id)))) throw Error('no valid public source items');
  output.publication.kind='public-snapshot'; // A maintenance publication, not an observed Cron execution.
  if(PRIVATE_CONTENT.test(JSON.stringify(output))) throw Error('public audit failed');
  return output;
}

export async function refreshPublicFeed(previous, {fetchImpl=fetch,now=()=>new Date(),definitions=FEED_CHANNELS,timeoutMs=10000,retryDelayMs=200}={}) {
  const attemptedAt=now().toISOString(), definitionsAll=[github,...definitions], results=[];
  const requestPlan=publicRequestPlan(definitions),retryBudget=publicRetryBudget(definitions,requestPlan);
  let cursor=0;
  async function read(def) {
    const old=previous.sources.find(s=>s.id===def.id) || {status:'not_connected',last_success_at:null};
    if(def.enabled===false) return {source:{...def,status:'not_connected',last_success_at:null},items:[],success:false};
    const sourceTimeoutMs=def.format==='hackernews-api' ? 20000 : def.sopilot_category ? Math.min(timeoutMs*2,20000) : timeoutMs;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('Public source request timed out.','TimeoutError')),sourceTimeoutMs);
    const fetchSource=createSourceFetch(fetchImpl,{deadline:Date.now()+sourceTimeoutMs,
      // A slow first read needs its actual source budget. Restarting it after
      // five seconds never helps a page that consistently takes six seconds.
      // Two-page ranks share the source deadline; HN keeps its detail budget.
      attemptTimeoutMs:def.format==='hackernews-api' ? 1800 : def.sopilot_category ? sourceTimeoutMs/2 : sourceTimeoutMs,retryDelayMs,retryBudget});
    let observedChannelId=null;
    try {
      let endpoint=def.feed_url;
      if(def.id==='github') {
        const since=new Date(now().getTime()-180*86400000).toISOString().slice(0,10);
        const url=new URL('https://api.github.com/search/repositories');
        url.search=new URLSearchParams({q:`topic:productivity stars:100..5000 archived:false fork:false pushed:>=${since}`,sort:'updated',order:'desc',per_page:'30'}).toString();
        endpoint=url.href;
      }
      if(!publicUrl(endpoint)) throw Error('invalid source');
      const options={signal:controller.signal,redirect:'manual',headers:{
        Accept:def.id==='github' ? 'application/vnd.github+json' : 'application/rss+xml, application/atom+xml, application/xml, application/json, text/html',
        'User-Agent':'PersonalFeed-public/0.22 (+https://woyun-feed-preview.woyun520.workers.dev/)',
        ...(def.id==='github' ? {'X-GitHub-Api-Version':'2022-11-28'} : {})
      }};
      let raw, body;
      if(def.format==='hackernews-api') body=await readHackerNewsApi(def,{fetchImpl:fetchSource,maxItems:requestPlan.hnMaxItems,...options});
      else if(def.format==='sopilot-author') body=await readSopilotAuthor(def,{fetchImpl:fetchSource,...options});
      else if(def.sopilot_category) body=await readSopilotRank(def,{fetchImpl:fetchSource,...options,readText:readBoundedText});
      else {
      const response=await fetchSource(endpoint,options);
      if(!response.ok) throw Error('upstream '+response.status);
      raw=await readBoundedText(response);
      }
      const capturedAt=now().toISOString();
      if(def.youtube_channel_id) {
        const reported=raw.match(/<yt:channelId>([^<]+)<\/yt:channelId>/i)?.[1]?.trim();
        if(/^(?:UC)?[A-Za-z0-9_-]{22}$/.test(reported || '')) observedChannelId=reported;
      }
      let items;
      if(def.id==='github') {
        const data=JSON.parse(raw);
        if(!Array.isArray(data.items) || data.incomplete_results) throw Error('incomplete');
        items=normalizeRepositories(data.items.slice(0,30),capturedAt,'public-fetch:'+def.id+':'+capturedAt);
        if(data.items.length && !items.length) throw Error('no valid items');
      } else items=normalizeSubscription(body || parseSubscription(raw,def),def,capturedAt,'public-fetch:'+def.id+':'+capturedAt).items;
      items=items.filter(item=>publicUrl(item.original_url));
      if(!items.length && def.format!=='sopilot-author') throw Error('empty public list');
      if(PRIVATE_CONTENT.test(JSON.stringify(items))) throw Error('unsafe source text');
      // Keep unchanged Chinese descriptions; changed introductions must be rechecked.
      return {source:{...def,status:'ok',last_attempt_at:attemptedAt,last_success_at:capturedAt,...successfulSourceHealth(old),
        ...(observedChannelId ? {observed_channel_id:observedChannelId} : {})},items,success:true};
    } catch(error) {
      const known=['oversize','invalid source','incomplete','no valid items','empty public list','unsafe source text'];
      const reason=controller.signal.aborted && controller.signal.reason?.name==='TimeoutError' ? 'TimeoutError'
        : error?.message === '视频来源频道不匹配，保留原有资料。' ? 'channel_mismatch'
          : error?.message === '来源订阅格式不正确。' ? 'source_format'
            : error?.message === '来源订阅没有可用条目，保留原有资料。' ? 'empty public list'
              : /^upstream \d{3}$/.test(error?.message || '') || known.includes(error?.message) ? error.message : ['TypeError','AbortError','TimeoutError','SyntaxError'].includes(error?.name) ? error.name : 'Error';
      const health=failedSourceHealth(old,now().toISOString());
      console.warn(JSON.stringify({event:'public-source-failed',source:def.id,reason,...health}));
      return {source:{...old,...def,status:'failed',last_attempt_at:attemptedAt,read_error:reason,...health,
        ...(observedChannelId ? {observed_channel_id:observedChannelId} : {})},items:retainedBucket(previous,def.id),success:false};
    } finally {clearTimeout(timer);}
  }
  // Leave room for platform connection limits and avoid fetching all feeds simultaneously.
  await Promise.all(Array.from({length:4},async()=>{while(cursor<definitionsAll.length){const index=cursor++;results[index]=await read(definitionsAll[index]);}}));
  const successes=results.filter(r=>r.success).length;
  const buckets=Object.fromEntries(results.map(r=>[r.source.id,r.items]));
  const items=mergeSourceItems(buckets),seen=new Set(previous.items.map(item=>sourceLinkIdentity(item.original_url) || item.id));
  const newIds=successes ? items.filter(item=>!seen.has(sourceLinkIdentity(item.original_url) || item.id)).map(item=>item.id) : [];
  const input={schema_version:'0.3',mode:'live',sources:results.map(r=>r.source),items,
    refresh:{status:successes ? 'ok' : 'failed',last_attempt_at:attemptedAt,new_item_ids:newIds}};
  const output=makePublicFeed(input,{cache:reusedGuides(previous),publishedAt:now().toISOString(),automaticUpdate:true});
  if(PRIVATE_CONTENT.test(JSON.stringify(output))) throw Error('public audit failed');
  return output;
}

export async function loadPublicSeed(env) {
  const response=await env.ASSETS.fetch(new Request('https://assets.invalid/data/public-feed.json'));
  if(!response.ok) throw Error('public seed unavailable');
  return response.json();
}

export async function runScheduledUpdate(env, options) {
  // Roster refresh must not block the public snapshot. A failed fetch keeps the last cache.
  try { await refreshKosxPoolCache(env, {fetchImpl:options?.fetchImpl, now:options?.now}); }
  catch { console.warn(JSON.stringify({event:'kosx-pool-refresh-failed'})); }
  const previous=await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY,'json') || await loadPublicSeed(env);
  const refreshed=await refreshPublicFeed(previous, options);
  let approved=[];
  if (typeof env?.DOT_INBOX?.list==='function') {
    const {listApprovedKosxRecords, autoApproveStalePending, backfillEssenceFace}=await import('../dot-pending-service.js');
    const {backfillEssenceHeat}=await import('./essence-sweep.js');
    try { await backfillEssenceHeat(env, {publish:false, extraItems:refreshed.items}); }
    catch { console.warn(JSON.stringify({event:'essence-heat-backfill-failed'})); }
    try { await autoApproveStalePending(env, {publish:false}); }
    catch { console.warn(JSON.stringify({event:'essence-auto-approve-failed'})); }
    const remembered=[...(Array.isArray(previous?.items) ? previous.items : []), ...(Array.isArray(refreshed?.items) ? refreshed.items : [])];
    try { await backfillEssenceFace(env, {extraItems:remembered}); }
    catch { console.warn(JSON.stringify({event:'essence-face-backfill-failed'})); }
    approved=await listApprovedKosxRecords(env);
  }
  const next=attachKosxApproved(refreshed, approved, previous?.items);
  // A single completed snapshot is published; partial failures keep each source's previous items.
  await env.PUBLIC_FEED.put(PUBLIC_FEED_KEY,JSON.stringify(next));
  console.log(JSON.stringify({event:'public-feed-updated',status:next.refresh.status,items:next.items.length,new_items:next.refresh.new_count,
    successful_sources:next.sources.filter(s=>s.status==='ok').length,failed_sources:next.sources.filter(s=>s.status==='failed').map(s=>s.id),
    completed_at:next.publication.published_at}));
  return next;
}
