import { CREATOR_CATALOG } from './creatorCatalog.js';
import { creatorPreferenceKey, readCreatorPreferences } from './creatorTutorials.js';
import { normalizeCoverUrl, normalizePostImage } from './postMedia.js';
import { postStatusId } from './postStream.js';
import { postAuthorLabel } from './topicWorkspace.js';
import { isKosxPoolHandle } from '../kosx-pool.js';
import { homeViewName, isArticleClassItem, readBoostTotal, selectHomeShowcase } from './homeShowcase.js';

export const CRANIAL_PER_HEAD = 3;
export const CRANIAL_SCRUB_PX = 560;
const CRANIAL_ART = '/assets/hero/couple-open-heads.png';

export const KOSX_EMOJI_ALT = 'KOSX 精选计划表情';
export const KOSX_EMOJI_INTERVAL_MS = 600;
export const KOSX_EMOJI_FRAMES = [1, 2, 3, 4, 5, 6].map(frame => `/assets/kosx/emoji/kosx-emoji-0${frame}-80.png`);

let kosxEmojiIndex = 0;
let kosxEmojiTimer = 0;
let kosxEmojiRoot = null;
let kosxEmojiView = null;
let kosxEmojiMedia = null;
let kosxEmojiCache = [];
const cranialState = {phase:'rest', listening:false, view:null};

export function kosxEmojiFrame(index, reducedMotion = false) {
  if (reducedMotion) return 0;
  const count = KOSX_EMOJI_FRAMES.length;
  const current = Number.isInteger(index) ? index : 0;
  return ((current % count) + count) % count;
}

function kosxEmojiReduced() {
  return kosxEmojiMedia?.matches === true;
}

function stopKosxEmojiTimer() {
  if (!kosxEmojiTimer) return;
  (kosxEmojiView || globalThis).clearInterval(kosxEmojiTimer);
  kosxEmojiTimer = 0;
}

export function resetKosxEmoji() {
  stopKosxEmojiTimer();
  kosxEmojiMedia?.removeEventListener?.('change', syncKosxEmoji);
  kosxEmojiIndex = 0;
  kosxEmojiRoot = null;
  kosxEmojiView = null;
  kosxEmojiMedia = null;
  kosxEmojiCache = [];
}

function preloadKosxEmoji(view) {
  if (kosxEmojiCache.length || typeof view?.Image !== 'function') return;
  kosxEmojiCache = KOSX_EMOJI_FRAMES.map(src => {
    const image = new view.Image();
    image.decoding = 'sync';
    image.src = src;
    return image;
  });
}

function kosxEmojiReady(index) {
  const cached = kosxEmojiCache[index];
  return !cached || cached.complete !== false;
}

function paintKosxEmoji(img) {
  const frame = kosxEmojiFrame(kosxEmojiIndex, kosxEmojiReduced());
  kosxEmojiIndex = frame;
  const src = KOSX_EMOJI_FRAMES[frame];
  if (img.getAttribute?.('src') !== src && img.src !== src) img.src = src;
  if (img.alt !== KOSX_EMOJI_ALT) img.alt = KOSX_EMOJI_ALT;
}

function syncKosxEmoji() {
  const img = kosxEmojiRoot?.querySelector?.('[data-kosx-emoji]');
  if (!img) {
    stopKosxEmojiTimer();
    return;
  }
  paintKosxEmoji(img);
  if (kosxEmojiReduced()) {
    stopKosxEmojiTimer();
    return;
  }
  if (kosxEmojiTimer) return;
  const view = kosxEmojiView || globalThis;
  kosxEmojiTimer = view.setInterval(() => {
    const node = kosxEmojiRoot?.querySelector?.('[data-kosx-emoji]');
    if (!node) {
      stopKosxEmojiTimer();
      return;
    }
    if (kosxEmojiReduced()) {
      kosxEmojiIndex = 0;
      paintKosxEmoji(node);
      stopKosxEmojiTimer();
      return;
    }
    const next = kosxEmojiFrame(kosxEmojiIndex + 1);
    if (!kosxEmojiReady(next)) return;
    kosxEmojiIndex = next;
    if (node.src !== KOSX_EMOJI_FRAMES[next]) node.src = KOSX_EMOJI_FRAMES[next];
    if (node.alt !== KOSX_EMOJI_ALT) node.alt = KOSX_EMOJI_ALT;
  }, KOSX_EMOJI_INTERVAL_MS);
}

export function mountKosxEmoji(root = globalThis.document) {
  kosxEmojiRoot = root || null;
  kosxEmojiView = root?.defaultView || globalThis;
  preloadKosxEmoji(kosxEmojiView);
  if (!kosxEmojiMedia && typeof kosxEmojiView.matchMedia === 'function') {
    kosxEmojiMedia = kosxEmojiView.matchMedia('(prefers-reduced-motion: reduce)');
    kosxEmojiMedia.addEventListener?.('change', syncKosxEmoji);
  }
  syncKosxEmoji();
}

