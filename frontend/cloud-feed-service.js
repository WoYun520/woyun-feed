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
export const PUBLIC_REFRESH_JOB_KEY = 'public-feed:refresh-job:v1';
export const PUBLIC_REFRESH_PART_PREFIX = 'public-feed:refresh-part:v1:';
const PUBLIC_REFRESH_DRAFT_PREFIX = 'public-feed:refresh-draft:v1:';
export const PUBLIC_REFRESH_PATH = '/api/internal/public-refresh';
// Measured 2026-11-06: one refreshPublicFeed of the committed snapshot was
// ~1165 ms of Node CPU across 35 sources (body decode dominated; parsing the
// buffered pages summed to ~116 ms). The cron is killed around 2050 ms of
// Worker CPU. Four sources keep a single invocation well under that cliff.
// A later failure mode is the job document itself. It used to embed every
// source's items, so each hop parsed and serialized that growing blob plus
// the ~1.6 MB snapshot. With ~1000 items the publish hop, and the caller's
// fallback publish, exceeded the CPU limit and left phase "active".
export const PUBLIC_REFRESH_SOURCE_BATCH = 4;
export const PUBLIC_REFRESH_JOB_MAX_BYTES = 128 * 1024;
export const SCHEDULE_LABEL = '每天 09:00、21:00（北京时间）';
const REFRESH_JOB_MAX_AGE_MS = 20 * 60 * 1000;
const REFRESH_JOB_MAX_HOPS = 40;

export function publicRefreshPartKey(token, sourceId) {
  return PUBLIC_REFRESH_PART_PREFIX+token+':'+sourceId;
}

function refreshDraftKey(token) {
  return PUBLIC_REFRESH_DRAFT_PREFIX+token;
}
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

export async function refreshPublicFeed(previous, options={}) {
  const definitions=options.definitions ?? FEED_CHANNELS;
  const results=await readPublicSourceResults(previous, [github, ...definitions], options);
  return assemblePublicFeed(previous, results, options);
}

// Read exactly these source definitions. Callers that split a refresh pass the
// request plan and retry budget computed for the full source list.
export async function readPublicSourceResults(previous, sourceDefs, {fetchImpl=fetch,now=()=>new Date(),timeoutMs=10000,retryDelayMs=200,requestPlan,retryBudget,attemptedAt:fixedAttempt}={}) {
  const attemptedAt=fixedAttempt || now().toISOString(), definitionsAll=sourceDefs, results=[];
  const planned=sourceDefs.filter(def=>def.id!=='github');
  const plan=requestPlan || publicRequestPlan(planned);
  const budget=retryBudget || publicRetryBudget(planned, plan);
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
      attemptTimeoutMs:def.format==='hackernews-api' ? 1800 : def.sopilot_category ? sourceTimeoutMs/2 : sourceTimeoutMs,retryDelayMs,retryBudget:budget});
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
      if(def.format==='hackernews-api') body=await readHackerNewsApi(def,{fetchImpl:fetchSource,maxItems:plan.hnMaxItems,...options});
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
  return results;
}

export function assemblePublicFeed(previous, results, {now=()=>new Date(),publishedAt}={}) {
  const successes=results.filter(r=>r.success).length;
  const buckets=Object.fromEntries(results.map(r=>[r.source.id,r.items]));
  const items=mergeSourceItems(buckets),seen=new Set((previous.items || []).map(item=>sourceLinkIdentity(item.original_url) || item.id));
  const newIds=successes ? items.filter(item=>!seen.has(sourceLinkIdentity(item.original_url) || item.id)).map(item=>item.id) : [];
  const attemptedAt=results.find(result=>result.source?.last_attempt_at)?.source.last_attempt_at || now().toISOString();
  const input={schema_version:'0.3',mode:'live',sources:results.map(r=>r.source),items,
    refresh:{status:successes ? 'ok' : 'failed',last_attempt_at:attemptedAt,new_item_ids:newIds}};
  const output=makePublicFeed(input,{cache:reusedGuides(previous),publishedAt:publishedAt || now().toISOString(),automaticUpdate:true});
  if(PRIVATE_CONTENT.test(JSON.stringify(output))) throw Error('public audit failed');
  return output;
}

