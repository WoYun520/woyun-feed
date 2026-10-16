import fs from 'node:fs';
import path from 'node:path';
import { REVIEW_TYPES } from './src/reviewQueue.js';

export const REVIEW_ADMIN_PATH = '/review-admin';
export const LOCAL_REVIEW_PENDING_PATH = '/api/local-review/pending';
export const LOCAL_REVIEW_DECISION_PATH = '/api/local-review/decision';
export const DEFAULT_REVIEW_ORIGIN = 'https://woyun-feed-preview.hhzovo66.workers.dev';
const UPSTREAM_PENDING = '/api/dot/pending';
const UPSTREAM_DECISION = '/api/dot/pending/decision';
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
