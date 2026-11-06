import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_CHANNELS, mergeSourceItems, normalizeSubscription, parseSubscription } from './feed-sources.js';
import { normalizeRepositories } from './repository-normalize.js';
import { makePublicFeed } from './public-feed-data.js';
import { PUBLIC_FEED_KEY, PUBLIC_REFRESH_JOB_KEY, PUBLIC_REFRESH_PATH, PUBLIC_REFRESH_SOURCE_BATCH, mergePublicSourceResults, readBoundedText, refreshPublicFeed, runScheduledUpdate } from './cloud-feed-service.js';
import worker from '../worker.js';

const oldTime = '2026-10-01T01:00:00.000Z';
const newTime = '2026-10-02T01:00:00.000Z';
const now = () => new Date(newTime);
const sspai = FEED_CHANNELS.find(source => source.id === 'sspai');
const v2ex = FEED_CHANNELS.find(source => source.id === 'v2ex-share');
const repo = (description = 'Public workflow utility') => ({
  id: 123, full_name: 'example/utility', description, stargazers_count: 500,
  pushed_at: '2026-09-30T01:00:00Z', created_at: '2026-09-01T01:00:00Z', archived: false, fork: false,
});
const xmlEscape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const rss = (url = 'https://sspai.com/post/10001', title = '公开文章', summary = '公开摘要') =>
  `<rss><channel><item><title>${xmlEscape(title)}</title><link>${xmlEscape(url)}</link><description>${xmlEscape(summary)}</description></item></channel></rss>`;
const atom = url => `<feed><entry><title>同一篇公开文章</title><link rel="alternate" href="${xmlEscape(url)}"/><published>${oldTime}</published></entry></feed>`;
const oldArticle = () => normalizeSubscription(parseSubscription(rss(), sspai), sspai, oldTime, 'old-public-evidence').items[0];
const seed = () => makePublicFeed({schema_version:'0.3', mode:'live',
  sources:[{id:'github', status:'ok', last_success_at:oldTime}, {id:'sspai', status:'ok', last_success_at:oldTime}],
  items:mergeSourceItems({github:normalizeRepositories([repo()], oldTime, 'old-repository-evidence'), sspai:[oldArticle()]}),
}, {publishedAt:oldTime});
const repositoryResponse = description => new Response(JSON.stringify({items:[repo(description)], incomplete_results:false}), {headers:{'Content-Type':'application/json'}});

const sopilotAI = FEED_CHANNELS.find(source => source.id === 'sopilot-ai');
const sopilotCreators = FEED_CHANNELS.find(source => source.id === 'sopilot-creators');
// Short invented post text, never a copy of a real creator's complete post.
const sopilotRow = overrides => ({id:'2105614023941316931', rank:4, text:'一个公开工具的测试线索。',
  authorName:'测试作者', screenName:'demo_author', sourceUrl:'https://x.com/demo_author/status/2105614023941316931',
  tweetCreatedAt:'2026-09-30T08:12:13.000Z', lastSyncedAt:'2026-10-01T00:20:21.234Z',
  updatedAt:'2026-10-01T00:20:22.345Z', velocityScore:1200, ...overrides});
const sopilotPage = (source, rows=[sopilotRow()], props={}) => {
  const data={locale:'zh',range:'24h',category:source.sopilot_category,page:1,totalPages:1,
    risingTweets:rows,hotTweets:[],...props};
  const stream=`6:${JSON.stringify(['$','$L39',null,data])}\n`;
  return `<main data-rank-page="true"></main><script>self.__next_f.push(${JSON.stringify([1,stream])})</script>`;
};
const sopilotResult = (source, rows=[sopilotRow()], capturedAt=oldTime) => ({
  source:{...source,status:'ok',last_success_at:capturedAt,last_attempt_at:capturedAt},
  items:normalizeSubscription(parseSubscription(sopilotPage(source,rows),source),source,capturedAt,'public-test:'+source.id).items,
});

