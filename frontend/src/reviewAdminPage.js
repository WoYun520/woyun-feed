import { renderReviewQueue, bindReviewQueueEvents } from './reviewQueueView.js';

const root = document.querySelector('#review-admin-root');
const state = {configured:true, loading:true, error:'', items:[], busy:false, message:''};

function setupNotice() {
  return `<section id="review-queue" class="review-queue" aria-label="本机过审"><header class="review-queue-heading"><h2>还没有本机接收码</h2><p>把接收码写成一行，放进项目里的 .local/dot-review-token，或在启动前设置 DOT_REVIEW_TOKEN，然后重新打开本机服务。这一页不会让你在浏览器里粘贴接收码。</p></header></section>`;
}

function paint() {
  if (!root) return;
  if (!state.configured) {
    root.innerHTML = setupNotice();
    return;
  }
  root.innerHTML = `${state.message ? `<p class="review-queue-status" role="status">${escapeText(state.message)}</p>` : ''}${renderReviewQueue({
    connected:true, loading:state.loading, error:state.error, items:state.items, busy:state.busy, mode:'local',
  })}`;
  bindReviewQueueEvents(root, {onReviewDecision});
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

async function refresh() {
  state.loading = true;
  state.error = '';
  paint();
  try {
    const response = await fetch('/api/local-review/pending', {headers:{Accept:'application/json'}, cache:'no-store'});
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
    state.loading = false;
    paint();
  }
}

async function onReviewDecision({url, status, underrated_candidate = false, review_type} = {}) {
  if (state.busy || !url || !['approved', 'rejected'].includes(status)) return;
  state.busy = true;
  state.error = '';
  state.message = '';
  paint();
  try {
    const response = await fetch('/api/local-review/decision', {
      method:'POST',
      headers:{Accept:'application/json', 'Content-Type':'application/json', 'X-Personal-Feed':'1'},
      cache:'no-store',
      body:JSON.stringify({url, status, ...(underrated_candidate ? {underrated_candidate:true} : {}), ...(review_type ? {review_type} : {})}),
    });
    const body = await readJson(response);
    if (!response.ok || typeof body.url !== 'string') throw new Error(typeof body.message === 'string' ? body.message : '过审没有完成。');
    state.items = state.items.map(item => item.url === body.url || item.key === body.key ? {...item, ...body} : item);
    state.message = status === 'approved'
      ? (underrated_candidate ? '已过审上首页，并记为低估栏候选。尚未钉进昨日低估栏。' : '已过审上首页。')
      : '已略过，不会出现在公开首页。';
  } catch (error) {
    state.error = error?.message || '过审没有完成。';
  } finally {
    state.busy = false;
    paint();
  }
}

refresh();
