export const HOME_BOOST_KEY = 'home-boost:v1';
export const HOME_BOOST_PATH = '/api/home-boost';
export const HOME_BOOST_SEEN_CAP = 4000;

const headers = {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
};
const visitorOk = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const statusOk = value => typeof value === 'string' && /^[1-9]\d{7,24}$/.test(value);

export function isHomeBoostRoute(pathname) {
  return pathname === HOME_BOOST_PATH;
}

export function normalizeBoostRecord(value) {
  const count = Number.isSafeInteger(value?.count) && value.count >= 0 && value.count <= 1e15 ? value.count : 0;
  const seen = Array.isArray(value?.seen)
    ? value.seen.filter(item => typeof item === 'string' && /^[0-9a-f]{32}$/.test(item)).slice(-HOME_BOOST_SEEN_CAP)
    : [];
  return {count, seen};
}

export function applyBoost(record, hash) {
  const current = normalizeBoostRecord(record);
  if (typeof hash !== 'string' || !/^[0-9a-f]{32}$/.test(hash) || current.seen.includes(hash)) return {record:current, counted:false};
  const seen = [...current.seen, hash];
  while (seen.length > HOME_BOOST_SEEN_CAP) seen.shift();
  return {record:{count:current.count + 1, seen}, counted:true};
}

async function seenHash(visitor, status) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${visitor}\n${status}`));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function readRecord(env) {
  if (!env?.PUBLIC_FEED?.get) throw Error('missing');
  const raw = await env.PUBLIC_FEED.get(HOME_BOOST_KEY);
  if (!raw) return {count:0, seen:[]};
  return normalizeBoostRecord(JSON.parse(raw));
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {status, headers:{...headers, ...extra}});
}

export async function handleHomeBoostRequest(request, env) {
  if (!isHomeBoostRoute(new URL(request.url).pathname)) return null;
  if (request.method === 'GET' || request.method === 'HEAD') {
    try {
      const record = await readRecord(env);
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({count:record.count}), {headers});
    } catch {
      return json({error:'unavailable'}, 503);
    }
  }
  if (request.method !== 'POST') return json({error:'method'}, 405, {Allow:'GET, HEAD, POST'});
  let payload;
  try {
    const raw = await request.text();
    if (raw.length > 512) return json({error:'invalid'}, 400);
    payload = JSON.parse(raw);
  } catch {
    return json({error:'invalid'}, 400);
  }
  if (!visitorOk(payload?.visitor) || !statusOk(payload?.status)) return json({error:'invalid'}, 400);
  try {
    const current = await readRecord(env);
    const result = applyBoost(current, await seenHash(payload.visitor, payload.status));
    if (result.counted) await env.PUBLIC_FEED.put(HOME_BOOST_KEY, JSON.stringify(result.record));
    return json({count:result.record.count, counted:result.counted});
  } catch {
    return json({error:'unavailable'}, 503);
  }
}