test('adding a public source preserves old source status, timestamps, authors and Chinese guides without mutating packets', () => {
  const base=seed(), repository=base.items.find(item=>item.repository_name);
  repository.repository_guide={summary:'减少重复操作的公开工具。',basis:'description',verification:'not_tested',
    source_url:repository.original_url,recorded_at:oldTime};
  const previous=mergePublicSourceResults(base,[sopilotResult(sopilotCreators)],{publishedAt:oldTime});
  Object.assign(previous.sources.find(source=>source.id==='sspai'),{status:'failed',read_error:'upstream 403',last_attempt_at:oldTime,
    message:'原站暂时不允许这次公开读取；有旧内容时仍可阅读。'});
  const result=sopilotResult(sopilotAI,[sopilotRow({id:'2105614023941316932',
    sourceUrl:'https://x.com/demo_author/status/2105614023941316932',authorName:'新榜单作者'})],newTime);
  const previousCopy=structuredClone(previous), resultCopy=structuredClone(result);
  const next=mergePublicSourceResults(previous,[result],{publishedAt:newTime});
  assert.deepEqual(previous,previousCopy); assert.deepEqual(result,resultCopy);
  for (const oldSource of previous.sources) assert.deepEqual(next.sources.find(source=>source.id===oldSource.id),oldSource);
  for (const oldItem of previous.items) assert.deepEqual(next.items.find(item=>item.id===oldItem.id),oldItem);
  const post=next.items.find(item=>item.source_refs.includes(sopilotCreators.id));
  assert.equal(post.author_name,'测试作者'); assert.equal(post.author_handle,'demo_author');
  assert.equal(post.published_at,'2026-09-30T08:12:13.000Z');
  assert.equal(post.source_item_time,'2026-10-01T00:20:21.234Z'); assert.equal(post.captured_at,oldTime);
  assert.deepEqual(next.items.find(item=>item.repository_name).repository_guide,repository.repository_guide);
  assert.equal(next.sources.find(source=>source.id===sopilotAI.id).last_success_at,newTime);
  assert.match(next.sources.find(source=>source.id===sopilotAI.id).reading_note,/SoPilot.*24 小时.*尚未核对/);
  assert.equal(next.refresh.new_count,1); assert.equal(next.publication.kind,'public-snapshot');
});

test('targeted recovery of the configured GitHub source preserves unrelated data and exact failure dates',()=>{
  const previous=seed(),copy=structuredClone(previous);
  const githubSource=previous.sources.find(source=>source.id==='github');
  const fresh=normalizeRepositories([repo('Fresh public description')],newTime,'github-recovery');
  const next=mergePublicSourceResults(previous,[{source:{...githubSource,status:'ok',last_success_at:newTime,last_attempt_at:newTime},items:fresh}],{publishedAt:newTime});
  assert.deepEqual(previous,copy);
  assert.deepEqual(next.sources.find(source=>source.id==='sspai'),previous.sources.find(source=>source.id==='sspai'));
  assert.deepEqual(next.items.find(item=>item.source_refs.includes('sspai')),previous.items.find(item=>item.source_refs.includes('sspai')));
  assert.equal(next.items.find(item=>item.source_refs.includes('github')).summary,'Fresh public description');
  assert.equal(next.sources.find(source=>source.id==='github').last_success_at,newTime);
});

test('maintenance merges reject unknown, disabled, invalid, duplicate and unsafe source results', () => {
  const previous=seed(), valid=sopilotResult(sopilotAI), copy=structuredClone(previous);
  const invalidPackets=[
    [],
    [{...valid,source:{...valid.source,id:'arbitrary-private-source'}}],
    [{...valid,source:{...valid.source,id:'x'}}],
    [{...valid,source:{...valid.source,status:'failed'}}],
    [{...valid,source:{...valid.source,last_success_at:'not-a-date'}}],
    [{...valid,items:[]}],
    [{...valid,items:valid.items.map(item=>({...item,id:'invalid-id'}))}],
    [{...valid,items:valid.items.map(item=>({...item,title:''}))}],
    [{...valid,items:valid.items.map(item=>({...item,source_refs:['sspai']}))}],
    [{...valid,items:valid.items.map(item=>({...item,original_url:'https://example.com/?api_key=private'}))}],
    [{...valid,items:valid.items.map(item=>({...item,summary:'/Users/private/work/PRIVATE_CANARY'}))}],
    [valid,valid],
  ];
  for (const results of invalidPackets) assert.throws(()=>mergePublicSourceResults(previous,results,{publishedAt:newTime}));
  assert.deepEqual(previous,copy,'rejected updates never mutate the previous public snapshot');
});

