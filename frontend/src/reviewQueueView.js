import { pendingBlankFace } from './coverFace.js';
import { REVIEW_TYPES, isReviewSignalCopy, pendingLocalReviewItems, pendingReviewItems, presentReviewItem, sortReviewQueue } from './reviewQueue.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));

function safeStatusUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'x.com' || url.username || url.password) return '';
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{7,24})\/?$/);
    return match ? `https://x.com/${match[1]}/status/${match[2]}` : '';
  } catch { return ''; }
}

function clip(value, max) {
  const chars = Array.from(typeof value === 'string' ? value.trim() : '');
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

function visibleCopy(value) {
  if (typeof value !== 'string' || isReviewSignalCopy(value)) return '';
  return clip(value, 180);
}

function renderItem(item, busy) {
  const presented = presentReviewItem(item);
  const url = safeStatusUrl(item.url);
  const blank = pendingBlankFace(item);
  const disabled = busy ? ' disabled' : '';
  const approveDisabled = busy || blank ? ' disabled' : '';
  const author = typeof item.author_handle === 'string' && item.author_handle ? `@${item.author_handle.replace(/^@/, '')}` : '作者未提供';
  const reviewType = presented.review_type;
  const note = visibleCopy(item.note);
  const excerpt = visibleCopy(item.text);
  const options = REVIEW_TYPES.map(type => `<option value="${escape(type)}"${type === reviewType ? ' selected' : ''}>${escape(type)}</option>`).join('');
  return `<article class="review-queue-item" data-review-url="${escape(url || item.url || '')}" data-review-type="${escape(reviewType)}">
    <p class="review-queue-title">${escape(author)}${note ? ` · ${escape(note)}` : ''}</p>
    ${excerpt && excerpt !== note ? `<p class="review-queue-excerpt">${escape(excerpt)}</p>` : ''}
    ${blank ? `<p class="review-queue-missing">${item.text_fill_failed === true ? '自动补摘录失败。这条还没有正文，过审后不会上公开首页。' : '缺摘录，过审后不会上公开首页'}</p>` : ''}
    <div class="review-queue-actions">
      ${url ? `<a class="dot-original-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">打开原帖 <span aria-hidden="true">↗</span></a>` : '<span>原帖链接不可用</span>'}
      <label class="review-type-edit">类型<select data-review-type-select aria-label="修正类型：${escape(author)}"${disabled}>${options}</select></label>
      <label class="review-underrated-choice"><input type="checkbox" data-review-underrated${disabled}>进低估</label>
      <button type="button" class="btn-primary-action" data-review-decision="approved"${approveDisabled}>过审上首页</button>
      <button type="button" class="btn-quiet" data-review-decision="rejected"${disabled}>略过</button>
    </div>
    <p class="review-queue-hint">原帖是昨日时，过审通过会钉进昨日低估栏。不是昨日就只上首页。</p>
  </article>`;
}

export function renderReviewQueue({connected = false, loading = false, error = '', items = [], busy = false, now = Date.now(), mode = 'public'} = {}) {
  const local = mode === 'local';
  const title = local ? '本机过审' : '公开待过审';
  if (!connected) {
    const disconnected = local
      ? '本机服务会按提交日列出北京时间今天或昨天进队的链接。'
      : '连接接收码后，这里按文章、教程指南、避坑、短帖、产品安利排列待过审链接。';
    return `<section id="review-queue" class="review-queue" aria-label="${title}"><header class="review-queue-heading"><h2>${title}</h2><p>${disconnected}</p></header></section>`;
  }
  const pending = sortReviewQueue((local ? pendingLocalReviewItems : pendingReviewItems)(items, now));
  const disabled = busy || loading;
  const reading = local ? '正在读取本机过审…' : '正在读取公开待过审…';
  const windowCopy = local
    ? '这里按提交日列出北京时间今天或昨天进队的链接，贴进来的旧帖也在里面。'
    : '这里只列出原帖日期是今天或昨天（北京时间）的链接。';
  const body = loading && !pending.length
    ? `<p class="review-queue-status" role="status">${reading}</p>`
    : pending.length
      ? pending.map(item => renderItem(item, disabled)).join('')
      : '<p class="review-queue-status" role="status">现在没有待过审的链接。</p>';
  return `<section id="review-queue" class="review-queue" aria-label="${title}" aria-busy="${loading || busy ? 'true' : 'false'}">
    <header class="review-queue-heading"><h2>${title}</h2><p>先看文章、教程指南和避坑。类型是粗分类，可在过审前改。过审后才会出现在公开首页。${windowCopy}${pending.length ? `待过审 ${pending.length} 条。` : ''}</p></header>
    ${error ? `<p class="review-queue-error" role="alert">${escape(error)}</p>` : ''}
    ${body}
  </section>`;
}

export function bindReviewQueueEvents(root, {onReviewDecision} = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const button of root.querySelectorAll('[data-review-decision]')) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      const article = typeof button.closest === 'function' ? button.closest('[data-review-url]') : null;
      const url = article?.getAttribute?.('data-review-url') || article?.dataset?.reviewUrl || '';
      const status = button.dataset.reviewDecision;
      if (!url || !['approved', 'rejected'].includes(status)) return;
      const selected = article?.querySelector?.('[data-review-type-select]')?.value;
      const review_type = REVIEW_TYPES.includes(selected) ? selected : undefined;
      const underrated_candidate = status === 'approved' && article?.querySelector?.('[data-review-underrated]')?.checked === true;
      onReviewDecision?.({url, status, underrated_candidate, ...(review_type ? {review_type} : {})});
    });
  }
  for (const select of root.querySelectorAll('[data-review-type-select]')) {
    select.addEventListener('change', () => {
      if (!REVIEW_TYPES.includes(select.value)) return;
      const article = typeof select.closest === 'function' ? select.closest('[data-review-url]') : null;
      const tag = article?.querySelector?.('[data-review-type-label]');
      if (tag) tag.textContent = select.value;
    });
  }
}