export async function loadPublicSeed(env) {
  const response=await env.ASSETS.fetch(new Request('https://assets.invalid/data/public-feed.json'));
  if(!response.ok) throw Error('public seed unavailable');
  return response.json();
}

async function maintainApprovedQueue(env, previous, refreshedItems) {
  if (typeof env?.DOT_INBOX?.list!=='function') return;
  const {autoApproveStalePending, backfillEssenceFace}=await import('../dot-pending-service.js');
  const {backfillEssenceHeat}=await import('./essence-sweep.js');
  try { await backfillEssenceHeat(env, {publish:false, extraItems:refreshedItems, feed:previous}); }
  catch { console.warn(JSON.stringify({event:'essence-heat-backfill-failed'})); }
  try { await autoApproveStalePending(env, {publish:false}); }
  catch { console.warn(JSON.stringify({event:'essence-auto-approve-failed'})); }
  const remembered=[...(Array.isArray(previous?.items) ? previous.items : []), ...(Array.isArray(refreshedItems) ? refreshedItems : [])];
  try { await backfillEssenceFace(env, {extraItems:remembered, feed:previous}); }
  catch { console.warn(JSON.stringify({event:'essence-face-backfill-failed'})); }
}

async function approvedRecords(env) {
  if (typeof env?.DOT_INBOX?.list!=='function') return [];
  const {listApprovedKosxRecords}=await import('../dot-pending-service.js');
  return listApprovedKosxRecords(env);
}

async function publishSnapshot(env, next) {
  // A single completed snapshot is published; partial failures keep each source's previous items.
  await env.PUBLIC_FEED.put(PUBLIC_FEED_KEY,JSON.stringify(next));
  try {
    const {rememberEssenceArchive}=await import('./essence-archive-service.js');
    await rememberEssenceArchive(env, next);
  } catch { console.warn(JSON.stringify({event:'essence-archive-remember-failed'})); }
  console.log(JSON.stringify({event:'public-feed-updated',status:next.refresh.status,items:next.items.length,new_items:next.refresh.new_count,
    successful_sources:next.sources.filter(s=>s.status==='ok').length,failed_sources:next.sources.filter(s=>s.status==='failed').map(s=>s.id),
    completed_at:next.publication.published_at}));
  return next;
}

async function runInlineUpdate(env, options) {
  // Roster refresh must not block the public snapshot. A failed fetch keeps the last cache.
  try { await refreshKosxPoolCache(env, {fetchImpl:options?.fetchImpl, now:options?.now}); }
  catch { console.warn(JSON.stringify({event:'kosx-pool-refresh-failed'})); }
  const previous=await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY,'json') || await loadPublicSeed(env);
  const refreshed=await refreshPublicFeed(previous, options);
  await maintainApprovedQueue(env, previous, refreshed.items);
  const next=attachKosxApproved(refreshed, await approvedRecords(env), previous?.items);
  return publishSnapshot(env, next);
}

function clockMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now==='number' && Number.isFinite(now)) return now;
  if (typeof now==='string' && Number.isFinite(Date.parse(now))) return Date.parse(now);
  return Date.now();
}

function createRefreshJob(options, now) {
  const definitions=options.definitions ?? FEED_CHANNELS;
  const requestPlan=publicRequestPlan(definitions);
  const retryBudget=publicRetryBudget(definitions, requestPlan);
  const instant=now instanceof Date ? now : new Date(clockMs(now));
  return {token:crypto.randomUUID(),created_at:instant.toISOString(),attempted_at:instant.toISOString(),cursor:0,phase:'active',hops:0,
    hn_max_items:requestPlan.hnMaxItems,retry_remaining:retryBudget.remaining,
    sources:JSON.parse(JSON.stringify([github, ...definitions]))};
}

function storedJob(job) {
  return {token:job.token,created_at:job.created_at,attempted_at:job.attempted_at,cursor:job.cursor,phase:job.phase,
    hops:job.hops,hn_max_items:job.hn_max_items,retry_remaining:job.retry_remaining,sources:job.sources,
    ...(job.stage==='commit' ? {stage:'commit'} : {})};
}

function validJob(raw) {
  return !!raw && typeof raw==='object' && !Array.isArray(raw) && raw.phase==='active' && Array.isArray(raw.sources)
    && typeof raw.token==='string' && raw.token.length>0 && Number.isInteger(raw.cursor) && raw.cursor>=0;
}

