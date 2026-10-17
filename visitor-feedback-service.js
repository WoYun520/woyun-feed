// Visitor notes from the public preview header. Stored beside the pending queue
// under a separate key prefix so over-approval never sees them.

export const VISITOR_FEEDBACK_PATH = '/api/visitor-feedback';
export const VISITOR_FEEDBACK_READ_PATH = '/api/visitor-feedback/read';
export const VISITOR_FEEDBACK_ITEM_PREFIX = 'visitor-feedback:item:';
export const VISITOR_FEEDBACK_ID_PREFIX = 'visitor-feedback:id:';
export const VISITOR_FEEDBACK_RATE_PREFIX = 'visitor-feedback:rate:';
export const VISITOR_FEEDBACK_TEXT_MAX = 1000;
export const VISITOR_FEEDBACK_CONTACT_MAX = 80;
export const VISITOR_FEEDBACK_AGENT_MAX = 160;
export const VISITOR_FEEDBACK_LIST_MAX = 50;
export const VISITOR_FEEDBACK_SCAN_MAX = 1000;
export const VISITOR_FEEDBACK_TTL_SECONDS = 90 * 24 * 60 * 60;
export const VISITOR_FEEDBACK_RATE_LIMIT = 5;
export const VISITOR_FEEDBACK_RATE_WINDOW_MS = 60 * 60 * 1000;
export const VISITOR_FEEDBACK_BODY_MAX = 4096;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

class FeedbackError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const bad = (code, message) => { throw new FeedbackError(400, code, message); };
const unavailable = () => { throw new FeedbackError(503, 'feedback_unavailable', '暂时无法收下反馈，请稍后再试。'); };

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...extraHeaders,
    },
  });
}

export function isVisitorFeedbackRoute(pathname) {
  return pathname === VISITOR_FEEDBACK_PATH || pathname === VISITOR_FEEDBACK_READ_PATH;
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function clip(value, max) {
  return Array.from(value).slice(0, max).join('');
}

export function cleanFeedbackText(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  if (!text || Array.from(text).length > VISITOR_FEEDBACK_TEXT_MAX) return '';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return '';
  return text;
}

export function cleanFeedbackContact(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return null;
  const contact = value.trim();
  if (!contact) return '';
  if (Array.from(contact).length > VISITOR_FEEDBACK_CONTACT_MAX || /[\u0000-\u001f\u007f]/.test(contact)) return null;
  return contact;
}

function cleanAgent(value) {
  if (typeof value !== 'string' || !value) return '';
  return clip(value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), VISITOR_FEEDBACK_AGENT_MAX);
}

function timestamp(value) {
  return typeof value === 'string' && value.length <= 32 && STAMP.test(value) && Number.isFinite(Date.parse(value));
}

export function feedbackView(record) {
  if (!plain(record)) return null;
  const text = cleanFeedbackText(record.text);
  const contact = cleanFeedbackContact(record.contact);
  if (!UUID.test(String(record.id || '').toLowerCase()) || !timestamp(record.created_at) || !text || contact == null) return null;
  if (typeof record.read !== 'boolean') return null;
  const userAgent = cleanAgent(record.user_agent);
  return {
    id: String(record.id).toLowerCase(),
    created_at: record.created_at,
    text,
    contact,
    user_agent: userAgent,
    read: record.read,
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function authorized(request, expectedHash) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer ([\x21-\x7e]{16,1024})$/i);
  if (!match || !HASH.test(expectedHash || '')) return false;
  const actual = await sha256(match[1]);
  const expected = expectedHash.toLowerCase();
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== url.origin) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  return site == null || site === 'same-origin' || site === 'none';
}

function inboxReady(env, {review = false} = {}) {
  const inbox = env?.DOT_INBOX;
  if (!inbox || typeof inbox.get !== 'function' || typeof inbox.put !== 'function' || typeof inbox.list !== 'function') return false;
  if (review && !HASH.test(env?.DOT_REVIEW_TOKEN_HASH || '')) return false;
  return true;
}

function clientKey(request) {
  const address = request.headers.get('CF-Connecting-IP') || '';
  return /^[0-9a-f:.]{3,64}$/i.test(address) ? address : 'unknown';
}

