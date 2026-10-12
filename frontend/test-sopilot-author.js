import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSopilotAuthor, readSopilotAuthor} from './sopilot-author-reader.js';

// Synthetic content only; the public author-page shape was observed 2026-10-03
// and its paired mediaUrls/mediaTypes were verified again 2026-10-09.
const source = {channel: 'creator-demo', format: 'sopilot-author', creator_handle: 'demo_creator',
  feed_url: 'https://sopilot.net/zh/rank/creators/demo_creator'};
const post = (overrides = {}) => ({id: '2105614023941316931', screenName: 'demo_creator', authorName: '测试作者',
  text: '截图后怎样添加箭头\n第一步打开截图；第二步选择箭头；最后导出图片。',
  sourceUrl: 'https://x.com/demo_creator/status/2105614023941316931', tweetCreatedAt: '2026-10-01T11:01:18Z',
  lastSyncedAt: '2026-10-03T00:18:13.240Z', updatedAt: '2026-10-03T00:18:13.300Z',
  viewsCount: 42, likesCount: 2, bookmarksCount: 1, mediaUrls: [], mediaTypes: [], ...overrides});
const props = (overrides = {}) => ({locale: 'zh', page: '1', query: '', backHref: '/zh/rank/creators?range=7d&sort=followers',
  detail: {account: {screenName: 'demo_creator', name: '测试作者'}, timeRange: '7d', sort: 'followers',
    posts: [post()], articles: [{text: '另一种文章，不是原帖摘录'}], ...overrides}});
const packet = value => `<script>self.__next_f.push(${JSON.stringify([1,value])})</script>`;
const fixture = (data = props(), {extras = '', split = false, textRecords = ''} = {}) => {
  const stream = `${textRecords}39:I[9157,[],"default"]\n6:${JSON.stringify(['$','$L39',null,data])}\n`;
  const chunks = split ? packet(stream.slice(0, 70)) + packet(stream.slice(70)) : packet(stream);
  return `<main data-rank-page="true">公开作者榜单</main>${extras}${chunks}`;
};
const response = (data = props(), options = {}) => new Response(fixture(data), {headers: {'content-type':'text/html'}, ...options});

test('an exact author page preserves a practical non-AI excerpt and its limited seven-day read scope', () => {
  const body = parseSopilotAuthor(fixture(), source), [item] = body.items;
  assert.equal(body.id, source.channel);assert.equal(body.status, 'success');assert.equal(body.read_scope, 'author-7d-top10');
  assert.equal(item.title, '截图后怎样添加箭头');assert.equal(item.summary, post().text);
  assert.equal(item.author_handle, 'demo_creator');assert.equal(item.author_name, '测试作者');
  assert.equal(item.url, post().sourceUrl);assert.equal(item.published_at, '2026-10-01T11:01:18.000Z');
  assert.equal(item.heat_label, '42 次浏览');assert.equal(item.extra.date, '2026-10-03T00:18:13.240Z');
  assert.equal(item.extra.read_scope, 'author-7d-top10');assert.equal(item.extra.excerpt_truncated, false);
  assert.equal(item.extra.excerpt_original_length, post().text.length);
  assert.ok(!/AI|人工智能/.test(item.summary));assert.ok(!JSON.stringify(body).includes('另一种文章'));
});

test('an author post retains only the first static main-row image with the unchanged reading scope', () => {
  const photo = 'https://pbs.twimg.com/media/DemoAuthorPhoto.jpg';
  const [item] = parseSopilotAuthor(fixture(props({posts: [post({mediaUrls: [photo,
    'https://pbs.twimg.com/media/DemoSecondPhoto.jpg'], mediaTypes: ['photo', 'photo'],
    authorAvatar: 'https://pbs.twimg.com/profile_images/123456/avatar.jpg',
    quotedTweet: {mediaUrls: ['https://pbs.twimg.com/media/DemoQuotedPhoto.jpg'], mediaTypes: ['photo']},
  })]})), source).items;
  assert.deepEqual(item.post_image, {url: photo, kind: 'photo', source_url: item.url});
  assert.equal(item.extra.read_scope, 'author-7d-top10'); assert.equal(item.summary, post().text);
  assert.ok(!JSON.stringify(item).includes('DemoSecondPhoto'));
  assert.ok(!JSON.stringify(item).includes('DemoQuotedPhoto'));
  assert.ok(!JSON.stringify(item).includes('profile_images'));
});