const shorten = (value, maximum) => {
  const text = (typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > maximum ? characters.slice(0, maximum).join('') + '…' : text;
};

function preferenceStorage() {
  try { return globalThis.localStorage || null; }
  catch { return null; }
}

function withCreatorScope(state) {
  if (state?.creatorCatalog && state.creatorPreferences) return state;
  const store = preferenceStorage();
  const preferences = state?.creatorPreferences || (store
    ? readCreatorPreferences(store, creatorPreferenceKey(state?.mode, state?.publicPreview)).preferences : {});
  return {...state, creatorCatalog:state?.creatorCatalog || CREATOR_CATALOG, creatorPreferences:preferences};
}

function coverImage(post) {
  const records = [post.item, ...(post.records || [])];
  const record = records.find(item => (postStatusId(item?.original_url) === post.statusId || postStatusId(item?.canonical_url) === post.statusId)
    && normalizePostImage(item.post_image, post.originalUrl));
  return record ? normalizePostImage(record.post_image, post.originalUrl) : null;
}

function itemCover(item) {
  return normalizePostImage(item?.post_image, item?.original_url || item?.canonical_url);
}

function isKosxCard(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.origin === 'kosx_approved') return true;
  const refs = item.source_refs;
  return Array.isArray(refs) && refs.length === 1 && refs[0] === 'sopilot-kosx';
}

// Article-class KOSX cards use a delivered cover when one was stored.
// Anything else stays on the text card: a quote, or title and meta.
function articleCover(item) {
  if (!isKosxCard(item) || !isArticleClassItem(item)) return null;
  const url = normalizeCoverUrl(item?.cover_url);
  return url ? {url, kind:'article_cover'} : null;
}

function collectionFor(state, post) {
  const savedIds = state.savedItemIds || new Set(), archivedIds = state.archivedItemIds || new Set();
  const matches = item => item && (post.itemIds?.includes(item.id) || item.alias_ids?.some(id => post.itemIds?.includes(id))
    || postStatusId(item.original_url) === post.statusId || postStatusId(item.canonical_url) === post.statusId);
  const savedRecords = (state.savedItems || []).filter(matches);
  const archivedRecord = (state.archivedItems || []).find(matches) || savedRecords.find(item => archivedIds.has?.(item.id));
  const savedId = savedRecords[0]?.id || post.itemIds?.find(id => savedIds.has?.(id));
  const archivedId = archivedRecord?.id || post.itemIds?.find(id => archivedIds.has?.(id));
  return {saved:!!savedId, archived:!!archivedId, itemId:archivedId || savedId || post.item.id};
}

function homepageSourceLabel(name) {
  const text = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!text || /^sopilot$/i.test(text)) return '';
  return text.replace(/^SoPilot\s*[·•.\-]\s*/u, '').trim();
}

function sourceNames(entry, state) {
  const raw = entry.post?.sourceNames?.length
    ? entry.post.sourceNames
    : (entry.item?.source_refs || []).map(id => state.sources?.find(source => source.id === id)?.name || id);
  const names = raw.map(homepageSourceLabel).filter(Boolean);
  return names.length ? names : ['来源未提供'];
}

export function renderHomeShowcase(app, state, {now} = {}) {
  const selection = selectHomeShowcase(withCreatorScope(state), {now});
  const view = homeViewName(app.homeView);
  const signature = renderSignature();
  const body = view === 'yesterday'
    ? renderList(app, state, selection.yesterday, {id:'home-yesterday', title:'昨日全部精华帖', note:yesterdayNote(selection)})
    : view === 'week' ? renderWeek(app, state, selection)
    : view === 'kept' ? renderKept(app, state, selection)
    : renderLatest(app, state, selection);
  const cranial = renderCranialStage(app, selection.latest, view === 'latest');
  return `<div class="home-showcase">${renderKosxStrip(app)}<div class="home-hero"><div class="home-hero-mast">${signature}${renderBoostWatermark(app)}</div>${cranial}</div>${body}${renderKosxFooter()}</div>`;
}

