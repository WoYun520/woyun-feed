const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '#';
  } catch {
    return '#';
  }
}

function safeCover(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function shorten(value, maximum) {
  const characters = Array.from(String(value ?? ''));
  return characters.length > maximum ? `${characters.slice(0, maximum).join('')}…` : characters.join('');
}

function quoteText(excerpt) {
  const lines = String(excerpt ?? '').split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length > 1) return lines.slice(0, 2).join(' ');
  return String(excerpt ?? '').replace(/\s+/g, ' ').trim();
}

export function formatArchiveTime(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone:'Asia/Shanghai', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(new Date(ms));
  const read = type => parts.find(part => part.type === type)?.value || '';
  const hour = read('hour').padStart(2, '0');
  const minute = read('minute').padStart(2, '0');
  return `${Number(read('month'))}月${Number(read('day'))}日 ${hour}:${minute}`;
}

function pager(page) {
  const current = Number.isSafeInteger(page?.page) ? page.page : 1;
  const pages = Number.isSafeInteger(page?.pages) ? page.pages : 0;
  const total = Number.isSafeInteger(page?.total) ? page.total : 0;
  const prev = current > 1 ? `<a href="?page=${current - 1}">上一页</a>` : '<span>上一页</span>';
  const next = pages && current < pages ? `<a href="?page=${current + 1}">下一页</a>` : '<span>下一页</span>';
  const label = total
    ? (current > pages ? `这一页没有帖。 <a href="?page=1">回到第一页</a>` : `共 ${total} 条 · 第 ${current} / ${pages} 页`)
    : '还没有可以放进全部精华的帖。';
  return `<nav class="essence-pager" aria-label="分页">${prev}<p>${label}</p>${next}</nav>`;
}

function renderCard(item) {
  const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : '来源未提供标题';
  const excerpt = typeof item?.excerpt === 'string' ? item.excerpt.trim() : '';
  const href = safeUrl(item?.url);
  const cover = safeCover(item?.cover_url);
  const mode = cover ? 'media' : excerpt ? 'quote' : 'plain';
  const quote = quoteText(excerpt);
  const published = formatArchiveTime(item?.published_at);
  const approved = formatArchiveTime(item?.approved_at);
  const dateBits = [
    published ? `<time datetime="${escape(item.published_at)}">${escape(published)}</time>` : '',
    approved && approved !== published ? `<span class="cover-date-kind">过审 ${escape(approved)}</span>` : '',
  ].filter(Boolean);
  const date = `<p class="cover-date">${dateBits.join('') || '时间未提供'}</p>`;
  const quoteBlock = mode !== 'media' && quote ? `<blockquote class="cover-quote"><span class="cover-quote-text">${escape(quote)}</span></blockquote>` : '';
  const excerptLine = mode === 'media' && excerpt ? `<p class="cover-excerpt">${escape(shorten(excerpt, 96))}</p>` : '';
  const figure = cover
    ? `<div class="cover-frame"><figure class="cover-photo${item.cover_kind === 'article_cover' ? ' cover-article' : ''}"><img src="${escape(cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></figure><a class="cover-hit" href="${escape(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(`打开原帖：${title}`)}"></a></div>`
    : '';
  const cues = [
    item?.pool === true ? '<span class="kosx-pool-badge">KOSX</span>' : '',
    item?.author ? `<span class="cover-author">${escape(item.author)}</span>` : '',
    item?.source ? `<span>${escape(item.source)}</span>` : '',
  ].filter(Boolean);
  return `<article class="cover-card shape-card" data-cover="${mode}" data-essence-id="${escape(item?.id || '')}">
    ${date}
    ${quoteBlock}
    ${figure}
    <div class="cover-body"><h3><a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(title)}</a></h3>
      ${excerptLine}
      ${cues.length ? `<p class="cover-cue">${cues.join('')}</p>` : ''}
      <div class="cover-actions"><a class="shape-pill-solid" href="${escape(href)}" target="_blank" rel="noopener noreferrer">打开原帖</a></div>
    </div></article>`;
}

export function renderEssenceArchiveFailure(message) {
  const text = typeof message === 'string' && message.trim() ? message.trim() : '全部精华暂时读不到，请稍后重试。';
  return `<header class="essence-top"><h1>全部精华</h1><a class="essence-back" href="/">回到首页</a></header><p class="home-empty" role="alert">${escape(text)}</p>`;
}

export function renderEssenceArchive(page) {
  const items = Array.isArray(page?.items) ? page.items : [];
  const size = Number.isSafeInteger(page?.page_size) ? page.page_size : 24;
  const grid = items.length ? `<div class="cover-grid">${items.map(renderCard).join('')}</div>` : '<p class="home-empty">这一页没有精华帖。</p>';
  return `<header class="essence-top"><h1 id="essence-archive-title">全部精华</h1><a class="essence-back" href="/">回到首页</a></header><p class="home-rule">留在全部精华里的帖。一页 ${size} 条，按过审时间从新到旧；没有过审时间时，按原帖发布时间排。</p>${grid}${pager(page)}`;
}
