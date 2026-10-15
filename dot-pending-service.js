import { dotPostKey } from './frontend/src/dotCandidates.js';
import { containsCredentialText } from './frontend/src/contentPrivacy.js';
import { dotInboxHash } from './dot-inbox-service.js';
import { PUBLIC_FEED_KEY, loadPublicSeed } from './frontend/cloud-feed-service.js';
import { attachKosxApproved, kosxPublicItem } from './frontend/kosx-public-posts.js';
import { KOSX_POOL_HANDLES } from './frontend/kosx-pool.js';
import { loadKosxPoolHandles } from './frontend/kosx-pool-cache.js';
import { wouldEnterUnderrated } from './frontend/src/homeShowcase.js';
import { PRIVATE_CONTENT } from './frontend/public-feed-data.js';
import { normalizeCoverUrl } from './frontend/src/postMedia.js';
import { REVIEW_COUNT_MAX, REVIEW_TEXT_MAX, REVIEW_TYPES, classifyReviewItem } from './frontend/src/reviewQueue.js';

export const DOT_PENDING_PATH = '/api/dot/pending';
export const DOT_PENDING_DECISION_PATH = '/api/dot/pending/decision';
export const DOT_PENDING_PREFIX = 'pending:';
export const DOT_PENDING_MAX = 300;
export const DOT_PENDING_BATCH_MAX = 20;
const MAX_NOTE = 400;
const MAX_BODY = 64 * 1024;
const recordFields = ['id', 'key', 'url', 'author_handle', 'note', 'status', 'submitted_at', 'source'];
const decidedFields = [...recordFields, 'reviewed_at'];
const signalFields = ['review_type', 'bookmark_count', 'like_count', 'has_article', 'cover_url', 'text'];
const timeFields = ['published_at', 'created_at'];
const intakeFields = ['url', 'author_handle', 'note', 'review_type', 'bookmark_count', 'like_count', 'has_article', 'cover_url', 'text', 'published_at', 'created_at'];
const hashPattern = /^[a-f0-9]{64}$/i;

class PendingError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (code, message) => { throw new PendingError(400, code, message); };
const unauthorized = (message = '带备注或批量提交需要投递密钥。') => { throw new PendingError(401, 'not_authorized', message); };
const unavailable = () => { throw new PendingError(503, 'pending_unavailable', '待筛选暂时不可用，请稍后重试。'); };

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {status, headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders,
  }});
}

export function isDotPendingRoute(pathname) {
  return pathname === DOT_PENDING_PATH || pathname === DOT_PENDING_DECISION_PATH;
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour < 24 && minute < 60 && second < 60;
}

function configured(env) {
  return hashPattern.test(env?.DOT_DELIVERY_TOKEN_HASH || '') && hashPattern.test(env?.DOT_REVIEW_TOKEN_HASH || '')
    && env.DOT_DELIVERY_TOKEN_HASH.toLowerCase() !== env.DOT_REVIEW_TOKEN_HASH.toLowerCase()
    && ['get', 'put', 'list'].every(method => typeof env?.DOT_INBOX?.[method] === 'function');
}

async function authorized(request, expectedHash) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer ([\x21-\x7e]{16,1024})$/i);
  if (!match) return false;
  const actual = await dotInboxHash(match[1]);
  const expected = expectedHash.toLowerCase();
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function canonicalPendingPost(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const key = dotPostKey(raw);
  if (!key) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  const author_handle = url.pathname.split('/')[1];
  const statusId = key.slice(2);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(author_handle)) return null;
  return {id:`kosx-${statusId}`, key, url:`https://x.com/${author_handle}/status/${statusId}`, author_handle};
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function cleanNote(value, present) {
  if (!present) return '';
  if (typeof value !== 'string' || value.length > MAX_NOTE || /[\u0000-\u001f\u007f]/.test(value) || containsCredentialText(value)) bad('invalid_note', '备注过长或不完整。');
  return value.trim();
}