function abandonedJob(text) {
  const head=text.slice(0, 400);
  const token=head.match(/"token":"([^"]{1,80})"/)?.[1] || '';
  const created_at=head.match(/"created_at":"([^"]{1,40})"/)?.[1] || '';
  return {abandoned:true, token, created_at};
}

// Text first. A stuck job from before per-source keys embeds every item and can
// be larger than a Worker should JSON.parse just to notice it is stale.
async function readStoredJob(kv) {
  let raw;
  try { raw=await kv.get(PUBLIC_REFRESH_JOB_KEY); }
  catch { return null; }
  if (raw==null) return null;
  if (typeof raw==='object') return validJob(raw) ? raw : null;
  if (typeof raw!=='string') return null;
  if (raw.length>PUBLIC_REFRESH_JOB_MAX_BYTES) return abandonedJob(raw);
  try { raw=JSON.parse(raw); } catch { return null; }
  return validJob(raw) ? raw : null;
}

async function deletePartsForToken(kv, token) {
  if (!token || typeof kv.list!=='function' || typeof kv.delete!=='function') return;
  const prefix=PUBLIC_REFRESH_PART_PREFIX+token+':';
  let cursor;
  do {
    const page=await kv.list({prefix, cursor});
    const keys=Array.isArray(page?.keys) ? page.keys : [];
    for (const key of keys) {
      const name=typeof key==='string' ? key : key?.name;
      if (name) await kv.delete(name);
    }
    cursor=page?.list_complete===false && page.cursor ? page.cursor : undefined;
  } while (cursor);
}

async function deleteJobParts(kv, job) {
  if (!job?.token || typeof kv.delete!=='function') return;
  const ids=(job.sources || []).map(source=>source?.id).filter(Boolean);
  await Promise.all(ids.map(id=>Promise.resolve(kv.delete(publicRefreshPartKey(job.token, id))).catch(()=>{})));
  await Promise.resolve(kv.delete(refreshDraftKey(job.token))).catch(()=>{});
  await deletePartsForToken(kv, job.token);
}

async function discardAbandonedJob(kv, job) {
  if (!job?.abandoned) return job;
  try { if (typeof kv.delete==='function') await kv.delete(PUBLIC_REFRESH_JOB_KEY); } catch { /* The next read still refuses to parse it. */ }
  await deletePartsForToken(kv, job.token);
  return null;
}

async function writeStoredJob(kv, job) {
  if (job.phase==='done') {
    await deleteJobParts(kv, job);
    if (typeof kv.delete==='function') { await kv.delete(PUBLIC_REFRESH_JOB_KEY); return; }
  }
  await kv.put(PUBLIC_REFRESH_JOB_KEY, JSON.stringify(job.phase==='done' ? {phase:'done',created_at:job.created_at} : storedJob(job)));
}

function partRecord(result) {
  if (result?.success) return {source:result.source, items:Array.isArray(result.items) ? result.items : [], success:true};
  return {source:result?.source, items:[], success:false, retain:true};
}

async function writePart(kv, token, result) {
  if (!result?.source?.id) return;
  await kv.put(publicRefreshPartKey(token, result.source.id), JSON.stringify(partRecord(result)));
}

async function loadParts(kv, job) {
  const parts=[];
  for (let index=0; index<job.sources.length; index+=PUBLIC_REFRESH_SOURCE_BATCH) {
    const slice=job.sources.slice(index, index+PUBLIC_REFRESH_SOURCE_BATCH);
    const rows=await Promise.all(slice.map(async def=>{
      try { return await kv.get(publicRefreshPartKey(job.token, def.id), 'json'); }
      catch { return null; }
    }));
    for (let row of rows) {
      if (typeof row==='string') { try { row=JSON.parse(row); } catch { row=null; } }
      if (row && typeof row==='object') parts.push(row);
    }
  }
  if (!parts.length && Array.isArray(job.results)) return job.results;
  return parts;
}

async function loadPreviousSnapshot(env) {
  let stored;
  try { stored=await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY,'json'); }
  catch { stored=null; }
  if (typeof stored==='string') { try { stored=JSON.parse(stored); } catch { stored=null; } }
  if (stored && Array.isArray(stored.items) && Array.isArray(stored.sources)) return stored;
  return loadPublicSeed(env);
}