test('shared posts retain each source unknown rank and heat instead of borrowing another leaderboard values', () => {
  const previous=mergePublicSourceResults(seed(),[
    sopilotResult(sopilotAI),sopilotResult(sopilotCreators,[sopilotRow({rank:null,velocityScore:null})]),
  ],{publishedAt:oldTime});
  const sourceUpdate={source:{...sspai,status:'ok',last_success_at:newTime},
    items:normalizeSubscription(parseSubscription(rss('https://sspai.com/post/10002'),sspai),sspai,newTime,'new-public-article').items};
  const next=mergePublicSourceResults(previous,[sourceUpdate],{publishedAt:newTime});
  const post=next.items.find(item=>item.source_refs.includes(sopilotAI.id));
  assert.equal(next.items.filter(item=>item.source_refs.includes(sopilotAI.id)).length,1);
  assert.deepEqual(post.source_refs,[sopilotAI.id,sopilotCreators.id]);
  const known=post.source_links.find(link=>link.source_id===sopilotAI.id), unknown=post.source_links.find(link=>link.source_id===sopilotCreators.id);
  assert.equal(known.source_rank,4); assert.equal(known.heat_label,'1.2K 曝光/小时');
  assert.equal(unknown.source_rank,null); assert.equal(unknown.heat_label,'');
  assert.equal(unknown.captured_at,oldTime); assert.equal(known.captured_at,oldTime);
});

test('SoPilot empty pages, category drift and timeouts retain previously captured authors and exact dates', async t => {
  const previous=mergePublicSourceResults(seed(),[sopilotResult(sopilotAI)],{publishedAt:oldTime});
  const expected=previous.items.find(item=>item.source_refs.includes(sopilotAI.id)), copy=structuredClone(previous);
  for (const failure of ['empty','category-drift','timeout']) await t.test(failure,async()=>{
    const next=await refreshPublicFeed(previous,{definitions:[sopilotAI],now,timeoutMs:5,fetchImpl:async(url,{signal})=>{
      if (new URL(url).hostname==='api.github.com') return repositoryResponse();
      if (failure==='timeout') return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
      return new Response(failure==='empty' ? sopilotPage(sopilotAI,[]) : sopilotPage(sopilotAI,undefined,{category:'all'}));
    }});
    const retained=next.items.find(item=>item.id===expected.id), source=next.sources.find(source=>source.id===sopilotAI.id);
    assert.equal(source.status,'failed'); assert.equal(source.last_success_at,oldTime); assert.equal(source.last_attempt_at,newTime);
    for (const field of ['author_name','author_handle','title','summary','original_url','published_at','captured_at','source_item_time','source_rank','heat_label','source_links']) assert.deepEqual(retained[field],expected[field],field);
    assert.deepEqual(previous,copy); assert.ok(!next.refresh.new_item_ids.includes(expected.id));
  });
});

