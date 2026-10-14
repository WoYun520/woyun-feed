import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOME_WEEK_BOOKMARK_MIN, addCalendarDays, beijingDateKey, parsePublicHeat, recordKosxBoost, selectHomeShowcase, wouldEnterUnderrated } from './src/homeShowcase.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { KOSX_EMOJI_ALT, KOSX_EMOJI_FRAMES, KOSX_EMOJI_INTERVAL_MS, coverExcerpt, mountKosxEmoji, renderHomeShowcase, resetKosxEmoji } from './src/homeShowcaseView.js';
import { renderWorkspaceNavigation } from './src/workspaceShell.js';
import { KOSX_POOL_HANDLES } from './kosx-pool.js';
import { PUBLIC_FILES } from './public-build.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const app = (homeView = 'latest') => ({homeView, escapeHtml:escape, safeUrl:value => {
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : '#'; }
  catch { return '#'; }
}, formatTime:value => value});
const source = {id:'sopilot-all', name:'SoPilot · 综合推文榜', group:'posts', link_kind:'post', status:'ok', enabled:true};
const post = (id, published, extra = {}) => ({
  id, title:extra.title || `公开帖 ${id}`, summary:extra.summary || `这是来源摘录 ${id}，尚未核对。`,
  source_refs:extra.source_refs || [source.id], link_kind:'post', origin:extra.origin || 'public', content_status:'excerpt_only',
  original_url:extra.url || `https://x.com/example/status/${id}`,
  canonical_url:extra.url || `https://x.com/example/status/${id}`,
  published_at:published, source_item_time:published, captured_at:published,
  heat_label:extra.heat || '', source_rank:extra.rank ?? null, post_image:extra.image,
  ...(extra.author_handle ? {author_handle:extra.author_handle} : {}),
  ...(extra.kosx_review ? {kosx_review:extra.kosx_review} : {}),
  ...(extra.bookmark_count !== undefined ? {bookmark_count:extra.bookmark_count} : {}),
  ...(extra.review_type ? {review_type:extra.review_type} : {}),
  ...(extra.has_article !== undefined ? {has_article:extra.has_article} : {}),
  ...(extra.cover_url !== undefined ? {cover_url:extra.cover_url} : {}),
});
const state = items => ({
  generated_at:'2026-10-10T13:01:27.954Z', mode:'live', sources:[source], allItems:items,
  hiddenItemIds:new Set(), savedItemIds:new Set(), archivedItemIds:new Set(), savedItems:[],
  dotFeaturedItems:[], profile:{exclude:''},
});

