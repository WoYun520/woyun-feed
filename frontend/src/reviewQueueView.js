import { REVIEW_TYPES, formatReviewSignals, sortReviewQueue } from './reviewQueue.js';

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

function renderItem(item, busy) {
  const signals = formatReviewSignals(item);
  const url = safeStatusUrl(item.url);
  const disabled = busy ? ' disabled' : '';
  const author = typeof item.author_handle === 'string' && item.author_handle ? `@${item.author_handle.replace(/^@/, '')}` : '作者未提供';
  const note = clip(item.note, 180);
  const excerpt = clip(item.text, 180);
  const options = REVIEW_TYPES.map(type => `<option value="${escape(type)}"${type === signals.review_type ? ' selected' : ''}>${escape(type)}</option>`).join('');
  return `<article class="review-queue-item" data-review-url="${escape(url || item.url || '')}" data-review-type="${escape(signals.review_type)}">
    <div class="review-queue-signals">
      <span class="review-type-tag" data-review-type-label>${escape(signals.review_type)}</span>
      <span class="review-queue-heat">${escape(signals.heat)}</span>
      <span class="review-queue-article">${escape(signals.article)}</span>
      ${signals.skip_cue ? '<span class="review-skip-cue">可后看</span>' : ''}
    </div>
    <p class="review-queue-title">${escape(author)}${note ? ` · ${escape(note)}` : ''}</p>
    ${excerpt && excerpt !== note ? `<p class="review-queue-excerpt">${escape(excerpt)}</p>` : ''}
    <div class="review-queue-actions">
      ${url ? `<a class="dot-original-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">打开原帖 <span aria-hidden="true">↗</span></a>` : '<span>原帖链接不可用</span>'}
      <label class="review-type-edit">类型<select data-review-type-select aria-label="修正类型：${escape(author)}"${disabled}>${options}</select></label>
      <label class="review-underrated-choice"><input type="checkbox" data-review-underrated${disabled}>进低估栏候选</label>
      <button type="button" class="btn-primary-action" data-review-decision="approved"${disabled}>过审上首页</button>
      <button type="button" class="btn-quiet" data-review-decision="rejected"${disabled}>略过</button>
    </div>
    <p class="review-queue-hint">勾选只记在这条过审记录上，不会钉进昨日低估栏。</p>
  </article>`;
}

export function renderReviewQueue({connected = false, loading = false, error = '', items = [], busy = false} = {}) {
  if (!connected) {
    return `<section id="review-queue" class="review-queue" aria-label="公开待过审"><header class="review-queue-heading"><h2>公开待过审</h2><p>连接接收码后，这里按文章、教程指南、避坑、短帖、产品安利排列待过审链接，并显示收藏、点赞和是否有 X Article 卡。</p></header></section>`;
  }
  const pending = sortReviewQueue((Array.isArray(items) ? items : []).filter(item => item && item.status === 'pending'));
  const disabled = busy || loading;
  const body = loading && !pending.length
    ? '<p class="review-queue-status" role="status">正在读取公开待过审…</p>'
    : pending.length
      ? pending.map(item => renderItem(item, disabled)).join('')
      : '<p class="review-queue-status" role="status">现在没有待过审的链接。</p>';
  return `<section id="review-queue" class="review-queue" aria-label="公开待过审" aria-busy="${loading || busy ? 'true' : 'false'}">
    <header class="review-queue-heading"><h2>公开待过审</h2><p>先看文章、教程指南和避坑。类型是粗分类，可在过审前改。过审后才会出现在公开首页。${pending.length ? `待过审 ${pending.length} 条。` : ''}</p></header>
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
