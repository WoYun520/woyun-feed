import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSopilotRank, readSopilotRank } from './sopilot-source-reader.js';

// Synthetic short text with the public component shape observed 2026-10-02;
// paired mediaUrls/mediaTypes were verified on public pages 2026-10-09.
// The complete real webpage is not copied into the project or test fixtures.
const source = {channel: 'sopilot-ai', sopilot_category: 'AI'};
const tweet = (overrides = {}) => ({id: '2105614023941316931', rank: 3, text: '一个 AI 工具\n原作者的第二行。',
  authorName: '测试作者', screenName: 'demo_creator', sourceUrl: 'https://x.com/demo_creator/status/2105614023941316931',
  tweetCreatedAt: '2026-10-01T11:01:18.000Z', updatedAt: '2026-10-02T04:30:20.580Z',
  lastSyncedAt: '2026-10-02T04:30:20.564Z', velocityScore: 192687.94, heatScore: 65014.81,
  articleTitle: null, mediaUrls: [], mediaTypes: [], ...overrides});
const props = (overrides = {}) => ({locale: 'zh', range: '24h', category: 'AI', page: 1, totalPages: 2,
  risingTweets: [tweet()], hotTweets: [tweet({text: '另一个曝光榜里的内容'})], ...overrides});
const packet = value => `<script>self.__next_f.push(${JSON.stringify([1, value])})</script>`;
const fixture = (data = props(), {split = false, extras = ''} = {}) => {
  const stream = `39:I[9157,[],"default"]\n6:${JSON.stringify(['$', '$L39', null, data])}\n`;
  const pushes = split ? packet(stream.slice(0, 80)) + packet(stream.slice(80)) : packet(stream);
  return `<main data-rank-page="true">可见公开榜单</main>${extras}${pushes}`;
};

test('SoPilot reads the observed public category and the single rising leaderboard', () => {
  const body = parseSopilotRank(fixture(), source), [item] = body.items;
  assert.equal(body.id, source.channel); assert.equal(body.status, 'success'); assert.equal(body.items.length, 1);
  assert.equal(item.title, '一个 AI 工具'); assert.equal(item.summary, '一个 AI 工具\n原作者的第二行。');
  assert.equal(item.author_name, '测试作者'); assert.equal(item.author_handle, 'demo_creator');
  assert.equal(item.url, 'https://x.com/demo_creator/status/2105614023941316931');
  assert.equal(item.published_at, '2026-10-01T11:01:18.000Z'); assert.equal(item.extra.date, '2026-10-02T04:30:20.564Z');
  assert.equal(item.source_rank, 3); assert.equal(item.heat_label, '19.3万 曝光/小时');
  assert.ok(!JSON.stringify(body).includes('另一个曝光榜')); assert.ok(!JSON.stringify(body).includes('65014.81'));
});

test('a rank post retains one static main-row photo and the canonical original-post identity', () => {
  const photo = 'https://pbs.twimg.com/media/DemoMainPhoto.jpg';
  const [item] = parseSopilotRank(fixture(props({risingTweets: [tweet({
    sourceUrl: 'https://twitter.com/demo_creator/status/2105614023941316931?tracking=discard',
    mediaUrls: [photo, 'https://pbs.twimg.com/media/DemoSecondPhoto.jpg'], mediaTypes: ['photo', 'photo'],
    authorAvatar: 'https://pbs.twimg.com/profile_images/123456/avatar.jpg',
    quotedTweet: {mediaUrls: ['https://pbs.twimg.com/media/DemoQuotedPhoto.jpg'], mediaTypes: ['photo']},
  })]})), source).items;
  assert.deepEqual(item.post_image, {url: photo, kind: 'photo', source_url: item.url});
  assert.equal(item.url, 'https://x.com/demo_creator/status/2105614023941316931');
  assert.equal(item.summary, tweet().text);
  assert.ok(!JSON.stringify(item).includes('DemoSecondPhoto'));
  assert.ok(!JSON.stringify(item).includes('DemoQuotedPhoto'));
  assert.ok(!JSON.stringify(item).includes('profile_images'));
});