function cleanCount(value, present, label) {
  if (!present) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > REVIEW_COUNT_MAX) bad('invalid_metrics', `${label}需为非负整数。`);
  return value;
}

function cleanArticle(value, present) {
  if (!present) return undefined;
  if (typeof value !== 'boolean') bad('invalid_article', 'has_article 只能是 true 或 false。');
  return value;
}

function cleanType(value, present) {
  if (!present) return undefined;
  if (!REVIEW_TYPES.includes(value)) bad('invalid_type', '类型只能是文章、教程指南、避坑、短帖或产品安利。');
  return value;
}

function cleanText(value, present) {
  if (!present) return undefined;
  if (typeof value !== 'string' || value.length > REVIEW_TEXT_MAX || /[\u0000-\u001f\u007f]/.test(value) || containsCredentialText(value)) bad('invalid_text', '摘录过长或不完整。');
  const text = value.trim();
  return text || undefined;
}

function cleanInstant(value, present) {
  if (!present) return undefined;
  if (!timestamp(value)) bad('invalid_time', '原帖时间需为带时区的时间。');
  return new Date(value).toISOString();
}

function cleanCover(value, present) {
  if (!present) return undefined;
  const cover = normalizeCoverUrl(value);
  if (!cover) bad('invalid_cover', '封面需为不含密钥的 https 地址。');
  return cover;
}

function onePost(value, {allowNote}) {
  if (!plain(value)) bad('invalid_body', '请提交 X 精华帖链接。');
  const keys = Object.keys(value);
  const allowed = allowNote ? intakeFields : ['url'];
  if (keys.some(key => !allowed.includes(key)) || !keys.includes('url')) {
    if (!allowNote) unauthorized();
    if (keys.includes('underrated_candidate')) bad('invalid_body', '进料不能标低估栏候选。过审时再用接收码选择。');
    bad('invalid_body', '请提交 X 精华帖链接。');
  }
  const post = canonicalPendingPost(value.url);
  if (!post) bad('invalid_url', '请粘贴有效的 X 链接。');
  if (Object.hasOwn(value, 'author_handle')) {
    if (typeof value.author_handle !== 'string' || value.author_handle.toLowerCase() !== post.author_handle.toLowerCase()) bad('invalid_author', '作者账号与原帖链接不一致。');
  }
  const note = cleanNote(value.note, Object.hasOwn(value, 'note'));
  if (!allowNote) return {...post, note};
  const review_type = cleanType(value.review_type, Object.hasOwn(value, 'review_type'));
  const bookmark_count = cleanCount(value.bookmark_count, Object.hasOwn(value, 'bookmark_count'), '收藏数');
  const like_count = cleanCount(value.like_count, Object.hasOwn(value, 'like_count'), '点赞数');
  const has_article = cleanArticle(value.has_article, Object.hasOwn(value, 'has_article'));
  const cover_url = cleanCover(value.cover_url, Object.hasOwn(value, 'cover_url'));
  const text = cleanText(value.text, Object.hasOwn(value, 'text'));
  const published_at = cleanInstant(value.published_at, Object.hasOwn(value, 'published_at'));
  const created_at = cleanInstant(value.created_at, Object.hasOwn(value, 'created_at'));
  return {
    ...post,
    note,
    ...(review_type ? {review_type} : {}),
    ...(bookmark_count !== undefined ? {bookmark_count} : {}),
    ...(like_count !== undefined ? {like_count} : {}),
    ...(has_article !== undefined ? {has_article} : {}),
    ...(cover_url ? {cover_url} : {}),
    ...(text ? {text} : {}),
    ...(published_at ? {published_at} : {}),
    ...(created_at ? {created_at} : {}),
  };
}