test('article-class KOSX cards show a delivered cover and a quote when the cover is missing', () => {
  const articleCover = 'https://cdn.example.com/covers/article-card.jpg?format=jpg&name=large';
  const tutorialCover = 'https://cdn.example.com/covers/tutorial-card.jpg';
  const cardCover = 'https://cdn.example.com/covers/x-article-card.jpg';
  const shortCover = 'https://cdn.example.com/covers/short-card.jpg';
  const pitfallCover = 'https://cdn.example.com/covers/pitfall-card.jpg';
  const outsideCover = 'https://cdn.example.com/covers/not-kosx.jpg';
  const photo = {kind:'photo', url:'https://pbs.twimg.com/media/AbcdEFG.jpg', source_url:'https://x.com/example/status/4401'};
  const items = [
    post('4401', '2026-10-10T08:00:00.000Z', {origin:'kosx_approved', review_type:'文章', bookmark_count:240, title:'带封面的文章', cover_url:articleCover, image:photo, url:'https://x.com/example/status/4401'}),
    post('4402', '2026-10-10T07:00:00.000Z', {origin:'kosx_approved', review_type:'文章', bookmark_count:220, title:'没有封面的文章'}),
    post('4403', '2026-10-10T06:00:00.000Z', {origin:'kosx_approved', review_type:'教程指南', bookmark_count:210, title:'教程封面', cover_url:tutorialCover}),
    post('4404', '2026-10-10T05:00:00.000Z', {origin:'kosx_approved', has_article:true, bookmark_count:205, title:'Article 卡封面', cover_url:cardCover}),
    post('4405', '2026-10-10T04:00:00.000Z', {origin:'kosx_approved', review_type:'短帖', title:'短帖不显示封面', cover_url:shortCover}),
    post('4406', '2026-10-10T03:00:00.000Z', {origin:'kosx_approved', review_type:'避坑', has_article:true, bookmark_count:900, title:'避坑不显示封面', cover_url:pitfallCover}),
    post('4407', '2026-10-10T02:00:00.000Z', {review_type:'文章', bookmark_count:900, title:'非精华不显示封面', cover_url:outsideCover}),
    post('4408', '2026-10-10T01:00:00.000Z', {origin:'kosx_approved', review_type:'文章', bookmark_count:230, title:'坏地址不显示', cover_url:'http://cdn.example.com/covers/nope.jpg'}),
  ];
  const input = state(items);
  const card = (html, group, id) => {
    const start = html.indexOf(`id="home-card-${group}-${id}"`);
    assert.notEqual(start, -1, `${group}:${id}`);
    return html.slice(start, html.indexOf('</article>', start));
  };
  const latest = renderHomeShowcase(app(), input);
  const week = renderHomeShowcase(app('week'), input);
  const shown = card(latest, 'latest', '4401');
  assert.match(shown, /src="https:\/\/cdn\.example\.com\/covers\/article-card\.jpg\?format=jpg&amp;name=large"/);
  assert.match(shown, /class="cover-photo cover-article"/);
  assert.match(shown, /文章封面，未核对原帖/);
  assert.match(shown, /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(shown, /cover-zoom|pbs\.twimg\.com/);
  const bare = card(latest, 'latest', '4402');
  assert.match(bare, /data-cover="quote"/);
  assert.match(bare, /class="cover-quote"/);
  assert.match(bare, /这是来源摘录 4402，尚未核对。/);
  assert.doesNotMatch(bare, /无来源附图|cover-fallback/);
  assert.doesNotMatch(bare, /<img|src=/);
  assert.match(card(latest, 'latest', '4403'), /src="https:\/\/cdn\.example\.com\/covers\/tutorial-card\.jpg"/);
  assert.match(card(latest, 'latest', '4404'), /src="https:\/\/cdn\.example\.com\/covers\/x-article-card\.jpg"/);
  assert.match(card(latest, 'latest', '4405'), /data-cover="quote"/);
  assert.doesNotMatch(card(latest, 'latest', '4405'), /无来源附图|short-card/);
  assert.doesNotMatch(card(latest, 'latest', '4406'), /pitfall-card/);
  assert.doesNotMatch(latest, /not-kosx|covers\/nope|无来源附图/);
  assert.match(card(week, 'week', '4401'), /article-card\.jpg/);
  assert.match(card(week, 'week', '4402'), /data-cover="quote"/);
  assert.doesNotMatch(card(week, 'week', '4402'), /无来源附图|<img/);
  assert.match(card(week, 'week', '4403'), /tutorial-card\.jpg/);
  assert.doesNotMatch(week, /short-card|pitfall-card|not-kosx|covers\/nope/);
  const css = readFileSync(new URL('./src/homeShowcase.css', import.meta.url), 'utf8');
  assert.match(css, /\.cover-photo\.cover-article figcaption/);
});

test('homepage essence cards keep a cover image or a quote and never an empty attachment frame', () => {
  const member = 'ai_suxiaole';
  const withCover = post('9101', '2026-10-14T12:21:00.000Z', {
    origin:'kosx_approved', review_type:'文章', bookmark_count:12, kosx_review:'pool',
    cover_url:'https://cdn.example.com/covers/dense.jpg', author_handle:member,
    url:`https://x.com/${member}/status/9101`, title:`@${member} 的精华帖`,
    summary:'超15万人关注的话题。\n原作者已经把仓库开源。',
  });
  const quote = post('9102', '2026-10-14T11:00:00.000Z', {
    origin:'kosx_approved', author_handle:member, bookmark_count:3,
    url:`https://x.com/${member}/status/9102`, title:`@${member} 的精华帖`,
    summary:'可玩性已经离开玩具级别了。下一句仍在摘录里。',
  });
  const bare = post('9103', '2026-10-14T10:00:00.000Z', {
    origin:'kosx_approved', author_handle:member, url:`https://x.com/${member}/status/9103`,
    title:`@${member} 的精华帖`,
    summary:'账号池成员的精华帖，按时间放上首页。尚未读取原文，未核对热度。不进入昨日最被低估。',
  });
  const createdOnly = post('9104', '2026-10-13T01:00:00.000Z', {
    origin:'kosx_approved', title:'只有创建时间', summary:'金句来自创建时间那条。',
  });
  delete createdOnly.published_at;
  createdOnly.created_at = '2026-10-01T08:30:00.000Z';
  const html = renderHomeShowcase(app(), state([withCover, quote, bare, createdOnly]));
  assert.doesNotMatch(html, /无来源附图|cover-fallback|cover-type|data-review-type/);
  const shown = cardHtml(html, '9101');
  assert.match(shown, /data-cover="media"/);
  assert.match(shown, /src="https:\/\/cdn\.example\.com\/covers\/dense\.jpg"/);
  assert.match(shown, /<time datetime="2026-10-14T12:21:00.000Z">/);
  assert.match(shown, /超15万人关注的话题/);
  assert.match(shown, /<span class="kosx-pool-badge">KOSX<\/span>/);
  assert.match(shown, /@ai_suxiaole 的精华帖/);
  assert.match(shown, /收藏 12/);
  assert.match(shown, /打开原帖/);
  assert.match(shown, />收藏</);
  const said = cardHtml(html, '9102');
  assert.match(said, /data-cover="quote"/);
  assert.match(said, /<blockquote class="cover-quote">可玩性已经离开玩具级别了。下一句仍在摘录里。<\/blockquote>/);
  assert.match(said, /class="cover-author">@ai_suxiaole</);
  assert.match(said, /收藏 3/);
  assert.match(said, /打开原帖/);
  assert.doesNotMatch(said, /<img|cover-frame|无来源附图/);
  const empty = cardHtml(html, '9103');
  assert.match(empty, /data-cover="plain"/);
  assert.match(empty, /@ai_suxiaole 的精华帖/);
  assert.match(empty, /打开原帖/);
  assert.doesNotMatch(empty, /cover-quote|cover-frame|<img|无来源附图|按时间放上首页|来源未提供摘录，请打开原帖/);
  const created = cardHtml(html, '9104');
  assert.match(created, /<time datetime="2026-10-01T08:30:00.000Z">/);
  assert.doesNotMatch(created, /2026-10-13T01:00:00.000Z/);
  const css = readFileSync(new URL('./src/homeShowcase.css', import.meta.url), 'utf8');
  assert.match(css, /\.cover-quote\s*\{[^}]*-webkit-line-clamp:\s*2/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.cover-quote\s*\{[^}]*font-size:\s*22px/);
});

test('beijing yesterday is the calendar day before the published snapshot', () => {
  assert.equal(beijingDateKey(Date.parse('2026-10-10T13:01:27.954Z')), '2026-10-10');
  assert.equal(addCalendarDays('2026-10-10', -1), '2026-10-09');
  assert.equal(parsePublicHeat('1.3K 曝光/小时').value, 1300);
  assert.equal(parsePublicHeat('5.1万 次浏览').unit, 'views');
  assert.equal(parsePublicHeat('没有数字'), null);
});

test('latest keeps 18 homepage essence posts by publication time and does not fill with the public stream', () => {
  const essence = Array.from({length:20}, (_, index) => post(String(200000 + index), `2026-10-10T${String(index).padStart(2,'0')}:00:00.000Z`, {origin:'kosx_approved'}));
  const hot = post('199001', '2026-10-10T23:30:00.000Z', {heat:'5.1万 曝光/小时', title:'2027年或成史上最热一年'});
  const mixed = post('199002', '2026-10-10T23:00:00.000Z', {heat:'100 曝光/小时', source_refs:['sopilot-kosx', 'sopilot-all'], title:'多来源热榜'});
  const sourced = post('199003', '2026-10-10T22:30:00.000Z', {source_refs:['sopilot-kosx'], title:'来源即精华'});
  const folded = post('188001', '2026-10-09T01:00:00.000Z', {origin:'kosx_approved', summary:'转发抽一名，送周边礼品，关注后参与。'});
  const items = [...essence, hot, mixed, sourced, folded];
  const input = state(items);
  input.sources = [source, {id:'sopilot-kosx', name:'KOSX 过审', group:'posts', link_kind:'post', status:'ok', enabled:true}];
  const before = structuredClone(input);
  const selected = selectHomeShowcase(input);
  assert.equal(selected.latest.length, 18);
  assert.deepEqual(selected.latest.map(entry => entry.post.item.id), [sourced.id, ...essence.slice(3).map(item => item.id).reverse()]);
  assert.equal(selected.latest.some(entry => entry.post.item.id === hot.id), false);
  assert.equal(selected.latest.some(entry => entry.post.item.id === mixed.id), false);
  assert.ok(selected.latest.every(entry => input.allItems.some(item => item.id === entry.post.item.id)));
  assert.equal(selected.counts.folded, 1);
  assert.ok(!selected.yesterday.some(entry => entry.post.item.id === '188001'));
  assert.deepEqual(input, before);
  const sparseItems = [
    post('230001', '2026-10-10T08:00:00.000Z', {origin:'kosx_approved', title:'一条精华'}),
    post('230002', '2026-10-10T09:00:00.000Z', {title:'热榜水文', heat:'9万 曝光/小时'}),
  ];
  const sparse = selectHomeShowcase(state(sparseItems));
  assert.deepEqual(sparse.latest.map(entry => entry.post.item.id), ['230001']);
  const note = renderHomeShowcase(app(), state(sparseItems));
  assert.match(note, /已经放上公开首页的精华帖/);
  assert.match(note, /信息流里其他带日期的帖不放进来/);
  assert.match(note, /符合条件的精华帖只有 1 条，没有用假帖或其他公开帖补满 18 条/);
  assert.doesNotMatch(note, /热榜水文|教程精选/);
});

test('昨日全部 is homepage essence for that Beijing day, and underrated is pins only', () => {
  const stream = post('20900111', '2026-10-09T01:00:00.000Z', {heat:'1 曝光/小时', title:'榜单帖'});
  const folded = post('20900811', '2026-10-09T01:30:00.000Z', {origin:'kosx_approved', title:'抽奖精华', summary:'转发抽一名，送周边礼品，关注后参与。'});
  const pooled = post('20901011', '2026-10-09T02:00:00.000Z', {origin:'kosx_approved', kosx_review:'pool', heat:'10 曝光/小时', title:'池内精华'});
  const human = post('20900211', '2026-10-09T03:00:00.000Z', {origin:'kosx_approved', heat:'120 曝光/小时', title:'过审精华'});
  const sourced = post('20900311', '2026-10-09T04:00:00.000Z', {source_refs:['sopilot-kosx'], heat:'450 曝光/小时', title:'来源即过审'});
  const today = post('21000111', '2026-10-10T08:00:00.000Z', {origin:'kosx_approved', title:'今天的精华'});
  const otherDay = post('20800111', '2026-10-08T08:00:00.000Z', {origin:'kosx_approved', heat:'1 曝光/小时', title:'前天的精华'});
  const items = [stream, folded, pooled, human, sourced, today, otherDay];
  const input = state(items);
  input.sources = [source, {id:'sopilot-kosx', name:'KOSX 过审', group:'posts', link_kind:'post', status:'ok', enabled:true}];
  const selected = selectHomeShowcase(input);
  assert.equal(selected.reference.yesterday, '2026-10-09');
  assert.deepEqual(selected.yesterday.map(entry => entry.post.item.id), [sourced.id, human.id, pooled.id]);
  assert.equal(selected.underrated.length, 0);
  assert.equal(selected.underratedRule, 'empty');
  assert.match(selected.underratedNote, /昨日全部/);
  assert.match(selected.underratedNote, /不按来源热度/);
  assert.match(selected.underratedNote, /昨日最被低估必须人工过审/);
  assert.deepEqual(selected.latest.map(entry => entry.post.item.id), [today.id, sourced.id, human.id, pooled.id, otherDay.id]);
  assert.equal(selected.latest.some(entry => entry.post.item.id === stream.id), false);
  assert.equal(wouldEnterUnderrated(input, stream.id), false);
  assert.equal(wouldEnterUnderrated(input, human.id), true);
  assert.equal(wouldEnterUnderrated(input, pooled.id), false);
  assert.ok(selected.reference.weekKeys.includes('2026-10-04'));
  assert.ok(selected.reference.weekKeys.includes('2026-10-10'));
  const pin = (item, day) => ({id:item.id, key:`x:${item.id}`, url:item.original_url, day});
  const pinned = selectHomeShowcase({...input, underratedPins:[pin(pooled, '2026-10-09'), pin(sourced, '2026-10-09'), pin(human, '2026-10-09'), pin(stream, '2026-10-09'), pin(otherDay, '2026-10-08')]});
  assert.equal(pinned.underratedRule, 'pinned');
  assert.deepEqual(pinned.underrated.map(entry => entry.post.item.id), [pooled.id, sourced.id]);
  const one = selectHomeShowcase({...input, underratedPins:[pin(human, '2026-10-09')]});
  assert.deepEqual(one.underrated.map(entry => entry.post.item.id), [human.id]);
  const missed = selectHomeShowcase({...input, underratedPins:[pin(stream, '2026-10-09'), pin(otherDay, '2026-10-08')]});
  assert.equal(missed.underratedRule, 'empty');
  assert.deepEqual(missed.underrated, []);
  const page = renderHomeShowcase(app('yesterday'), input);
  assert.match(page, /已经放上公开首页的精华帖/);
  assert.match(page, /过审精华/);
  assert.match(page, /池内精华/);
  assert.match(page, /来源即过审/);
  assert.doesNotMatch(page, /榜单帖|抽奖精华|今天的精华|前天的精华/);
  const html = renderHomeShowcase(app(), {...input, underratedPins:[pin(human, '2026-10-09'), pin(sourced, '2026-10-09')]});
  const band = html.slice(html.indexOf('id="home-underrated"'));
  assert.match(band, /data-underrated-rule="pinned"/);
  assert.match(band, /昨日最被低估精华帖/);
  assert.doesNotMatch(band, /<p class="home-rule"|人工钉选的顺序|按现有公开指标粗排/);
  assert.ok(band.indexOf('过审精华') < band.indexOf('来源即过审'));
  assert.doesNotMatch(band, /池内精华|榜单帖/);
  const pooledHtml = renderHomeShowcase(app(), {...input, underratedPins:[pin(pooled, '2026-10-09')]});
  const pooledBand = pooledHtml.slice(pooledHtml.indexOf('id="home-underrated"'));
  assert.match(pooledBand, /data-underrated-rule="pinned"/);
  assert.match(pooledBand, /池内精华/);
  assert.doesNotMatch(pooledBand, /榜单帖/);
  const quiet = renderHomeShowcase(app(), input);
  assert.doesNotMatch(quiet, /id="home-underrated"|昨日最被低估精华帖/);
});

test('public feed pins reach the homepage through the adapter', () => {
  const previous = globalThis.localStorage;
  const bag = new Map();
  globalThis.localStorage = {getItem:key => bag.get(key) ?? null, setItem:(key, value) => bag.set(key, value), removeItem:key => bag.delete(key), key:index => [...bag.keys()][index] ?? null, get length() { return bag.size; }};
  try {
    const pinned = post('20900411', '2026-10-09T04:00:00.000Z', {heat:'9000 曝光/小时', title:'钉选原帖', origin:'kosx_approved'});
    const low = post('20900211', '2026-10-09T02:00:00.000Z', {heat:'120 曝光/小时', title:'低热度原帖', origin:'kosx_approved'});
    const adapter = new FeedDataAdapter();
    adapter.feedData = {
      mode:'live', schema_version:'0.3', profile:{exclude:''}, sources:[source],
      items:[pinned, low], sections:{daily:[], discover:[]}, generated_at:'2026-10-10T13:01:27.954Z',
      underrated_pins:[{id:pinned.id, key:`x:${pinned.id}`, url:pinned.original_url, day:'2026-10-09', pinned_at:'2026-10-10T06:00:00.000Z'}],
    };
    const selected = selectHomeShowcase(adapter.getState());
    assert.deepEqual(adapter.getState().underratedPins.map(pin => pin.id), [pinned.id]);
    assert.equal(selected.underratedRule, 'pinned');
    assert.deepEqual(selected.underrated.map(entry => entry.post.item.id), [pinned.id]);
    assert.equal(selected.underrated.some(entry => entry.post.item.id === low.id), false);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

function cardHtml(html, id) {
  const marker = `data-home-card="${id}"`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, id);
  const open = html.lastIndexOf('<article', start);
  const close = html.indexOf('</article>', start);
  return html.slice(open, close);
}

test('an empty underrated band is omitted and a pinned band stays on the homepage', () => {
  const today = post('21009911', '2026-10-10T08:00:00.000Z', {title:'今天的公开帖', origin:'kosx_approved'});
  const yesterday = post('20900211', '2026-10-09T02:00:00.000Z', {title:'过审精华', heat:'120 曝光/小时', origin:'kosx_approved'});
  const stream = post('20900311', '2026-10-09T03:00:00.000Z', {title:'榜单帖', heat:'1 曝光/小时'});
  const emptyHtml = renderHomeShowcase(app(), state([today, yesterday, stream]));
  assert.match(emptyHtml, /id="home-latest"/);
  assert.doesNotMatch(emptyHtml, /id="home-underrated"/);
  assert.doesNotMatch(emptyHtml, /昨日最被低估精华帖/);
  assert.doesNotMatch(emptyHtml, /昨日没有可放入这一栏的公开帖/);
  const pin = {id:yesterday.id, key:`x:${yesterday.id}`, url:yesterday.original_url, day:'2026-10-09'};
  const filled = renderHomeShowcase(app(), {...state([today, yesterday, stream]), underratedPins:[pin]});
  assert.match(filled, /id="home-underrated"/);
  assert.match(filled, /昨日最被低估精华帖/);
  assert.match(filled, /过审精华/);
  assert.doesNotMatch(filled.slice(filled.indexOf('id="home-underrated"')), /榜单帖/);
  assert.doesNotMatch(filled, /昨日没有可放入这一栏的公开帖/);
  const streamPin = {id:stream.id, key:`x:${stream.id}`, url:stream.original_url, day:'2026-10-09'};
  const missed = renderHomeShowcase(app(), {...state([today, yesterday, stream]), underratedPins:[streamPin]});
  assert.doesNotMatch(missed, /id="home-underrated"/);
});

test('cover cards show a quiet KOSX badge only for account-pool authors', () => {
  const member = KOSX_POOL_HANDLES[0];
  const pooled = post('210201', '2026-10-10T09:00:00.000Z', {title:'账号池封面', author_handle:member.toUpperCase(), url:`https://x.com/${member}/status/210201`, origin:'kosx_approved'});
  const flagged = post('210202', '2026-10-10T08:00:00.000Z', {title:'过审池帖', author_handle:'former_pool', kosx_review:'pool', url:'https://x.com/former_pool/status/210202', origin:'kosx_approved'});
  const linked = post('210203', '2026-10-10T07:00:00.000Z', {title:'链接里的池成员', url:`https://twitter.com/${member}/status/210203`, origin:'kosx_approved'});
  const outsider = post('210204', '2026-10-10T06:00:00.000Z', {title:'站外作者', author_handle:'not_in_pool', url:'https://x.com/not_in_pool/status/210204', origin:'kosx_approved'});
  const html = renderHomeShowcase(app(), state([pooled, flagged, linked, outsider]));
  for (const item of [pooled, flagged, linked]) assert.match(cardHtml(html, item.id), /<span class="kosx-pool-badge">KOSX<\/span>/);
  assert.doesNotMatch(cardHtml(html, outsider.id), /kosx-pool-badge|KOSX/);
  assert.equal(html.match(/class="kosx-pool-badge"/g).length, 3);
  const css = readFileSync(new URL('./src/homeShowcase.css', import.meta.url), 'utf8');
  assert.match(css, /\.kosx-pool-badge\s*\{[^}]*font-size:\s*10px/);
  assert.match(css, /\.kosx-pool-badge\s*\{[^}]*color:\s*#8a8f86/);
  assert.match(css, /\.kosx-pool-badge\s*\{[^}]*background:\s*#f0f0ec/);
  assert.doesNotMatch(css, /\.kosx-pool-badge\s*\{[^}]*(?:#171917|#c84924|#EC672B)/);
});

test('seven-day shelf keeps high-bookmark essence articles and the kept shelf reads current stores only', () => {
  const steps = '教程：打开截图工具，选择图片文件。\n1. 打开截图工具，选择图片文件。\n2. 点击箭头按钮，再导出图片文件。';
  const high = post('207001', '2026-10-07T02:00:00.000Z', {origin:'kosx_approved', review_type:'文章', bookmark_count:800, title:'高收藏文章'});
  const floor = post('207003', '2026-10-08T04:00:00.000Z', {origin:'kosx_approved', has_article:true, bookmark_count:HOME_WEEK_BOOKMARK_MIN, title:'刚好过线'});
  const low = post('207004', '2026-10-08T03:00:00.000Z', {origin:'kosx_approved', review_type:'教程指南', bookmark_count:HOME_WEEK_BOOKMARK_MIN - 1, title:'差一点'});
  const shortPost = post('207005', '2026-10-08T05:00:00.000Z', {origin:'kosx_approved', review_type:'短帖', bookmark_count:9000, title:'高收藏短帖'});
  const promo = post('207007', '2026-10-08T06:00:00.000Z', {origin:'kosx_approved', review_type:'产品安利', bookmark_count:9000, title:'高收藏安利'});
  const stream = post('207002', '2026-10-07T03:00:00.000Z', {review_type:'文章', bookmark_count:9000, title:'榜单文章', summary:steps});
  const outside = post('207006', '2026-10-03T03:00:00.000Z', {origin:'kosx_approved', review_type:'文章', bookmark_count:9000, title:'窗口外文章'});
  const heatOnly = post('207008', '2026-10-09T02:00:00.000Z', {origin:'kosx_approved', review_type:'文章', heat:'9万 曝光/小时', title:'只有热度'});
  const featured = {...post('300001', '2026-10-01T00:00:00.000Z', {title:'我留下的原帖'}), origin:'dot_import'};
  const saved = post('300002', '2026-10-02T00:00:00.000Z', {title:'已收藏原帖'});
  const hidden = post('300003', '2026-10-02T00:00:00.000Z');
  const input = state([high, floor, low, shortPost, promo, stream, outside, heatOnly, featured, saved, hidden]);
  input.dotFeaturedItems = [featured];
  input.savedItems = [saved, featured, hidden];
  input.savedItemIds = new Set([saved.id, featured.id, hidden.id]);
  input.hiddenItemIds = new Set([hidden.id]);
  const selected = selectHomeShowcase(input);
  assert.equal(HOME_WEEK_BOOKMARK_MIN, 200);
  assert.equal(selected.weekRule, 'bookmarks');
  assert.deepEqual(selected.week.map(entry => entry.post.item.id), ['207001', '207003']);
  assert.equal(selected.weekLeads, undefined);
  assert.equal(selected.weekRest, undefined);
  assert.match(selected.weekNote, /2026-10-04 至 2026-10-10/);
  assert.match(selected.weekNote, /已经放上公开首页的精华帖/);
  assert.match(selected.weekNote, /达到 200 才留下/);
  assert.match(selected.weekNote, /点赞和浏览不换算成收藏/);
  assert.match(selected.weekNote, /没有把其余公开帖补进来/);
  assert.equal(selected.week.some(entry => entry.post.item.id === stream.id), false);
  assert.deepEqual(selected.kept.featured.map(item => item.id), [featured.id]);
  assert.deepEqual(selected.kept.saved.map(item => item.id), [saved.id]);
  const html = renderHomeShowcase(app('week'), input);
  assert.match(html, /id="home-week"/);
  assert.match(html, /data-week-rule="bookmarks"/);
  assert.match(html, /七日精选精华帖 <small>2<\/small>/);
  assert.match(html, /高收藏文章/);
  assert.match(html, /刚好过线/);
  assert.ok(html.indexOf('高收藏文章') < html.indexOf('刚好过线'));
  assert.doesNotMatch(html, /同七日其余公开帖|摘录含操作线索|week-rest|week-lead|差一点|高收藏短帖|高收藏安利|榜单文章|窗口外文章|只有热度/);
  assert.equal(html.match(/data-home-group="week"/g).length, 2);
});

test('seven-day shelf uses public heat only when bookmark counts are missing, then excerpt evidence', () => {
  const steps = '教程：打开截图工具，选择图片文件。\n1. 打开截图工具，选择图片文件。\n2. 点击箭头按钮，再导出图片文件。';
  const hot = post('217001', '2026-10-06T02:00:00.000Z', {origin:'kosx_approved', review_type:'文章', heat:'9000 曝光/小时', title:'高曝光文章'});
  const mid = post('217002', '2026-10-07T02:00:00.000Z', {origin:'kosx_approved', review_type:'教程指南', heat:'450 曝光/小时', title:'中等曝光'});
  const cool = post('217003', '2026-10-08T02:00:00.000Z', {origin:'kosx_approved', has_article:true, heat:'100 曝光/小时', title:'低曝光文章'});
  const otherUnit = post('217004', '2026-10-08T03:00:00.000Z', {origin:'kosx_approved', review_type:'文章', heat:'40.3万 次浏览', title:'另一种热度'});
  const opinion = post('217005', '2026-10-08T04:00:00.000Z', {origin:'kosx_approved', heat:'9万 曝光/小时', title:'高曝光看法'});
  const stream = post('217006', '2026-10-08T05:00:00.000Z', {heat:'9万 曝光/小时', review_type:'文章', title:'榜单高热'});
  const heated = selectHomeShowcase(state([hot, mid, cool, otherUnit, opinion, stream]));
  assert.equal(heated.weekRule, 'heat');
  assert.deepEqual(heated.week.map(entry => entry.post.item.id), ['217001']);
  assert.match(heated.weekNote, /没有可读的收藏数/);
  assert.match(heated.weekNote, /曝光\/小时/);
  assert.match(heated.weekNote, /高于中位数/);
  const newer = post('217011', '2026-10-09T02:00:00.000Z', {origin:'kosx_approved', title:'较新教程', summary:steps});
  const older = post('217012', '2026-10-05T02:00:00.000Z', {origin:'kosx_approved', title:'较早教程', summary:steps});
  const lone = post('217013', '2026-10-08T02:00:00.000Z', {origin:'kosx_approved', review_type:'文章', heat:'9000 曝光/小时', title:'只有一条热度'});
  const plain = post('217014', '2026-10-08T06:00:00.000Z', {origin:'kosx_approved', title:'没有线索的精华'});
  const sparse = selectHomeShowcase(state([newer, older, lone, plain, stream]));
  assert.equal(sparse.weekRule, 'article');
  assert.deepEqual(sparse.week.map(entry => entry.post.item.id), ['217011', '217013', '217012']);
  assert.match(sparse.weekNote, /不是收藏榜/);
  assert.match(sparse.weekNote, /不足 2 条/);
  const tieA = post('217021', '2026-10-09T01:00:00.000Z', {origin:'kosx_approved', review_type:'文章', heat:'1200 曝光/小时', title:'并列较新'});
  const tieB = post('217022', '2026-10-06T01:00:00.000Z', {origin:'kosx_approved', review_type:'文章', heat:'1200 曝光/小时', title:'并列较旧'});
  const tied = selectHomeShowcase(state([tieA, tieB]));
  assert.equal(tied.weekRule, 'heat');
  assert.deepEqual(tied.week.map(entry => entry.post.item.id), ['217021', '217022']);
  const quiet = selectHomeShowcase(state([plain, opinion, stream]));
  assert.equal(quiet.weekRule, 'empty');
  assert.deepEqual(quiet.week, []);
  const page = renderHomeShowcase(app('week'), state([plain]));
  assert.match(page, /data-week-rule="empty"/);
  assert.match(page, /达到 200 才留下/);
  assert.match(page, /这七日没有留下精华文章/);
  assert.doesNotMatch(page, /同七日其余公开帖|摘录含操作线索/);
});

test('default homepage renders cover cards, signature, navigation labels and no saturated specimen fill', () => {
  const image = {kind:'photo', url:'https://pbs.twimg.com/media/AbcdEFG.jpg', source_url:'https://x.com/example/status/210001'};
  const items = [
    post('210001', '2026-10-10T08:00:00.000Z', {title:'带图原帖 <script>', image, heat:'2万 曝光/小时', origin:'kosx_approved'}),
    ...Array.from({length:17}, (_, index) => post(String(220000 + index), `2026-10-10T${String(index).padStart(2, '0')}:10:00.000Z`, {origin:'kosx_approved'})),
    post('210888', '2026-10-10T20:00:00.000Z', {title:'2027年或成史上最热一年', heat:'9万 曝光/小时'}),
    post('20900211', '2026-10-09T02:00:00.000Z', {title:'低热度原帖', heat:'120 曝光/小时', origin:'kosx_approved'}),
    post('20900311', '2026-10-09T03:00:00.000Z', {title:'次低热度', heat:'450 曝光/小时', origin:'kosx_approved'}),
  ];
  const html = renderHomeShowcase(app(), {...state(items), underratedPins:[
    {id:'20900211', key:'x:20900211', day:'2026-10-09'},
    {id:'20900311', key:'x:20900311', day:'2026-10-09'},
  ]});
  assert.match(html, /aria-label="Levi flow"/);
  assert.match(html, /id="home-latest"/);
  assert.match(html, /id="home-marquee"/);
  assert.match(html, /aria-label="幕布"/);
  assert.match(html, /class="cover-card shape-card"/);
  assert.doesNotMatch(html, /18\+|年满|未满请离开|年龄|home-age|shape-age/);
  assert.match(html, /id="home-underrated"/);
  assert.match(html, /最新精华帖/);
  assert.match(html, /已经放上公开首页的精华帖/);
  assert.match(html, /这里是最近 18 条，不是热度榜/);
  assert.match(html, /信息流里其他带日期的帖不放进来/);
  assert.doesNotMatch(html, /2027年或成史上最热一年|教程精选/);
  assert.match(html, /昨日最被低估精华帖/);
  assert.doesNotMatch(html, /昨日最被低估必须人工过审，账号池自动放上首页的帖不进入这一栏/);
  assert.doesNotMatch(html, /按现有公开指标粗排，未实测|避开已经出现在最新 18/);
  assert.doesNotMatch(html, /home-strap|卧云信息流把公开帖放在一起|换设备前请自行备份|home-local-note/);
  assert.match(html, /class="cover-grid"/);
  assert.match(html, /综合推文榜/);
  assert.doesNotMatch(html, /SoPilot|本浏览器保存|第一次来|展开说明|实用教程|怎么用/);
  assert.match(html, /src="https:\/\/pbs\.twimg\.com\/media\/AbcdEFG\.jpg"/);
  assert.match(html, /data-cover="quote"/);
  assert.doesNotMatch(html, /无来源附图|cover-fallback/);
  assert.match(html, /打开原帖/);
  assert.match(html, /data-action="toggle-save"/);
  assert.doesNotMatch(html, /放进主题|data-action="topic-save"|实用教程|收藏与跟进|主题工作台|我的关注|怎么用|待筛选/);
  assert.match(html, /aria-label="KOSX 精选计划"/);
  assert.match(html, /KOSX 精选计划/);
  assert.doesNotMatch(html, /助力计划/);
  assert.match(html, /class="kosx-mark" src="\/assets\/kosx\/symbol-ink\.svg" width="30" height="30" alt="KOSX 四瓣标志"/);
  assert.match(html, /class="kosx-emoji" src="\/assets\/kosx\/emoji\/kosx-emoji-01-80\.png" width="40" height="40" alt="KOSX 精选计划表情"/);
  assert.equal((html.match(/alt="KOSX 精选计划表情"/g) || []).length, 1);
  assert.equal((html.match(/alt="KOSX 四瓣标志"/g) || []).length, 1);
  const strip = html.slice(html.indexOf('<div class="kosx-strip">'), html.indexOf('<form class="kosx-panel"'));
  assert.ok(strip.indexOf('kosx-mark') < strip.indexOf('kosx-name'));
  assert.ok(strip.indexOf('kosx-name') < strip.indexOf('kosx-emoji'));
  assert.ok(strip.indexOf('kosx-emoji') < strip.indexOf('kosx-hint'));
  assert.ok(strip.indexOf('kosx-hint') < strip.indexOf('>贴链接<'));
  const brand = strip.slice(strip.indexOf('<div class="kosx-brand">'), strip.indexOf('<div class="kosx-middle">'));
  assert.match(brand, /kosx-mark[\s\S]*kosx-name[\s\S]*kosx-emoji/);
  assert.doesNotMatch(strip.slice(strip.indexOf('<div class="kosx-middle">')), /kosx-emoji|kosx-mark|symbol-ink/);
  assert.match(html, /上传你的精华帖链接/);
  assert.match(html, /class="kosx-accent" aria-hidden="true"/);
  assert.match(html, />贴链接</);
  assert.match(html, /placeholder="粘贴 X 精华帖链接"/);
  assert.match(html, /id="kosx-panel" hidden/);
  assert.match(html, /<footer class="kosx-footer"><img class="kosx-wordmark" src="\/assets\/kosx\/wordmark-ink\.svg" width="187" height="32" alt="KOSX\.ai，橙色圆点"><\/footer>/);
  assert.ok(html.indexOf('kosx-strip') < html.indexOf('levi-signature'));
  assert.doesNotMatch(html, /class="home-strap"/);
  assert.ok(html.indexOf('levi-signature') < html.indexOf('id="home-latest"'));
  assert.ok(html.indexOf('id="home-latest"') < html.indexOf('id="home-marquee"'));
  assert.ok(html.indexOf('id="home-marquee"') < html.indexOf('id="home-underrated"'));
  assert.match(html, /boost-watermark-wash" aria-hidden="true"><\/span>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|background:\s*#(?:ff|f[0-9a-f]{2}[0-5])/i);
  assert.equal(html.match(/data-home-group="latest"/g).length, 18);
  assert.equal(html.match(/data-home-group="under"/g).length, 2);
  const marquee = html.match(/<p class="home-slogan"[\s\S]*?<\/p>/)[0];
  assert.match(marquee, /你的文章，值得被看见/);
  assert.equal((marquee.match(/你的文章，值得被看见/g) || []).length, 1);
  assert.doesNotMatch(marquee, /<button|<br|18\+|年满|年龄|留下有用的|home-marquee-track/);
  const css = readFileSync(new URL('./src/homeShowcase.css', import.meta.url), 'utf8');
  assert.match(css, /\.home-slogan\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.home-slogan-line\s*\{[^}]*font-size:\s*calc\(100cqi \/ 9\.7\)/);
  assert.match(css, /\.home-slogan-line\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /\.home-slogan-line\s*\{[^}]*animation:\s*none/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.doesNotMatch(css, /@keyframes home-marquee|translateX\(-50%\)/);
  assert.match(css, /\.lift-bar\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(css, /\.levi-signature\s*\{[^}]*text-align:\s*center/);
  assert.match(css, /\.lift-pill\[aria-current="page"\], \.lift-cat\[aria-current="page"\]\s*\{[^}]*background:\s*#171917/);
  assert.match(css, /--home-bg:\s*#ffffff/);
  assert.match(css, /--shape-card:\s*24px 24px 12px 24px/);
  assert.doesNotMatch(css, /shape-age|18\+|年龄/);
  assert.match(css, /--shape-cover:\s*16\s*\/\s*9/);
  assert.match(css, /--home-line:\s*#e8e8e4/);
  assert.match(css, /--home-accent:\s*#c84924/);
  assert.match(css, /--home-wash:\s*#f5f5f2/);
  assert.doesNotMatch(css, /#fbfbf8|#f4f1ea|#8b3019/);
  assert.match(html, /class="boost-watermark"/);
  assert.match(html, /class="boost-watermark-count" id="home-boost-count">\d+</);
  assert.match(html, /boost-watermark-label">已助力/);
  assert.ok(html.indexOf('boost-watermark-label') < html.indexOf('boost-watermark-count'));
  assert.match(css, /\.boost-watermark\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.boost-watermark-count\s*\{[^}]*color:\s*#e8e8e4/);
  assert.match(css, /\.boost-watermark-count\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /\.boost-watermark-count\s*\{[^}]*clamp\(96px,\s*7\.5vw,\s*120px\)/);
  assert.match(css, /\.boost-watermark-label\s*\{[^}]*font-size:\s*11px/);
  assert.match(css, /\.boost-watermark-label\s*\{[^}]*color:\s*#62675d/);
  assert.match(css, /\.boost-watermark-wash\s*\{[^}]*radial-gradient/);
  assert.doesNotMatch(css, /\.boost-watermark-wash\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.kosx-strip\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.kosx-strip\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.kosx-brand\s*\{[^}]*gap:\s*8px/);
  assert.match(css, /\.kosx-emoji\s*\{[^}]*width:\s*40px/);
  assert.match(css, /\.kosx-emoji\s*\{[^}]*height:\s*40px/);
  assert.match(css, /\.kosx-emoji\s*\{[^}]*margin-left:\s*2px/);
  assert.doesNotMatch(css, /\.kosx-emoji\s*\{[^}]*justify-self:\s*end/);
  assert.match(css, /\.kosx-mark\s*\{[^}]*width:\s*30px/);
  assert.match(css, /\.kosx-mark\s*\{[^}]*height:\s*30px/);
  assert.match(css, /\.kosx-middle\s*\{[^}]*margin-left:\s*auto/);
  assert.match(css, /\.kosx-middle\s*\{[^}]*gap:\s*28px/);
  assert.match(css, /@media \(max-width: 520px\)\s*\{\s*\.kosx-strip\s*\{[^}]*min-height:\s*44px/);
  assert.doesNotMatch(css, /grid-template-areas:\s*"brand emoji"|home-strap|home-local-note/);
  assert.match(css, /\.kosx-name\s*\{[^}]*font-size:\s*16px/);
  assert.match(css, /\.kosx-name\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /\.kosx-name\s*\{[^}]*color:\s*#171917/);
  assert.match(css, /\.kosx-accent\s*\{[^}]*background:\s*#EC672B/);
  assert.match(css, /\.kosx-cta,\s*\.kosx-submit\s*\{[^}]*background:\s*#171917/);
  assert.match(css, /\.kosx-wordmark\s*\{[^}]*height:\s*32px/);
  const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(page, /rel="icon" href="\.\/assets\/kosx\/favicon\.svg" type="image\/svg\+xml"/);
  assert.match(page, /rel="apple-touch-icon" href="\.\/assets\/kosx\/apple-touch-icon\.png"/);
  const cardImage = 'https://woyun-feed-preview.hhzovo66.workers.dev/assets/kosx/symbol-ink.png';
  const cardDescription = '精选的 X 精华帖。昨日全部、七日精选、卧云精选，按原帖时间排列。';
  assert.equal(page.includes('property="og:type" content="website"'), true);
  assert.equal(page.includes('property="og:title" content="卧云信息流"'), true);
  assert.equal(page.includes(`property="og:description" content="${cardDescription}"`), true);
  assert.equal(page.includes(`property="og:image" content="${cardImage}"`), true);
  assert.equal(page.includes('property="og:image:alt" content="KOSX 四瓣标志"'), true);
  assert.equal(page.includes('name="twitter:card" content="summary_large_image"'), true);
  assert.equal(page.includes('name="twitter:title" content="卧云信息流"'), true);
  assert.equal(page.includes(`name="twitter:description" content="${cardDescription}"`), true);
  assert.equal(page.includes(`name="twitter:image" content="${cardImage}"`), true);
  assert.equal(PUBLIC_FILES.includes('assets/kosx/symbol-ink.png'), true);
  const published = readFileSync(new URL('../public-dist/index.html', import.meta.url), 'utf8');
  assert.match(published, /<title>我的信息流 · 公开预览<\/title>/);
  assert.equal(published.includes('property="og:title" content="卧云信息流"'), true);
  assert.equal(published.includes('name="twitter:card" content="summary_large_image"'), true);
  assert.equal(published.includes(`property="og:image" content="${cardImage}"`), true);
  assert.match(published, /rel="apple-touch-icon" href="\.\/assets\/kosx\/apple-touch-icon\.png"/);
  assert.match(css, /\.kosx-hint\s*\{[^}]*font-size:\s*13px/);
  assert.match(css, /\.kosx-hint\s*\{[^}]*color:\s*#62675d/);
  assert.match(css, /\.kosx-panel\s*\{[^}]*border-radius:\s*16px/);
  assert.match(css, /\.kosx-panel input\s*\{[^}]*border-radius:\s*8px/);
  assert.match(css, /\.kosx-cta,\s*\.kosx-submit\s*\{[^}]*border:\s*0;[^}]*background:\s*#171917/);
  assert.match(css, /\.cover-grid\s*\{[^}]*gap:\s*32px/);
  const appSource = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /mountKosxEmoji\(document\)/);
  assert.match(appSource, /已进入待筛选/);
  assert.match(appSource, /这条已在待筛选里/);
  assert.doesNotMatch(appSource, /已放入待筛选|已放回待筛选|这条链接已经收过/);
});

test('homepage cards hide leftover process excerpts and keep a real note', () => {
  const pool = '账号池成员的精华帖，按时间放上首页。尚未读取原文，未核对热度。不进入昨日最被低估。';
  const review = '过审后放上首页的 X 链接。尚未读取原文，未核对热度。';
  const reviewedNote = '三步装好本地字幕。过审后放上首页。尚未读取原文，未核对热度。';
  assert.equal(coverExcerpt(pool), '');
  assert.equal(coverExcerpt(review), '');
  assert.equal(coverExcerpt(reviewedNote), '三步装好本地字幕');
  assert.equal(coverExcerpt('热度还没核对，先看这三步安装。'), '热度还没核对，先看这三步安装。');
  const items = [
    post('8801', '2026-10-10T08:00:00.000Z', {origin:'kosx_approved', kosx_review:'pool', summary:pool, title:'@aaa 的精华帖'}),
    post('8802', '2026-10-10T07:00:00.000Z', {origin:'kosx_approved', summary:review, title:'过审帖'}),
    post('8803', '2026-10-10T06:00:00.000Z', {origin:'kosx_approved', summary:reviewedNote, title:'有备注'}),
    post('8804', '2026-10-10T05:00:00.000Z', {origin:'kosx_approved', summary:'原文摘录：第一步打开设置。', title:'真实摘录'}),
  ];
  const html = renderHomeShowcase(app(), state(items));
  assert.doesNotMatch(html, /不进入昨日最被低估|尚未读取原文，未核对热度|按时间放上首页|过审后放上首页/);
  assert.match(html, /来源未提供摘录。/);
  assert.doesNotMatch(html, /来源未提供摘录，请打开原帖。|无来源附图/);
  assert.match(html, /三步装好本地字幕/);
  assert.match(html, /原文摘录：第一步打开设置。/);
  const keptState = state([]);
  keptState.savedItems = [items[0]];
  const kept = renderHomeShowcase(app('kept'), keptState);
  assert.doesNotMatch(kept, /不进入昨日最被低估|尚未读取原文|没有摘录。|无来源附图/);
  assert.match(kept, /@aaa 的精华帖/);
  assert.match(kept, /data-cover="plain"/);
});

test('category views and the masthead keep the three names visible without a second local store', () => {
  const featured = {...post('300001', '2026-10-01T00:00:00.000Z', {title:'精选原帖'}), origin:'dot_import'};
  const input = state([post('20900111', '2026-10-09T02:00:00.000Z', {heat:'120 曝光/小时', origin:'kosx_approved', title:'昨日精华'})]);
  input.dotFeaturedItems = [featured];
  const yesterday = renderHomeShowcase(app('yesterday'), input);
  const kept = renderHomeShowcase(app('kept'), input);
  assert.match(yesterday, /class="kosx-mark"/);
  assert.match(yesterday, /class="kosx-emoji"/);
  assert.match(yesterday, /KOSX 精选计划/);
  assert.ok(yesterday.indexOf('kosx-mark') < yesterday.indexOf('kosx-emoji'));
  assert.ok(yesterday.indexOf('kosx-emoji') < yesterday.indexOf('>贴链接<'));
  assert.doesNotMatch(yesterday, /助力计划|home-strap|卧云信息流把公开帖放在一起/);
  assert.match(yesterday, /kosx-footer/);
  assert.match(kept, /alt="KOSX\.ai，橙色圆点"/);
  assert.match(yesterday, /昨日全部精华帖/);
  assert.match(yesterday, /已经放上公开首页的精华帖/);
  assert.match(yesterday, /昨日精华/);
  assert.match(yesterday, /2026-10-09/);
  assert.match(kept, /卧云精选贴（常驻保存）/);
  assert.match(kept, /精选原帖/);
  assert.match(kept, /不另建本地库/);
  assert.doesNotMatch(kept, /data-dot-open-featured|待筛选|收藏页|放进主题/);
  const mast = renderWorkspaceNavigation('today', input, {homeView:'week', menuOpen:false});
  assert.match(mast, /卧云信息流/);
  assert.match(mast, />昨日全部</);
  assert.match(mast, />七日精选</);
  assert.match(mast, />卧云精选</);
  assert.doesNotMatch(mast, /昨日全部精华帖|七日精选精华帖|卧云精选贴（常驻保存）/);
  assert.match(mast, /data-home-view="week" aria-current="page"/);
  assert.match(mast, /id="home-cats-button"/);
  assert.match(mast, /id="home-cats"/);
  assert.doesNotMatch(mast, /is-open|KOSX|贴链接|id="home-menu"|id="home-menu-button"|实用教程|收藏与跟进|主题工作台|我的关注|怎么用|待筛选|id="nav-/);
  const openCats = renderWorkspaceNavigation('today', input, {homeView:'week', catsOpen:true});
  assert.match(openCats, /id="home-cats" class="lift-cats is-open"|class="lift-cats is-open" id="home-cats"/);
  assert.doesNotMatch(openCats, /实用教程|收藏与跟进|主题工作台|我的关注|怎么用|待筛选|id="nav-/);
  const removed = ['本浏览器保存 · 重要材料请备份', '第一次来？挑材料 → 补想法 → 带给 AI', '展开说明', 'SoPilot · 财经推文榜'];
  for (const label of removed) assert.equal(`${mast}\n${openCats}`.includes(label), false);
  const appSource = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
  const start = appSource.indexOf('renderTodayFeedView(state) {');
  const home = appSource.slice(start, start + 280);
  assert.match(home, /return renderHomeShowcase\(this, state\)/);
  assert.doesNotMatch(home, /renderSourceBoard|home-open-sources|renderWelcome|SoPilot/);
  assert.match(appSource, /publicHome \? '' : renderWorkspaceStorageNotice/);
  assert.doesNotMatch(appSource, /audience:\s*'visitor'|home-local-note|换设备前请自行备份/);
  assert.match(appSource, /publicHome \|\| state\.loadStatus\?\.phase === 'ready' \? '' : renderFeedLoadStatus/);
  assert.doesNotMatch(appSource, /读取等待超时|读取超时/);
  assert.match(appSource, /!publicHome && this\.currentTab === 'today' && this\.welcomeVisible \? renderWelcome\(\)/);
});

test('opening an X cover counts once per visitor and post in local storage only', () => {
  const bag = new Map();
  const store = {getItem:key => bag.get(key) ?? null, setItem:(key, value) => bag.set(key, value)};
  const first = 'https://x.com/example/status/2108148604447883464';
  const same = 'https://twitter.com/example/status/2108148604447883464?s=20';
  const second = 'https://x.com/other/status/2108148604447883465';
  assert.equal(recordKosxBoost(store, first).counted, true);
  assert.equal(recordKosxBoost(store, same).counted, false);
  assert.equal(recordKosxBoost(store, second).count, 2);
  assert.equal(recordKosxBoost(store, 'https://example.com/not-a-post').counted, false);
  assert.equal(recordKosxBoost(store, second).count, 2);
  assert.equal(bag.size, 1);
});

test('a pasted X link stays in pending review and is not added to the homepage', async () => {
  const previous = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const bag = new Map();
  const calls = [];
  globalThis.localStorage = {getItem:key => bag.get(key) ?? null, setItem:(key, value) => bag.set(key, value), removeItem:key => bag.delete(key), key:index => [...bag.keys()][index] ?? null, get length() { return bag.size; }};
  const pendingBody = (existing) => JSON.stringify({
    id:'kosx-2108148604447883999', key:'x:2108148604447883999',
    url:'https://x.com/example/status/2108148604447883999', author_handle:'example',
    status:'pending', submitted_at:'2026-10-13T00:00:00.000Z', existing,
  });
  globalThis.fetch = async (url, init) => {
    calls.push({url, init});
    const posted = JSON.parse(init.body);
    const seen = calls.filter(call => JSON.parse(call.init.body).url === posted.url).length;
    return new Response(pendingBody(seen > 1), {status: seen > 1 ? 200 : 201, headers:{'Content-Type':'application/json'}});
  };
  try {
    const adapter = new FeedDataAdapter();
    adapter.feedData = {mode:'live', schema_version:'0.3', profile:{}, items:[], sources:[], sections:{daily:[], discover:[]}, generated_at:'2026-10-10T13:01:27.954Z'};
    const before = adapter.getState().allItems.length;
    const url = 'https://x.com/example/status/2108148604447883999';
    const result = await adapter.submitKosxLink(url);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/dot/pending');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(calls[0].init.body), {url});
    const state = adapter.getState();
    assert.equal(result.added, true);
    assert.equal(state.dotPendingCandidates.length, 1);
    assert.equal(state.dotPendingCandidates[0].status, 'pending');
    assert.equal(state.dotFeaturedItems.length, 0);
    assert.equal(state.allItems.length, before);
    assert.equal(adapter.localState.dot_candidates.length, 0);
    assert.equal((await adapter.submitKosxLink(`https://twitter.com/example/status/2108148604447883999`)).duplicate, true);
    assert.deepEqual(JSON.parse(calls[1].init.body), {url});
    const attempted = calls.length;
    await assert.rejects(() => adapter.submitKosxLink(''), /请粘贴有效的 X 链接/);
    await assert.rejects(() => adapter.submitKosxLink('https://example.com/not-a-post'), /请粘贴有效的 X 链接/);
    assert.equal(calls.length, attempted);
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(() => adapter.submitKosxLink('https://x.com/other/status/2108148604447884000'), /没有放入待筛选/);
    assert.equal(adapter.localState.kosx_pending.length, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({error:'queue_full', message:'待筛选已满，请先处理已有链接。'}), {status:409, headers:{'Content-Type':'application/json'}});
    await assert.rejects(() => adapter.submitKosxLink('https://x.com/other/status/2108148604447884001'), /待筛选已满/);
    assert.equal(adapter.localState.kosx_pending.some(row => String(row.url).includes('2108148604447884001')), false);
    assert.throws(() => adapter.setDotCandidateStatus([result.id], 'featured'), /不会自动出现在首页/);
    assert.equal(adapter.getState().dotFeaturedItems.length, 0);
    assert.equal(adapter.getState().dotPendingCandidates.length, 1);
    const html = renderHomeShowcase(app(), adapter.getState());
    assert.doesNotMatch(html, /2108148604447883999/);
    assert.doesNotMatch(html, /待筛选的 X 链接/);
    assert.match(adapter.getState().dotPendingCandidates[0].material.summary_zh, /KOSX 精选计划/);
    assert.doesNotMatch(adapter.getState().dotPendingCandidates[0].material.summary_zh, /助力计划/);
    const reload = new FeedDataAdapter();
    reload.feedData = adapter.feedData;
    assert.equal(reload.getState().dotPendingCandidates.length, 1);
    assert.equal(reload.localState.dot_candidates.length, 0);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

function emojiSlot({reduced = false} = {}) {
  let src = KOSX_EMOJI_FRAMES[0];
  let alt = KOSX_EMOJI_ALT;
  const listeners = [];
  const media = {
    matches: reduced,
    addEventListener(type, fn) { if (type === 'change') listeners.push(fn); },
    removeEventListener(type, fn) {
      if (type !== 'change') return;
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  const img = {
    get src() { return src; },
    set src(value) { src = value; },
    get alt() { return alt; },
    set alt(value) { alt = value; },
    getAttribute(name) { return name === 'src' ? src : name === 'alt' ? alt : null; },
  };
  return {
    img,
    setReduced(value) {
      media.matches = value;
      for (const fn of [...listeners]) fn();
    },
    document: {
      querySelector(selector) { return selector === '[data-kosx-emoji]' ? img : null; },
      defaultView: {
        matchMedia(query) {
          assert.equal(query, '(prefers-reduced-motion: reduce)');
          return media;
        },
        setInterval: (...args) => globalThis.setInterval(...args),
        clearInterval: (...args) => globalThis.clearInterval(...args),
      },
    },
  };
}

test('emoji carousel hard-cuts six frames every 600ms and freezes on frame 1 when motion is reduced', (t) => {
  assert.equal(KOSX_EMOJI_FRAMES.length, 6);
  assert.equal(KOSX_EMOJI_INTERVAL_MS, 600);
  assert.equal(new Set(KOSX_EMOJI_FRAMES).size, 6);
  t.mock.timers.enable({apis:['setInterval']});
  const slot = emojiSlot();
  try {
    mountKosxEmoji(slot.document);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[0]);
    assert.equal(slot.img.alt, KOSX_EMOJI_ALT);
    t.mock.timers.tick(599);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[0]);
    t.mock.timers.tick(1);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[1]);
    assert.equal(slot.img.alt, KOSX_EMOJI_ALT);
    t.mock.timers.tick(600 * 5);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[0]);
    mountKosxEmoji(slot.document);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[0]);
    t.mock.timers.tick(600);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[1]);
    slot.setReduced(true);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[0]);
    assert.equal(slot.img.alt, KOSX_EMOJI_ALT);
    t.mock.timers.tick(1800);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[0]);
    slot.setReduced(false);
    t.mock.timers.tick(600);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[1]);
    slot.img.alt = '其他说明';
    t.mock.timers.tick(600);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[2]);
    assert.equal(slot.img.alt, KOSX_EMOJI_ALT);
  } finally {
    resetKosxEmoji();
    mock.timers.reset();
  }
});

test('emoji carousel stays on frame 1 when reduced motion is already requested', (t) => {
  t.mock.timers.enable({apis:['setInterval']});
  const slot = emojiSlot({reduced:true});
  try {
    mountKosxEmoji(slot.document);
    t.mock.timers.tick(2400);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[0]);
    assert.equal(slot.img.alt, KOSX_EMOJI_ALT);
    slot.setReduced(false);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[0]);
    t.mock.timers.tick(600);
    assert.equal(slot.img.src, KOSX_EMOJI_FRAMES[1]);
  } finally {
    resetKosxEmoji();
    mock.timers.reset();
  }
});
