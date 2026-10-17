import { renderReviewQueue, bindReviewQueueEvents } from './reviewQueueView.js';

export const REVIEW_ADMIN_POLL_MS = 30000;
export const REVIEW_ADMIN_REFRESH_COPY = '打开时拉一次待过审和意见反馈，之后约每 30 秒自动更新，也可以点刷新。页面在后台、正在过审或标为已读时会跳过自动更新。';

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

function formatFeedbackTime(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(ms);
  const pick = type => parts.find(part => part.type === type)?.value || '';
  const month = pick('month');
  const day = pick('day');
  const hour = pick('hour');
  const minute = pick('minute');
  return month && day && hour && minute ? `${month}月${day}日 ${hour}:${minute}` : '';
}

function feedbackItems(items) {
  return (Array.isArray(items) ? items : []).filter(item => item && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.created_at === 'string');
}

function renderFeedbackSection(state) {
  const items = feedbackItems(state.feedback);
  const disabled = state.feedbackBusy || state.loading ? ' disabled' : '';
  const body = state.loading && !items.length
    ? '<p class="visitor-feedback-status" role="status">正在读取意见反馈…</p>'
    : items.length
      ? items.map(item => {
        const when = formatFeedbackTime(item.created_at);
        const contact = typeof item.contact === 'string' ? item.contact.trim() : '';
        const agent = typeof item.user_agent === 'string' ? Array.from(item.user_agent).slice(0, 120).join('') : '';
        const read = item.read === true;
        return `<article class="visitor-feedback-item${read ? ' is-read' : ''}" data-feedback-id="${escapeText(item.id)}">
          <p class="visitor-feedback-time">${escapeText(when || item.created_at)}${read ? ' · 已读' : ''}</p>
          <p class="visitor-feedback-text">${escapeText(item.text)}</p>
          ${contact ? `<p class="visitor-feedback-contact">联系：${escapeText(contact)}</p>` : ''}
          ${agent ? `<p class="visitor-feedback-meta">${escapeText(agent)}</p>` : ''}
          ${read ? '' : `<button type="button" class="btn-quiet" data-feedback-read="${escapeText(item.id)}"${disabled}>标为已读</button>`}
        </article>`;
      }).join('')
      : '<p class="visitor-feedback-status" role="status">现在没有意见反馈。</p>';
  const note = state.feedbackTruncated ? '<p class="visitor-feedback-status">还有更早的反馈没有列在这里。</p>' : '';
  return `<section id="visitor-feedback" class="visitor-feedback" aria-label="意见反馈">
    <header class="visitor-feedback-heading"><h2>意见反馈</h2><p>公开预览顶栏发来的话，单独放在这里，不进待过审队列。</p></header>
    ${state.feedbackMessage ? `<p class="visitor-feedback-status" role="status">${escapeText(state.feedbackMessage)}</p>` : ''}
    ${state.feedbackError ? `<p class="visitor-feedback-error" role="alert">${escapeText(state.feedbackError)}</p>` : ''}
    ${note}${body}
  </section>`;
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
  const state = {configured:true, loading:false, error:'', items:[], busy:false, message:'', feedback:[], feedbackError:'', feedbackBusy:false, feedbackMessage:'', feedbackTruncated:false};
  let refreshing = false;
  let timer = null;

  function paint() {
    if (!root) return;
    const queue = state.configured
      ? `${state.message ? `<p class="review-queue-status" role="status">${escapeText(state.message)}</p>` : ''}${renderReviewQueue({
        connected:true, loading:state.loading, error:state.error, items:state.items, busy:state.busy, mode:'local',
      })}`
      : setupNotice();
    root.innerHTML = `${refreshToolbar(state)}${queue}${state.configured ? renderFeedbackSection(state) : ''}`;
    if (state.configured) {
      bindReviewQueueEvents(root, {onReviewDecision});
      for (const button of root.querySelectorAll?.('[data-feedback-read]') || []) {
        button.addEventListener('click', () => {
          if (button.disabled) return;
          onFeedbackRead(button.getAttribute('data-feedback-read'));
        });
      }
    }
    const button = root.querySelector?.('[data-review-refresh]');
    button?.addEventListener?.('click', () => {
      if (button.disabled || state.busy) return;
      refresh({reason:'manual'});
    });
  }

  async function readEndpoint(url) {
    try {
      const response = await fetchImpl(url, {headers:{Accept:'application/json'}, cache:'no-store'});
      return {response, body:await readJson(response)};
    } catch {
      return null;
    }
  }

  async function refresh({reason = 'manual'} = {}) {
    if (state.busy || state.feedbackBusy || refreshing) return false;
    if (reason === 'poll' && pageHidden(documentRef)) return false;
    refreshing = true;
    state.loading = true;
    state.error = '';
    state.feedbackError = '';
    paint();
    try {
      const [pending, feedback] = await Promise.all([
        readEndpoint('/api/local-review/pending'),
        readEndpoint('/api/local-review/feedback'),
      ]);
      if (!pending) {
        state.error = '暂时无法读取本机过审。';
      } else if (pending.response.status === 503 && pending.body.error === 'review_credential_missing') {
        state.configured = false;
        state.items = [];
        state.feedback = [];
      } else if (!pending.response.ok || !Array.isArray(pending.body.items)) {
        state.configured = true;
        state.items = [];
        state.error = typeof pending.body.message === 'string' ? pending.body.message : '暂时无法读取本机过审。';
      } else {
        state.configured = true;
        state.items = pending.body.items;
      }
      if (state.configured) {
        if (!feedback) {
          state.feedback = [];
          state.feedbackError = '暂时无法读取意见反馈。';
          state.feedbackTruncated = false;
        } else if (!feedback.response.ok || !Array.isArray(feedback.body.items)) {
          state.feedback = [];
          state.feedbackTruncated = false;
          state.feedbackError = typeof feedback.body.message === 'string' ? feedback.body.message : '暂时无法读取意见反馈。';
        } else {
          state.feedback = feedback.body.items;
          state.feedbackTruncated = feedback.body.truncated === true;
        }
      }
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
            ? (typeof body.pin_message === 'string' && body.pin_message ? body.pin_message : '已过审上首页。原帖日期不是当前「昨日全部」，也不是它的前一个自然日，没有钉进昨日低估栏。')
            : '已过审上首页。';
    } catch (error) {
      state.error = error?.message || '过审没有完成。';
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function onFeedbackRead(id) {
    if (state.busy || state.feedbackBusy || refreshing || !id) return;
    state.feedbackBusy = true;
    state.feedbackError = '';
    state.feedbackMessage = '';
    paint();
    try {
      const response = await fetchImpl('/api/local-review/feedback/read', {
        method:'POST',
        headers:{Accept:'application/json', 'Content-Type':'application/json', 'X-Personal-Feed':'1'},
        cache:'no-store',
        body:JSON.stringify({id}),
      });
      const body = await readJson(response);
      if (!response.ok || body?.id !== id || body.read !== true) throw new Error(typeof body.message === 'string' ? body.message : '没有标成已读。');
      state.feedback = feedbackItems(state.feedback).map(item => item.id === id ? {...item, ...body} : item);
      state.feedbackMessage = '已标为已读。';
    } catch (error) {
      state.feedbackError = error?.message || '没有标成已读。';
    } finally {
      state.feedbackBusy = false;
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