function postsFromBody(value, authenticated) {
  if (!plain(value)) bad('invalid_body', '请提交 X 精华帖链接。');
  const keys = Object.keys(value);
  if (!authenticated && (keys.length !== 1 || keys[0] !== 'url')) unauthorized();
  if (Object.hasOwn(value, 'items')) {
    if (!authenticated) unauthorized();
    if (keys.some(key => key !== 'items') || !Array.isArray(value.items) || !value.items.length || value.items.length > DOT_PENDING_BATCH_MAX) bad('invalid_body', `每批最多 ${DOT_PENDING_BATCH_MAX} 条 X 链接。`);
    const posts = value.items.map(item => onePost(item, {allowNote:true}));
    if (new Set(posts.map(post => post.key)).size !== posts.length) bad('duplicate_url', '同一批里有重复链接。');
    return {posts, batched:true};
  }
  return {posts:[onePost(value, {allowNote:authenticated})], batched:false};
}

async function readBody(request) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)))) bad('invalid_length', '请求长度不正确。');
  if (Number(contentLength) > MAX_BODY) {
    await request.body?.cancel().catch(() => {});
    bad('body_too_large', '提交内容过长。');
  }
  if (!request.body) bad('empty_body', '请提交 X 精华帖链接。');
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) throw new PendingError(413, 'body_too_large', '提交内容过长。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof PendingError) throw error;
    bad('invalid_body', '未收到完整提交，请重试。');
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text;
  try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { bad('invalid_encoding', '提交需使用 UTF-8 文本。'); }
  try { return JSON.parse(text); } catch { bad('invalid_json', '请提交 JSON。'); }
}

function signalsValid(value) {
  if (Object.hasOwn(value, 'review_type') && !REVIEW_TYPES.includes(value.review_type)) return false;
  for (const field of ['bookmark_count', 'like_count']) {
    if (Object.hasOwn(value, field) && (typeof value[field] !== 'number' || !Number.isSafeInteger(value[field]) || value[field] < 0 || value[field] > REVIEW_COUNT_MAX)) return false;
  }
  if (Object.hasOwn(value, 'has_article') && typeof value.has_article !== 'boolean') return false;
  if (Object.hasOwn(value, 'cover_url') && normalizeCoverUrl(value.cover_url) !== value.cover_url) return false;
  if (Object.hasOwn(value, 'text') && (typeof value.text !== 'string' || !value.text.trim() || value.text.length > REVIEW_TEXT_MAX || /[\u0000-\u001f\u007f]/.test(value.text) || containsCredentialText(value.text))) return false;
  for (const field of timeFields) if (Object.hasOwn(value, field) && !timestamp(value[field])) return false;
  const candidate = Object.hasOwn(value, 'underrated_candidate');
  const candidateAt = Object.hasOwn(value, 'underrated_candidate_at');
  if (candidate !== candidateAt) return false;
  if (candidate && (value.status !== 'approved' || value.underrated_candidate !== true || !timestamp(value.underrated_candidate_at))) return false;
  return true;
}

function validRecord(value, storageKey) {
  const decided = value?.status === 'approved' || value?.status === 'rejected';
  const fields = decided ? [...decidedFields] : [...recordFields];
  if (value?.status === 'approved' && Object.hasOwn(value, 'approval')) fields.push('approval');
  for (const field of signalFields) if (Object.hasOwn(value, field)) fields.push(field);
  for (const field of timeFields) if (Object.hasOwn(value, field)) fields.push(field);
  if (Object.hasOwn(value, 'underrated_candidate')) fields.push('underrated_candidate', 'underrated_candidate_at');
  if (!plain(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) return false;
  if (!signalsValid(value)) return false;
  if (Object.hasOwn(value, 'approval') && !['pool', 'review'].includes(value.approval)) return false;
  if (value?.approval === 'pool' && value.source !== 'delivery') return false;
  if (!['pending', 'approved', 'rejected'].includes(value.status) || !['homepage', 'delivery'].includes(value.source)) return false;
  if (decided && !timestamp(value.reviewed_at)) return false;
  if (!decided && Object.hasOwn(value, 'reviewed_at')) return false;
  if (`${DOT_PENDING_PREFIX}${value.key}` !== storageKey || value.id !== `kosx-${value.key.slice(2)}`) return false;
  if (typeof value.note !== 'string' || value.note.length > MAX_NOTE || /[\u0000-\u001f\u007f]/.test(value.note) || containsCredentialText(value.note)) return false;
  if (!timestamp(value.submitted_at)) return false;
  const post = canonicalPendingPost(value.url);
  return !!post && post.key === value.key && post.url === value.url && post.author_handle === value.author_handle && post.id === value.id;
}

async function readStored(env, key) {
  const storageKey = `${DOT_PENDING_PREFIX}${key}`;
  const raw = await env.DOT_INBOX.get(storageKey);
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_BODY) unavailable();
  let stored;
  try { stored = JSON.parse(raw); } catch { unavailable(); }
  if (!validRecord(stored, storageKey)) unavailable();
  return stored;
}

