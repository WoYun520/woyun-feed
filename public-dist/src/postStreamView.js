import { selectPostStream, POST_STREAM_PAGE_SIZE, postStreamLimit, postStatusId } from './postStream.js';
import { postAuthorLabel } from './topicWorkspace.js';
import { normalizePostImage } from './postMedia.js';
import { renderPostMedia } from './postMediaView.js';

function knownTime(app, value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '';
  const e = value => app.escapeHtml(value);
  return `<span>${e(label)} <time datetime="${e(value)}">${e(app.formatTime ? app.formatTime(value) : value)}</time></span>`;
}

function collectionAction(state, post) {
  const savedIds = state.savedItemIds || new Set(), archivedIds = state.archivedItemIds || new Set();
  const matches = item => item && (post.itemIds.includes(item.id)
    || item.alias_ids?.some(id => post.itemIds.includes(id))
    || postStatusId(item.original_url) === post.statusId || postStatusId(item.canonical_url) === post.statusId);
  // Prefer the actual preserved collection record to a current feed alias.
  // Its ID also lets rememberDisplayedItems route the old saved snapshot.
  const savedRecords = (state.savedItems || []).filter(matches);
  const archivedRecord = (state.archivedItems || []).find(matches)
    || savedRecords.find(item => archivedIds.has?.(item.id));
  const savedId = savedRecords[0]?.id || post.itemIds.find(id => savedIds.has?.(id));
  const archivedId = archivedRecord?.id || post.itemIds.find(id => archivedIds.has?.(id));
  return {saved:!!savedId, archived:!!archivedId, itemId:archivedId || savedId || post.item.id};
}

function renderPost(app, state, post, {folded = false} = {}) {
  const e = value => app.escapeHtml(value), item = post.item, id = e(item.id), title = item.title || '来源未提供标题';
  const {saved, archived, itemId:collectionItemId} = collectionAction(state, post);
  const saveLabel = archived ? '恢复收藏' : saved ? '取消收藏' : '收藏';
  const author = postAuthorLabel(item), excerpt = typeof item.summary === 'string' ? item.summary.trim() : '';
  const inTopic = (state.topics || []).some(topic => (topic.materials || []).some(material => post.itemIds.includes(material.item?.id)
    || postStatusId(material.item?.original_url) === post.statusId || postStatusId(material.item?.canonical_url) === post.statusId));
  const key = `post-stream:${item.id}`;
  // A merged alias may supply the image omitted by the longest excerpt. Only
  // aliases of this exact status are eligible; resource groups never share it.
  const imageRecord = [item,...(post.records || [])].find(record => (postStatusId(record.original_url) === post.statusId || postStatusId(record.canonical_url) === post.statusId)
    && normalizePostImage(record.post_image, post.originalUrl));
  const mediaItem = imageRecord ? {...item,post_image:imageRecord.post_image} : item;
  return `<article class="post-stream-post${folded ? ' post-stream-post-folded' : ''}" data-post-stream-item-id="${id}">
    <div class="post-stream-post-heading"><p class="post-stream-author">${author ? `来源标注作者：${e(author)}` : '来源未提供作者'}</p><p class="post-stream-time">${knownTime(app, item.published_at, '原帖发布') || '原帖发布时间未提供'}</p></div>
    <h4 class="post-stream-title"><a href="${e(app.safeUrl(post.originalUrl))}" target="_blank" rel="noopener noreferrer" aria-label="${e(title)} · 打开原帖">${e(title)} <span aria-hidden="true">↗</span></a></h4>
    <ul class="post-stream-tags" aria-label="来源与线索标签">${post.memberships.map(source => `<li>${e(source.name)}</li>`).join('')}${post.instruction?.eligible ? `<li class="post-stream-instruction">${e(post.instruction.label)}</li>` : ''}${post.isNew ? '<li class="post-stream-new">最近一次新增</li>' : ''}${post.resources.length ? `<li>${post.resources.some(resource => resource.kind === 'repository') ? '含项目链接' : '含外部材料链接'}</li>` : ''}</ul>
    ${renderPostMedia(app,mediaItem,{originalUrl:post.originalUrl})}
    ${folded ? `<p class="post-stream-fold-reason">折叠提示：${e(post.quality.reason || '摘录含推广参与信号，可能误筛')}</p>` : ''}
    ${excerpt ? `<details class="post-stream-excerpt" data-excerpt-details="${e(key)}" ${app.openExcerptDetails?.has(key) ? 'open' : ''}><summary>查看摘录与来源说明</summary><p class="post-stream-excerpt-text">${e(excerpt)}</p><p class="post-stream-boundary">${item.read_scope === 'author-7d-top10' ? 'SoPilot 指定作者近七日热门摘录，属于前十条范围；未读取完整原帖或图片步骤。' : 'SoPilot 公开榜单摘录；未读取完整原帖。'}${item.excerpt_truncated ? ' 摘录已截断，剩余内容请到原帖查看。' : ''}未核对原帖内容、作者身份或热度，未实测。</p><p class="post-stream-evidence-times">${knownTime(app, item.source_item_time, '榜单条目更新')}${knownTime(app, item.captured_at, '获取于')}</p><a class="post-stream-original" href="${e(app.safeUrl(post.originalUrl))}" target="_blank" rel="noopener noreferrer">打开原帖 ↗</a></details>` : '<p class="post-stream-boundary">来源未提供摘录，请打开原帖核对。</p>'}
    <div class="post-stream-actions"><button type="button" class="btn-primary-action" id="post-stream-try-${id}" data-material-start="try" data-item-id="${id}" aria-label="我想试试：${e(title)}">我想试试 <span aria-hidden="true">→</span></button><button type="button" class="btn-secondary-quiet" id="post-stream-write-${id}" data-material-start="write" data-item-id="${id}" aria-label="做成选题：${e(title)}">做成选题</button><button type="button" class="btn-quiet${saved ? ' post-stream-collected' : ''}" id="post-stream-save-${id}" data-action="${archived ? 'restore-collection' : 'toggle-save'}" data-item-id="${e(collectionItemId)}" aria-pressed="${!!saved}" aria-label="${saveLabel}：${e(title)}">${saveLabel}</button></div>${inTopic ? '<p class="post-stream-in-topic">已在选题卡中</p>' : ''}
  </article>`;
}

