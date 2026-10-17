// Live 万粉计划 membership. Intake reports pool:true and does not publish.
// Handles only. latest_followers is never written to KV or the public feed.
import { KOSX_HANDLE_PATTERN, KOSX_POOL_SOURCE, handlesFromRoster } from './kosx-pool-roster.js';
import { KOSX_POOL_HANDLES } from './kosx-pool.js';

export const KOSX_POOL_CACHE_KEY = 'kosx_pool_handles';
export const KOSX_POOL_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_ROSTER_BYTES = 1024 * 1024;
const MAX_HANDLES = 5000;

export function poolCacheFresh(fetchedAt, now = Date.now()) {
  const then = Date.parse(fetchedAt);
  if (!Number.isFinite(then)) return false;
  const age = now - then;
  return age >= 0 && age < KOSX_POOL_MAX_AGE_MS;
}

export function parsePoolCache(raw) {
  if (typeof raw !== 'string' || !raw || raw.includes('latest_followers')) return null;
  let body;
  try { body = JSON.parse(raw); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const extra = Object.keys(body).filter(key => key !== 'handles' && key !== 'fetched_at');
  if (extra.length) return null;
  if (!Array.isArray(body.handles) || !body.handles.length || body.handles.length > MAX_HANDLES) return null;
  if (typeof body.fetched_at !== 'string' || !Number.isFinite(Date.parse(body.fetched_at))) return null;
  const handles = [];
  for (const handle of body.handles) {
    if (typeof handle !== 'string' || handle !== handle.toLowerCase() || !KOSX_HANDLE_PATTERN.test(handle)) return null;
    handles.push(handle);
  }
  if (new Set(handles).size !== handles.length) return null;
  return {handles, fetched_at:body.fetched_at};
}

export function serializePoolCache(handles, fetchedAt) {
  if (!Array.isArray(handles) || !handles.length) throw Error('pool cache needs handles');
  const raw = JSON.stringify({handles, fetched_at:fetchedAt});
  if (raw.includes('latest_followers') || !parsePoolCache(raw)) throw Error('pool cache must not store follower counts');
  return raw;
}

function poolKv(env) {
  const kv = env?.DOT_INBOX;
  if (typeof kv?.get === 'function' && typeof kv?.put === 'function') return kv;
  return null;
}

function nowMs(now) {
  const value = typeof now === 'function' ? now() : now;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return Date.parse(value);
  return Date.now();
}

function resolveFetch(env, options) {
  const fetchImpl = options.fetchImpl || env?.kosxPoolFetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw Error('no roster fetch');
  return fetchImpl;
}

async function readBounded(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw Error('oversize');
  }
  if (typeof response.body?.getReader !== 'function') {
    const text = typeof response.text === 'function' ? await response.text() : '';
    if (text.length > maxBytes) throw Error('oversize');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw Error('oversize');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchRosterHandles(fetchImpl) {
  const init = {headers:{accept:'application/json'}};
  if (fetchImpl === globalThis.fetch && typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(8000);
  const response = await fetchImpl(KOSX_POOL_SOURCE, init);
  if (!response?.ok) {
    await response?.body?.cancel?.().catch(() => {});
    throw Error('roster status');
  }
  const text = await readBounded(response, MAX_ROSTER_BYTES);
  return handlesFromRoster(JSON.parse(text));
}

async function readCache(kv) {
  try {
    const raw = await kv.get(KOSX_POOL_CACHE_KEY);
    return parsePoolCache(raw);
  } catch {
    return null;
  }
}

function committedSet() {
  return new Set(KOSX_POOL_HANDLES);
}

// force: cron always refetches. Otherwise a cache younger than one hour is reused.
// Fetch failure keeps the last valid cache. No cache falls back to kosx-pool.js.
// This function does not throw.
export async function loadKosxPoolHandles(env, options = {}) {
  const now = nowMs(options.now);
  const kv = poolKv(env);
  if (!kv) return committedSet();
  const cached = await readCache(kv);
  if (cached && !options.force && poolCacheFresh(cached.fetched_at, now)) return new Set(cached.handles);
  try {
    const handles = await fetchRosterHandles(resolveFetch(env, options));
    const fetchedAt = new Date(now).toISOString();
    try { await kv.put(KOSX_POOL_CACHE_KEY, serializePoolCache(handles, fetchedAt)); }
    catch { console.warn(JSON.stringify({event:'kosx-pool-cache-write-failed'})); }
    console.log(JSON.stringify({event:'kosx-pool-refreshed', handles:handles.length, fetched_at:fetchedAt}));
    return new Set(handles);
  } catch {
    console.warn(JSON.stringify({event:'kosx-pool-refresh-failed'}));
    if (cached) return new Set(cached.handles);
    return committedSet();
  }
}

export async function refreshKosxPoolCache(env, options = {}) {
  return loadKosxPoolHandles(env, {...options, force:true});
}
