import { blankPublicCover, homepageCardExcerpt, homepageCardTitle, itemAuthorHandle, showcaseCoverMedia, usableCardTitle } from './src/coverFace.js';
import { dotPostKey } from './src/dotCandidates.js';
import { isHomepageEssence } from './src/homeShowcase.js';
import { isKosxPoolHandle } from './kosx-pool.js';
import { selectPostStream } from './src/postStream.js';
import { stripIntakePipelineCopy } from './src/reviewQueue.js';

// One page of the curated essence line. The homepage rails stay on their own
// windows and caps. Membership is remembered in PUBLIC_FEED under
// ESSENCE_ARCHIVE_KEY, separate from the homepage snapshot.
export const ESSENCE_ARCHIVE_PAGE_SIZE = 24;
export const ESSENCE_ARCHIVE_PATH = '/api/essence-archive';
export const ESSENCE_ARCHIVE_ADMIN_PATH = '/api/essence-archive/admin';
export const ESSENCE_ARCHIVE_KEY = 'essence-archive:v1';
export const ESSENCE_ARCHIVE_SCHEMA = 'essence-archive-v1';
export const ESSENCE_ARCHIVE_CAP = 2000;

const KEY = /^x:[1-9]\d{0,24}$/;

// Pending intake uses dotPostKey, which wants a long snowflake. The public stream
// also accepts a shorter numeric status id. The archive uses that same identity.
export function archiveKeyFromUrl(value) {
  const strict = dotPostKey(typeof value === 'string' ? value.trim() : '');
  if (strict) return strict;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/([1-9]\d{0,24})\/?$/);
    return match ? `x:${match[1]}` : null;
  } catch {
    return null;
  }
}

const finite = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function recordsOf(post) {
  return [post?.item, ...(Array.isArray(post?.records) ? post.records : [])].filter(item => item && typeof item === 'object');
}

function essenceRows(post) {
  return recordsOf(post).filter(isHomepageEssence);
}

// Approval is source_item_time on the essence row. The original post clock is
// published_at, then created_at. A missing approval falls back to that clock.
function clocks(post) {
  let approved = 0;
  let published = 0;
  for (const item of essenceRows(post)) {
    if (finite(item.source_item_time)) approved = Math.max(approved, Date.parse(item.source_item_time));
    const original = finite(item.published_at) ? item.published_at : finite(item.created_at) ? item.created_at : '';
    if (original) published = Math.max(published, Date.parse(original));
  }
  return {approved, published};
}

function face(post) {
  const pool = recordsOf(post);
  let excerpt = '';
  let title = homepageCardTitle(post.item);
  const replaceTitle = !usableCardTitle(post.item);
  for (const candidate of pool) {
    const nextExcerpt = homepageCardExcerpt(candidate.summary);
    if (Array.from(nextExcerpt).length > Array.from(excerpt).length) excerpt = nextExcerpt;
    if (!replaceTitle) continue;
    const nextTitle = usableCardTitle(candidate);
    const current = usableCardTitle({...post.item, title});
    if (nextTitle && Array.from(nextTitle).length > Array.from(current).length) title = nextTitle;
  }
  return {title, excerpt};
}

function sourceLabel(post) {
  const names = (Array.isArray(post?.sourceNames) ? post.sourceNames : [])
    .map(name => stripIntakePipelineCopy(typeof name === 'string' ? name : '').replace(/^SoPilot\s*[·•.\-]\s*/u, '').trim())
    .filter(Boolean);
  return names.find(name => name.includes('过审')) || names[0] || 'KOSX 过审';
}

function authorCue(post) {
  for (const item of recordsOf(post)) {
    const handle = itemAuthorHandle(item);
    const name = stripIntakePipelineCopy(typeof item.author_name === 'string' ? item.author_name : '');
    if (handle && name && name.toLowerCase() !== handle.toLowerCase()) return `${name} · @${handle}`;
    if (handle) return `@${handle}`;
    if (name) return name;
  }
  return '';
}