test('an author video thumbnail stays a static poster while video and animated sources are omitted', () => {
  const poster = 'https://pbs.twimg.com/amplify_video_thumb/2106552022472507392/img/DemoPoster.jpg';
  const video = 'https://video.twimg.com/amplify_video/2106552022472507392/vid/avc1/1920x1080/DemoVideo.mp4';
  const [item] = parseSopilotAuthor(fixture(props({posts: [post({mediaUrls: [poster, video],
    mediaTypes: ['photo', 'video']})]})), source).items;
  assert.deepEqual(item.post_image, {url: poster, kind: 'video_poster', source_url: item.url});
  assert.ok(!JSON.stringify(item).includes(video));
  const [animatedOnly] = parseSopilotAuthor(fixture(props({posts: [post({mediaUrls: [video],
    mediaTypes: ['animated_gif']})]})), source).items;
  assert.equal(animatedOnly.post_image, undefined);
});

test('invalid optional author media never removes its valid text or adopts an avatar or nested quote', () => {
  const photo = 'https://pbs.twimg.com/media/DemoAuthorPhoto.jpg';
  for (const overrides of [{mediaUrls: undefined, mediaTypes: undefined},
    {mediaUrls: [photo], mediaTypes: []}, {mediaUrls: [photo, photo], mediaTypes: ['photo']},
    {mediaUrls: ['https://pbs.twimg.com/profile_images/123456/avatar.jpg'], mediaTypes: ['photo']},
    {mediaUrls: ['https://evil.example/media/DemoAuthorPhoto.jpg'], mediaTypes: ['photo']},
    {authorAvatar: photo, quotedTweet: {mediaUrls: [photo], mediaTypes: ['photo']}}]) {
    const [item] = parseSopilotAuthor(fixture(props({posts: [post(overrides)]})), source).items;
    assert.equal(item.summary, post().text); assert.equal(item.post_image, undefined);
  }
});

test('validated zero posts is a successful empty author result, while malformed or missing posts is failure', () => {
  const body = parseSopilotAuthor(fixture(props({posts: []})), source);
  assert.equal(body.status, 'success');assert.deepEqual(body.items, []);
  for (const posts of [null, undefined, '$3a', {}, Array.from({length:11}, () => post())]) {
    assert.throws(() => parseSopilotAuthor(fixture(props({posts})), source));
  }
  assert.throws(() => parseSopilotAuthor('<html>登录后查看作者</html>', source));
  assert.throws(() => parseSopilotAuthor(fixture().replace('data-rank-page="true"',''), source));
});

test('the requested author identity and seven-day page cannot silently become another account, range, or search', () => {
  for (const overrides of [{account:{screenName:'other_author'}}, {account:null}, {account:{}}, {timeRange:'24h'}, {timeRange:'30d'}]) {
    assert.throws(() => parseSopilotAuthor(fixture(props(overrides)), source));
  }
  for (const override of [{locale:'en'}, {page:'2'}, {query:'教程'}]) {
    assert.throws(() => parseSopilotAuthor(fixture({...props(),...override}), source));
  }
  const body = parseSopilotAuthor(fixture(props({account:{screenName:'DEMO_CREATOR'}, posts:[post({screenName:'DEMO_CREATOR',
    sourceUrl:'https://twitter.com/DEMO_CREATOR/status/2105614023941316931'})]})), source);
  assert.equal(body.items[0].url, 'https://x.com/DEMO_CREATOR/status/2105614023941316931');
});

test('a foreign author inside an otherwise matching author page rejects the whole transaction', () => {
  assert.throws(() => parseSopilotAuthor(fixture(props({posts:[post(),post({id:'2105614023941316932',
    screenName:'other_author',sourceUrl:'https://x.com/other_author/status/2105614023941316932'})]})), source), /其他作者/);
  for (const screenName of ['@demo_creator', '', '$3a', null, 'demo_creat\u0000or', ' demo_creator ']) {
    assert.throws(() => parseSopilotAuthor(fixture(props({posts:[post({screenName})]})), source));
  }
});

test('unsafe, forged, or mismatched original post links reject rather than entering the author excerpt', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'http://x.com/demo_creator/status/2105614023941316931',
    'https://x.com.evil.example/demo_creator/status/2105614023941316931',
    'https://x.com@evil.example/demo_creator/status/2105614023941316931',
    'https://user:pass@x.com/demo_creator/status/2105614023941316931',
    'https://x.com:8443/demo_creator/status/2105614023941316931',
    'https://x.com/other/status/2105614023941316931', 'https://x.com/demo_creator/status/9999999999999999999',
    'https://x.com/demo_creator/status/2105614023941316931/photo/1',
    'https://x.com/demo_creator/status/%32%31%30%35%36%31%34%30%32%33%39%34%31%33%31%36%39%33%31']) {
    assert.throws(() => parseSopilotAuthor(fixture(props({posts:[post({sourceUrl})]})), source));
  }
  for (const host of ['x.com','www.x.com','twitter.com','www.twitter.com']) {
    const [item] = parseSopilotAuthor(fixture(props({posts:[post({sourceUrl:
      `https://${host}/demo_creator/status/2105614023941316931?tracking=removed#reply`})]})), source).items;
    assert.equal(item.url, post().sourceUrl);
  }
});