async function readJson(request) {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > VISITOR_FEEDBACK_BODY_MAX)) {
    await request.body?.cancel?.().catch(() => {});
    throw new FeedbackError(413, 'body_too_large', '反馈太长，请缩短后再发。');
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    bad('json_required', '请用 JSON 提交反馈。');
  }
  if (!request.body) bad('invalid_body', '请写下想说的话。');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > VISITOR_FEEDBACK_BODY_MAX) throw new FeedbackError(413, 'body_too_large', '反馈太长，请缩短后再发。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof FeedbackError) throw error;
    bad('invalid_body', '没有收到完整反馈，请重试。');
  }
  let raw;
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    raw = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    bad('invalid_body', '请用 UTF-8 文字写下反馈。');
  }
  try {
    return JSON.parse(raw);
  } catch {
    bad('invalid_json', '请提交有效的反馈 JSON。');
  }
}

function remainingTtl(createdAt, now = Date.now()) {
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start)) return VISITOR_FEEDBACK_TTL_SECONDS;
  const remaining = VISITOR_FEEDBACK_TTL_SECONDS - Math.floor((now - start) / 1000);
  if (remaining < 60) return 60;
  return Math.min(remaining, VISITOR_FEEDBACK_TTL_SECONDS);
}

async function enforceRate(env, request) {
  const digest = (await sha256(clientKey(request))).slice(0, 32);
  const key = `${VISITOR_FEEDBACK_RATE_PREFIX}${digest}`;
  const now = Date.now();
  let state = {count: 0, reset: now + VISITOR_FEEDBACK_RATE_WINDOW_MS};
  const raw = await env.DOT_INBOX.get(key);
  if (typeof raw === 'string' && raw.length < 200) {
    try {
      const parsed = JSON.parse(raw);
      if (Number.isSafeInteger(parsed?.count) && Number.isSafeInteger(parsed?.reset) && parsed.reset > now) state = parsed;
    } catch { /* A broken counter starts a fresh window. */ }
  }
  if (state.count >= VISITOR_FEEDBACK_RATE_LIMIT) {
    const retry = Math.max(1, Math.ceil((state.reset - now) / 1000));
    throw new FeedbackError(429, 'rate_limited', '发送太频繁，请稍后再试。', {'Retry-After': String(retry)});
  }
  state = {count: state.count + 1, reset: state.reset};
  const ttl = Math.max(60, Math.ceil((state.reset - now) / 1000));
  await env.DOT_INBOX.put(key, JSON.stringify(state), {expirationTtl: ttl});
}

function itemKey(id, createdAt) {
  const reverse = String(9_007_199_254_740_991 - Date.parse(createdAt)).padStart(16, '0');
  return `${VISITOR_FEEDBACK_ITEM_PREFIX}${reverse}:${id}`;
}

async function accept(request, env) {
  if (!inboxReady(env)) unavailable();
  const payload = await readJson(request);
  if (!plain(payload)) bad('invalid_body', '请写下想说的话。');
  const keys = Object.keys(payload);
  if (!keys.includes('text') || keys.some(key => key !== 'text' && key !== 'contact')) bad('invalid_body', '请只提交反馈正文和可选的联系方式。');
  const text = cleanFeedbackText(payload.text);
  const contact = cleanFeedbackContact(payload.contact);
  if (!text) bad('invalid_text', '请写下想说的话，1000 字以内。');
  if (contact == null) bad('invalid_contact', '联系方式请写在 80 字以内，不要换行。');
  await enforceRate(env, request);
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const record = feedbackView({
    id,
    created_at,
    text,
    contact,
    user_agent: cleanAgent(request.headers.get('User-Agent')),
    read: false,
  });
  if (!record) unavailable();
  const key = itemKey(id, created_at);
  const options = {expirationTtl: VISITOR_FEEDBACK_TTL_SECONDS, metadata: {id, created_at, read: '0'}};
  await env.DOT_INBOX.put(key, JSON.stringify(record), options);
  try {
    await env.DOT_INBOX.put(`${VISITOR_FEEDBACK_ID_PREFIX}${id}`, key, {expirationTtl: VISITOR_FEEDBACK_TTL_SECONDS});
  } catch { /* The note itself is already stored. Mark-read can still find it. */ }
  return json({id: record.id, created_at: record.created_at}, 201);
}

async function findItemKey(env, id) {
  let pointer = null;
  try { pointer = await env.DOT_INBOX.get(`${VISITOR_FEEDBACK_ID_PREFIX}${id}`); } catch { unavailable(); }
  if (typeof pointer === 'string' && pointer.startsWith(VISITOR_FEEDBACK_ITEM_PREFIX) && pointer.endsWith(`:${id}`)) return pointer;
  let page;
  try { page = await env.DOT_INBOX.list({prefix: VISITOR_FEEDBACK_ITEM_PREFIX, limit: VISITOR_FEEDBACK_SCAN_MAX}); }
  catch { unavailable(); }
  const found = page?.keys?.find(entry => typeof entry?.name === 'string' && entry.name.endsWith(`:${id}`));
  return found?.name || '';
}