test('scheduled publishing writes a completed snapshot while a failed SoPilot category keeps old public evidence', async () => {
  const previous=mergePublicSourceResults(seed(),[sopilotResult(sopilotAI)],{publishedAt:oldTime});
  const expected=previous.items.find(item=>item.source_refs.includes(sopilotAI.id)), writes=[];
  const originalFetch=globalThis.fetch, originalWarn=console.warn, originalLog=console.log;
  globalThis.fetch=async url=>new URL(url).hostname==='api.github.com' ? repositoryResponse()
    : url===sopilotAI.feed_url ? new Response(sopilotPage(sopilotAI,undefined,{category:'all'}))
      : Promise.reject(Error('source unavailable'));
  console.warn=()=>{}; console.log=()=>{};
  try {
    const next=await runScheduledUpdate({PUBLIC_FEED:{get:async()=>previous,put:async(key,value)=>writes.push({key,value})},
      ASSETS:{fetch:async()=>{throw Error('existing cloud snapshot must be retained');}}});
    assert.equal(writes.length,1); assert.equal(writes[0].key,PUBLIC_FEED_KEY);
    assert.deepEqual(JSON.parse(writes[0].value),next);
    assert.deepEqual(next.items.find(item=>item.id===expected.id),expected);
    const failed=next.sources.find(source=>source.id===sopilotAI.id);
    assert.equal(failed.status,'failed'); assert.equal(failed.last_success_at,oldTime);
    assert.ok(Date.parse(failed.last_attempt_at)>Date.parse(oldTime));
    assert.match(next.publication.schedule_label,/09:00.*21:00/);
    assert.equal(next.publication.automatic_update,true);
  } finally {globalThis.fetch=originalFetch;console.warn=originalWarn;console.log=originalLog;}
});

test('partial source failure retains its old items and successful timestamp while other sources update', async () => {
  const previous = seed(), copy = structuredClone(previous), calls = [];
  const next = await refreshPublicFeed(previous, {definitions:[sspai], now, fetchImpl:async (url, opts) => {
    calls.push({url, opts});
    if (new URL(url).hostname === 'api.github.com') return repositoryResponse();
    throw Error('offline');
  }});
  const failed = next.sources.find(source => source.id === 'sspai');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.last_success_at, oldTime);
  assert.equal(failed.last_attempt_at, newTime);
  const kept = next.items.find(item => item.source_refs.includes('sspai'));
  assert.equal(kept.original_url, 'https://sspai.com/post/10001');
  assert.equal(kept.captured_at, oldTime);
  assert.equal(kept.source_links[0].captured_at, oldTime);
  assert.equal(next.sources.find(source => source.id === 'github').last_success_at, newTime);
  assert.equal(next.refresh.status, 'partial');
  assert.deepEqual(previous, copy, 'refresh does not mutate the previous snapshot');
  assert.ok(calls.every(call => call.opts.redirect === 'manual' && call.opts.signal));
});

test('all source failures do not claim fresh data or add newly discovered items', async () => {
  const previous = seed();
  const next = await refreshPublicFeed(previous, {definitions:[sspai], now, fetchImpl:async () => {throw Error('unavailable');}});
  assert.equal(next.refresh.status, 'failed');
  assert.equal(next.generated_at, oldTime, 'content fetch time remains the actual last successful fetch');
  assert.equal(next.refresh.last_attempt_at, newTime);
  assert.deepEqual(next.refresh.new_item_ids, []);
  assert.equal(next.refresh.new_count, 0);
  assert.deepEqual(next.items.map(item => item.original_url).sort(), previous.items.map(item => item.original_url).sort());
  assert.ok(next.sources.every(source => source.status === 'failed' && source.last_success_at === oldTime));
});

test('incomplete GitHub results retain its previous good snapshot instead of publishing a partial search', async () => {
  const previous = seed();
  const next = await refreshPublicFeed(previous, {definitions:[], now, fetchImpl:async () =>
    new Response(JSON.stringify({items:[repo('Changed partial result')], incomplete_results:true})),
  });
  assert.equal(next.sources[0].status, 'failed');
  assert.equal(next.sources[0].last_success_at, oldTime);
  assert.equal(next.items[0].summary, 'Public workflow utility');
  assert.equal(next.generated_at, oldTime);
});

