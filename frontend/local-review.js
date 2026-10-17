import fs from 'node:fs';
import path from 'node:path';
import { REVIEW_TYPES } from './src/reviewQueue.js';

export const REVIEW_ADMIN_PATH = '/review-admin';
export const LOCAL_REVIEW_PENDING_PATH = '/api/local-review/pending';
export const LOCAL_REVIEW_DECISION_PATH = '/api/local-review/decision';
export const LOCAL_REVIEW_FEEDBACK_PATH = '/api/local-review/feedback';
export const LOCAL_REVIEW_FEEDBACK_READ_PATH = '/api/local-review/feedback/read';
export const DEFAULT_REVIEW_ORIGIN = 'https://woyun-feed-preview.hhzovo66.workers.dev';
const UPSTREAM_PENDING = '/api/dot/pending';
const UPSTREAM_DECISION = '/api/dot/pending/decision';
const UPSTREAM_FEEDBACK = '/api/visitor-feedback';
const UPSTREAM_FEEDBACK_READ = '/api/visitor-feedback/read';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const PAGE_LIMIT = 8;
const ITEM_LIMIT = 300;
const BODY_LIMIT = 1_000_000;

const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const cursorValid = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);

export function normalizeReviewToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  return TOKEN_PATTERN.test(token) ? token : '';
}

