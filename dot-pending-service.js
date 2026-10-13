import { dotPostKey } from './frontend/src/dotCandidates.js';
import { containsCredentialText } from './frontend/src/contentPrivacy.js';
import { dotInboxHash } from './dot-inbox-service.js';

export const DOT_PENDING_PATH = '/api/dot/pending';
export const DOT_PENDING_PREFIX = 'pending:';
export const DOT_PENDING_MAX = 300;
export const DOT_PENDING_BATCH_MAX = 20;
const MAX_NOTE = 400;
const MAX_BODY = 64 * 1024;
const recordFields = ['id', 'key', 'url', 'author_handle', 'note', 'status', 'submitted_at', 'source'];
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
  return pathname === DOT_PENDING_PATH;
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

function onePost(value, {allowNote}) {
  if (!plain(value)) bad('invalid_body', '请提交 X 精华帖链接。');
  const keys = Object.keys(value);
  const allowed = allowNote ? ['url', 'author_handle', 'note'] : ['url'];
  if (keys.some(key => !allowed.includes(key)) || !keys.includes('url')) {
    if (!allowNote) unauthorized();
    bad('invalid_body', '请提交 X 精华帖链接。');
  }
  const post = canonicalPendingPost(value.url);
  if (!post) bad('invalid_url', '请粘贴有效的 X 链接。');
  if (Object.hasOwn(value, 'author_handle')) {
    if (typeof value.author_handle !== 'string' || value.author_handle.toLowerCase() !== post.author_handle.toLowerCase()) bad('invalid_author', '作者账号与原帖链接不一致。');
  }
  return {...post, note:cleanNote(value.note, Object.hasOwn(value, 'note'))};
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

function validRecord(value, storageKey) {
  if (!plain(value) || Object.keys(value).length !== recordFields.length || recordFields.some(field => !Object.hasOwn(value, field))) return false;
  if (value.status !== 'pending' || !['homepage', 'delivery'].includes(value.source)) return false;
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

function publicView(record, {includeNote}) {
  return {
    id:record.id, key:record.key, url:record.url, author_handle:record.author_handle, status:record.status,
    submitted_at:record.submitted_at, ...(includeNote ? {note:record.note, source:record.source} : {}),
  };
}

function queryCursor(url, isRead) {
  const entries = [...url.searchParams.entries()];
  if (!entries.length) return null;
  if (!isRead || entries.length !== 1 || entries[0][0] !== 'cursor') bad('unsupported_query', '此入口不支持这些查询参数；密钥只能放在请求头。');
  const value = entries[0][1];
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) bad('invalid_cursor', '分页位置不正确，请从第一条重新读取。');
  return value;
}

export async function handleDotPendingRequest(request, env) {
  try {
    const url = new URL(request.url);
    if (!isDotPendingRoute(url.pathname)) return null;
    const origin = request.headers.get('Origin');
    if (origin !== null && origin !== url.origin) return json({error:'origin_not_allowed', message:'不接受其他网站发来的待筛选请求。'}, 403);
    if (!configured(env)) unavailable();
    if (!['GET', 'POST'].includes(request.method)) return json({error:'method_not_allowed', message:'不支持此操作。'}, 405, {Allow:'GET, POST'});
    const isRead = request.method === 'GET';
    const delivery = await authorized(request, env.DOT_DELIVERY_TOKEN_HASH);
    const review = await authorized(request, env.DOT_REVIEW_TOKEN_HASH);
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
      const record = {...post, status:'pending', submitted_at, source};
      await env.DOT_INBOX.put(`${DOT_PENDING_PREFIX}${post.key}`, JSON.stringify(record), {
        metadata:{id:record.id, key:record.key, status:'pending', submitted_at},
      });
      existing.set(post.key, record);
    }
    const results = posts.map(post => ({...publicView(existing.get(post.key), {includeNote:delivery}), existing:!created.includes(post)}));
    if (!batched) return json(results[0], created.length ? 201 : 200);
    return json({status:'pending', results}, created.length ? 201 : 200);
  } catch (error) {
    if (error instanceof PendingError) return json({error:error.code, message:error.message}, error.status, error.status === 401 ? {'WWW-Authenticate':'Bearer realm="dot-pending"'} : {});
    return json({error:'pending_unavailable', message:'待筛选暂时不可用，请稍后重试。'}, 503);
  }
}