function finishedResult(previous, def, part) {
  const old=(previous.sources || []).find(source=>source.id===def.id) || {status:'not_connected',last_success_at:null};
  if (part?.success) return {source:{...part.source, ...successfulSourceHealth(old)}, items:Array.isArray(part.items) ? part.items : [], success:true};
  // Counters are applied once, from the snapshot. The fetch hop does not have
  // the previous items, so a stored failure must not be incremented again.
  const failedAt=part?.source?.last_failure_at || part?.source?.last_attempt_at || new Date().toISOString();
  return {source:{...old, ...def, status:'failed', last_attempt_at:part?.source?.last_attempt_at || failedAt,
    last_success_at:old.last_success_at ?? null, read_error:part?.source?.read_error, ...failedSourceHealth(old, failedAt),
    ...(part?.source?.observed_channel_id ? {observed_channel_id:part.source.observed_channel_id} : {})},
    items:retainedBucket(previous, def.id), success:false};
}

function resultsForPublish(previous, sources, done) {
  const byId=new Map(done.map(result=>[result?.source?.id, result]));
  const results=[];
  for (const def of sources) {
    if (byId.has(def.id)) { results.push(finishedResult(previous, def, byId.get(def.id))); continue; }
    const known=(previous.sources || []).some(source=>source.id===def.id) || (previous.items || []).some(item=>item.source_refs?.includes(def.id));
    if (!known) continue;
    const old=(previous.sources || []).find(source=>source.id===def.id) || {status:'not_connected',last_success_at:null};
    results.push({source:{...old,id:def.id},items:retainedBucket(previous, def.id),success:false});
  }
  return results;
}

async function assembledFeed(env, job, options) {
  const previous=await loadPreviousSnapshot(env);
  const done=await loadParts(env.PUBLIC_FEED, job);
  return {previous, refreshed:assemblePublicFeed(previous, resultsForPublish(previous, job.sources, done), {now:options?.now})};
}

async function readDraft(kv, token) {
  let raw;
  try { raw=await kv.get(refreshDraftKey(token), 'json'); }
  catch { return null; }
  if (typeof raw==='string') { try { raw=JSON.parse(raw); } catch { return null; } }
  if (!raw || typeof raw!=='object' || !Array.isArray(raw.items) || !Array.isArray(raw.sources)) return null;
  return raw;
}

// Reading every source part and building the public document is one invocation.
// Maintenance, approved rows, the snapshot write and the archive are the next,
// so a 1000-item publish is not stacked on top of that build.
async function writeRefreshDraft(env, job, options) {
  const {refreshed}=await assembledFeed(env, job, options);
  await env.PUBLIC_FEED.put(refreshDraftKey(job.token), JSON.stringify(refreshed));
  job.stage='commit';
}

async function publishJob(env, job, options) {
  const drafted=job.stage==='commit' ? await readDraft(env.PUBLIC_FEED, job.token) : null;
  const previous=await loadPreviousSnapshot(env);
  const refreshed=drafted || (await assembledFeed(env, job, options)).refreshed;
  await maintainApprovedQueue(env, previous, refreshed.items);
  const next=attachKosxApproved(refreshed, await approvedRecords(env), previous?.items);
  await publishSnapshot(env, next);
  job.phase='done';
  job.snapshot=next;
  return next;
}

async function finishRefreshJob(env, job, options) {
  try { await publishJob(env, job, options); }
  catch { console.warn(JSON.stringify({event:'public-refresh-publish-failed'})); }
  job.phase='done';
  try { await writeStoredJob(env.PUBLIC_FEED, job); }
  catch { console.warn(JSON.stringify({event:'public-refresh-job-write-failed'})); }
}