async function listFeedback(env) {
  let page;
  try {
    page = await env.DOT_INBOX.list({prefix: VISITOR_FEEDBACK_ITEM_PREFIX, limit: VISITOR_FEEDBACK_SCAN_MAX});
  } catch {
    unavailable();
  }
  if (!page || !Array.isArray(page.keys) || page.keys.length > VISITOR_FEEDBACK_SCAN_MAX || typeof page.list_complete !== 'boolean') unavailable();
  const ranked = page.keys
    .filter(entry => typeof entry?.name === 'string' && entry.name.startsWith(VISITOR_FEEDBACK_ITEM_PREFIX))
    .map(entry => ({name: entry.name, created_at: typeof entry.metadata?.created_at === 'string' ? entry.metadata.created_at : ''}))
    .sort((left, right) => (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0));
  const items = [];
  for (const entry of ranked.slice(0, VISITOR_FEEDBACK_LIST_MAX)) {
    let raw;
    try { raw = await env.DOT_INBOX.get(entry.name); } catch { unavailable(); }
    if (typeof raw !== 'string') continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const view = feedbackView(parsed);
    if (!view || !entry.name.endsWith(`:${view.id}`)) continue;
    items.push(view);
  }
  items.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || (left.id < right.id ? -1 : 1));
  return json({items, truncated: page.list_complete === false || ranked.length > VISITOR_FEEDBACK_LIST_MAX});
}

async function markRead(request, env) {
  const payload = await readJson(request);
  if (!plain(payload) || Object.keys(payload).length !== 1 || typeof payload.id !== 'string' || !UUID.test(payload.id.toLowerCase())) {
    bad('invalid_id', '请提交要标为已读的反馈编号。');
  }
  const id = payload.id.toLowerCase();
  const key = await findItemKey(env, id);
  if (!key) throw new FeedbackError(404, 'not_found', '这条反馈不存在或已超过保留期。');
  let raw;
  try { raw = await env.DOT_INBOX.get(key); } catch { unavailable(); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const current = feedbackView(parsed);
  if (!current || current.id !== id) throw new FeedbackError(404, 'not_found', '这条反馈不存在或已超过保留期。');
  const next = {...current, read: true};
  const ttl = remainingTtl(next.created_at);
  try {
    await env.DOT_INBOX.put(key, JSON.stringify(next), {expirationTtl: ttl, metadata: {id, created_at: next.created_at, read: '1'}});
    await env.DOT_INBOX.put(`${VISITOR_FEEDBACK_ID_PREFIX}${id}`, key, {expirationTtl: ttl});
  } catch {
    unavailable();
  }
  return json(next);
}

export async function handleVisitorFeedbackRequest(request, env) {
  try {
    const url = new URL(request.url);
    if (!isVisitorFeedbackRoute(url.pathname)) return null;
    if (!sameOrigin(request, url)) return json({error: 'origin_not_allowed', message: '不接受其他网站发来的反馈。'}, 403);
    if ([...url.searchParams.keys()].length) bad('unsupported_query', '这个入口不接受查询参数。');
    const marking = url.pathname === VISITOR_FEEDBACK_READ_PATH;
    const allowed = marking ? ['POST'] : ['GET', 'POST'];
    if (!allowed.includes(request.method)) return json({error: 'method_not_allowed', message: '不支持此操作。'}, 405, {Allow: allowed.join(', ')});
    const hostRead = request.method === 'GET' || marking;
    if (hostRead) {
      if (!inboxReady(env, {review: true})) return json({error: 'feedback_unavailable', message: '暂时无法读取意见反馈。'}, 503);
      if (!await authorized(request, env.DOT_REVIEW_TOKEN_HASH)) {
        return json({error: 'not_authorized', message: '查看意见反馈需要接收码。'}, 401, {'WWW-Authenticate': 'Bearer realm="visitor-feedback"'});
      }
      return marking ? await markRead(request, env) : await listFeedback(env);
    }
    return await accept(request, env);
  } catch (error) {
    if (error instanceof FeedbackError) return json({error: error.code, message: error.message}, error.status, error.headers);
    return json({error: 'feedback_unavailable', message: '暂时无法收下反馈，请稍后再试。'}, 503);
  }
}