test('the observed static video thumbnail is labeled as a poster and no video source is retained', () => {
  const poster = 'https://pbs.twimg.com/amplify_video_thumb/2108103672936943616/img/DemoPoster.jpg';
  const video = 'https://video.twimg.com/amplify_video/2108103672936943616/vid/avc1/1920x1080/DemoVideo.mp4?tag=29';
  const [item] = parseSopilotRank(fixture(props({risingTweets: [tweet({mediaUrls: [poster, video],
    mediaTypes: ['photo', 'video']})]})), source).items;
  assert.deepEqual(item.post_image, {url: poster, kind: 'video_poster', source_url: item.url});
  assert.ok(!JSON.stringify(item).includes(video));
});

test('a missing, mismatched, excessive, or unknown media type keeps the valid rank text without an image', () => {
  const photo = 'https://pbs.twimg.com/media/DemoMainPhoto.jpg';
  for (const overrides of [
    {mediaUrls: undefined, mediaTypes: undefined}, {mediaUrls: '$3a', mediaTypes: ['photo']},
    {mediaUrls: [photo], mediaTypes: []}, {mediaUrls: [photo, photo], mediaTypes: ['photo']},
    {mediaUrls: [photo], mediaTypes: ['video']}, {mediaUrls: [photo], mediaTypes: ['animated_gif']},
    {mediaUrls: Array(17).fill(photo), mediaTypes: Array(17).fill('photo')},
    {authorAvatar: photo, quotedTweet: {mediaUrls: [photo], mediaTypes: ['photo']}},
  ]) {
    const [item] = parseSopilotRank(fixture(props({risingTweets: [tweet(overrides)]})), source).items;
    assert.equal(item.summary, tweet().text); assert.equal(item.post_image, undefined);
  }
});

test('rank photos reject unsafe URLs and avatars while a later valid top-level photo remains available', () => {
  const good = 'https://pbs.twimg.com/media/DemoMainPhoto.jpg';
  for (const bad of ['http://pbs.twimg.com/media/DemoMainPhoto.jpg',
    'https://pbs.twimg.com.evil.example/media/DemoMainPhoto.jpg',
    'https://user:password@pbs.twimg.com/media/DemoMainPhoto.jpg',
    'https://pbs.twimg.com/profile_images/123456/avatar.jpg', 'https://pbs.twimg.com/media/DemoMainPhoto.svg',
    'https://video.twimg.com/amplify_video/123456/vid/DemoVideo.mp4', 'javascript:alert(1)', '$3a', null]) {
    const [without] = parseSopilotRank(fixture(props({risingTweets: [tweet({mediaUrls: [bad], mediaTypes: ['photo']})]})), source).items;
    assert.equal(without.post_image, undefined);
    const [withFallback] = parseSopilotRank(fixture(props({risingTweets: [tweet({mediaUrls: [bad, good], mediaTypes: ['photo', 'photo']})]})), source).items;
    assert.equal(withFallback.post_image?.url, good);
  }
});

test('split serialized chunks and Creator category are supported without executing anything', () => {
  const body = parseSopilotRank(fixture(props({category: 'Creator'}), {split: true,
    extras: '<script>globalThis.__sopilotExecuted = true</script><script src="https://ads.example/a.js"></script>'}),
  {channel: 'sopilot-creators', sopilot_category: 'Creator'});
  assert.equal(body.items.length, 1); assert.equal(globalThis.__sopilotExecuted, undefined);
});

test('long main text resolves its public UTF-8 Flight text record with exact byte boundaries', () => {
  const mainText = '中文 AI 工具🧰\n第二行是公开正文。', quotedText = '引用帖另一作者的内容。';
  const textRecord = (id, value) => `${id}:T${Buffer.byteLength(value).toString(16)},${value}`;
  const data = props({risingTweets: [tweet({text: '$3a', quotedTweet: {text: '$3b'}})]});
  const stream = textRecord('3a', mainText) + textRecord('3b', quotedText)
    + `6:${JSON.stringify(['$', '$L39', null, data])}\n`;
  const raw = `<main data-rank-page="true"></main>${packet(stream.slice(0, 17))}${packet(stream.slice(17))}`;
  const [item] = parseSopilotRank(raw, source).items;
  assert.equal(item.title, '中文 AI 工具🧰'); assert.equal(item.summary, mainText);
  assert.ok(!JSON.stringify(item).includes(quotedText));
  for (const invalid of [stream.replace('3a:T', '3a:Tfffff'), stream.replace(/^3a:T[\da-f]+,/, '3a:T1,')]) {
    assert.throws(() => parseSopilotRank(`<main data-rank-page="true"></main>${packet(invalid)}`, source));
  }
});