async function pendingCount(env) {
  const page = await env.DOT_INBOX.list({prefix:DOT_PENDING_PREFIX, limit:DOT_PENDING_MAX});
  if (!page || !Array.isArray(page.keys) || page.keys.length > DOT_PENDING_MAX || typeof page.list_complete !== 'boolean') unavailable();
  if (!page.list_complete) return DOT_PENDING_MAX;
  if (page.keys.some(entry => typeof entry?.name !== 'string' || !entry.name.startsWith(DOT_PENDING_PREFIX))) unavailable();
  return page.keys.length;
}

function signalView(record) {
  const view = {};
  if (typeof record.review_type === 'string') view.review_type = record.review_type;
  if (Object.hasOwn(record, 'bookmark_count')) view.bookmark_count = record.bookmark_count;
  if (Object.hasOwn(record, 'like_count')) view.like_count = record.like_count;
  if (Object.hasOwn(record, 'has_article')) view.has_article = record.has_article;
  if (typeof record.cover_url === 'string') view.cover_url = record.cover_url;
  if (typeof record.text === 'string' && record.text) view.text = record.text;
  if (typeof record.published_at === 'string') view.published_at = record.published_at;
  if (typeof record.created_at === 'string') view.created_at = record.created_at;
  if (record.underrated_candidate === true) {
    view.underrated_candidate = true;
    view.underrated_candidate_at = record.underrated_candidate_at;
  }
  return view;
}

function publicView(record, {includeNote}) {
  return {
    id:record.id, key:record.key, url:record.url, author_handle:record.author_handle, status:record.status,
    submitted_at:record.submitted_at,
    ...(includeNote && record.reviewed_at ? {reviewed_at:record.reviewed_at} : {}),
    ...(includeNote && record.approval ? {approval:record.approval} : {}),
    ...(includeNote ? {note:record.note, source:record.source, ...signalView(record)} : {}),
  };
}

function inPool(handles, value) {
  return typeof value === 'string' && handles.has(value.toLowerCase());
}

function intakeView(record, {includeNote, existing, held, handles}) {
  const view = {...publicView(record, {includeNote}), existing};
  if (includeNote) {
    view.pool = inPool(handles, record.author_handle);
    view.published = record.status === 'approved';
  }
  if (held) view.message = '这条会进入昨日最被低估，保持待筛选，需接收码人工过审。';
  else if (existing && record.status === 'approved') view.message = '这条已经在公开首页。';
  else if (existing && record.status === 'rejected') view.message = '这条已从待筛选里略过。';
  else if (includeNote && record.approval === 'pool' && record.status === 'approved') view.message = '账号池成员的精华帖已按时间放上公开首页。';
  return view;
}

function withReviewSignals(record, post) {
  const classified = classifyReviewItem({
    review_type:post.review_type, note:record.note, text:post.text,
    has_article:post.has_article, bookmark_count:post.bookmark_count, like_count:post.like_count,
  });
  const next = {...record, review_type:classified.review_type};
  if (post.bookmark_count !== undefined) next.bookmark_count = post.bookmark_count;
  if (post.like_count !== undefined) next.like_count = post.like_count;
  if (post.has_article !== undefined) next.has_article = post.has_article;
  if (post.cover_url) next.cover_url = post.cover_url;
  if (post.text) next.text = post.text;
  if (post.published_at) next.published_at = post.published_at;
  if (post.created_at) next.created_at = post.created_at;
  return next;
}