export function reviewOrigin(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_REVIEW_ORIGIN;
  let url;
  try { url = new URL(raw); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return '';
  return url.origin;
}

export function loadReviewToken({root, env = process.env, readFileSync = fs.readFileSync} = {}) {
  const fromEnv = normalizeReviewToken(env?.DOT_REVIEW_TOKEN);
  if (fromEnv) return fromEnv;
  if (!root) return '';
  let fileText = '';
  try { fileText = readFileSync(path.join(root, '.local', 'dot-review-token'), 'utf8'); }
  catch (error) { if (error?.code !== 'ENOENT') return ''; }
  return normalizeReviewToken(fileText);
}

export function launchOpenPath(value) {
  return value === REVIEW_ADMIN_PATH ? REVIEW_ADMIN_PATH : '/';
}

function missingCredential() {
  return {
    status:503,
    body:{
      error:'review_credential_missing',
      message:'本机还没有接收码。把接收码写成一行，放进项目里的 .local/dot-review-token，或在启动前设置 DOT_REVIEW_TOKEN，然后重新打开本机服务。这一页不会让你在浏览器里粘贴接收码。',
    },
  };
}

function upstreamMessage(payload, token) {
  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
  if (!message || message.length > 200 || (token && message.includes(token))) return '';
  return message;
}

function scrub(value, token) {
  let raw;
  try { raw = JSON.stringify(value); } catch { return null; }
  if (token && raw.includes(token)) return null;
  return value;
}

async function readUpstream(response, token) {
  const length = response.headers?.get?.('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) return null;
  const raw = await response.text();
  if (raw.length > BODY_LIMIT || (token && raw.includes(token))) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function callUpstream(fetchImpl, origin, token, path, {method = 'GET', body} = {}) {
  const response = await fetchImpl(`${origin}${path}`, {
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      Accept:'application/json',
      ...(body === undefined ? {} : {'Content-Type':'application/json'}),
    },
    redirect:'error',
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  const payload = await readUpstream(response, token);
  return {status:response.status, payload};
}

export function decisionBody(input) {
  if (!plain(input)) return {error:'请提交要过审的链接和结果。'};
  const keys = Object.keys(input);
  if (keys.some(key => !['url', 'status', 'underrated_candidate', 'review_type'].includes(key)) || !keys.includes('url') || !keys.includes('status')) {
    return {error:'请提交要过审的链接和结果。'};
  }
  if (typeof input.url !== 'string' || !input.url || input.url.length > 2000) return {error:'请提交有效的 X 链接。'};
  if (!['approved', 'rejected'].includes(input.status)) return {error:'过审结果只能是通过或略过。'};
  if (Object.hasOwn(input, 'underrated_candidate') && typeof input.underrated_candidate !== 'boolean') return {error:'进低估只能是勾选或不勾选。'};
  if (input.underrated_candidate === true && input.status !== 'approved') return {error:'只有过审通过时才能钉进低估栏。'};
  if (Object.hasOwn(input, 'review_type') && !REVIEW_TYPES.includes(input.review_type)) return {error:'类型不正确。'};
  const body = {url:input.url, status:input.status};
  if (input.underrated_candidate === true) body.underrated_candidate = true;
  if (REVIEW_TYPES.includes(input.review_type)) body.review_type = input.review_type;
  return {body};
}

export async function listPendingForLocalReview({token, origin, fetchImpl}) {
  if (!token) return missingCredential();
  const resolved = reviewOrigin(origin);
  if (!resolved || typeof fetchImpl !== 'function') return {status:502, body:{error:'review_unavailable', message:'暂时无法读取本机过审。'}};
  const items = [];
  const seen = new Set();
  const cursors = new Set();
  let cursor = '';
  try {
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const path = UPSTREAM_PENDING + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');
      const result = await callUpstream(fetchImpl, resolved, token, path);
      if (result.status === 401 || result.status === 403) {
        return {status:401, body:{error:'review_rejected', message:'本机接收码没有通过。请核对 .local/dot-review-token 或 DOT_REVIEW_TOKEN，然后重新打开本机服务。'}};
      }
      const list = result.payload;
      if (result.status !== 200 || !plain(list) || !Array.isArray(list.items) || list.items.length > 50 || !(list.next_cursor === null || cursorValid(list.next_cursor))) {
        return {status:502, body:{error:'review_unavailable', message:upstreamMessage(list, token) || '暂时无法读取本机过审。'}};
      }
      for (const item of list.items) {
        if (!plain(item) || typeof item.id !== 'string' || typeof item.url !== 'string' || seen.has(item.id)) {
          return {status:502, body:{error:'review_unavailable', message:'暂时无法读取本机过审。'}};
        }
        const safe = scrub(item, token);
        if (!safe) return {status:502, body:{error:'review_unavailable', message:'暂时无法读取本机过审。'}};
        seen.add(item.id);
        items.push(safe);
        if (items.length > ITEM_LIMIT) return {status:502, body:{error:'review_unavailable', message:'待过审太多，请先处理一部分。'}};
      }
      if (list.next_cursor === null) return {status:200, body:{items}};
      if (cursors.has(list.next_cursor)) return {status:502, body:{error:'review_unavailable', message:'暂时无法读取本机过审。'}};
      cursors.add(list.next_cursor);
      cursor = list.next_cursor;
    }
    return {status:200, body:{items}};
  } catch {
    return {status:502, body:{error:'review_unavailable', message:'暂时无法读取本机过审。'}};
  }
}

const FEEDBACK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEEDBACK_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function feedbackUnavailable(message = '暂时无法读取意见反馈。') {
  return {status:502, body:{error:'feedback_unavailable', message}};
}

function cleanFeedbackItem(item, token) {
  if (!plain(item)) return null;
  const id = typeof item.id === 'string' ? item.id.toLowerCase() : '';
  const text = typeof item.text === 'string' ? item.text : '';
  const contact = item.contact == null ? '' : item.contact;
  const userAgent = item.user_agent == null ? '' : item.user_agent;
  if (!FEEDBACK_UUID.test(id) || !FEEDBACK_STAMP.test(item.created_at) || !Number.isFinite(Date.parse(item.created_at))) return null;
  if (!text.trim() || Array.from(text).length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  if (typeof contact !== 'string' || Array.from(contact).length > 80 || /[\u0000-\u001f\u007f]/.test(contact)) return null;
  if (typeof userAgent !== 'string' || Array.from(userAgent).length > 160 || /[\u0000-\u001f\u007f]/.test(userAgent)) return null;
  if (typeof item.read !== 'boolean') return null;
  const safe = scrub({id, created_at:item.created_at, text, contact, user_agent:userAgent, read:item.read}, token);
  return safe;
}

export async function listFeedbackForLocalReview({token, origin, fetchImpl}) {
  if (!token) return missingCredential();
  const resolved = reviewOrigin(origin);
  if (!resolved || typeof fetchImpl !== 'function') return feedbackUnavailable();
  try {
    const result = await callUpstream(fetchImpl, resolved, token, UPSTREAM_FEEDBACK);
    if (result.status === 401 || result.status === 403) {
      return {status:401, body:{error:'review_rejected', message:'本机接收码没有通过。请核对 .local/dot-review-token 或 DOT_REVIEW_TOKEN，然后重新打开本机服务。'}};
    }
    const list = result.payload;
    if (result.status !== 200 || !plain(list) || !Array.isArray(list.items) || list.items.length > 50 || (list.truncated != null && typeof list.truncated !== 'boolean')) {
      return feedbackUnavailable(upstreamMessage(list, token) || '暂时无法读取意见反馈。');
    }
    const items = [];
    for (const item of list.items) {
      const safe = cleanFeedbackItem(item, token);
      if (!safe) return feedbackUnavailable();
      items.push(safe);
    }
    return {status:200, body:{items, truncated:list.truncated === true}};
  } catch {
    return feedbackUnavailable();
  }
}

export function feedbackReadBody(input) {
  if (!plain(input) || Object.keys(input).length !== 1 || typeof input.id !== 'string' || !FEEDBACK_UUID.test(input.id)) {
    return {error:'请提交要标为已读的反馈。'};
  }
  return {body:{id:input.id.toLowerCase()}};
}

export async function markFeedbackReadForLocalReview({token, origin, fetchImpl, input}) {
  if (!token) return missingCredential();
  const prepared = feedbackReadBody(input);
  if (prepared.error) return {status:400, body:{error:'invalid_body', message:prepared.error}};
  const resolved = reviewOrigin(origin);
  if (!resolved || typeof fetchImpl !== 'function') return {status:502, body:{error:'feedback_unavailable', message:'没有标成已读。'}};
  try {
    const result = await callUpstream(fetchImpl, resolved, token, UPSTREAM_FEEDBACK_READ, {method:'POST', body:prepared.body});
    if (result.status === 401 || result.status === 403) {
      return {status:401, body:{error:'review_rejected', message:'本机接收码没有通过。请核对 .local/dot-review-token 或 DOT_REVIEW_TOKEN，然后重新打开本机服务。'}};
    }
    const safe = cleanFeedbackItem(result.payload, token);
    if (!safe || safe.read !== true || safe.id !== prepared.body.id) {
      return {status:result.status >= 400 && result.status < 500 ? result.status : 502, body:{error:'feedback_unavailable', message:upstreamMessage(result.payload, token) || '没有标成已读。'}};
    }
    if (result.status !== 200) {
      return {status:result.status, body:{error:typeof result.payload?.error === 'string' ? result.payload.error : 'feedback_unavailable', message:upstreamMessage(result.payload, token) || '没有标成已读。'}};
    }
    return {status:200, body:safe};
  } catch {
    return {status:502, body:{error:'feedback_unavailable', message:'没有标成已读。'}};
  }
}

export async function decidePendingForLocalReview({token, origin, fetchImpl, input}) {
  if (!token) return missingCredential();
  const prepared = decisionBody(input);
  if (prepared.error) return {status:400, body:{error:'invalid_body', message:prepared.error}};
  const resolved = reviewOrigin(origin);
  if (!resolved || typeof fetchImpl !== 'function') return {status:502, body:{error:'review_unavailable', message:'过审没有完成。'}};
  try {
    const result = await callUpstream(fetchImpl, resolved, token, UPSTREAM_DECISION, {method:'POST', body:prepared.body});
    if (result.status === 401 || result.status === 403) {
      return {status:401, body:{error:'review_rejected', message:'本机接收码没有通过。请核对 .local/dot-review-token 或 DOT_REVIEW_TOKEN，然后重新打开本机服务。'}};
    }
    const payload = scrub(result.payload, token);
    if (!payload || !plain(payload) || typeof payload.url !== 'string' || !['approved', 'rejected'].includes(payload.status)) {
      return {status:result.status >= 400 && result.status < 500 ? result.status : 502, body:{error:'review_unavailable', message:upstreamMessage(result.payload, token) || '过审没有完成。'}};
    }
    if (result.status !== 200) {
      return {status:result.status, body:{error:typeof payload.error === 'string' ? payload.error : 'review_unavailable', message:upstreamMessage(payload, token) || '过审没有完成。'}};
    }
    return {status:200, body:payload};
  } catch {
    return {status:502, body:{error:'review_unavailable', message:'过审没有完成。'}};
  }
}