function renderKosxStrip(app) {
  const open = app?.kosxOpen === true;
  const draft = typeof app?.kosxDraft === 'string' ? app.kosxDraft : '';
  const message = typeof app?.kosxMessage === 'string' ? app.kosxMessage : '';
  const error = typeof app?.kosxError === 'string' ? app.kosxError : '';
  const status = message || error;
  const e = value => app.escapeHtml(value);
  return `<section class="kosx-band" aria-label="KOSX 精选计划"><div class="kosx-strip"><div class="kosx-brand"><img class="kosx-mark" src="/assets/kosx/symbol-ink.svg" width="30" height="30" alt="KOSX 四瓣标志"><p class="kosx-name">KOSX 精选计划</p><img class="kosx-emoji" src="${KOSX_EMOJI_FRAMES[0]}" width="40" height="40" alt="${KOSX_EMOJI_ALT}" data-kosx-emoji></div><div class="kosx-middle"><p class="kosx-hint">上传你的精华帖链接</p><span class="kosx-paste"><span class="kosx-accent" aria-hidden="true"></span><button type="button" class="kosx-cta" id="kosx-open" aria-expanded="${open ? 'true' : 'false'}" aria-controls="kosx-panel">贴链接</button></span></div></div><form class="kosx-panel" id="kosx-panel"${open ? '' : ' hidden'}><label for="kosx-link">粘贴 X 精华帖链接</label><input id="kosx-link" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2000" placeholder="粘贴 X 精华帖链接" value="${e(draft)}"><button type="submit" class="kosx-submit">提交</button><p class="kosx-status" id="kosx-status" role="${error ? 'alert' : 'status'}" tabindex="-1">${e(status)}</p></form></section>`;
}

function renderKosxFooter() {
  return `<footer class="kosx-footer"><img class="kosx-wordmark" src="/assets/kosx/wordmark-ink.svg" width="187" height="32" alt="KOSX.ai，橙色圆点"></footer>`;
}

function renderBoostWatermark(app) {
  const stored = readBoostTotal(preferenceStorage());
  const count = Number.isSafeInteger(app?.homeBoostCount) && app.homeBoostCount >= 0 ? app.homeBoostCount : stored;
  return `<aside class="boost-watermark" aria-label="已助力"><span class="boost-watermark-label">已助力</span><span class="boost-watermark-figure"><span class="boost-watermark-wash" aria-hidden="true"></span><span class="boost-watermark-count" id="home-boost-count">${count}</span></span></aside>`;
}

function renderSignature() {
  const letters = ['L', 'e', 'v', 'i', 'f', 'l', 'o', 'w'];
  return `<section class="levi-signature" aria-labelledby="levi-flow-title"><h1 id="levi-flow-title" class="levi-flow" aria-label="Levi flow">${letters.map((letter, index) => `<span${index === 4 ? ' class="levi-word"' : ''}>${letter}</span>`).join('')}</h1><svg class="levi-scribble" viewBox="0 0 360 28" aria-hidden="true"><path d="M6 16c28-12 42 10 70 2 24-8 36 12 62 4 22-6 40 10 66 2 28-8 48 12 78 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><p class="levi-kicker">LEVI</p></section>`;
}

// Alternate newest essence posts across the two open heads, up to three each.
// An empty head is omitted so there is no blank slot.
export function splitCranialEntries(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean).slice(0, CRANIAL_PER_HEAD * 2) : [];
  const left = [], right = [];
  list.forEach((entry, index) => (index % 2 === 0 ? left : right).push(entry));
  return {left, right};
}