test('a Flight-escaped dollar prefix stays literal post text, while unresolved data references cannot enter', () => {
  for (const value of ['$$SOL', '$$a', '$$L39']) {
    const [item] = parseSopilotRank(fixture(props({risingTweets: [tweet({text: value})]})), source).items;
    assert.equal(item.summary, value.slice(1)); assert.equal(item.title, value.slice(1));
  }
});

test('SoPilot requires the source requested category, public page marker, and exact current page shape', () => {
  for (const overrides of [{category: 'all'}, {category: 'ai'}, {range: '6h'}, {page: 2}, {locale: 'en'},
    {risingTweets: '$40'}, {hotTweets: null}, {totalPages: 0}]) {
    assert.throws(() => parseSopilotRank(fixture(props(overrides)), source));
  }
  assert.throws(() => parseSopilotRank(fixture(), {...source, sopilot_category: 'Finance'}));
  assert.throws(() => parseSopilotRank(fixture().replace('data-rank-page="true"', ''), source));
  assert.throws(() => parseSopilotRank('<html>captcha or upstream error</html>', source));
  assert.throws(() => parseSopilotRank(fixture(props({risingTweets: []})), source));
});

test('only exact HTTPS original post links and matching author/id survive', () => {
  const unsafe = ['javascript:alert(1)', 'http://x.com/demo_creator/status/2105614023941316931',
    'https://x.com.evil.example/demo_creator/status/2105614023941316931',
    'https://x.com@evil.example/demo_creator/status/2105614023941316931',
    'https://user:pass@x.com/demo_creator/status/2105614023941316931',
    'https://x.com:8443/demo_creator/status/2105614023941316931',
    'https://x.com/demo_creator/status/9999999999999999999',
    'https://x.com/other/status/2105614023941316931',
    'https://x.com/demo_creator/status/2105614023941316931/photo/1',
    'https://x.com/demo_creator/status/%32%31%30%35%36%31%34%30%32%33%39%34%31%33%31%36%39%33%31'];
  for (const url of unsafe) assert.throws(() => parseSopilotRank(fixture(props({risingTweets: [tweet({sourceUrl: url})]})), source));
  for (const host of ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']) {
    const item = parseSopilotRank(fixture(props({risingTweets: [tweet({sourceUrl:
      `https://${host}/demo_creator/status/2105614023941316931?sid=public-tracking#reply`})]})), source).items[0];
    assert.equal(item.url, 'https://x.com/demo_creator/status/2105614023941316931');
  }
});

test('post text never mixes nested quoted text, duplicate posts, ads, or unrelated scripts', () => {
  const quote = {text: '引用帖里的另一作者说法', authorName: '另一作者'};
  const rows = [tweet({quotedTweet: quote}), tweet({text: '重复帖'}),
    tweet({screenName: 'DEMO_CREATOR', sourceUrl: 'https://twitter.com/DEMO_CREATOR/status/2105614023941316931'}),
    tweet({id: '2105614023941316932', sourceUrl: 'https://x.com/demo_creator/status/2105614023941316932', isAd: true})];
  const body = parseSopilotRank(fixture(props({risingTweets: rows}), {extras:
    '<script type="application/json">{"risingTweets":[{"text":"广告脚本"}]}</script>'}), source);
  assert.equal(body.items.length, 1); assert.equal(body.items[0].source_rank, 3);
  assert.ok(!JSON.stringify(body).includes('引用帖')); assert.ok(!JSON.stringify(body).includes('广告脚本'));
});

test('unknown relative times, invalid calendar dates, missing rank and engagement stay unknown', () => {
  for (const value of [null, undefined, '20 小时前', '2026-02-30T11:01:18.000Z', '2026-10-01', 'not-a-date']) {
    const [item] = parseSopilotRank(fixture(props({risingTweets: [tweet({tweetCreatedAt: value,
      updatedAt: value, lastSyncedAt: value, rank: null, velocityScore: null})]})), source).items;
    assert.equal(item.published_at, null); assert.equal(item.extra.date, null);
    assert.equal(item.source_rank, null); assert.equal(item.heat_label, null);
  }
  const [item] = parseSopilotRank(fixture(props({risingTweets: [tweet({velocityScore: 0,
    lastSyncedAt: undefined, updatedAt: '2026-10-02T04:30:20Z'})]})), source).items;
  assert.equal(item.heat_label, '0 曝光/小时'); assert.equal(item.extra.date, '2026-10-02T04:30:20.000Z');
});

