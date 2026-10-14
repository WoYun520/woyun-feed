import { dotPostKey } from './frontend/src/dotCandidates.js';
import { containsCredentialText } from './frontend/src/contentPrivacy.js';
import { addCalendarDays, beijingDateKey, postTime, referenceClock } from './frontend/src/homeShowcase.js';
import { dotInboxHash } from './dot-inbox-service.js';
import { canonicalPendingPost } from './dot-pending-service.js';
import { PUBLIC_FEED_KEY } from './frontend/cloud-feed-service.js';

export const DOT_UNDERRATED_PATH = '/api/dot/underrated';
export const UNDERRATED_PIN_KEY = 'underrated:pins:v1';
export const UNDERRATED_PIN_STORE_MAX = 8;
export const UNDERRATED_REVIEWER = 'review';
const MAX_NOTE = 400;
const MAX_BODY = 64 * 1024;
const pinFields = ['id', 'key', 'url', 'author_handle', 'day', 'pinned_at', 'note', 'reviewer'];
const hashPattern = /^[a-f0-9]{64}$/i;

class UnderratedError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (code, message) => { throw new UnderratedError(400, code, message); };
const unavailable = () => { throw new UnderratedError(503, 'underrated_unavailable', '昨日低估栏暂时不可用，请稍后重试。'); };

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

export function isDotUnderratedRoute(pathname) {
  return pathname === DOT_UNDERRATED_PATH;
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour < 24 && minute < 60 && second < 60;
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function configured(env) {
  return hashPattern.test(env?.DOT_DELIVERY_TOKEN_HASH || '') && hashPattern.test(env?.DOT_REVIEW_TOKEN_HASH || '')
    && env.DOT_DELIVERY_TOKEN_HASH.toLowerCase() !== env.DOT_REVIEW_TOKEN_HASH.toLowerCase()
    && ['get', 'put'].every(method => typeof env?.DOT_INBOX?.[method] === 'function')
    && typeof env?.PUBLIC_FEED?.get === 'function';
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

function cleanNote(value, present) {
  if (!present) return '';
  if (typeof value !== 'string' || value.length > MAX_NOTE || /[\u0000-\u001f\u007f]/.test(value) || containsCredentialText(value)) bad('invalid_note', '备注过长或不完整。');
  return value.trim();
}

function oneUrl(value) {
  const post = canonicalPendingPost(value);
  if (!post) bad('invalid_url', '请粘贴有效的 X 链接。');
  return post;
}

function targetsFromBody(value, {unpin}) {
  if (!plain(value)) bad('invalid_body', unpin ? '请提交要撤下的 X 链接。' : '请提交要钉选的 X 链接。');
  const keys = Object.keys(value);
  const allowed = unpin ? ['url', 'urls', 'status'] : ['url', 'urls', 'note'];
  if (keys.some(key => !allowed.includes(key))) bad('invalid_body', unpin ? '撤下钉选只接受链接。' : '请只提交链接，或链接和备注。');
  if (unpin && Object.hasOwn(value, 'status') && value.status !== 'unpinned') bad('invalid_status', '撤下钉选时 status 只能是 unpinned。');
  if (!unpin && Object.hasOwn(value, 'status')) bad('invalid_body', '钉选时不要带 status。撤下请用 unpinned。');
  const hasUrl = Object.hasOwn(value, 'url');
  const hasUrls = Object.hasOwn(value, 'urls');
  if (hasUrl === hasUrls) bad('invalid_body', '请提交 url 或 urls 其中之一。');
  const note = unpin ? '' : cleanNote(value.note, Object.hasOwn(value, 'note'));
  if (hasUrl) {
    if (unpin && keys.includes('status') && keys.length !== 2) bad('invalid_body', '撤下钉选只接受链接。');
    return {posts:[oneUrl(value.url)], note, batched:false};
  }
  if (!Array.isArray(value.urls) || !value.urls.length || value.urls.length > UNDERRATED_PIN_STORE_MAX || value.urls.some(url => typeof url !== 'string')) {
    bad('invalid_body', `urls 需要 1 到 ${UNDERRATED_PIN_STORE_MAX} 条 X 链接。`);
  }
  const posts = value.urls.map(oneUrl);
  if (new Set(posts.map(post => post.key)).size !== posts.length) bad('duplicate_url', '同一批里有重复链接。');
  return {posts, note, batched:true};
}

async function readBody(request) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)))) bad('invalid_length', '请求长度不正确。');
  if (Number(contentLength) > MAX_BODY) {
    await request.body?.cancel().catch(() => {});
    bad('body_too_large', '提交内容过长。');
  }
  if (!request.body) bad('empty_body', '请提交 X 链接。');
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) throw new UnderratedError(413, 'body_too_large', '提交内容过长。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof UnderratedError) throw error;
    bad('invalid_body', '未收到完整提交，请重试。');
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text;
  try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { bad('invalid_encoding', '提交需使用 UTF-8 文本。'); }
  try { return JSON.parse(text); } catch { bad('invalid_json', '请提交 JSON。'); }
}

