import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarDays, beijingDateKey, parsePublicHeat, selectHomeShowcase } from './src/homeShowcase.js';
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
  assert.match(html, /id="home-underrated"/);
  assert.match(html, /最新精华帖/);
  assert.match(html, /昨日最被低估精华帖/);
  assert.match(html, /按现有公开指标粗排，未实测/);
  assert.match(html, /class="cover-grid"/);
  assert.match(html, /class="cover-card"/);
  assert.match(html, /src="https:\/\/pbs\.twimg\.com\/media\/AbcdEFG\.jpg"/);
  assert.match(html, /无来源附图/);
  assert.match(html, /打开原帖/);
  assert.match(html, /data-action="toggle-save"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|background:\s*#(?:ff|f[0-9a-f]{2}[0-5])/i);
  assert.equal(html.match(/data-home-group="latest"/g).length, 18);
  assert.equal(html.match(/data-home-group="under"/g).length, 2);
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
  const mast = renderWorkspaceNavigation('today', input, {homeView:'week', menuOpen:false});
  assert.match(mast, /卧云信息流/);
  assert.match(mast, /昨日全部精华帖/);
  assert.match(mast, /七日精选精华帖/);
  assert.match(mast, /卧云精选贴（常驻保存）/);
  assert.match(mast, /data-home-view="week" aria-current="page"/);
  assert.match(mast, /id="home-menu"/);
  for (const key of ['today','tutorials','candidates','saved','topics','profile']) assert.equal((mast.match(new RegExp(`id="nav-${key}"`, 'g')) || []).length, 1);
});