function sameToken(left, right) {
  const a=String(left ?? ''), b=String(right ?? '');
  let difference=a.length===b.length ? 0 : 1;
  const length=Math.max(a.length, b.length);
  for (let index=0; index<length; index+=1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference===0;
}

async function advanceRefreshJob(env, job, options) {
  if (job.cursor<job.sources.length) {
    if (job.cursor===0) {
      try { await refreshKosxPoolCache(env, {fetchImpl:options?.fetchImpl, now:options?.now}); }
      catch { console.warn(JSON.stringify({event:'kosx-pool-refresh-failed'})); }
    }
    // Source hops keep the previous snapshot out of this invocation. Failure
    // health and retained articles are restored once, on the publish hop.
    const batch=job.sources.slice(job.cursor, job.cursor+PUBLIC_REFRESH_SOURCE_BATCH);
    const retryBudget={remaining:job.retry_remaining};
    const results=await readPublicSourceResults({sources:[],items:[]}, batch, {...options,requestPlan:{hnMaxItems:job.hn_max_items},retryBudget,attemptedAt:job.attempted_at});
    for (const result of results) await writePart(env.PUBLIC_FEED, job.token, result);
    job.retry_remaining=retryBudget.remaining;
    job.cursor+=batch.length;
    return;
  }
  if (job.stage!=='commit') {
    await writeRefreshDraft(env, job, options);
    return;
  }
  await publishJob(env, job, options);
}

async function dispatchRefresh(env, job, options) {
  // Await the next invocation. Its CPU limit is separate; this invocation only waits.
  // The next step finishes before this response returns, so a cancelled caller cannot drop it.
  const request=new Request('https://woyun-feed-preview.woyun520.workers.dev'+PUBLIC_REFRESH_PATH,{method:'POST',headers:{'x-woyun-refresh-token':job.token}});
  try {
    const response=await env.SELF.fetch(request);
    await response?.arrayBuffer?.().catch(()=>{});
    if (response && response.status!==204) throw Error('continue');
    return null;
  } catch {
    // The callee may already have saved a later batch or published. Republish only
    // the job still stored here, and never overwrite a snapshot the callee finished.
    const latest=await readStoredJob(env.PUBLIC_FEED);
    if (!latest || latest.abandoned || latest.token!==job.token) return null;
    await finishRefreshJob(env, latest, options);
    return latest.snapshot ?? null;
  }
}

// One bounded step. A service binding starts the next step in a fresh invocation
// so a full refresh does not have to fit in a single CPU budget. Without that
// binding (tests and a misconfigured deploy) the inline path still publishes.
async function runBoundedUpdate(env, options={}) {
  const kv=env.PUBLIC_FEED;
  let job=await discardAbandonedJob(kv, await readStoredJob(kv));
  const now=typeof options.now==='function' ? options.now() : new Date();
  const age=clockMs(now)-Date.parse(job?.created_at || '');
  if (!job || !Number.isFinite(age) || age<0 || age>REFRESH_JOB_MAX_AGE_MS) {
    if (job?.token) await deleteJobParts(kv, job);
    job=createRefreshJob(options, now);
  }
  job.hops+=1;
  if (job.hops>REFRESH_JOB_MAX_HOPS) {
    await finishRefreshJob(env, job, options);
    return job.snapshot ?? null;
  }
  try { await advanceRefreshJob(env, job, options); }
  catch {
    console.warn(JSON.stringify({event:'public-refresh-step-failed',hop:job.hops}));
    await finishRefreshJob(env, job, options);
    return job.snapshot ?? null;
  }
  try { await writeStoredJob(kv, job); }
  catch {
    console.warn(JSON.stringify({event:'public-refresh-job-write-failed'}));
    if (job.phase!=='done') await finishRefreshJob(env, job, options);
    return job.snapshot ?? null;
  }
  if (job.phase==='done') return job.snapshot ?? null;
  return await dispatchRefresh(env, job, options) ?? job.snapshot ?? null;
}

export async function handlePublicRefreshRequest(request, env) {
  const url=new URL(request.url);
  if (url.pathname!==PUBLIC_REFRESH_PATH) return null;
  const job=typeof env?.PUBLIC_FEED?.get==='function' ? await readStoredJob(env.PUBLIC_FEED) : null;
  const token=request.headers.get('x-woyun-refresh-token') || '';
  if (!job || job.abandoned || !sameToken(token, job.token)) return new Response('Not found',{status:404});
  if (request.method!=='POST') return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
  await runBoundedUpdate(env);
  return new Response(null,{status:204});
}

export async function runScheduledUpdate(env, options) {
  if (typeof env?.SELF?.fetch==='function') return runBoundedUpdate(env, options);
  return runInlineUpdate(env, options);
}