export function underratedStatusKey(item) {
  const values = [item?.original_url, item?.canonical_url, ...(Array.isArray(item?.source_links) ? item.source_links.map(link => link?.url) : [])];
  for (const value of values) {
    const key = dotPostKey(value);
    if (key) return key;
  }
  return '';
}

function validPin(value) {
  if (!plain(value) || Object.keys(value).length !== pinFields.length || pinFields.some(field => !Object.hasOwn(value, field))) return false;
  if (value.reviewer !== UNDERRATED_REVIEWER || !/^x:[1-9]\d{7,24}$/.test(value.key) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !timestamp(value.pinned_at)) return false;
  if (typeof value.id !== 'string' || !value.id || value.id.length > 200 || /[\u0000-\u001f\u007f]/.test(value.id)) return false;
  if (typeof value.note !== 'string' || value.note.length > MAX_NOTE || /[\u0000-\u001f\u007f]/.test(value.note) || containsCredentialText(value.note)) return false;
  const post = canonicalPendingPost(value.url);
  return !!post && post.key === value.key && post.url === value.url && post.author_handle === value.author_handle;
}

function parseStored(raw) {
  if (raw == null) return {items:[]};
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_BODY) return {error:true};
  let stored;
  try { stored = JSON.parse(raw); } catch { return {error:true}; }
  if (!plain(stored) || Object.keys(stored).length !== 1 || !Array.isArray(stored.items) || stored.items.length > UNDERRATED_PIN_STORE_MAX) return {error:true};
  if (!stored.items.every(validPin) || new Set(stored.items.map(item => item.key)).size !== stored.items.length) return {error:true};
  return {items:stored.items};
}

function reviewView(record, extra = {}) {
  return {
    id:record.id, key:record.key, url:record.url, author_handle:record.author_handle,
    day:record.day, pinned_at:record.pinned_at, note:record.note, reviewer:record.reviewer, ...extra,
  };
}

function publicPin(record) {
  return {id:record.id, key:record.key, url:record.url, day:record.day, pinned_at:record.pinned_at};
}

async function loadPins(env) {
  let raw;
  try { raw = await env.DOT_INBOX.get(UNDERRATED_PIN_KEY); }
  catch { unavailable(); }
  const parsed = parseStored(raw);
  if (parsed.error) unavailable();
  return parsed.items;
}

async function savePins(env, items) {
  await env.DOT_INBOX.put(UNDERRATED_PIN_KEY, JSON.stringify({items}), {
    metadata:{count:items.length, updated_at:new Date().toISOString()},
  });
}

async function readPublicFeed(env) {
  let raw;
  try { raw = await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY); }
  catch { unavailable(); }
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { unavailable(); }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) unavailable();
  return raw;
}

// Same clock as the homepage: feed generated_at when present, otherwise now.
function homepageYesterday(feed) {
  const today = beijingDateKey(referenceClock({generated_at:feed?.generated_at}).ms);
  return today ? addCalendarDays(today, -1) : '';
}

function resolvePublic(feed, post) {
  const matches = feed.items.filter(item => underratedStatusKey(item) === post.key);
  if (!matches.length) throw new UnderratedError(404, 'not_public', '这条链接还不在当前公开首页。请先用接收码过审，或等它进入公开快照。钉选不会顺便批准。');
  const item = matches[0];
  const time = postTime(item);
  const day = time.ms ? beijingDateKey(time.ms) : '';
  if (!day) bad('undated', '这条公开帖没有可判断日期的时间，不能钉进昨日低估栏。');
  const yesterday = homepageYesterday(feed);
  if (day !== yesterday) {
    const target = yesterday ? `当前「昨日全部」是 ${yesterday}（北京时间）` : '当前整理日无法确定「昨日全部」';
    throw new UnderratedError(409, 'not_yesterday', `这条公开帖的原帖日期是 ${day}（北京时间）。${target}。钉选只接受已经在昨日全部里的帖。`);
  }
  const id = typeof item.id === 'string' && item.id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(item.id) ? item.id : post.id;
  return {id, key:post.key, url:post.url, author_handle:post.author_handle, day};
}

function resultResponse(results, batched, statusName, created) {
  if (!batched) return json(results[0], created ? 201 : 200);
  return json({status:statusName, results}, created ? 201 : 200);
}

