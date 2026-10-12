// Only transient transport failures get one extra attempt. Parsing, identity,
// privacy and storage checks remain outside this policy and are never retried.
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const timeout = () => new DOMException('Public source request timed out.', 'TimeoutError');
const stopped = signal => signal?.reason || new DOMException('Public source request stopped.', 'AbortError');
function cancelBody(response) {try {response?.body?.cancel().catch(() => {});} catch {}}

export function createRetryBudget(remaining) {
  return {remaining: Number.isSafeInteger(remaining) ? Math.max(0, remaining) : 0};
}

// Every configured source gets its normal first read. HN's detail count can
// shrink within its top-ten scope so one retry and one platform request remain
// available. KV uses the separate internal-service limit.
export function publicRequestPlan(definitions) {
  const active=definitions.filter(source=>source.enabled!==false);
  const hn=active.filter(source=>source.format==='hackernews-api');
  const withoutDetails=1+active.reduce((total,source)=>total+(source.sopilot_category ? 2 : 1),0);
  const hnMaxItems=hn.length ? Math.min(10,Math.floor((48-withoutDetails)/hn.length)) : 10;
  if (hnMaxItems<1 || withoutDetails+hn.length*hnMaxItems>48) throw Error('public source request budget exceeded');
  const normalRequests=withoutDetails+hn.length*hnMaxItems;
  return {hnMaxItems,normalRequests,retryRequests:Math.min(2,49-normalRequests)};
}

export function publicRetryBudget(definitions,plan=publicRequestPlan(definitions)) {
  return createRetryBudget(plan.retryRequests);
}

function transientError(error) {
  return error?.name === 'TimeoutError'
    || NETWORK_CODES.has(error?.code) || NETWORK_CODES.has(error?.cause?.code)
    || error?.name === 'TypeError' && /(?:fetch failed|network|failed to fetch|load failed)/i.test(error.message || '')
    || error?.name === 'Error' && /^(?:offline|network error|network unavailable|fetch failed)$/i.test(error.message || '');
}

function retryDelay(response, fallback) {
  const value = response?.headers?.get('retry-after');
  if (value == null || value === '') return fallback;
  const seconds = Number(value), date = Date.parse(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
    : Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallback;
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(stopped(signal));
  return new Promise((resolve, reject) => {
    const abort = () => {clearTimeout(timer);signal?.removeEventListener('abort', abort);reject(stopped(signal));};
    const timer = setTimeout(() => {signal?.removeEventListener('abort', abort);resolve();}, ms);
    signal?.addEventListener('abort', abort, {once: true});
  });
}

// Buffer only the bounded transport body, before any parser runs. This catches
// header and body stalls alike. Preserve response identity for redirect checks.
async function bufferResponse(response, signal) {
  if (!response.ok || !response.body?.getReader) return response;
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {cancelBody(response);throw Error('oversize');}
  const reader = response.body.getReader(), chunks = [];let length = 0;
  const abort = () => {try {reader.cancel().catch(() => {});} catch {}};
  signal.addEventListener('abort', abort, {once: true});
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (signal.aborted) throw stopped(signal);
      if (done) break;
      length += value.byteLength;if (length > MAX_BODY_BYTES) throw Error('oversize');chunks.push(value);
    }
    const bytes = new Uint8Array(length);let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset);offset += chunk.byteLength;}
    const buffered = new Response(bytes, {status: response.status, statusText: response.statusText, headers: response.headers});
    for (const key of ['url', 'redirected', 'type']) Object.defineProperty(buffered, key, {value: response[key]});
    return buffered;
  } catch (error) {abort();throw error;}
  finally {signal.removeEventListener('abort', abort);reader.releaseLock();}
}

async function attempt(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController(), signal = options.signal;
  const abort = () => controller.abort(stopped(signal));
  if (signal?.aborted) throw stopped(signal);
  signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(timeout()), timeoutMs);
  let stop, response;
  const ended = new Promise((_, reject) => {
    stop = () => reject(stopped(controller.signal));
    controller.signal.addEventListener('abort', stop, {once: true});
  });
  const operation = Promise.resolve().then(async () => {
    response = await fetchImpl(url, {...options, signal: controller.signal});
    if (controller.signal.aborted) {cancelBody(response);throw stopped(controller.signal);}
    return bufferResponse(response, controller.signal);
  });
  try {return await Promise.race([operation, ended]);}
  catch (error) {cancelBody(response);throw error;}
  finally {clearTimeout(timer);signal?.removeEventListener('abort', abort);controller.signal.removeEventListener('abort', stop);}
}

export function createSourceFetch(fetchImpl, {deadline, attemptTimeoutMs = 5000, retryDelayMs = 200, retryBudget} = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isFinite(deadline)
    || !Number.isFinite(attemptTimeoutMs) || attemptTimeoutMs <= 0
    || !Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 750) throw Error('invalid source retry policy');
  return async (url, options = {}) => {
    let response, failure;
    for (let index = 0;index < 2;index++) {
      if (options.signal?.aborted) throw stopped(options.signal);
      const remaining = deadline - Date.now();if (remaining <= 0) throw timeout();
      try {
        response = await attempt(fetchImpl, url, options, Math.max(1, Math.min(attemptTimeoutMs, remaining)));
        failure = null;
        if (!(response.status === 429 || response.status >= 500 && response.status <= 599)) {
          if (!response.ok) cancelBody(response);return response;
        }
      } catch (error) {failure = error;if (!transientError(error)) throw error;}
      const delay = retryDelay(response, retryDelayMs);
      if (index === 1 || options.signal?.aborted || delay > 750 || deadline - Date.now() <= delay
        || retryBudget && retryBudget.remaining <= 0) {
        if (failure) throw failure;cancelBody(response);return response;
      }
      if (retryBudget) retryBudget.remaining--;
      cancelBody(response);response = null;
      await wait(delay, options.signal);
    }
  };
}