test('author pages retain long main excerpts and explicitly mark the twelve-thousand character boundary', () => {
  const within = '长教程\n' + '步骤、截图与结果。'.repeat(500);
  const [complete] = parseSopilotAuthor(fixture(props({posts:[post({text:within})]})), source).items;
  assert.equal(complete.summary, within);assert.equal(complete.extra.excerpt_truncated, false);
  const longText = '中'.repeat(11999) + '🧰' + '结尾'.repeat(20);
  const textRecord = `3a:T${Buffer.byteLength(longText).toString(16)},${longText}`;
  const [truncated] = parseSopilotAuthor(fixture(props({posts:[post({text:'$3a'})]}),
    {textRecords:textRecord,split:true}), source).items;
  assert.equal(truncated.summary.length,11999);assert.equal(truncated.extra.excerpt_truncated,true);
  assert.equal(truncated.extra.excerpt_original_length,longText.length);
  assert.ok(!/[\uD800-\uDBFF]$/.test(truncated.summary));
});

test('nested quotes, article lists, ad scripts and duplicated status IDs do not become extra author posts', () => {
  const data = props({posts:[post({quotedTweet:{text:'引用帖另一作者的正文'}}),post({text:'重复记录'}),
    post({id:'2105614023941316932',text:'广告记录',isAd:true})]});
  const body = parseSopilotAuthor(fixture(data,{extras:'<script>globalThis.__authorScriptExecuted = true</script>'
    + '<script src="https://example.com/ad.js"></script>'}),source);
  assert.equal(body.items.length,1);assert.equal(globalThis.__authorScriptExecuted,undefined);
  assert.ok(!JSON.stringify(body).includes('引用帖'));assert.ok(!JSON.stringify(body).includes('广告记录'));
});

test('Flight escapes remain literal, while unresolved or malformed public text is not adopted', () => {
  for (const text of ['$$SOL','$$a','$$L39']) {
    const [item] = parseSopilotAuthor(fixture(props({posts:[post({text})]})),source).items;
    assert.equal(item.summary,text.slice(1));
  }
  for (const overrides of [{text:'$a'},{text:'$L39'},{text:'$undefined'},{text:''},{authorName:'$a'},
    {authorName:null},{id:2105614023941316931}]) {
    assert.throws(() => parseSopilotAuthor(fixture(props({posts:[post(overrides)]})),source));
  }
  assert.throws(() => parseSopilotAuthor(fixture() + packet(`7:${JSON.stringify(['$','$L39',null,props()])}\n`),source));
  assert.throws(() => parseSopilotAuthor(fixture() + '<script>self.__next_f.push([1,malformed])</script>',source));
  assert.throws(() => parseSopilotAuthor(fixture() + ' '.repeat(2*1024*1024),source));
});

test('missing engagement and invalid calendar dates stay unknown rather than implying zero or a recent post', () => {
  for (const value of [null,undefined,'2小时之前','2026-02-30T10:00:00Z','2026-10-03','not-a-date']) {
    const [item] = parseSopilotAuthor(fixture(props({posts:[post({tweetCreatedAt:value,lastSyncedAt:value,
      updatedAt:value,viewsCount:null})]})),source).items;
    assert.equal(item.published_at,null);assert.equal(item.extra.date,null);assert.equal(item.heat_label,null);
  }
  const [zero] = parseSopilotAuthor(fixture(props({posts:[post({viewsCount:0})]})),source).items;
  assert.equal(zero.heat_label,'0 次浏览');
});