function cardFrom(post, clock) {
  const key = archiveKeyFromUrl(post.originalUrl);
  if (!key) return null;
  const shown = face(post);
  const image = showcaseCoverMedia(post);
  const rows = recordsOf(post);
  const pool = essenceRows(post).some(item => item.kosx_review === 'pool') || rows.some(item => isKosxPoolHandle(itemAuthorHandle(item)));
  return {
    key,
    id: post.item.id,
    title: shown.title,
    excerpt: shown.excerpt,
    url: post.originalUrl,
    published_at: clock.published ? new Date(clock.published).toISOString() : '',
    approved_at: clock.approved ? new Date(clock.approved).toISOString() : '',
    author: authorCue(post),
    source: sourceLabel(post),
    cover_url: typeof image?.url === 'string' && image.url.startsWith('https://') ? image.url : '',
    cover_kind: typeof image?.kind === 'string' ? image.kind : '',
    pool,
  };
}

// Same membership as 最新精华: an approved kosx row on any copy of the post,
// a face the card can show, and the quality fold already applied by the stream.
// No 30-day window and no 18-card cap. Order is approval time, then the
// original post time, then id.
export function essenceArchiveCards(state) {
  const stream = selectPostStream(state || {}, {sources:state?.sources, profile:{}, view:'all', limit:100000});
  const cards = [];
  for (const post of stream.posts) {
    if (!post || post.quality?.fold) continue;
    if (!essenceRows(post).length || blankPublicCover(post)) continue;
    const clock = clocks(post);
    if (!clock.approved && !clock.published) continue;
    const card = cardFrom(post, clock);
    if (!card) continue;
    cards.push({card, clock});
  }
  cards.sort((a, b) => (b.clock.approved || b.clock.published) - (a.clock.approved || a.clock.published)
    || b.clock.published - a.clock.published
    || compareId(a.card.id, b.card.id));
  return cards.map(entry => entry.card);
}

export function pageEssenceArchive(cards, {page = 1, pageSize = ESSENCE_ARCHIVE_PAGE_SIZE} = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const size = Number.isSafeInteger(pageSize) && pageSize >= 20 && pageSize <= 30 ? pageSize : ESSENCE_ARCHIVE_PAGE_SIZE;
  const current = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const total = list.length;
  const pages = total ? Math.ceil(total / size) : 0;
  const start = (current - 1) * size;
  const items = start >= 0 && start < total ? list.slice(start, start + size) : [];
  return {page:current, page_size:size, total, pages, sort:'approved_at', fallback:'published_at', items};
}

export function essenceArchiveState(feed) {
  return {
    items:Array.isArray(feed?.items) ? feed.items : [],
    sources:Array.isArray(feed?.sources) ? feed.sources : [],
    generated_at:typeof feed?.generated_at === 'string' ? feed.generated_at : '',
    hiddenItemIds:new Set(),
    profile:{},
  };
}

function clip(value, max) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return Array.from(clean).slice(0, max).join('');
}

function stamp(value) {
  return finite(value) && value.length <= 40 ? new Date(Date.parse(value)).toISOString() : '';
}

