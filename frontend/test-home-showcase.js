import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addCalendarDays, beijingDateKey, parsePublicHeat, recordKosxBoost, selectHomeShowcase } from './src/homeShowcase.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { renderHomeShowcase } from './src/homeShowcaseView.js';
import { renderWorkspaceNavigation } from './src/workspaceShell.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const app = (homeView = 'latest') => ({homeView, escapeHtml:escape, safeUrl:value => {
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : '#'; }
  catch { return '#'; }
}, formatTime:value => value});
const source = {id:'sopilot-all', name:'SoPilot · 综合推文榜', group:'posts', link_kind:'post', status:'ok', enabled:true};
const post = (id, published, extra = {}) => ({
  id, title:extra.title || `公开帖 ${id}`, summary:extra.summary || `这是来源摘录 ${id}，尚未核对。`,
  source_refs:[source.id], link_kind:'post', origin:'public', content_status:'excerpt_only',
  original_url:extra.url || `https://x.com/example/status/${id}`,
  canonical_url:extra.url || `https://x.com/example/status/${id}`,
  published_at:published, source_item_time:published, captured_at:published,
  heat_label:extra.heat || '', source_rank:extra.rank ?? null, post_image:extra.image,
});
const state = items => ({
  generated_at:'2026-10-10T13:01:27.954Z', mode:'live', sources:[source], allItems:items,
  hiddenItemIds:new Set(), savedItemIds:new Set(), archivedItemIds:new Set(), savedItems:[],
  dotFeaturedItems:[], profile:{exclude:''},
});

test('beijing yesterday is the calendar day before the published snapshot', () => {
  assert.equal(beijingDateKey(Date.parse('2026-10-10T13:01:27.954Z')), '2026-10-10');
  assert.equal(addCalendarDays('2026-10-10', -1), '2026-10-09');
  assert.equal(parsePublicHeat('1.3K 曝光/小时').value, 1300);
  assert.equal(parsePublicHeat('5.1万 次浏览').unit, 'views');
  assert.equal(parsePublicHeat('没有数字'), null);
});

test('latest keeps 18 real posts by publication time and does not invent rows', () => {
  const items = [
    ...Array.from({length:20}, (_, index) => post(String(200000 + index), `2026-10-10T${String(index).padStart(2,'0')}:00:00.000Z`)),
    post('199001', '2026-10-09T02:00:00.000Z', {heat:'100 曝光/小时'}),
    post('199002', '2026-10-09T03:00:00.000Z', {heat:'5.1万 曝光/小时'}),
    post('188001', '2026-10-09T01:00:00.000Z', {summary:'转发抽一名，送周边礼品，关注后参与。'}),
  ];
  const input = state(items), before = structuredClone(input);
  const selected = selectHomeShowcase(input);
  assert.equal(selected.latest.length, 18);
  assert.deepEqual(selected.latest.map(entry => entry.post.item.id), items.slice(2, 20).map(item => item.id).reverse());
  assert.ok(selected.latest.every(entry => input.allItems.some(item => item.id === entry.post.item.id)));
  assert.equal(selected.counts.folded, 1);
  assert.ok(!selected.yesterday.some(entry => entry.post.item.id === '188001'));
  assert.deepEqual(input, before);
});

test('underrated yesterday posts are the lowest same-unit public heat and stay out of the latest 18', () => {
  const items = [
    post('210001', '2026-10-10T08:00:00.000Z', {heat:'9万 曝光/小时'}),
    post('209001', '2026-10-09T01:00:00.000Z', {heat:'9000 曝光/小时'}),
    post('209002', '2026-10-09T02:00:00.000Z', {heat:'120 曝光/小时'}),
    post('209003', '2026-10-09T03:00:00.000Z', {heat:'450 曝光/小时'}),
    post('209004', '2026-10-09T04:00:00.000Z', {heat:'40.3万 次浏览'}),
  ];
  const selected = selectHomeShowcase(state(items));
  assert.equal(selected.reference.yesterday, '2026-10-09');
  assert.deepEqual(selected.underrated.map(entry => entry.post.item.id), ['209002', '209003']);
  assert.equal(selected.underratedRule, 'heat');
  assert.match(selected.underratedNote, /按现有公开指标粗排，未实测/);
  assert.equal(selected.yesterday.length, 4);
  assert.ok(selected.reference.weekKeys.includes('2026-10-04'));
  assert.ok(selected.reference.weekKeys.includes('2026-10-10'));
});

