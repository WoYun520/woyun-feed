import { renderMaterialReview } from './materialReview.js';
import { repositoryPresentation } from './repositoryGuide.js';
import { sameMaterial } from './topicWorkspace.js';
import { feedAdapter } from './dataAdapter.js';
import { openTopicDialog } from './topicViews.js';
import { renderManualExcerpt } from './excerptViews.js';
import { practicalMaterialKind } from './practicalMaterials.js';

const searchText=value=>String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
export function selectCollection(state,{archived=false,query=''}={}) {
  const tokens=searchText(query).trim().split(/\s+/u).filter(Boolean);
  const candidates=state.savedItems.filter(item=>!!state.archivedItemIds?.has(item.id)===archived);
  const items=candidates.filter(item=>{
    const guide=item.repository_guide || {};
    const text=searchText([item.title,item.summary,item.repository_name,item.original_url,guide.summary,guide.example,guide.audience,
      state.savedItemNotes?.[item.id]?.note,state.savedItemExcerpts?.[item.id]?.text,...item.source_refs.map(id=>state.sourceMap.get(id)?.name || id)].join(' '));
    return tokens.every(token=>text.includes(token));
  });
  return {items,total:candidates.length};
}

export function renderCollectionResults(app,state) {
  const archived=app.savedSubTab==='archived';
  const {items,total}=selectCollection(state,{archived,query:app.collectionQuery});
  const query=!!app.collectionQuery?.trim();
  const status=query ? `找到 ${items.length} 条${archived ? '归档材料' : '收藏'}，共 ${total} 条。` : `${total} 条${archived ? '归档材料' : '收藏'}。`;
  return `<p class="collection-result-count" role="status" aria-live="polite">${status}</p>${items.length
    ? `<div class="collection-list">${items.map(item=>renderCollectionItem(app,item,state)).join('')}</div>`
    : `<div class="empty-state"><h3 class="empty-title">${query ? '没有找到匹配的材料' : archived ? '归档里还没有材料' : '还没有收藏'}</h3><p class="empty-desc">${query ? '可以换个关键词，或清空搜索查看这一区的全部材料。' : archived ? '暂时用不上的材料可以归档，原文、想法和主题关联都会保留。' : '在首页点标题旁的书签，一下就能收下，不用先起主题名字。'}</p><button class="btn-secondary-quiet" data-collection-action="${query ? 'clear' : archived ? 'active' : 'home'}">${query ? '清空搜索' : archived ? '去看收藏' : '返回首页'}</button></div>`}`;
}

export function renderCollectionPanel(app,state) {
  return `<section class="collection-panel" aria-label="${app.savedSubTab==='archived' ? '归档材料' : '已收藏材料'}">
    <div class="collection-search"><label class="form-label" for="collection-search">搜索收藏</label><div class="collection-search-controls"><input id="collection-search" class="form-textarea" type="search" maxlength="200" placeholder="搜标题、用途、摘录或我的想法" aria-controls="collection-results" value="${app.escapeHtml(app.collectionQuery || '')}"><button class="btn-secondary-quiet" id="collection-search-clear" ${app.collectionQuery ? '' : 'hidden'}>清空</button></div><p class="form-help">只查已保存的标题、简介、用途、手动摘录和想法，不搜索网页全文。</p></div>
    <div id="collection-results">${renderCollectionResults(app,state)}</div>
  </section>`;
}

export function bindCollectionActions(app) {
  const archive=(itemId,archived,trigger)=>{
    const y=window.scrollY;
    try {
      feedAdapter.setArchived(itemId,archived);
      window.scrollTo({top:y,behavior:'instant'});
      (document.getElementById(trigger.id) || document.querySelector('.page-headline'))?.focus({preventScroll:true});
      app.showToast(archived ? '已归档，材料和想法都保留。' : '已恢复到收藏。','撤销',()=>{
        try {feedAdapter.setArchived(itemId,!archived);app.showToast(archived ? '已放回收藏。' : '已放回归档。');}
        catch(error){app.showToast(error.message);}
      },7000);
    } catch(error){app.showToast(`未保存：${error.message}`);}
  };
  document.querySelectorAll('[data-action="restore-collection"]').forEach(button=>button.addEventListener('click',()=>archive(button.dataset.itemId,false,button)));
  const input=document.getElementById('collection-search'),results=document.getElementById('collection-results');
  if (!input || !results) return;
  const update=()=>{
    app.collectionQuery=input.value;
    results.innerHTML=renderCollectionResults(app,feedAdapter.getState());
    document.getElementById('collection-search-clear').hidden=!input.value;
  };
  const clear=()=>{input.value='';update();input.focus();};
  input.addEventListener('input',event=>{if(!event.isComposing) update();});
  input.addEventListener('compositionend',update);
  input.addEventListener('blur',()=>requestAnimationFrame(()=>{if(app.pendingRender && !app.activeModal) app.render();}));
  document.getElementById('collection-search-clear').addEventListener('click',clear);
  results.addEventListener('click',event=>{
    const button=event.target.closest('[data-collection-action]');
    if(!button || !results.contains(button)) return;
    const itemId=button.dataset.itemId;
    switch(button.dataset.collectionAction) {
      case 'sync':openTopicDialog(app,'sync',{topicId:button.dataset.topicId,itemId},button);break;
      case 'topic':openTopicDialog(app,'collect',{itemId},button);break;
      case 'note':openTopicDialog(app,'collection-note',{itemId},button);break;
      case 'followup':app.openFollowupModal(itemId,button);break;
      case 'remove':app.toggleSaved(itemId,button);break;
      case 'archive':archive(itemId,true,button);break;
      case 'restore':archive(itemId,false,button);break;
      case 'clear':clear();break;
      case 'active':app.savedSubTab='items';app.render();break;
      case 'home':app.switchTab('today');break;
    }
  });
}