// Scroll progress 0–1. Later cards in a stack leave after the front card.
// Ease-in keeps the stack in the heads until the scroll commits, then they arrive together.
export function cranialFlightT(progress, stackIndex) {
  const lead = Math.min(CRANIAL_PER_HEAD - 1, Math.max(0, Number(stackIndex) || 0)) * 0.1;
  const raw = (Number(progress) - lead) / 0.8;
  const t = Math.min(1, Math.max(0, raw));
  return t * t;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function cssNum(value) {
  const n = Math.round(value * 1000) / 1000;
  return Object.is(n, -0) ? '0' : String(n);
}

// Size stays at the slot until the card is over its feed card, then eases
// into that rect. Fading starts slightly earlier so the arrival dissolves
// instead of sitting opaque on the real card.
function cranialBlend(t, startAt) {
  const amount = clamp01(t);
  if (amount <= startAt) return 0;
  const u = (amount - startAt) / (1 - startAt);
  return u * u * (3 - 2 * u);
}

export function placeCranialCard(card, anchorRect, targetRect, t) {
  const start = anchorRect && Number.isFinite(anchorRect.width) && Number.isFinite(anchorRect.height)
    ? anchorRect
    : {left:0, top:0, width:1, height:1};
  const end = targetRect && Number.isFinite(targetRect.width) && Number.isFinite(targetRect.height)
    ? targetRect
    : {left:start.left, top:start.top + 48, width:start.width, height:start.height};
  const amount = clamp01(t);
  const arrive = cranialBlend(amount, 0.84);
  const fade = cranialBlend(amount, 0.72);
  const startW = Math.max(start.width, 1);
  const startH = Math.max(start.height, 1);
  const scaleX = (startW + (end.width - startW) * arrive) / startW;
  const scaleY = (startH + (end.height - startH) * arrive) / startH;
  const startCx = start.left + start.width / 2;
  const startCy = start.top + start.height / 2;
  const cx = startCx + ((end.left + end.width / 2) - startCx) * amount;
  const cy = startCy + ((end.top + end.height / 2) - startCy) * amount;
  const left = cx - (startW * scaleX) / 2;
  const top = cy - (startH * scaleY) / 2;
  card.style.position = 'fixed';
  card.style.left = '0px';
  card.style.top = '0px';
  card.style.width = `${cssNum(startW)}px`;
  card.style.height = `${cssNum(startH)}px`;
  card.style.margin = '0';
  card.style.transformOrigin = '0 0';
  card.style.transform = `translate3d(${cssNum(left)}px, ${cssNum(top)}px, 0) scale(${cssNum(scaleX)}, ${cssNum(scaleY)})`;
  card.style.zIndex = '30';
  card.style.pointerEvents = 'none';
  card.style.opacity = cssNum(1 - fade);
}

function renderCranialLids() {
  return '<div class="cranial-lid cranial-lid-left" data-cranial-lid="left" aria-hidden="true"></div><div class="cranial-lid cranial-lid-right" data-cranial-lid="right" aria-hidden="true"></div>';
}

function renderCranialStage(app, entries, cards) {
  const art = `<img class="cranial-art" src="${CRANIAL_ART}" width="2048" height="2048" alt="" aria-hidden="true">`;
  const lids = renderCranialLids();
  if (!cards) return `<div class="cranial-stage" data-cranial-stage>${art}${lids}</div>`;
  const split = splitCranialEntries(entries);
  return `<div class="cranial-stage" data-cranial-stage>${art}${lids}${renderCranialBowl(app, 'left', split.left)}${renderCranialBowl(app, 'right', split.right)}</div>`;
}

function renderCranialBowl(app, side, entries) {
  if (!entries.length) return '';
  return `<div class="cranial-bowl cranial-bowl-${side}" data-cranial-bowl="${side}" inert aria-hidden="true">${entries.map((entry, index) => renderCranialCard(app, entry, index)).join('')}</div>`;
}

function renderCranialCard(app, entry, index) {
  const e = value => app.escapeHtml(value);
  const item = entry.post.item;
  const title = item.title || '来源未提供标题';
  const image = articleCover(item) || coverImage(entry.post);
  const id = e(item.id);
  const author = authorCue(item);
  const cover = image ? `<img class="cranial-cover" src="${e(image.url)}" alt="" decoding="async" referrerpolicy="no-referrer">` : '';
  return `<div class="cranial-slot" style="--stack:${index}" data-cranial-anchor="${id}"><article class="cranial-card" data-cranial-card data-cranial-id="${id}" data-cranial-stack="${index}">${cover}<p class="cranial-title">${e(title)}</p>${author ? `<p class="cranial-author">${e(author)}</p>` : ''}</article></div>`;
}

function cranialSelector(value) {
  const text = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
  return text.replace(/["\\]/g, '\\$&');
}

function cranialReduced(view) {
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

function cranialProgress(view) {
  const y = view?.scrollY ?? view?.pageYOffset ?? 0;
  return Math.min(1, Math.max(0, (Number(y) || 0) / CRANIAL_SCRUB_PX));
}

function cranialMeasure(node) {
  const rect = node.getBoundingClientRect();
  return {left:rect.left, top:rect.top, width:rect.width, height:rect.height};
}

function cranialLayer(doc) {
  let layer = doc.getElementById('cranial-flight-root');
  if (layer) return layer;
  layer = doc.createElement('div');
  layer.id = 'cranial-flight-root';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.pointerEvents = 'none';
  try { layer.inert = true; } catch { /* Older documents still keep the cards out of tab order via the bowl. */ }
  doc.body.appendChild(layer);
  return layer;
}

function cranialCardNodes(doc, stage) {
  const layer = doc.getElementById('cranial-flight-root');
  const parked = stage?.querySelectorAll?.('[data-cranial-card]') || [];
  const flying = layer?.querySelectorAll?.('[data-cranial-card]') || [];
  return [...parked, ...flying];
}

function restoreCranialCards(stage) {
  const doc = stage?.ownerDocument;
  const layer = doc?.getElementById('cranial-flight-root');
  if (!layer) return;
  for (const card of [...layer.querySelectorAll('[data-cranial-card]')]) {
    const anchor = stage.querySelector(`[data-cranial-anchor="${cranialSelector(card.getAttribute('data-cranial-id'))}"]`);
    card.removeAttribute('style');
    if (anchor) anchor.appendChild(card);
    else card.remove();
  }
  layer.remove();
}

function applyCranialFrame(doc, progress) {
  const stage = doc.querySelector('[data-cranial-stage]');
  if (!stage) return;
  const cards = cranialCardNodes(doc, stage);
  if (!cards.length) return;
  const layer = cranialLayer(doc);
  for (const card of cards) {
    if (card.parentElement !== layer) layer.appendChild(card);
    const id = card.getAttribute('data-cranial-id');
    const anchor = stage.querySelector(`[data-cranial-anchor="${cranialSelector(id)}"]`);
    if (!anchor) continue;
    const target = doc.getElementById(`home-card-latest-${id}`);
    const t = cranialFlightT(progress, card.getAttribute('data-cranial-stack'));
    placeCranialCard(card, cranialMeasure(anchor), target ? cranialMeasure(target) : null, t);
  }
}

function finishCranial(doc, {landed} = {}) {
  const stage = doc.querySelector('[data-cranial-stage]');
  const ids = cranialCardNodes(doc, stage).map(card => card.getAttribute('data-cranial-id')).filter(Boolean);
  doc.getElementById('cranial-flight-root')?.remove();
  cranialState.phase = 'done';
  stage?.classList.add('is-settled');
  if (!landed) return;
  for (const id of ids) doc.getElementById(`home-card-latest-${id}`)?.classList.add('is-cranial-landed');
}

function cranialCardsLanded(cards, progress) {
  return cards.length > 0 && cards.every(card => cranialFlightT(progress, card.getAttribute('data-cranial-stack')) >= 1);
}

function onCranialScroll() {
  const view = cranialState.view || globalThis;
  const doc = view.document;
  if (!doc || cranialState.phase === 'done') return;
  const stage = doc.querySelector('[data-cranial-stage]');
  if (!stage || stage.dataset.cranialMode === 'reduced') return;
  const cards = cranialCardNodes(doc, stage);
  if (!cards.length) return;
  const progress = cranialProgress(view);
  if (progress <= 0) {
    restoreCranialCards(stage);
    cranialState.phase = 'rest';
    return;
  }
  cranialState.phase = 'scrub';
  applyCranialFrame(doc, progress);
  // The last card reaches t=1 before the scrub track ends. Cap the bowls then,
  // so the openings are not left empty while an invisible card waits out the track.
  if (cranialCardsLanded(cards, progress)) finishCranial(doc, {landed:true});
}

export function resetCranialFlight() {
  cranialState.phase = 'rest';
  const doc = cranialState.view?.document || globalThis.document;
  doc?.getElementById?.('cranial-flight-root')?.remove();
}

export function mountCranialFlight(root = globalThis.document) {
  if (!root?.querySelector) return;
  const stage = root.querySelector('[data-cranial-stage]');
  if (!stage) return;
  const view = root.defaultView || globalThis;
  cranialState.view = view;
  if (cranialState.phase === 'done') {
    stage.classList.add('is-settled');
    return;
  }
  if (cranialReduced(view)) {
    stage.dataset.cranialMode = 'reduced';
    restoreCranialCards(stage);
    return;
  }
  const doc = root;
  const progress = cranialProgress(view);
  const parked = [...(stage.querySelectorAll?.('[data-cranial-card]') || [])];
  if (cranialCardsLanded(parked, progress)) {
    finishCranial(doc, {landed:false});
    return;
  }
  if (cranialState.phase === 'scrub' || (parked.length && progress > 0)) {
    doc.getElementById('cranial-flight-root')?.remove();
    if (progress <= 0) cranialState.phase = 'rest';
    else {
      cranialState.phase = 'scrub';
      applyCranialFrame(doc, progress);
    }
  }
  if (cranialState.listening) return;
  view.addEventListener?.('scroll', onCranialScroll, {passive:true});
  cranialState.listening = true;
}

function yesterdayNote(selection) {
  const day = selection.reference.yesterday || '未能确定';
  return `昨日全部是整理日的前一个北京时间自然日（${day}）里、已经放上公开首页的精华帖，按原帖发布时间从新到旧。包括过审写入公开首页的帖，以及账号池自动放上首页的帖。信息流里其他带日期的帖不放进来。已收起抽奖或推广信号 ${selection.counts.folded} 条。未核对原帖，未实测。`;
}

function latestNote(selection) {
  const short = selection.latest.length < 18 ? `符合条件的精华帖只有 ${selection.latest.length} 条，没有用假帖或其他公开帖补满 18 条。` : '这里是最近 18 条，不是热度榜。';
  const folded = selection.counts.folded ? `现有质量规则收起了 ${selection.counts.folded} 条抽奖或推广信号。` : '现有质量规则没有收起抽奖或推广信号。';
  const undated = selection.counts.undated ? `另有 ${selection.counts.undated} 条没有可用时间，没有放进最新、昨日或七日。` : '';
  return `最新精华是已经放上公开首页的精华帖，按原帖发布时间从新到旧。包括过审写入公开首页的帖，以及账号池自动放上首页的帖。没有发布时间时用榜单条目时间，再没有则用采集时间。信息流里其他带日期的帖不放进来。${short}${folded}未核对原帖，未实测。${undated}`;
}

function renderLatest(app, state, selection) {
  const e = value => app.escapeHtml(value);
  const underrated = selection.underrated.length
    ? `<section class="home-band home-underrated" id="home-underrated" aria-labelledby="home-underrated-title" data-underrated-rule="${e(selection.underratedRule)}"><header class="home-band-heading"><h2 id="home-underrated-title">昨日最被低估精华帖 <small>${selection.underrated.length}</small></h2></header>${renderCards(app, state, selection.underrated, 'under')}</section>`
    : '';
  return `<section class="home-band" id="home-latest" aria-labelledby="home-latest-title"><header class="home-band-heading"><h2 id="home-latest-title">最新精华帖 <small>${selection.latest.length} / 18</small></h2></header>${renderCards(app, state, selection.latest, 'latest')}<p class="home-rule">${e(latestNote(selection))}</p></section>${renderSlogan(e)}${underrated}`;
}

function renderSlogan(e) {
  return `<p class="home-slogan" id="home-marquee" aria-label="幕布"><span class="home-slogan-line">${e('你的文章，值得被看见')}</span></p>`;
}

function renderList(app, state, entries, {id, title, note}) {
  const e = value => app.escapeHtml(value);
  return `<section class="home-band" id="${e(id)}" aria-labelledby="${e(id)}-title"><header class="home-band-heading"><h2 id="${e(id)}-title">${e(title)} <small>${entries.length}</small></h2><p class="home-rule">${e(note)}</p></header>${entries.length ? renderCards(app, state, entries, id) : '<p class="home-empty">这一日没有放上公开首页的精华帖。没有把信息流里其他帖补进来。</p>'}</section>`;
}

function renderWeek(app, state, selection) {
  const e = value => app.escapeHtml(value);
  const entries = selection.week;
  return `<section class="home-band" id="home-week" aria-labelledby="home-week-title" data-week-rule="${e(selection.weekRule)}"><header class="home-band-heading"><h2 id="home-week-title">七日精选精华帖 <small>${entries.length}</small></h2><p class="home-rule">${e(selection.weekNote)}</p></header>${entries.length ? renderCards(app, state, entries, 'week') : '<p class="home-empty">这七日没有留下精华文章。没有把其余公开帖补进来。</p>'}</section>`;
}

function renderKept(app, state, selection) {
  const e = value => app.escapeHtml(value);
  const featured = selection.kept.featured, saved = selection.kept.saved;
  const note = '卧云精选贴读取这个浏览器里已经保存的手动精选和收藏，不另建本地库。手动选入或收藏不等于已实测。换浏览器或清空站点数据后这里会空。';
  return `<section class="home-band" id="home-kept" aria-labelledby="home-kept-title"><header class="home-band-heading"><h2 id="home-kept-title">卧云精选贴（常驻保存） <small>${featured.length + saved.length}</small></h2><p class="home-rule">${e(note)}</p></header><h3 class="home-subhead">我选入的精选 <small>${featured.length}</small></h3>${featured.length ? renderItemCards(app, state, featured, 'kept-featured') : '<p class="home-empty">这个浏览器还没有选入精选。选入仍由人工决定，不会自动出现在首页。</p>'}<h3 class="home-subhead">已收藏 <small>${saved.length}</small></h3>${saved.length ? renderItemCards(app, state, saved, 'kept-saved') : '<p class="home-empty">还没有收藏。点卡片上的收藏，会写在这个浏览器里。</p>'}${selection.kept.archivedCount ? `<p class="home-rule">另有归档材料留在这个浏览器，不重复列在这里。</p>` : ''}</section>`;
}

function itemAuthorHandle(item) {
  if (typeof item?.author_handle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(item.author_handle)) return item.author_handle;
  for (const value of [item?.original_url, item?.canonical_url]) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host !== 'x.com' && host !== 'twitter.com') continue;
      const handle = url.pathname.split('/').filter(Boolean)[0] || '';
      if (/^[A-Za-z0-9_]{1,15}$/.test(handle) && handle.toLowerCase() !== 'i') return handle;
    } catch { /* not a post url */ }
  }
  return '';
}

// Pool auto-approve stores kosx_review:"pool". Other cover posts only carry the author,
// so membership falls back to the same impact.kosx.ai handle list used at intake.
function kosxPoolBadge(item) {
  if (item?.kosx_review === 'pool' || isKosxPoolHandle(itemAuthorHandle(item))) return '<span class="kosx-pool-badge">KOSX</span>';
  return '';
}

// Old pool and review rows stored a process sentence as the excerpt. That
// sentence is not the post. A real note before it stays; the sentence does not.
function policyRemainder(rest) {
  const words = /账号池成员的精华帖|按时间放上首页|过审后放上首页|的 X 链接|尚未读取原文|未核对热度|不进入昨日最被低估/g;
  return !/[A-Za-z0-9\u4e00-\u9fff]/.test(rest.replace(words, ''));
}

export function coverExcerpt(summary) {
  const text = typeof summary === 'string' ? summary.trim() : '';
  if (!text) return '';
  const clause = /账号池成员的精华帖，按时间放上首页|过审后放上首页(?:的 X 链接)?|尚未读取原文，未核对热度|不进入昨日最被低估/g;
  let cut = text.length;
  for (const match of text.matchAll(clause)) {
    const index = match.index ?? 0;
    if (index < cut && policyRemainder(text.slice(index))) cut = index;
  }
  if (cut === text.length) return text;
  return text.slice(0, cut).replace(/[。．\s]+$/u, '').trim();
}

function renderCards(app, state, entries, group) {
  return `<div class="cover-grid">${entries.map(entry => renderPostCard(app, state, entry, group)).join('')}</div>`;
}

const hasClock = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

// The shelf clock already prefers published_at. created_at is the intake
// fallback when that field was never stored on the public row.
function cardClock(item, fallback) {
  if (fallback?.key === 'published' && fallback.iso) return {iso:fallback.iso, label:fallback.label};
  if (hasClock(item?.published_at)) return {iso:item.published_at, label:'原帖发布时间'};
  if (hasClock(item?.created_at)) return {iso:item.created_at, label:'原帖发布时间'};
  if (fallback?.iso) return {iso:fallback.iso, label:fallback.label || '时间未提供'};
  if (hasClock(item?.source_item_time)) return {iso:item.source_item_time, label:'榜单条目时间'};
  if (hasClock(item?.captured_at)) return {iso:item.captured_at, label:'采集或阅读时间'};
  return {iso:'', label:fallback?.label || '时间未提供'};
}

function authorCue(item) {
  const handle = itemAuthorHandle(item);
  const name = typeof item?.author_name === 'string' ? item.author_name.trim() : '';
  if (handle && name && name.toLowerCase() !== handle.toLowerCase()) return `${name} · @${handle}`;
  if (handle) return `@${handle}`;
  return postAuthorLabel(item);
}

function quoteText(excerpt) {
  const lines = excerpt.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length > 1) return lines.slice(0, 2).join(' ');
  return excerpt.replace(/\s+/g, ' ').trim();
}