test('seven-day view leads with existing instruction evidence and kept shelf reads current stores only', () => {
  const tutorial = post('207001', '2026-10-07T02:00:00.000Z', {title:'给截图加箭头', summary:'教程：打开截图工具，选择图片文件。\n1. 打开截图工具，选择图片文件。\n2. 点击箭头按钮，再导出图片文件。'});
  const ordinary = post('207002', '2026-10-07T03:00:00.000Z', {summary:'只是一条看法，没有操作步骤。'});
  const featured = {...post('300001', '2026-10-01T00:00:00.000Z', {title:'我留下的原帖'}), origin:'dot_import'};
  const saved = post('300002', '2026-10-02T00:00:00.000Z', {title:'已收藏原帖'});
  const hidden = post('300003', '2026-10-02T00:00:00.000Z');
  const input = state([tutorial, ordinary, featured, saved, hidden]);
  input.dotFeaturedItems = [featured];
  input.savedItems = [saved, featured, hidden];
  input.savedItemIds = new Set([saved.id, featured.id, hidden.id]);
  input.hiddenItemIds = new Set([hidden.id]);
  const selected = selectHomeShowcase(input);
  assert.deepEqual(selected.weekLeads.map(entry => entry.post.item.id), ['207001']);
  assert.deepEqual(selected.weekRest.map(entry => entry.post.item.id), ['207002']);
  assert.deepEqual(selected.kept.featured.map(item => item.id), [featured.id]);
  assert.deepEqual(selected.kept.saved.map(item => item.id), [saved.id]);
});

test('default homepage renders cover cards, signature, navigation labels and no saturated specimen fill', () => {
  const image = {kind:'photo', url:'https://pbs.twimg.com/media/AbcdEFG.jpg', source_url:'https://x.com/example/status/210001'};
  const items = [
    post('210001', '2026-10-10T08:00:00.000Z', {title:'带图原帖 <script>', image, heat:'2万 曝光/小时'}),
    ...Array.from({length:17}, (_, index) => post(String(220000 + index), `2026-10-10T${String(index).padStart(2, '0')}:10:00.000Z`)),
    post('209002', '2026-10-09T02:00:00.000Z', {title:'低热度原帖', heat:'120 曝光/小时'}),
    post('209003', '2026-10-09T03:00:00.000Z', {title:'次低热度', heat:'450 曝光/小时'}),
  ];
  const html = renderHomeShowcase(app(), state(items));
  assert.match(html, /aria-label="Levi flow"/);
  assert.match(html, /id="home-latest"/);
  assert.match(html, /id="home-marquee"/);
  assert.match(html, /aria-label="幕布"/);
  assert.match(html, /class="cover-card shape-card"/);
  assert.doesNotMatch(html, /18\+|年满|未满请离开|年龄|home-age|shape-age/);
  assert.match(html, /id="home-underrated"/);
  assert.match(html, /最新精华帖/);
  assert.match(html, /昨日最被低估精华帖/);
  assert.match(html, /按现有公开指标粗排，未实测/);
  assert.match(html, /class="cover-grid"/);
  assert.match(html, /综合推文榜/);
  assert.doesNotMatch(html, /SoPilot|本浏览器保存|第一次来|展开说明|实用教程|怎么用/);
  assert.match(html, /src="https:\/\/pbs\.twimg\.com\/media\/AbcdEFG\.jpg"/);
  assert.match(html, /无来源附图/);
  assert.match(html, /打开原帖/);
  assert.match(html, /data-action="toggle-save"/);
  assert.doesNotMatch(html, /放进主题|data-action="topic-save"|实用教程|收藏与跟进|主题工作台|我的关注|怎么用|待筛选/);
  assert.match(html, /KOSX 助力计划/);
  assert.match(html, /上传你的精华帖链接/);
  assert.match(html, />贴链接</);
  assert.match(html, /placeholder="粘贴 X 精华帖链接"/);
  assert.match(html, /id="kosx-panel" hidden/);
  assert.ok(html.indexOf('kosx-strip') < html.indexOf('levi-signature'));
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
  assert.match(css, /\.kosx-name\s*\{[^}]*font-size:\s*16px/);
  assert.match(css, /\.kosx-name\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /\.kosx-name\s*\{[^}]*color:\s*#171917/);
  assert.match(css, /\.kosx-hint\s*\{[^}]*font-size:\s*13px/);
  assert.match(css, /\.kosx-hint\s*\{[^}]*color:\s*#62675d/);
  assert.match(css, /\.kosx-panel\s*\{[^}]*border-radius:\s*16px/);
  assert.match(css, /\.kosx-panel input\s*\{[^}]*border-radius:\s*8px/);
  assert.match(css, /\.kosx-cta,\s*\.kosx-submit\s*\{[^}]*border:\s*0;[^}]*background:\s*#171917/);
  assert.match(css, /\.cover-grid\s*\{[^}]*gap:\s*32px/);
  const appSource = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /已进入待筛选/);
  assert.match(appSource, /这条已在待筛选里/);
  assert.doesNotMatch(appSource, /已放入待筛选|已放回待筛选|这条链接已经收过/);
});

test('category views and the masthead keep the three names visible without a second local store', () => {
  const featured = {...post('300001', '2026-10-01T00:00:00.000Z', {title:'精选原帖'}), origin:'dot_import'};
  const input = state([post('209001', '2026-10-09T02:00:00.000Z', {heat:'120 曝光/小时'})]);
  input.dotFeaturedItems = [featured];
  const yesterday = renderHomeShowcase(app('yesterday'), input);
  const kept = renderHomeShowcase(app('kept'), input);
  assert.match(yesterday, /昨日全部精华帖/);
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