test('a source exceeding its fetch deadline is aborted and retains the previous good content', async () => {
  let aborted = false;
  const next = await refreshPublicFeed(seed(), {definitions:[sspai], now, timeoutMs:5, fetchImpl:async (url, {signal}) => {
    if (new URL(url).hostname === 'api.github.com') return repositoryResponse();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {aborted = true; reject(Error('aborted'));}, {once:true}));
  }});
  assert.equal(aborted, true);
  const source = next.sources.find(source => source.id === 'sspai');
  assert.equal(source.status, 'failed');
  assert.equal(source.last_success_at, oldTime);
  assert.ok(next.items.some(item => item.original_url === 'https://sspai.com/post/10001'));
});

test('matching original links from multiple sources merge while distinct links stay separate', async () => {
  const next = await refreshPublicFeed(seed(), {definitions:[sspai, v2ex], now, fetchImpl:async url => {
    if (new URL(url).hostname === 'api.github.com') return repositoryResponse();
    return new Response(url === sspai.feed_url ? rss('https://sspai.com/post/99999?utm_source=feed') : atom('https://sspai.com/post/99999'));
  }});
  const shared = next.items.filter(item => item.canonical_url === 'https://sspai.com/post/99999');
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].source_refs.sort(), ['sspai', 'v2ex-share']);
  assert.deepEqual(shared[0].source_links.map(link => link.source_id).sort(), ['sspai', 'v2ex-share']);
  assert.equal(next.items.filter(item => item.source_refs.includes('github')).length, 1);
  assert.equal(next.refresh.new_count, 1, 'one canonical link counts as one new item');
});

test('unchanged public author introductions reuse Chinese guides; changed introductions discard them', async () => {
  const previous = seed(), item = previous.items.find(item => item.repository_name);
  item.repository_guide = {summary:'帮助减少重复操作的小工具。', basis:'description', verification:'not_tested', recorded_at:oldTime};
  const make = description => refreshPublicFeed(previous, {definitions:[], now, fetchImpl:async () => repositoryResponse(description)});
  const unchanged = await make(item.summary);
  assert.equal(unchanged.items[0].repository_guide.summary, item.repository_guide.summary);
  assert.equal(unchanged.items[0].repository_guide.recorded_at, oldTime);
  assert.equal(unchanged.items[0].repository_guide.verification, 'not_tested');
  const changed = await make('A different purpose than before');
  assert.equal(changed.items[0].repository_guide, undefined);
  assert.equal(changed.items[0].summary, 'A different purpose than before');
});

test('private user records, unsafe links and arbitrary source definitions are excluded from public data', () => {
  const previous = seed(), good = previous.items[0];
  const input = {...previous, profile:{interests:'PRIVATE_CANARY'}, followups:[{question:'PRIVATE_CANARY'}],
    sources:[...previous.sources, {id:'private-feed', name:'PRIVATE_CANARY', status:'ok'}],
    items:[...previous.items,
      {...good, id:'github-222', origin:'user_added', title:'PRIVATE_CANARY'},
      {...good, id:'github-333', source_refs:['private-feed'], title:'PRIVATE_CANARY'},
      {...good, id:'github-444', original_url:'https://example.com/?api_key=PRIVATE_CANARY'},
      {...good, id:'github-555', original_url:'http://172.16.1.1/private'},
    ]};
  const output = makePublicFeed(input, {publishedAt:newTime, automaticUpdate:true});
  assert.equal(output.items.length, previous.items.length);
  assert.ok(!JSON.stringify(output).includes('PRIVATE_CANARY'));
  assert.ok(!output.sources.some(source => source.id === 'private-feed'));
});

test('a feed containing only unsafe links fails safely and retains its last good source data', async () => {
  const next = await refreshPublicFeed(seed(), {definitions:[sspai], now, fetchImpl:async url =>
    new URL(url).hostname === 'api.github.com' ? repositoryResponse() : new Response(rss('https://example.com/?api_key=private')),
  });
  const source = next.sources.find(source => source.id === 'sspai');
  assert.equal(source.status, 'failed');
  assert.equal(source.last_success_at, oldTime);
  assert.ok(next.items.some(item => item.original_url === 'https://sspai.com/post/10001'));
  assert.ok(!next.items.some(item => item.original_url.includes('api_key')));
});