// The card face already shows the excerpt. Open the details only when that
// face is shorter than the real excerpt. Heat gaps and "未核对" lines stay off the card.
function cardEvidence(e, excerpt, mode) {
  const full = typeof excerpt === 'string' ? excerpt.trim() : '';
  if (!full) return '';
  const collapsed = full.replace(/\s+/g, ' ').trim();
  const visible = mode === 'media' ? shorten(full, 96) : quoteText(full);
  if (!visible || visible === collapsed || visible.replace(/…$/, '') === collapsed) return '';
  return `<details class="cover-evidence"><summary>摘录与时间依据</summary><p>${e(full)}</p></details>`;
}

function renderPostCard(app, state, entry, group) {
  const post = entry.post, item = post.item;
  const title = item.title || '来源未提供标题';
  const excerpt = coverExcerpt(item.summary);
  const image = articleCover(item) || coverImage(post);
  return renderShowcaseCard(app, {
    group, item, title, excerpt, image, originalUrl:post.originalUrl, mediaKey:`${group}:${item.id}`,
    collection:collectionFor(state, post), names:sourceNames(entry, state).join('、'),
    clock:cardClock(item, entry.time), saveId:`home-save-${group}-${item.id}`,
  });
}

function renderItemCards(app, state, items, group) {
  return `<div class="cover-grid">${items.map(item => renderKeptCard(app, state, item, group)).join('')}</div>`;
}

