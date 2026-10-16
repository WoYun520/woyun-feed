import { renderReviewQueue, bindReviewQueueEvents } from './reviewQueueView.js';

export const REVIEW_ADMIN_POLL_MS = 30000;
export const REVIEW_ADMIN_REFRESH_COPY = '打开时拉一次待过审，之后约每 30 秒自动更新，也可以点刷新。页面在后台或正在过审时会跳过自动更新。';

const rootNode = typeof document === 'undefined' ? null : document.querySelector?.('#review-admin-root');

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}

function setupNotice() {
  return `<section id="review-queue" class="review-queue" aria-label="本机过审"><header class="review-queue-heading"><h2>还没有本机接收码</h2><p>把接收码写成一行，放进项目里的 .local/dot-review-token，或在启动前设置 DOT_REVIEW_TOKEN，然后重新打开本机服务。这一页不会让你在浏览器里粘贴接收码。</p></header></section>`;
}

function refreshToolbar(state) {
  const disabled = state.busy || state.loading ? ' disabled' : '';
  return `<div class="review-admin-toolbar"><button type="button" class="btn-quiet" data-review-refresh${disabled}>刷新</button><p>${escapeText(REVIEW_ADMIN_REFRESH_COPY)}</p></div>`;
}

function pageHidden(documentRef) {
  return documentRef?.visibilityState === 'hidden' || documentRef?.hidden === true;
}

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

export function createReviewAdmin({
  root,
  fetchImpl = globalThis.fetch,
  documentRef = globalThis.document,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
} = {}) {
  const state = {configured:true, loading:false, error:'', items:[], busy:false, message:''};
  let refreshing = false;
  let timer = null;

  function paint() {
    if (!root) return;
    const queue = state.configured
      ? `${state.message ? `<p class="review-queue-status" role="status">${escapeText(state.message)}</p>` : ''}${renderReviewQueue({
        connected:true, loading:state.loading, error:state.error, items:state.items, busy:state.busy, mode:'local',
      })}`
      : setupNotice();
    root.innerHTML = `${refreshToolbar(state)}${queue}`;
    if (state.configured) bindReviewQueueEvents(root, {onReviewDecision});
    const button = root.querySelector?.('[data-review-refresh]');
    button?.addEventListener?.('click', () => {
      if (button.disabled || state.busy) return;
      refresh({reason:'manual'});
    });
  }

  async function refresh({reason = 'manual'} = {}) {
    if (state.busy || refreshing) return false;
    if (reason === 'poll' && pageHidden(documentRef)) return false;
    refreshing = true;
    state.loading = true;
    state.error = '';
    paint();
    try {
      const response = await fetchImpl('/api/local-review/pending', {headers:{Accept:'application/json'}, cache:'no-store'});
      const body = await readJson(response);
      if (response.status === 503 && body.error === 'review_credential_missing') {
        state.configured = false;
        state.items = [];
      } else if (!response.ok || !Array.isArray(body.items)) {
        state.configured = true;
        state.items = [];
        state.error = typeof body.message === 'string' ? body.message : '暂时无法读取本机过审。';
      } else {
        state.configured = true;
        state.items = body.items;
      }
    } catch {
      state.error = '暂时无法读取本机过审。';
    } finally {
      refreshing = false;
      state.loading = false;
      paint();
    }
    return true;
  }

  async function onReviewDecision({url, status, underrated_candidate = false, review_type} = {}) {
    if (state.busy || refreshing || !url || !['approved', 'rejected'].includes(status)) return;
    state.busy = true;
    state.error = '';
    state.message = '';
    paint();
    try {
      const response = await fetchImpl('/api/local-review/decision', {
        method:'POST',
        headers:{Accept:'application/json', 'Content-Type':'application/json', 'X-Personal-Feed':'1'},
        cache:'no-store',
        body:JSON.stringify({url, status, ...(underrated_candidate ? {underrated_candidate:true} : {}), ...(review_type ? {review_type} : {})}),
      });
      const body = await readJson(response);
      if (!response.ok || typeof body.url !== 'string') throw new Error(typeof body.message === 'string' ? body.message : '过审没有完成。');
      state.items = state.items.map(item => item.url === body.url || item.key === body.key ? {...item, ...body} : item);
      state.message = status !== 'approved'
        ? '已略过，不会出现在公开首页。'
        : body.pinned
          ? '已过审上首页，并钉进昨日低估栏。'
          : underrated_candidate
            ? (typeof body.pin_message === 'string' && body.pin_message ? body.pin_message : '已过审上首页。原帖日期不是昨日，没有钉进昨日低估栏。')
            : '已过审上首页。';
    } catch (error) {
      state.error = error?.message || '过审没有完成。';
    } finally {
      state.busy = false;
      paint();
    }
  }

  function start() {
    if (timer == null) timer = setIntervalImpl(() => { refresh({reason:'poll'}); }, REVIEW_ADMIN_POLL_MS);
    return refresh({reason:'open'});
  }

  function stop() {
    if (timer != null) clearIntervalImpl(timer);
    timer = null;
  }

  return {state, refresh, start, stop, paint};
}

if (rootNode) createReviewAdmin({root:rootNode}).start();