test('retired X placeholder in an old cloud snapshot is not fetched or republished', async () => {
  assert.equal(FEED_CHANNELS.some(source => source.id === 'x'), false);
  const previous=seed();
  previous.sources.push({id:'x',name:'X / Twitter',enabled:false,status:'not_connected',home_url:'https://x.com',last_success_at:null});
  const copy=structuredClone(previous);
  const calls = [];
  const next = await refreshPublicFeed(previous, {definitions:[], now, fetchImpl:async url => {calls.push(url); return repositoryResponse();}});
  assert.equal(calls.length, 1, 'only the built-in GitHub source is fetched');
  assert.equal(new URL(calls[0]).hostname, 'api.github.com');
  assert.equal(next.sources.some(source => source.id === 'x'),false);
  assert.ok(!next.items.some(item => item.source_refs.includes('x')));
  assert.deepEqual(previous,copy);
});

test('upstream private text is rejected and scheduled logs contain only public status metadata', async () => {
  const previous = seed(), writes = [], logs = [], originalFetch = globalThis.fetch, originalLog = console.log, originalWarn = console.warn;
  const secret = '/Users/private/work/PRIVATE_CANARY';
  globalThis.fetch = async url => {
    if (new URL(url).hostname === 'api.github.com') return repositoryResponse();
    if (url === sspai.feed_url) return new Response(rss('https://sspai.com/post/22222', secret));
    throw Error('upstream failed ' + secret);
  };
  console.log = value => logs.push(value);
  console.warn = value => logs.push(value);
  try {
    const next = await runScheduledUpdate({PUBLIC_FEED:{get:async () => previous, put:async (key, value) => writes.push({key, value})}, ASSETS:{fetch:async () => {throw Error('seed should not be requested');}}});
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, PUBLIC_FEED_KEY);
    assert.ok(!JSON.stringify(next).includes('PRIVATE_CANARY'));
    assert.ok(!writes[0].value.includes('PRIVATE_CANARY'));
    assert.ok(logs.length > 0);
    assert.ok(!logs.join('\n').includes('PRIVATE_CANARY'));
    assert.equal(next.sources.find(source => source.id === 'sspai').status, 'failed');
    assert.equal(next.sources.find(source => source.id === 'sspai').last_success_at, oldTime);
  } finally {globalThis.fetch = originalFetch; console.log = originalLog; console.warn = originalWarn;}
});

test('a corrupted stored snapshot fails closed without writing a new snapshot or logging private text', async () => {
  const previous = seed(), secret = '/Users/private/work/PRIVATE_CANARY';
  previous.items.find(item => item.source_refs.includes('sspai')).summary = secret;
  const writes = [], logs = [], originalFetch = globalThis.fetch, originalLog = console.log, originalWarn = console.warn;
  globalThis.fetch = async () => {throw Error('upstream unavailable');};
  console.log = value => logs.push(value);
  console.warn = value => logs.push(value);
  try {
    await assert.rejects(runScheduledUpdate({PUBLIC_FEED:{get:async () => previous, put:async (...args) => writes.push(args)},
      ASSETS:{fetch:async () => {throw Error('seed should not be requested');}}}), /public audit failed/);
    assert.equal(writes.length, 0);
    assert.ok(!logs.join('\n').includes('PRIVATE_CANARY'));
  } finally {globalThis.fetch = originalFetch; console.log = originalLog; console.warn = originalWarn;}
});

test('upstream body limits cover declared length and streamed bytes and cancel oversized streams', async () => {
  let declaredCancelled = false;
  const declared = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(5));}, cancel() {declaredCancelled = true;}});
  await assert.rejects(readBoundedText(new Response(declared, {headers:{'Content-Length':'101'}}), 100), /oversize/);
  assert.equal(declaredCancelled, true, 'oversize header releases the unconsumed upstream connection');
  let cancelled = false;
  const stream = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8));}, cancel() {cancelled = true;}});
  await assert.rejects(readBoundedText(new Response(stream), 12), /oversize/);
  assert.equal(cancelled, true);
  const response = new Response('公开标题');
  assert.equal(await readBoundedText(response, 100), '公开标题');
});