function renderKeptCard(app, state, item, group) {
  const title = item.title || '已保存的材料';
  const excerpt = coverExcerpt(item.summary);
  const image = articleCover(item) || itemCover(item);
  const names = (item.source_refs || []).map(id => homepageSourceLabel(state.sources?.find(source => source.id === id)?.name) || (item.origin === 'dot_import' ? '手动精选' : homepageSourceLabel(id)));
  const archived = state.archivedItemIds?.has?.(item.id);
  const saved = !archived && (group === 'kept-saved' || state.savedItemIds?.has?.(item.id));
  return renderShowcaseCard(app, {
    group, item, title, excerpt, image, originalUrl:item.original_url, mediaKey:`${group}:${item.id}`,
    collection:{saved, archived, itemId:item.id}, names:names.filter(Boolean).join('、') || '来源未提供',
    clock:cardClock(item), saveId:`home-save-${group}-${item.id}`,
  });
}

function renderShowcaseCard(app, spec) {
  const e = value => app.escapeHtml(value);
  const {group, item, title, excerpt, image, originalUrl, mediaKey, collection, names, clock, saveId} = spec;
  const mode = image ? 'media' : excerpt ? 'quote' : 'plain';
  const id = e(item.id);
  const quote = quoteText(excerpt);
  const shown = clock.iso ? (app.formatTime ? app.formatTime(clock.iso) : clock.iso) : '';
  const kind = clock.iso && clock.label && clock.label !== '原帖发布时间' ? `<span class="cover-date-kind">${e(clock.label)}</span>` : '';
  const date = `<p class="cover-date">${kind}${clock.iso ? `<time datetime="${e(clock.iso)}">${e(shown)}</time>` : e(clock.label || '时间未提供')}</p>`;
  const quoteBlock = quote ? `<blockquote class="cover-quote"><span class="cover-quote-text">${e(quote)}</span></blockquote>` : '';
  const excerptLine = mode === 'media' && excerpt ? `<p class="cover-excerpt">${e(shorten(excerpt, 96))}</p>` : '';
  const evidence = cardEvidence(e, excerpt, mode);
  const author = authorCue(item);
  const cueBits = [
    kosxPoolBadge(item),
    author ? `<span class="cover-author">${e(author)}</span>` : '',
    names ? `<span>${e(names)}</span>` : '',
  ].filter(Boolean);
  return `<article class="cover-card shape-card" id="home-card-${e(group)}-${id}" data-shape="card" data-home-card="${id}" data-home-group="${e(group)}" data-cover="${mode}">
    ${date}
    ${quoteBlock}
    ${renderCover(app, title, image, originalUrl, mediaKey)}
    <div class="cover-body"><h3><a href="${e(app.safeUrl(originalUrl))}" target="_blank" rel="noopener noreferrer">${e(title)}</a></h3>
      ${excerptLine}
      ${cueBits.length ? `<p class="cover-cue">${cueBits.join('')}</p>` : ''}
      ${evidence}
      <div class="cover-actions"><a class="shape-pill-solid" href="${e(app.safeUrl(originalUrl))}" target="_blank" rel="noopener noreferrer">打开原帖</a>${saveButton(e, collection, saveId, title)}</div>
    </div></article>`;
}