function renderGroup(app, state, group) {
  const e = value => app.escapeHtml(value);
  const resource = group.resource;
  return `<li class="post-stream-group" id="post-stream-group-${e(group.primary.item.id)}">${group.posts.length > 1 ? `<div class="post-stream-group-heading"><span>${resource?.kind === 'repository' ? '同一 GitHub 项目' : '同一外部材料'} · ${group.posts.length} 条原帖</span>${resource ? `<a href="${e(app.safeUrl(resource.url))}" target="_blank" rel="noopener noreferrer">${e(resource.label)} ↗</a>` : ''}</div>` : ''}${renderPost(app, state, group.primary, {folded:group.folded})}${group.posts.length > 1 ? `<details class="post-stream-originals" data-post-stream-group="${e(group.key)}" ${app.openPostGroups?.has(group.key) ? 'open' : ''}><summary>查看另外 ${group.posts.length - 1} 条原帖</summary><ol aria-label="谈论同一材料的其他原帖">${group.posts.slice(1).map(post => `<li>${renderPost(app, state, post, {folded:group.folded})}</li>`).join('')}</ol></details>` : ''}</li>`;
}

export function renderPostStream(app, state, {sources = state.sources || [], onlyNew = !!app.onlyNew, profile = state.profile || {}, selection} = {}) {
  const result = selection || selectPostStream(state, {sources, onlyNew, profile, limit:app.postStreamLimit,view:app.postStreamView==='all' ? 'all' : 'tutorials'});
  const activeView=result.view==='tutorials' ? 'tutorials' : 'all';
  const e = value => app.escapeHtml(value), showFolded = !!app.postShowFolded;
  const more = result.hasMore || showFolded && result.hasMoreFolded;
  const viewButton=(view,label,count)=>`<button type="button" id="post-stream-view-${view}" data-post-stream-view="${view}" aria-pressed="${activeView===view}">${label}<span>${count}</span></button>`;
  const emptyText=result.foldedCount ? '当前范围的帖子已折叠，可展开后自行判断。' : activeView==='tutorials' && result.unmatchedCount ? '这批摘录还没有识别到可跟着做的教程。不用其他新闻凑数，也可以去全部线索里自己挑。' : onlyNew ? '当前范围最近一次没有新增原帖。' : '当前范围暂无可展示的原帖。';
  return `<section class="post-stream" id="post-stream" aria-labelledby="post-stream-heading"><header class="post-stream-header"><div><h3 id="post-stream-heading" tabindex="-1">${activeView==='tutorials' ? '推特：操作教程' : '推特：值得看的线索'} <small>${result.visibleCount} 条可读原帖</small></h3><p>${activeView==='tutorials' ? '先看摘录中有命令、具体步骤或操作指引的帖子，不够数不凑数。' : '全部线索按摘录里的操作线索优先，再按新增与来源时间排列。'}</p></div><p class="post-stream-scope">来自 SoPilot 公开榜单与已启用作者摘录；未核对完整原帖与热度。</p></header>
    <div class="post-stream-view-controls"><div class="post-stream-views" role="group" aria-label="推特阅读范围">${viewButton('tutorials','操作教程',result.tutorialCount)}${viewButton('all','全部线索',result.originalPostCount)}</div><p class="post-stream-view-note">按已有摘录初筛，不需要出现 AI 关键词；可能漏掉图片或线程中的步骤。全部线索包含未入教程视图的帖子及可展开的推广提示。入选不代表实测或自动精选。</p></div>
    ${result.groups.length ? `<ol class="post-stream-list" aria-label="推特线索">${result.groups.map(group => renderGroup(app, state, group)).join('')}</ol>` : `<div class="post-stream-empty"><p>${emptyText}</p>${activeView==='tutorials' && result.originalPostCount ? '<button type="button" class="btn-secondary-quiet" data-post-stream-view="all">查看全部线索</button>' : ''}</div>`}
    ${result.foldedCount ? `<div class="post-stream-folded"><button type="button" class="post-stream-fold-toggle" id="post-stream-fold-toggle" data-post-stream-fold-toggle aria-expanded="${showFolded}" aria-controls="post-stream-folded-list">${showFolded ? '收起' : '查看'}折叠的 ${result.foldedCount} 条</button><p>摘录含抽奖、邀请返佣等推广信号时先折叠；规则可能误筛，材料仍可收藏和打开。</p>${showFolded ? `<ol class="post-stream-list post-stream-folded-list" id="post-stream-folded-list" aria-label="已折叠的原帖">${result.foldedGroups.map(group => renderGroup(app, state, group)).join('')}</ol>` : '<div id="post-stream-folded-list" hidden></div>'}</div>` : ''}
    ${more ? '<footer class="post-stream-footer"><button type="button" class="source-more post-stream-more" id="post-stream-more" data-post-stream-more>再看 5 条线索 <span aria-hidden="true">→</span></button></footer>' : ''}
  </section>`;
}