export function renderCollectionItem(app,item,state) {
  const e=value=>app.escapeHtml(value || '');
  const practical=practicalMaterialKind(item);
  const repository=repositoryPresentation(item);
  const topics=state.topics.filter(topic=>topic.materials.some(material=>sameMaterial(material.item,item)));
  const note=state.savedItemNotes?.[item.id]?.note || '';
  const excerpt=state.savedItemExcerpts?.[item.id];
  const names=item.source_refs.map(id=>state.sourceMap.get(id)?.name || id).join(' / ');
  const archived=state.archivedItemIds?.has(item.id);
  return `<article class="collection-card" data-item-id="${e(item.id)}" id="item-${e(item.id)}">
    <div class="collection-meta"><span>${e(names)}</span><span>${archived ? '已归档' : '稍后整理'}${topics.length ? ` · 已放进 ${topics.length} 个主题` : ''}</span></div>
    <h3><a href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">${e(practical ? item.title : repository?.title || item.title)} <span aria-hidden="true">↗</span></a></h3>
    ${practical ? '<p class="form-help">本站整理的中文标题 · AI 按官方说明整理，未实测</p>' : repository ? `<p class="form-help">${e(repository.repository)} · ${e(repository.basis)} · 尚未实测</p>` : ''}
    ${renderMaterialReview(app,item)}
    ${(state.topicSyncRows || []).filter(row=>row.collection_item_id===item.id).map(row=>`<div class="topic-sync-notice">主题“${e(state.topics.find(t=>t.id===row.topic_id)?.title)}”还保留另一份内容。<button class="btn-quiet" data-collection-action="sync" data-topic-id="${e(row.topic_id)}" data-item-id="${e(row.item_id)}">查看变化</button></div>`).join('')}
    ${renderManualExcerpt(app,excerpt)}
    ${note ? `<p class="collection-note"><span>我的想法</span>${e(note)}</p>` : ''}
    ${item.origin==='user_added' ? `<p class="form-help">标题与链接由手动添加，未核对原文 · 添加于 ${e(app.formatTime(item.added_at))}</p>` : ''}
    <details class="collection-source"><summary>收藏时的摘录与来源</summary><p>${e(item.summary || (item.origin==='user_added' ? '只保存手动填写的标题和链接，没有自动读取页面。' : '来源只提供了标题，暂无正文摘录。'))}</p><p class="form-help">${practical ? 'AI 按官方说明整理，未实测' : item.origin==='user_added' ? '手动添加，尚未核对原文' : item.content_status==='headline_only' ? '仅读标题' : '来源简介或摘要'}${item.captured_at ? ` · ${practical ? '说明阅读于' : '获取于'} ${e(app.formatTime(item.captured_at))}` : ''} · 收藏不会抓取网页全文</p></details>
    <div class="collection-actions">
      ${archived ? `<button class="btn-secondary-quiet" id="collection-restore-${e(item.id)}" data-collection-action="restore" data-item-id="${e(item.id)}">恢复到收藏</button>` : ''}
      <button class="${archived ? 'btn-quiet' : 'btn-secondary-quiet'}" id="collection-topic-${e(item.id)}" data-collection-action="topic" data-item-id="${e(item.id)}">放进主题</button>
      <button class="btn-quiet" id="collection-note-${e(item.id)}" data-collection-action="note" data-item-id="${e(item.id)}">${note || excerpt ? '修改摘录与想法' : '补摘录与想法'}</button>
      ${item.origin!=='user_added' ? `<button class="btn-quiet" id="collection-followup-${e(item.id)}" data-collection-action="followup" data-item-id="${e(item.id)}">继续查一查</button>` : ''}
      ${!archived ? `<button class="btn-quiet" id="collection-archive-${e(item.id)}" data-collection-action="archive" data-item-id="${e(item.id)}">归档</button>` : ''}
      <button class="btn-quiet" id="collection-remove-${e(item.id)}" data-collection-action="remove" data-item-id="${e(item.id)}">取消收藏</button>
    </div>
  </article>`;
}