function renderCover(app, title, image, originalUrl, key) {
  const e = value => app.escapeHtml(value);
  if (!image) return '';
  const hit = `<a class="cover-hit" href="${e(app.safeUrl(originalUrl))}" target="_blank" rel="noopener noreferrer" aria-label="${e(`打开原帖：${title}`)}"></a>`;
  if (image.kind === 'article_cover') {
    const label = '文章封面，未核对原帖';
    return `<div class="cover-frame"><figure class="cover-photo cover-article" data-post-media><img src="${e(image.url)}" alt="${e(label)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-post-media-thumb><figcaption>${e(label)}</figcaption></figure>${hit}</div>`;
  }
  const kind = image.kind === 'video_poster' ? '视频封面，未播放' : '来源附图，未核对原帖';
  return `<div class="cover-frame"><figure class="cover-photo" data-post-media><img src="${e(image.url)}" alt="${e(kind)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-post-media-thumb><button type="button" class="cover-zoom" data-post-media-open data-post-media-key="${e(key)}" data-post-media-url="${e(image.url)}" data-post-media-kind="${e(image.kind)}" data-post-media-source="${e(image.source_url)}" data-post-media-original="${e(originalUrl)}" aria-label="${e(`放大${kind}：${title}`)}">放大</button><figcaption>${e(kind)}</figcaption></figure>${hit}</div>`;
}

function saveButton(e, collection, id, title) {
  const label = collection.archived ? '恢复收藏' : collection.saved ? '取消收藏' : '收藏';
  return `<button type="button" class="btn-quiet shape-pill-line${collection.saved ? ' is-saved' : ''}" id="${e(id)}" data-action="${collection.archived ? 'restore-collection' : 'toggle-save'}" data-item-id="${e(collection.itemId)}" aria-pressed="${collection.saved ? 'true' : 'false'}" aria-label="${e(`${label}：${title}`)}">${label}</button>`;
}