test('one exact public GET omits caller credentials and never follows redirects or fetches arbitrary sources', async () => {
  let captured,calls=0;
  const body = await readSopilotAuthor(source,{headers:{Authorization:'private',Cookie:'private','X-Api-Key':'private',
    Accept:'text/html','Accept-Language':'zh-CN','User-Agent':'PersonalFeed-test'},fetchImpl:async(url,options)=>{
    calls++;captured={url,options};return response();}});
  assert.equal(calls,1);assert.equal(body.items.length,1);assert.equal(captured.url,source.feed_url);
  assert.equal(captured.options.method,'GET');assert.equal(captured.options.credentials,'omit');assert.equal(captured.options.redirect,'error');
  assert.equal(captured.options.headers.get('authorization'),null);assert.equal(captured.options.headers.get('cookie'),null);
  assert.equal(captured.options.headers.get('x-api-key'),null);assert.equal(captured.options.headers.get('user-agent'),'PersonalFeed-test');
  assert.equal(captured.options.headers.get('accept-language'),'zh-CN');
  const invalid = ['https://example.com/zh/rank/creators/demo_creator', 'http://sopilot.net/zh/rank/creators/demo_creator',
    'https://user:pass@sopilot.net/zh/rank/creators/demo_creator', 'https://sopilot.net/zh/rank/creators/other_author',
    'https://sopilot.net/en/rank/creators/demo_creator', 'https://sopilot.net:8443/zh/rank/creators/demo_creator',
    'https://sopilot.net/zh/rank/creators/demo_creator?range=30d', 'https://sopilot.net/zh/rank/creators/demo_creator#hash'];
  for (const feed_url of invalid) {
    calls=0;await assert.rejects(readSopilotAuthor({...source,feed_url},{fetchImpl:async()=>{calls++;return response();}}));
    assert.equal(calls,0);
  }
  for (const override of [{creator_handle:'@demo_creator'},{format:'sopilot-rank'},{creator_handle:'evil/host'},{creator_handle:123}]) {
    calls=0;await assert.rejects(readSopilotAuthor({...source,...override},{fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
  }
  calls=0;await assert.rejects(readSopilotAuthor(source,{redirect:'follow',fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
});

test('HTTP failure, redirect and broken format reject with cancellation without treating them as empty success', async () => {
  for (const mode of ['http','redirect','format']) {
    let cancelled=false;
    const upstream = new Response(new ReadableStream({start(stream){stream.enqueue(new TextEncoder().encode('<html>login</html>'));},
      cancel(){cancelled=true;return new Promise(()=>{});}}),{status:mode==='http'?403:mode==='redirect'?302:200});
    await assert.rejects(readSopilotAuthor(source,{redirect:'manual',fetchImpl:async()=>upstream,
      ...(mode==='format'?{readText:async()=>'<html>login</html>'}:{})}));
    assert.equal(cancelled,true,mode);
  }
  const redirected=response();Object.defineProperty(redirected,'redirected',{value:true});
  await assert.rejects(readSopilotAuthor(source,{fetchImpl:async()=>redirected}));
});

test('declared, streamed, and injected bodies remain bounded to two MiB', async () => {
  for (const mode of ['declared','stream']) {
    let cancelled=false;
    const upstream = new Response(new ReadableStream({pull(stream){stream.enqueue(new Uint8Array(mode==='stream'?2*1024*1024+1:1));},
      cancel(){cancelled=true;}}),{headers:mode==='declared'?{'content-length':String(2*1024*1024+1)}:{}});
    await assert.rejects(readSopilotAuthor(source,{fetchImpl:async()=>upstream}));assert.equal(cancelled,true);
  }
  let capturedBound;
  await readSopilotAuthor(source,{fetchImpl:async()=>response(),readText:async(r,bound)=>{capturedBound=bound;return r.text();}});
  assert.equal(capturedBound,2*1024*1024);
  await assert.rejects(readSopilotAuthor(source,{fetchImpl:async()=>response(),readText:async()=> '中'.repeat(800000)}));
});

test('caller cancellation covers a pending body and no delayed response can later become a successful update', async () => {
  const controller=new AbortController();let started,late;
  const began=new Promise(resolve=>{started=resolve;});
  const operation=readSopilotAuthor(source,{signal:controller.signal,fetchImpl:async()=>response(),
    readText:()=>{started();return new Promise(resolve=>{late=resolve;});}});
  await began;controller.abort();await assert.rejects(operation,error=>error.name==='AbortError');
  late(fixture());await assert.rejects(operation,error=>error.name==='AbortError');
  const already=new AbortController();already.abort();let calls=0;
  await assert.rejects(readSopilotAuthor(source,{signal:already.signal,fetchImpl:async()=>{calls++;return response();}}));assert.equal(calls,0);
});

test('even callers without a deadline cannot leave author fetch or body reads hanging indefinitely', async () => {
  for (const mode of ['fetch','body']) {
    await assert.rejects(readSopilotAuthor(source,{timeoutMs:10,
      fetchImpl:()=>mode==='fetch'?new Promise(()=>{}):response(),
      ...(mode==='body'?{readText:()=>new Promise(()=>{})}:{})}),error=>error.name==='TimeoutError');
  }
  for (const timeoutMs of [0,10001,'10',NaN]) {
    let calls=0;await assert.rejects(readSopilotAuthor(source,{timeoutMs,fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
  }
});