export function bindPostStreamActions(app) {
  app.openPostGroups ||= new Set();
  document.querySelectorAll('[data-post-stream-view]').forEach(button=>button.addEventListener('click',()=>{
    const view=button.dataset.postStreamView;
    if(button.disabled || !['tutorials','all'].includes(view)) return;
    app.postStreamView=view;app.postStreamLimit=POST_STREAM_PAGE_SIZE;app.postShowFolded=false;
    app.render();document.getElementById(`post-stream-view-${view}`)?.focus();
  }));
  document.querySelectorAll('[data-post-stream-group]').forEach(detail => detail.addEventListener('toggle', () => {
    if (detail.isConnected === false) return;
    if (detail.open) app.openPostGroups.add(detail.dataset.postStreamGroup);
    else app.openPostGroups.delete(detail.dataset.postStreamGroup);
  }));
  document.querySelectorAll('[data-post-stream-fold-toggle]').forEach(button => button.addEventListener('click', () => {
    app.postShowFolded = !app.postShowFolded;
    app.render();
    document.getElementById('post-stream-fold-toggle')?.focus();
  }));
  document.querySelectorAll('[data-post-stream-more]').forEach(button => button.addEventListener('click', () => {
    app.postStreamLimit = postStreamLimit(app.postStreamLimit) + POST_STREAM_PAGE_SIZE;
    app.render();
    (document.getElementById('post-stream-more') || document.getElementById('post-stream-heading'))?.focus();
  }));
}