function httpsCover(value) {
  if (typeof value !== 'string' || value.length > 2000 || !value.startsWith('https://')) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

// Public JSON never carries the storage key or the take-down flag.
export function publicArchiveCard(card) {
  return {
    id:clip(card?.id, 80),
    title:clip(card?.title, 500),
    excerpt:clip(card?.excerpt, 4000),
    url:typeof card?.url === 'string' ? card.url : '',
    published_at:stamp(card?.published_at),
    approved_at:stamp(card?.approved_at),
    author:clip(card?.author, 120),
    source:clip(card?.source, 80),
    cover_url:httpsCover(card?.cover_url),
    cover_kind:clip(card?.cover_kind, 40),
    pool:card?.pool === true,
  };
}

function storedCard(card, previous) {
  const face = publicArchiveCard(card);
  const removed = previous?.removed === true;
  return {
    ...face,
    key:card.key,
    approved_at:stamp(previous?.approved_at) || face.approved_at,
    removed,
    removed_at:removed ? stamp(previous?.removed_at) : '',
  };
}

function sortMoment(card) {
  return Date.parse(card?.approved_at) || Date.parse(card?.published_at) || 0;
}

function byArchiveOrder(cards) {
  return [...cards].sort((a, b) => sortMoment(b) - sortMoment(a)
    || (Date.parse(b?.published_at) || 0) - (Date.parse(a?.published_at) || 0)
    || compareId(String(a?.id || ''), String(b?.id || '')));
}

export function emptyEssenceArchive() {
  return {schema:ESSENCE_ARCHIVE_SCHEMA, items:[]};
}

function looksLikePublicSnapshot(raw) {
  let doc = raw;
  if (typeof raw === 'string') {
    try { doc = JSON.parse(raw); } catch { return false; }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  if (typeof doc.schema_version === 'string') return true;
  return Array.isArray(doc.items) && doc.items.some(item => item && (item.source_refs || item.origin || item.canonical_url));
}

export function normalizeEssenceArchive(raw) {
  let doc = raw;
  if (typeof raw === 'string') {
    if (raw.length > 8_000_000) return null;
    try { doc = JSON.parse(raw); } catch { return null; }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.schema !== ESSENCE_ARCHIVE_SCHEMA || !Array.isArray(doc.items)) return null;
  const items = [];
  const seen = new Set();
  for (const item of doc.items) {
    if (!item || typeof item !== 'object' || !KEY.test(item.key) || seen.has(item.key)) continue;
    const key = archiveKeyFromUrl(item.url);
    if (key !== item.key) continue;
    seen.add(item.key);
    items.push(storedCard(item, item));
    if (items.length >= ESSENCE_ARCHIVE_CAP) break;
  }
  return {schema:ESSENCE_ARCHIVE_SCHEMA, items};
}

// New cards join. An already stored card keeps its first approval time and,
// once taken down, stays taken down across later publishes. At the cap, new
// keys are refused so a kept post is not evicted.
export function mergeEssenceArchive(stored, cards) {
  const base = stored?.schema === ESSENCE_ARCHIVE_SCHEMA && Array.isArray(stored.items) ? stored : emptyEssenceArchive();
  const byKey = new Map(base.items.map(item => [item.key, item]));
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || !KEY.test(card.key)) continue;
    const previous = byKey.get(card.key);
    if (!previous && byKey.size >= ESSENCE_ARCHIVE_CAP) continue;
    byKey.set(card.key, storedCard(card, previous));
  }
  return {schema:ESSENCE_ARCHIVE_SCHEMA, items:[...byKey.values()]};
}

export function setEssenceArchiveRemoved(doc, key, removed, removedAt) {
  if (!doc || doc.schema !== ESSENCE_ARCHIVE_SCHEMA || !Array.isArray(doc.items) || !KEY.test(key)) return null;
  if (!doc.items.some(item => item.key === key)) return null;
  const when = stamp(removedAt) || new Date().toISOString();
  return {
    schema:ESSENCE_ARCHIVE_SCHEMA,
    items:doc.items.map(item => item.key === key ? {...item, removed:removed === true, removed_at:removed === true ? when : ''} : item),
  };
}

export function pageStoredEssenceArchive(doc, {page = 1, includeRemoved = false} = {}) {
  const items = (Array.isArray(doc?.items) ? doc.items : []).filter(item => includeRemoved || item.removed !== true);
  const view = byArchiveOrder(items).map(item => includeRemoved
    ? {...publicArchiveCard(item), removed:item.removed === true, removed_at:item.removed === true ? stamp(item.removed_at) : ''}
    : publicArchiveCard(item));
  return pageEssenceArchive(view, {page});
}

export function essenceArchiveFromFeed(feed, options = {}) {
  return pageEssenceArchive(essenceArchiveCards(essenceArchiveState(feed)).map(publicArchiveCard), options);
}

export function snapshotLooksLikeFeed(raw) {
  return looksLikePublicSnapshot(raw);
}