function copySignals(stored, record) {
  for (const field of [...signalFields, ...timeFields]) if (Object.hasOwn(stored, field)) record[field] = stored[field];
  return record;
}

function absentSignal(stored, post, field) {
  if (Object.hasOwn(stored, field)) return undefined;
  if (field === 'bookmark_count' || field === 'like_count') return typeof post[field] === 'number' ? post[field] : undefined;
  if (field === 'has_article') return typeof post[field] === 'boolean' ? post[field] : undefined;
  if (field === 'cover_url') return normalizeCoverUrl(post.cover_url) || undefined;
  if (field === 'review_type') return REVIEW_TYPES.includes(post[field]) ? post[field] : undefined;
  if (field === 'text') return typeof post.text === 'string' && post.text ? post.text : undefined;
  return undefined;
}

// A later delivery may replace published_at / created_at when the body brings
// a valid instant. Signal fields are fill-if-absent: bookmark_count, like_count,
// review_type, has_article, cover_url, and text are copied only when the stored
// row does not already have them. Zero counts and has_article false count as
// present. An existing cover_url is not replaced. Notes and the review clock
// stay as first written. The caller leaves rejected rows untouched.
function mergeIntakeTimes(stored, post) {
  let changed = false;
  const next = {...stored};
  for (const field of timeFields) {
    if (!timestamp(post[field]) || next[field] === post[field]) continue;
    next[field] = post[field];
    changed = true;
  }
  for (const field of signalFields) {
    const value = absentSignal(stored, post, field);
    if (value === undefined) continue;
    next[field] = value;
    changed = true;
  }
  return changed ? next : null;
}

// candidate: true sets the flag, false clears it, null keeps the previous flag.
// The flag never writes the underrated pin list.
function decidedRecord(stored, status, reviewed_at, approval, {candidate = null, review_type, candidateAt} = {}) {
  const record = {
    id:stored.id, key:stored.key, url:stored.url, author_handle:stored.author_handle, note:stored.note,
    status, submitted_at:stored.submitted_at, source:stored.source, reviewed_at,
  };
  if (approval) record.approval = approval;
  copySignals(stored, record);
  if (review_type) record.review_type = review_type;
  const keep = status === 'approved' && (candidate === true || (candidate !== false && stored.underrated_candidate === true));
  if (keep) {
    record.underrated_candidate = true;
    record.underrated_candidate_at = stored.underrated_candidate === true ? stored.underrated_candidate_at : candidateAt;
  }
  return record;
}

function showcaseState(feed) {
  return {sources:feed.sources, allItems:feed.items, items:feed.items, profile:feed.profile || {}, generated_at:feed.generated_at};
}

function canRelease(item) {
  return !!item && !containsCredentialText(item) && !PRIVATE_CONTENT.test(JSON.stringify(item));
}