test('malformed, excessive and ambiguous Flight data fail closed instead of preserving partial assumptions', () => {
  assert.throws(() => parseSopilotRank(fixture() + packet(`7:${JSON.stringify(['$', '$L39', null, props()])}\n`), source));
  assert.throws(() => parseSopilotRank(fixture() + '<script>self.__next_f.push([1,malformed])</script>', source));
  assert.throws(() => parseSopilotRank(fixture(props({risingTweets: Array.from({length: 201}, () => tweet())})), source));
  assert.throws(() => parseSopilotRank(fixture() + ' '.repeat(2 * 1024 * 1024), source));
  assert.throws(() => parseSopilotRank(fixture() + packet('x'.repeat(1024 * 1024)), source));
  for (const overrides of [{text: '$a'}, {authorName: '$a'}, {text: '$undefined'}, {text: '$L39'},
    {screenName: '@demo_creator'}, {id: 2105614023941316931}]) {
    assert.throws(() => parseSopilotRank(fixture(props({risingTweets: [tweet(overrides)]})), source));
  }
  for (const articleTitle of ['$a', '$L39', '$undefined']) {
    const [item] = parseSopilotRank(fixture(props({risingTweets: [tweet({articleTitle})]})), source).items;
    assert.equal(item.title, '一个 AI 工具');
  }
});

test('bounded unique outputs retain the site rank rather than assigning new ranks after filtering', () => {
  const rows = Array.from({length: 50}, (_, index) => {
    const id = String(2105614023941316900n + BigInt(index));
    return tweet({id, rank: index + 1, sourceUrl: `https://x.com/demo_creator/status/${id}`});
  });
  rows[0].sourceUrl = 'https://evil.example/ad';
  const items = parseSopilotRank(fixture(props({risingTweets: rows})), source).items;
  assert.equal(items.length, 49); assert.equal(items[0].source_rank, 2); assert.equal(items.at(-1).source_rank, 50);
});

const pageRows = (count, start = 1) => Array.from({length:count},(_,index)=>{
  const rank = start + index, id = String(2105614023941316900n + BigInt(rank));
  return tweet({id,rank,sourceUrl:`https://x.com/demo_creator/status/${id}`,text:`公开帖子 ${rank}。`});
});
const pageResponse = (page, overrides = {}) => new Response(fixture(props({page,
  risingTweets:pageRows(50,(page-1)*50+1),...overrides})),{headers:{'content-type':'text/html'}});

test('all four public categories preserve their own identity and exact requested second page', () => {
  for (const category of ['all','AI','Creator','Finance']) {
    const definition = {channel:`sopilot-${category}`,sopilot_category:category};
    const body = parseSopilotRank(fixture(props({category,page:2,risingTweets:pageRows(12,51)})),definition,{page:2});
    assert.equal(body.page,2);assert.equal(body.totalPages,2);assert.equal(body.items.length,12);
    assert.equal(body.items[0].source_rank,51);assert.equal(body.items.at(-1).source_rank,62);
    assert.throws(()=>parseSopilotRank(fixture(props({category,page:1})),definition,{page:2}));
  }
  for (const category of ['Web3','English','ai','Politics']) {
    assert.throws(()=>parseSopilotRank(fixture(props({category})),{...source,sopilot_category:category}));
  }
  for (const page of [0,3,'2',NaN]) assert.throws(()=>parseSopilotRank(fixture(),source,{page}));
});