async function pinPosts(env, posts, note, batched) {
  const items = await loadPins(env);
  const fresh = posts.filter(post => !items.some(item => item.key === post.key));
  const resolved = new Map();
  if (fresh.length) {
    const publicFeed = await readPublicFeed(env);
    for (const post of fresh) resolved.set(post.key, resolvePublic(publicFeed, post));
  }
  if (items.length + fresh.length > UNDERRATED_PIN_STORE_MAX) {
    return json({error:'pin_full', message:`昨日低估钉选已满（${UNDERRATED_PIN_STORE_MAX} 条）。请先撤下旧钉选。首页这一栏最多仍显示 2 条。`}, 409);
  }
  const pinned_at = new Date().toISOString();
  for (const post of fresh) {
    items.push({...resolved.get(post.key), pinned_at, note, reviewer:UNDERRATED_REVIEWER});
  }
  if (fresh.length) await savePins(env, items);
  const results = posts.map(post => reviewView(items.find(item => item.key === post.key), {status:'pinned', existing:!fresh.includes(post)}));
  return resultResponse(results, batched, 'pinned', fresh.length > 0);
}

async function unpinPosts(env, posts, batched) {
  const items = await loadPins(env);
  const missing = posts.find(post => !items.some(item => item.key === post.key));
  if (missing) return json({error:'not_pinned', message:'这条链接不在昨日低估钉选里。', url:missing.url}, 404);
  const removed = posts.map(post => items.find(item => item.key === post.key));
  const keys = new Set(posts.map(post => post.key));
  await savePins(env, items.filter(item => !keys.has(item.key)));
  const results = removed.map(record => reviewView(record, {status:'unpinned', existing:false}));
  return resultResponse(results, batched, 'unpinned', false);
}

export async function overlayPublicUnderratedPins(raw, env) {
  if (typeof raw !== 'string' || !raw || typeof env?.DOT_INBOX?.get !== 'function') return raw;
  let stored;
  try { stored = await env.DOT_INBOX.get(UNDERRATED_PIN_KEY); }
  catch { return raw; }
  const parsed = parseStored(stored);
  if (parsed.error || !parsed.items.length) return raw;
  let feed;
  try { feed = JSON.parse(raw); } catch { return raw; }
  if (!plain(feed)) return raw;
  try { return JSON.stringify({...feed, underrated_pins:parsed.items.map(publicPin)}); }
  catch { return raw; }
}

export async function handleDotUnderratedRequest(request, env) {
  try {
    const url = new URL(request.url);
    if (!isDotUnderratedRoute(url.pathname)) return null;
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== url.origin) return json({error:'origin_not_allowed', message:'不接受其他网站发来的低估栏请求。'}, 403);
    if (!configured(env)) unavailable();
    if ([...url.searchParams.keys()].length) bad('unsupported_query', '此入口不支持查询参数；接收码只能放在请求头。');
    const review = await authorized(request, env.DOT_REVIEW_TOKEN_HASH);
    const delivery = await authorized(request, env.DOT_DELIVERY_TOKEN_HASH);
    if (!review) {
      const message = delivery
        ? '钉选昨日低估栏需要接收码。投递密钥不能钉选，也不能撤下。'
        : '昨日低估栏连接未通过，请检查接收码。';
      return json({error:'not_authorized', message}, 401, {'WWW-Authenticate':'Bearer realm="dot-underrated"'});
    }
    if (request.method === 'GET') return json({items:(await loadPins(env)).map(record => reviewView(record)), limit:2, store_limit:UNDERRATED_PIN_STORE_MAX});
    if (!['POST', 'DELETE'].includes(request.method)) return json({error:'method_not_allowed', message:'不支持此操作。'}, 405, {Allow:'GET, POST, DELETE'});
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({error:'json_required', message:'请使用 application/json 提交。'}, 415);
    const body = await readBody(request);
    const unpin = request.method === 'DELETE' || (plain(body) && Object.hasOwn(body, 'status'));
    if (request.method === 'DELETE' && plain(body) && Object.hasOwn(body, 'status')) bad('invalid_body', '撤下钉选只接受链接。');
    const {posts, note, batched} = targetsFromBody(body, {unpin});
    if (unpin) return await unpinPosts(env, posts, batched);
    return await pinPosts(env, posts, note, batched);
  } catch (error) {
    if (error instanceof UnderratedError) return json({error:error.code, message:error.message}, error.status, error.status === 401 ? {'WWW-Authenticate':'Bearer realm="dot-underrated"'} : {});
    return json({error:'underrated_unavailable', message:'昨日低估栏暂时不可用，请稍后重试。'}, 503);
  }
}