// Delivery of a pool handle can publish onto the chronological cover.
// Homepage paste, non-members, rejected rows, and anything that would enter
// 昨日最被低估 stay pending for the review code. Follower counts are not read.
async function applyPoolRelease(env, posts, existing, delivery, handles) {
  const held = new Set();
  const promoted = new Set();
  if (!delivery) return {held, promoted, published:false};
  const pendingPool = posts.map(post => existing.get(post.key)).filter(record => record?.source === 'delivery' && record.status === 'pending' && inPool(handles, record.author_handle));
  const repair = posts.some(post => {
    const record = existing.get(post.key);
    return record?.source === 'delivery' && record.status === 'approved' && record.approval === 'pool';
  });
  if (!pendingPool.length && !repair) return {held, promoted, published:false};
  if (typeof env?.PUBLIC_FEED?.get !== 'function' || typeof env?.PUBLIC_FEED?.put !== 'function') unavailable();
  const reviewed_at = new Date().toISOString();
  const base = await readPublicFeed(env);
  const approved = await listApprovedKosxRecords(env);
  const accepted = [...approved];
  for (const record of pendingPool) {
    const trial = decidedRecord(record, 'approved', reviewed_at, null);
    const item = kosxPublicItem(trial);
    if (!canRelease(item)) continue;
    let blocked = true;
    try { blocked = wouldEnterUnderrated(showcaseState(attachKosxApproved(base, [...accepted, trial])), record.id); }
    catch { blocked = true; }
    if (blocked) { held.add(record.key); continue; }
    const next = decidedRecord(record, 'approved', reviewed_at, 'pool');
    await env.DOT_INBOX.put(`${DOT_PENDING_PREFIX}${record.key}`, JSON.stringify(next), {
      metadata:{id:next.id, key:next.key, status:'approved', submitted_at:next.submitted_at, reviewed_at, approval:'pool'},
    });
    existing.set(record.key, next);
    accepted.push(next);
    promoted.add(record.key);
  }
  const published = accepted.length !== approved.length || repair;
  if (published) await publishApproved(env);
  return {held, promoted, published};
}

function queryCursor(url, isRead) {
  const entries = [...url.searchParams.entries()];
  if (!entries.length) return null;
  if (!isRead || entries.length !== 1 || entries[0][0] !== 'cursor') bad('unsupported_query', '此入口不支持这些查询参数；密钥只能放在请求头。');
  const value = entries[0][1];
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) bad('invalid_cursor', '分页位置不正确，请从第一条重新读取。');
  return value;
}

export async function listApprovedKosxRecords(env) {
  const records = [];
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    let listed;
    try { listed = await env.DOT_INBOX.list({prefix:DOT_PENDING_PREFIX, limit:DOT_PENDING_MAX, ...(cursor ? {cursor} : {})}); }
    catch { unavailable(); }
    if (!listed || !Array.isArray(listed.keys) || listed.keys.length > DOT_PENDING_MAX || typeof listed.list_complete !== 'boolean') unavailable();
    for (const entry of listed.keys) {
      const key = entry?.name?.slice(DOT_PENDING_PREFIX.length);
      if (!entry?.name?.startsWith(DOT_PENDING_PREFIX) || !key) unavailable();
      const stored = await readStored(env, key);
      if (!stored) unavailable();
      if (stored.status === 'approved') records.push(stored);
    }
    if (listed.list_complete) return records;
    if (typeof listed.cursor !== 'string' || !listed.cursor || listed.cursor === cursor) unavailable();
    cursor = listed.cursor;
  }
  unavailable();
}

async function readPublicFeed(env) {
  if (typeof env?.PUBLIC_FEED?.get !== 'function' || typeof env?.PUBLIC_FEED?.put !== 'function') unavailable();
  let raw;
  try { raw = await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY); }
  catch { unavailable(); }
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { unavailable(); }
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.items) && Array.isArray(raw.sources)) return raw;
  try { return await loadPublicSeed(env); }
  catch { unavailable(); }
}

async function publishApproved(env) {
  const feed = attachKosxApproved(await readPublicFeed(env), await listApprovedKosxRecords(env));
  await env.PUBLIC_FEED.put(PUBLIC_FEED_KEY, JSON.stringify(feed));
  return feed;
}