test('the reader fetches at most two declared pages, keeps ranks 51 to 100, and never mixes hot tweets', async () => {
  const calls = [], controller = new AbortController();
  const body = await readSopilotRank(source,{signal:controller.signal,fetchImpl:async(url,options)=>{
    calls.push({url,options});return pageResponse(Number(new URL(url).searchParams.get('page') || 1),{totalPages:7});
  }});
  assert.equal(calls.length,2);assert.equal(body.items.length,100);
  assert.equal(body.items[0].source_rank,1);assert.equal(body.items.at(-1).source_rank,100);
  assert.equal(body.totalPages,7);assert.equal(body.page,1);
  assert.ok(!JSON.stringify(body).includes('另一个曝光榜'));
  for (const {url,options} of calls) {
    const parsed = new URL(url);assert.equal(parsed.origin,'https://sopilot.net');assert.equal(parsed.pathname,'/zh/rank/tweets');
    assert.equal(parsed.searchParams.get('range'),'24h');assert.equal(parsed.searchParams.get('category'),'AI');
    assert.equal(options.signal,controller.signal);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
  }
});

test('a declared single page reads every valid row without inventing or requesting a second page', async () => {
  let calls = 0;
  const body = await readSopilotRank(source,{fetchImpl:async()=>{calls++;return pageResponse(1,{totalPages:1,risingTweets:pageRows(47)});}});
  assert.equal(calls,1);assert.equal(body.items.length,47);assert.equal(body.items.at(-1).source_rank,47);
  const capped = parseSopilotRank(fixture(props({risingTweets:pageRows(150)})),source);
  assert.equal(capped.items.length,100);assert.equal(capped.items.at(-1).source_rank,100);
});

test('cross-page duplicate status IDs keep their first real rank even when a handle changes letter case', async () => {
  const repeated = pageRows(1,50)[0];
  const body = await readSopilotRank(source,{fetchImpl:async url=>Number(new URL(url).searchParams.get('page') || 1)===1
    ? pageResponse(1) : pageResponse(2,{risingTweets:[{...repeated,rank:51,screenName:'DEMO_CREATOR',
      sourceUrl:`https://twitter.com/DEMO_CREATOR/status/${repeated.id}`},...pageRows(49,52)]})});
  assert.equal(body.items.length,99);
  assert.equal(body.items.filter(item=>item.url.endsWith(`/status/${repeated.id}`)).length,1);
  assert.equal(body.items.find(item=>item.url.endsWith(`/status/${repeated.id}`)).source_rank,50);
  assert.equal(body.items.at(-1).source_rank,100);
});

test('a failed, substituted, empty or drifting second page rejects the whole source transaction', async () => {
  const cases = [()=>new Response('denied',{status:403}),()=>new Response('redirect',{status:302}),
    ()=>pageResponse(1),()=>pageResponse(2,{category:'all'}),()=>pageResponse(2,{range:'7d'}),
    ()=>pageResponse(2,{totalPages:3}),()=>pageResponse(2,{risingTweets:[]}),()=>new Response('<html>format changed</html>'),
    ()=>{throw new Error('second page fetch failed');}];
  for (const second of cases) {
    let calls = 0;
    await assert.rejects(readSopilotRank(source,{redirect:'manual',fetchImpl:async()=>++calls===1 ? pageResponse(1) : second()}));
    assert.equal(calls,2);
  }
});