test('public GET and HEAD read only the completed snapshot without writes or upstream requests', async () => {
  const raw = JSON.stringify(seed()), calls = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {throw Error('GET must not fetch sources');};
  const env = {PUBLIC_FEED:{get:async key => {calls.push(['get', key]); return raw;}, put:async () => {throw Error('GET must not write');}},
    ASSETS:{fetch:async () => {throw Error('existing snapshot should not need assets');}}};
  try {
    const get = await worker.fetch(new Request('https://feed.example/data/public-feed.json'), env);
    assert.equal(get.status, 200); assert.equal(await get.text(), raw);
    assert.equal(get.headers.get('Cache-Control'), 'no-store');
    assert.match(get.headers.get('Content-Type'), /application\/json/);
    assert.equal(get.headers.get('X-Content-Type-Options'), 'nosniff');
    const head = await worker.fetch(new Request('https://feed.example/data/public-feed.json', {method:'HEAD'}), env);
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.deepEqual(calls, [['get',PUBLIC_FEED_KEY], ['get',PUBLIC_FEED_KEY]]);
  } finally {globalThis.fetch = originalFetch;}
});

test('public feed falls back to static published data on missing or temporarily failed storage', async () => {
  for (const get of [async () => null, async () => {throw Error('storage offline');}]) {
    const calls = [], raw = JSON.stringify(seed());
    const response = await worker.fetch(new Request('https://feed.example/data/public-feed.json'), {
      PUBLIC_FEED:{get, put:async () => {throw Error('read must not write');}},
      ASSETS:{fetch:async request => {calls.push(request.url); return new Response(raw);}},
    });
    assert.equal(response.status, 200); assert.equal(await response.text(), raw);
    assert.deepEqual(calls, ['https://feed.example/data/public-feed.json']);
  }
});