async function handleDecision(request, env, review) {
  if (request.method !== 'POST') return json({error:'method_not_allowed', message:'不支持此操作。'}, 405, {Allow:'POST'});
  if (!review) return json({error:'not_authorized', message:'过审需要接收码。投递密钥不能把链接放上首页。'}, 401, {'WWW-Authenticate':'Bearer realm="dot-pending"'});
  if ([...new URL(request.url).searchParams.keys()].length) bad('unsupported_query', '此入口不支持这些查询参数；密钥只能放在请求头。');
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({error:'json_required', message:'请使用 application/json 提交。'}, 415);
  if (typeof env?.PUBLIC_FEED?.get !== 'function' || typeof env?.PUBLIC_FEED?.put !== 'function') unavailable();
  const body = await readBody(request);
  const decisionFields = ['url', 'status', 'underrated_candidate', 'review_type'];
  if (!plain(body) || Object.keys(body).some(key => !decisionFields.includes(key)) || !Object.hasOwn(body, 'url') || !Object.hasOwn(body, 'status')) bad('invalid_body', '请提交要过审的 X 链接和结果。');
  if (!['approved', 'rejected'].includes(body.status)) bad('invalid_status', '过审结果只能是 approved 或 rejected。');
  if (Object.hasOwn(body, 'underrated_candidate') && typeof body.underrated_candidate !== 'boolean') bad('invalid_candidate', '进低估栏候选只能是 true 或 false。');
  if (body.underrated_candidate === true && body.status !== 'approved') bad('invalid_candidate', '只有过审通过时才能标成低估栏候选。');
  const reviewType = cleanType(body.review_type, Object.hasOwn(body, 'review_type'));
  const post = canonicalPendingPost(body.url);
  if (!post) bad('invalid_url', '请粘贴有效的 X 链接。');
  const stored = await readStored(env, post.key);
  if (!stored) return json({error:'not_found', message:'这条链接不在待筛选里。'}, 404);
  let record = stored;
  const statusChanged = stored.status !== body.status;
  const markReview = body.status === 'approved' && stored.approval === 'pool';
  const candidate = Object.hasOwn(body, 'underrated_candidate') ? body.underrated_candidate : null;
  const candidateChanged = candidate === true ? stored.underrated_candidate !== true : candidate === false && stored.underrated_candidate === true;
  const typeChanged = !!reviewType && reviewType !== stored.review_type;
  // A candidate flag stays on this pending row. It does not call /api/dot/underrated.
  if (statusChanged || markReview || candidateChanged || typeChanged) {
    const reviewed_at = statusChanged ? new Date().toISOString() : stored.reviewed_at;
    record = decidedRecord(stored, body.status, reviewed_at, body.status === 'approved' ? 'review' : null, {
      candidate, review_type:reviewType, candidateAt:new Date().toISOString(),
    });
    if (record.status === 'approved' && !canRelease(kosxPublicItem(record))) bad('invalid_note', '这条备注不能放上公开首页。');
    await env.DOT_INBOX.put(`${DOT_PENDING_PREFIX}${record.key}`, JSON.stringify(record), {
      metadata:{id:record.id, key:record.key, status:record.status, submitted_at:record.submitted_at, reviewed_at:record.reviewed_at, ...(record.approval ? {approval:record.approval} : {})},
    });
  }
  await publishApproved(env);
  return json({...publicView(record, {includeNote:true}), existing:!statusChanged, published:record.status === 'approved'});
}