test('only the fixed public source URL is accepted and caller credential headers are never forwarded', async () => {
  const invalid = ['https://example.com/zh/rank/tweets?range=24h&category=AI',
    'http://sopilot.net/zh/rank/tweets?range=24h&category=AI',
    'https://user:pass@sopilot.net/zh/rank/tweets?range=24h&category=AI',
    'https://sopilot.net/api/private?range=24h&category=AI','https://sopilot.net/en/rank/tweets?range=24h&category=AI',
    'https://sopilot.net/zh/rank/tweets?range=7d&category=AI','https://sopilot.net/zh/rank/tweets?range=24h&category=all',
    'https://sopilot.net/zh/rank/tweets?range=24h&category=AI&page=2',
    'https://sopilot.net/zh/rank/tweets?range=24h&category=AI&token=private',
    'https://sopilot.net/zh/rank/tweets?range=24h&category=AI&category=Creator',
    'https://sopilot.net:8443/zh/rank/tweets?range=24h&category=AI'];
  for (const feed_url of invalid) {
    let calls = 0;await assert.rejects(readSopilotRank({...source,feed_url},{fetchImpl:async()=>{calls++;return pageResponse(1);}}));
    assert.equal(calls,0);
  }
  let captured;
  await readSopilotRank({...source,feed_url:'https://sopilot.net/zh/rank/tweets/?range=24h&category=AI'},
    {headers:{Authorization:'private','Cookie':'private','X-Api-Key':'private',Accept:'text/html','User-Agent':'PersonalFeed-test'},
      fetchImpl:async(_,options)=>{captured=options;return pageResponse(1,{totalPages:1});}});
  assert.equal(captured.headers.get('authorization'),null);assert.equal(captured.headers.get('cookie'),null);
  assert.equal(captured.headers.get('x-api-key'),null);assert.equal(captured.headers.get('user-agent'),'PersonalFeed-test');
  assert.equal(captured.credentials,'omit');
  let calls = 0;
  await assert.rejects(readSopilotRank(source,{redirect:'follow',fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
});

test('body reads are bounded at two MiB, non-success responses are cancelled, and shared readers get the same bound', async () => {
  for (const state of ['declared-oversize','stream-oversize','non-success']) {
    let cancelled = false;
    const stream = new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(state==='stream-oversize' ? 2*1024*1024+1 : 1));},
      cancel(){cancelled=true;}});
    const response = new Response(stream,{status:state==='non-success' ? 429 : 200,
      headers:state==='declared-oversize' ? {'content-length':String(2*1024*1024+1)} : {}});
    await assert.rejects(readSopilotRank(source,{fetchImpl:async()=>response}));assert.equal(cancelled,true,state);
  }
  const bounds = [];
  await readSopilotRank(source,{fetchImpl:async url=>pageResponse(Number(new URL(url).searchParams.get('page') || 1)),
    readText:async(response,maxBytes)=>{bounds.push(maxBytes);return response.text();}});
  assert.deepEqual(bounds,[2*1024*1024,2*1024*1024]);
  await assert.rejects(readSopilotRank(source,{fetchImpl:async()=>pageResponse(1),readText:async()=> '中'.repeat(800000)}));
});

test('one caller abort covers both pages and a pending body read; no late body can become a successful result', async () => {
  const controller = new AbortController();let calls = 0;
  const operation = readSopilotRank(source,{signal:controller.signal,fetchImpl:async()=>{
    if (++calls===2) controller.abort();return pageResponse(calls);
  }});
  await assert.rejects(operation,error=>error.name==='AbortError');assert.equal(calls,2);
  const bodyController = new AbortController();let started,late;
  const began = new Promise(resolve=>{started=resolve;});
  const reading = readSopilotRank(source,{signal:bodyController.signal,fetchImpl:async()=>pageResponse(1),
    readText:()=>{started();return new Promise(resolve=>{late=resolve;});}});
  await began;bodyController.abort();await assert.rejects(reading,error=>error.name==='AbortError');
  late(fixture(props()));
  await assert.rejects(reading,error=>error.name==='AbortError');
  const already = new AbortController();already.abort();let attempted = false;
  await assert.rejects(readSopilotRank(source,{signal:already.signal,fetchImpl:async()=>{attempted=true;}}));assert.equal(attempted,false);
});

test('non-completing cancellation cannot hide HTTP or body failure behind an unbounded cleanup wait', async () => {
  for (const mode of ['http','body-reader','oversize']) {
    let cancelled = false, abortTimer, guardTimer;
    const controller = new AbortController();
    const response = new Response(new ReadableStream({
      pull(stream) {if (mode==='oversize') stream.enqueue(new Uint8Array(2*1024*1024+1));},
      cancel() {cancelled=true;return new Promise(()=>{});},
    }),{status:mode==='http' ? 403 : 200});
    const options = {signal:controller.signal,fetchImpl:async()=>response,
      ...(mode==='body-reader' ? {readText:async()=>{throw new Error('body reader failed');}} : {})};
    const operation = readSopilotRank(source,options);
    abortTimer = setTimeout(()=>controller.abort(),10);
    try {
      const result = await Promise.race([
        operation.then(()=>({resolved:true}),error=>({error})),
        new Promise(resolve=>{guardTimer=setTimeout(()=>resolve({pending:true}),80);}),
      ]);
      assert.equal(result.pending,undefined,`${mode} cleanup exceeded the shared deadline`);
      assert.equal(cancelled,true);assert.ok(result.error);
      assert.match(result.error.message,mode==='http' ? /^upstream 403$/ : mode==='body-reader' ? /body reader failed/ : /页面过大/);
    } finally {clearTimeout(abortTimer);clearTimeout(guardTimer);}
  }
});