test('public feed rejects mutation methods before storage or assets are contacted', async () => {
  const env = {PUBLIC_FEED:{get:async () => {throw Error('must not read');},put:async () => {throw Error('must not write');}},
    ASSETS:{fetch:async () => {throw Error('must not proxy mutations');}}};
  for (const method of ['POST','PUT','PATCH','DELETE']) {
    const response = await worker.fetch(new Request('https://feed.example/data/public-feed.json', {method}), env);
    assert.equal(response.status, 405); assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
});

test('a continuation without the refresh token does not touch the snapshot', async () => {
  let writes=0;
  const response=await worker.fetch(new Request('https://feed.example'+PUBLIC_REFRESH_PATH,{method:'POST',headers:{'x-woyun-refresh-token':'not-the-job'}}),{
    PUBLIC_FEED:{get:async()=>null,put:async()=>{writes+=1;}},
  });
  assert.equal(response.status,404);
  assert.equal(writes,0);
});

test('scheduled refresh reads a bounded source batch, then still publishes without dropping earlier items', async () => {
  const previous=seed(), original=JSON.stringify(previous);
  const sspai=FEED_CHANNELS.find(source=>source.id==='sspai');
  const others=FEED_CHANNELS.filter(source=>source.format==='rss' && !source.creator_scope && !source.youtube_channel_id && source.id!=='sspai').slice(0,7);
  const definitions=[...others,sspai];
  const calls=[];
  const store=new Map([[PUBLIC_FEED_KEY, original]]);
  const kv={
    async get(key, type){const raw=store.get(key); if(raw==null) return null; return type==='json' ? JSON.parse(raw) : raw;},
    async put(key, value){store.set(key, value);},
    async delete(key){store.delete(key);},
  };
  const fetchImpl=async url=>{
    calls.push(String(url));
    if(new URL(url).hostname==='api.github.com') return repositoryResponse();
    const source=definitions.find(entry=>entry.feed_url===String(url));
    if(!source) throw Error('unexpected source');
    if(source.id==='sspai') throw Error('reader failed');
    return new Response(rss(`https://example.com/${source.id}/item`));
  };
  const env={PUBLIC_FEED:kv, SELF:{fetch:async()=>new Response(null,{status:204})}};
  const options={definitions, fetchImpl, now};
  const originalWarn=console.warn, originalLog=console.log;
  console.warn=()=>{}; console.log=()=>{};
  try {
    await runScheduledUpdate(env, options);
    assert.equal(calls.length, PUBLIC_REFRESH_SOURCE_BATCH);
    assert.equal(store.get(PUBLIC_FEED_KEY), original, 'a source batch does not replace the snapshot');
    assert.equal(JSON.parse(store.get(PUBLIC_REFRESH_JOB_KEY)).cursor, PUBLIC_REFRESH_SOURCE_BATCH);
    let published=null;
    for(let hop=0; hop<12 && store.has(PUBLIC_REFRESH_JOB_KEY); hop+=1) published=await runScheduledUpdate(env, options);
    assert.equal(store.has(PUBLIC_REFRESH_JOB_KEY), false);
    assert.equal(calls.length, 1+definitions.length);
    assert.equal(published.items.some(item=>item.original_url==='https://sspai.com/post/10001'), true);
    assert.equal(published.sources.find(source=>source.id==='sspai').status, 'failed');
    assert.equal(published.sources.find(source=>source.id==='sspai').last_success_at, oldTime);
    assert.equal(published.items.some(item=>item.original_url===`https://example.com/${others[0].id}/item`), true);
    assert.equal(store.get(PUBLIC_FEED_KEY), JSON.stringify(published));
  } finally {console.warn=originalWarn; console.log=originalLog;}
});

test('a broken refresh chain publishes completed sources and keeps sources it has not read yet', async () => {
  const previous=seed();
  const sspai=FEED_CHANNELS.find(source=>source.id==='sspai');
  const others=FEED_CHANNELS.filter(source=>source.format==='rss' && !source.creator_scope && !source.youtube_channel_id && source.id!=='sspai').slice(0,7);
  const definitions=[...others,sspai];
  const calls=[];
  const store=new Map([[PUBLIC_FEED_KEY, JSON.stringify(previous)]]);
  const kv={
    async get(key, type){const raw=store.get(key); if(raw==null) return null; return type==='json' ? JSON.parse(raw) : raw;},
    async put(key, value){store.set(key, value);},
    async delete(key){store.delete(key);},
  };
  const fetchImpl=async url=>{
    calls.push(String(url));
    if(new URL(url).hostname==='api.github.com') return repositoryResponse();
    const source=definitions.find(entry=>entry.feed_url===String(url));
    if(!source) throw Error('unexpected source');
    return new Response(rss(`https://example.com/${source.id}/item`));
  };
  const env={PUBLIC_FEED:kv, SELF:{fetch:async()=>{throw Error('chain broke');}}};
  const originalWarn=console.warn, originalLog=console.log;
  console.warn=()=>{}; console.log=()=>{};
  try {
    const published=await runScheduledUpdate(env, {definitions, fetchImpl, now});
    assert.equal(calls.length, PUBLIC_REFRESH_SOURCE_BATCH);
    assert.equal(published.items.some(item=>item.original_url==='https://sspai.com/post/10001'), true);
    assert.equal(published.sources.find(source=>source.id==='sspai').last_success_at, oldTime);
    assert.equal(published.sources.find(source=>source.id==='sspai').status, 'ok');
    assert.equal(published.items.some(item=>item.original_url===`https://example.com/${others[0].id}/item`), true);
    assert.equal(published.items.some(item=>item.original_url===`https://example.com/${sspai.id}/item`), false);
    assert.equal(store.get(PUBLIC_FEED_KEY), JSON.stringify(published));
  } finally {console.warn=originalWarn; console.log=originalLog;}
});
