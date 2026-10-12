// Connection checks and content dates describe different events.
export function feedLoadMessage(state, { deferred = false } = {}) {
  const load = state?.loadStatus;
  if (!load || state.mode === 'demo') return '';
  if (load.phase === 'loading') return load.fromCache
    ? '先看上次缓存的内容，正在读取网站更新。'
    : '正在读取网站内容，当前资料仍可阅读。';
  if (load.phase === 'cached') return '正在显示上次缓存的内容，尚未检查网站更新。';
  if (load.phase === 'error') return (load.errorKind === 'timeout'
    ? '读取等待超时。' : load.errorKind === 'format' ? '本次返回的内容无法使用。' : '暂时无法连接。')
    + (load.fromCache ? '已保留上次缓存，仍可阅读和整理。' : '已保留当前资料，仍可阅读和整理。');
  if (load.phase === 'ready') return deferred
    ? '网站内容已读到，结束操作或关闭编辑后显示。'
    : '已连接网站，当前资料可阅读。';
  return '';
}

function contentTime(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间未提供，见各来源';
}

export function renderFeedLoadStatus(app, state, { deferred = false } = {}) {
  const message = feedLoadMessage(state, { deferred });
  if (!message) return '';
  const load = state.loadStatus, e = value => app.escapeHtml(value);
  const busy = load.phase === 'loading';
  const displayedAt = deferred ? app.renderedGeneratedAt : state.generated_at;
  return `<div class="feed-load-notice ${load.phase === 'error' ? 'feed-load-error' : ''}">
    <div><p>${e(message)}</p><small>当前显示资料的整理时间：<time datetime="${e(displayedAt || '')}">${e(contentTime(displayedAt))}</time>。原站获取时间见各来源。</small>
    ${load.cacheWarning ? '<small>本次内容可读，但浏览器未能暂存，下次打开可能需要重新联网。</small>' : ''}</div>
    ${load.phase === 'error' || load.phase === 'cached' ? `<button type="button" class="btn-secondary-quiet" id="btn-retry-feed" ${busy ? 'disabled' : ''}>重新连接</button>` : ''}
  </div>`;
}

export function renderInitialFeedLoad(app, error = null, { slow = false } = {}) {
  const e = value => app.escapeHtml(value);
  return `<section class="feed-initial-load" aria-labelledby="feed-load-heading" aria-live="polite">
    <h2 id="feed-load-heading">${error ? '暂时无法打开信息流' : '正在打开信息流'}</h2>
    <p>${error ? e(error.message || '请稍后重试。') : slow ? '读取比平时慢。超时后会停止等待，你可以重新连接。' : '正在读取内容，稍后即可浏览。'}</p>
    <p>${error ? '没有可用的内容缓存。已有收藏、摘录和想法仍保留在当前浏览器。' : '成功读取后会暂存内容，下次打开可先浏览。'}</p>
    ${error ? '<button type="button" id="btn-retry-load" class="btn-primary-action">重新连接</button>' : ''}
  </section>`;
}