export async function handleDotPendingRequest(request, env) {
  try {
    const url = new URL(request.url);
    if (!isDotPendingRoute(url.pathname)) return null;
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== url.origin) return json({error:'origin_not_allowed', message:'不接受其他网站发来的待筛选请求。'}, 403);
    if (!configured(env)) unavailable();
    const delivery = await authorized(request, env.DOT_DELIVERY_TOKEN_HASH);
    const review = await authorized(request, env.DOT_REVIEW_TOKEN_HASH);
    if (url.pathname === DOT_PENDING_DECISION_PATH) return await handleDecision(request, env, review);
    if (!['GET', 'POST'].includes(request.method)) return json({error:'method_not_allowed', message:'不支持此操作。'}, 405, {Allow:'GET, POST'});
    const isRead = request.method === 'GET';
    if (isRead ? !review : request.headers.get('Authorization') && !delivery) return json({error:'not_authorized', message:'待筛选连接未通过，请检查对应的接入密钥。'}, 401, {'WWW-Authenticate':'Bearer realm="dot-pending"'});
    const cursor = queryCursor(url, isRead);
    if (isRead) {
      let page;
      try { page = await env.DOT_INBOX.list({prefix:DOT_PENDING_PREFIX, limit:50, ...(cursor ? {cursor} : {})}); }
      catch (error) {
        if (cursor && /cursor|invalid|400/i.test(String(error?.message))) bad('invalid_cursor', '分页位置已失效，请从第一条重新读取。');
        unavailable();
      }
      if (!page || !Array.isArray(page.keys) || page.keys.length > 50 || typeof page.list_complete !== 'boolean') unavailable();
      const items = [];
      for (const entry of page.keys) {
        const key = entry?.name?.slice(DOT_PENDING_PREFIX.length);
        if (!entry?.name?.startsWith(DOT_PENDING_PREFIX) || !key) unavailable();
        const stored = await readStored(env, key);
        if (!stored) unavailable();
        items.push(publicView(stored, {includeNote:true}));
      }
      if (!page.list_complete && (typeof page.cursor !== 'string' || !page.cursor || page.cursor.length > 2048 || /[\u0000-\u0020\u007f]/.test(page.cursor))) unavailable();
      return json({items, next_cursor:page.list_complete ? null : page.cursor});
    }
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({error:'json_required', message:'请使用 application/json 提交。'}, 415);
    const {posts, batched} = postsFromBody(await readBody(request), delivery);
    const existing = new Map();
    for (const post of posts) {
      const stored = await readStored(env, post.key);
      if (stored) existing.set(post.key, stored);
    }
    const created = posts.filter(post => !existing.has(post.key));
    if (created.length && await pendingCount(env) + created.length > DOT_PENDING_MAX) return json({error:'queue_full', message:'待筛选已满，请先处理已有链接。'}, 409);
    const submitted_at = new Date().toISOString();
    const source = delivery ? 'delivery' : 'homepage';
    for (const post of created) {
      const record = withReviewSignals({...post, status:'pending', submitted_at, source}, post);
      await env.DOT_INBOX.put(`${DOT_PENDING_PREFIX}${post.key}`, JSON.stringify(record), {
        metadata:{id:record.id, key:record.key, status:'pending', submitted_at},
      });
      existing.set(post.key, record);
    }
    const refreshed = [];
    for (const post of posts) {
      if (created.includes(post)) continue;
      const stored = existing.get(post.key);
      if (!stored || stored.status === 'rejected') continue;
      const next = mergeIntakeTimes(stored, post);
      if (!next) continue;
      await env.DOT_INBOX.put(`${DOT_PENDING_PREFIX}${next.key}`, JSON.stringify(next), {
        metadata:{id:next.id, key:next.key, status:next.status, submitted_at:next.submitted_at, ...(next.reviewed_at ? {reviewed_at:next.reviewed_at} : {}), ...(next.approval ? {approval:next.approval} : {})},
      });
      existing.set(post.key, next);
      if (next.status === 'approved') refreshed.push(next.key);
    }
    let handles = new Set(KOSX_POOL_HANDLES);
    if (delivery) {
      try { handles = await loadKosxPoolHandles(env); }
      catch { handles = new Set(KOSX_POOL_HANDLES); }
    }
    const {held, promoted, published} = await applyPoolRelease(env, posts, existing, delivery, handles);
    if (refreshed.length && !published) await publishApproved(env);
    const results = posts.map(post => intakeView(existing.get(post.key), {includeNote:delivery, existing:!created.includes(post), held:held.has(post.key), handles}));
    const changed = created.length || promoted.size;
    if (!batched) return json(results[0], changed ? 201 : 200);
    const status = results.every(row => row.status === 'approved') ? 'approved' : results.some(row => row.status === 'approved') ? 'partial' : 'pending';
    return json({status, results}, changed ? 201 : 200);
  } catch (error) {
    if (error instanceof PendingError) return json({error:error.code, message:error.message}, error.status, error.status === 401 ? {'WWW-Authenticate':'Bearer realm="dot-pending"'} : {});
    return json({error:'pending_unavailable', message:'待筛选暂时不可用，请稍后重试。'}, 503);
  }
}
