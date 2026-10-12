import { renderMaterialReview } from './materialReview.js';
import { repositoryPresentation } from './repositoryGuide.js';
import { practicalMaterialKind } from './practicalMaterials.js';
import { feedAdapter } from './dataAdapter.js';
import { TOPIC_STATUS, blankTopic, postReadingContext } from './topicWorkspace.js';
import { renderManualExcerpt, renderExcerptField } from './excerptViews.js';
import { buildMaterialStart, materialStartDetails, topicStartSteps } from './materialStart.js';
const materialTitle = item => practicalMaterialKind(item) ? item.title : repositoryPresentation(item)?.title || item?.title;


export function renderTopicWorkspace(app,state) {
  const e=value=>app.escapeHtml(value || '');
  const changes=state.topicSyncRows || [];
  const topic=state.topics.find(t=>t.id===app.selectedTopicId);
  if (!topic) return `<section class="topic-workspace">
    <div class="topic-heading"><div><h2 class="page-headline">主题工作台</h2><p class="page-subtitle">围绕一件想做的事，把材料、自己的想法和下一步放在一起。</p></div><div class="topic-actions"><button class="btn-secondary-quiet" data-manual-add>添加材料</button><button class="btn-primary-action" id="topic-new">新建主题</button></div></div>
    <p class="form-help topic-local-note">保存在当前浏览器。换设备前可备份；交给 AI 时只复制你选中的主题。</p>
    ${state.topics.length ? `<div class="topic-grid">${state.topics.map(t=>`<article class="topic-card"><div class="topic-card-meta"><span>${TOPIC_STATUS[t.status] || '收集材料'}</span><span>${t.materials.length} 条材料</span></div><h3>${e(t.title)}</h3>${changes.some(r=>r.topic_id===t.id) ? `<p class="topic-sync-notice">${changes.filter(r=>r.topic_id===t.id).length} 条收藏与主题内容不同，打开查看</p>` : ''}<p>${e(t.goal || '还没写目标，可以先收集，慢慢想。')}</p>${t.next_step ? `<p class="topic-next">下一步：${e(t.next_step.slice(0,160))}</p>`:''}<div class="topic-card-footer"><small>更新于 ${app.formatTime(t.updated_at)}</small><button class="btn-secondary-quiet" data-topic-open="${e(t.id)}">打开主题</button></div></article>`).join('')}</div>` : `<div class="empty-state"><h3 class="empty-title">从一件你想做的事开始</h3><p class="empty-desc">比如“找一个好用的字幕工具”或“做一期视频转笔记教程”。先起个名字，再把有用的信息收进来。</p><button class="btn-secondary-quiet" data-topic-discover>先去看看信息</button></div>`}
    <div class="topic-backup"><button class="btn-secondary-quiet" id="open-backup">备份与恢复</button></div></section>`;
  const field=(label,value,empty)=>`<section class="topic-note-block"><h3>${label}</h3><p class="${value?'':'topic-placeholder'}">${e(value || empty)}</p></section>`;
  const startSteps=topicStartSteps(topic);
  return `<section class="topic-workspace">
    <button class="btn-quiet topic-back" id="topic-back">← 全部主题</button>
    <div class="topic-heading"><div><div class="topic-card-meta">${TOPIC_STATUS[topic.status]} · ${topic.materials.length} 条材料</div><h2 class="page-headline topic-title">${e(topic.title)}</h2><p class="topic-goal">${e(topic.goal || '还没写目标，先收藏几条材料也可以。')}</p></div><div class="topic-actions"><button class="btn-secondary-quiet" id="topic-edit">编辑想法与进度</button><button class="btn-primary-action" id="topic-export">带走这份材料</button></div></div>
    ${topic.imported_backup ? '<p class="backup-origin">从备份恢复的历史主题，本轮未重新核验。</p>':''}
    <div class="topic-layout"><section aria-label="主题材料"><div class="topic-section-heading"><h3>收进来的材料</h3><div class="topic-actions"><button class="btn-secondary-quiet" data-manual-add>添加材料</button><button class="btn-quiet" data-topic-discover>去首页收集 →</button></div></div>
    ${topic.materials.length ? topic.materials.map((m,index)=>`<article class="topic-material"><div class="topic-card-meta"><span>材料 ${index+1}</span><span>${e(m.item.source_refs.map(id=>state.sourceMap.get(id)?.name || id).join(' / '))}</span></div><h4>${e(materialTitle(m.item))}</h4>${practicalMaterialKind(m.item) ? '<p class="form-help">本站整理的中文标题 · AI 按官方说明整理，未实测</p>' : repositoryPresentation(m.item) ? `<p class="form-help">${e(repositoryPresentation(m.item).repository)} · ${e(repositoryPresentation(m.item).basis)} · 尚未实测</p>` : ''}${renderMaterialReview(app,m.item)}${renderSyncNotice(app,changes.find(r=>r.topic_id===topic.id && r.item_id===m.item.id))}${renderManualExcerpt(app,m.manual_excerpt)}<p class="topic-material-note">${m.note ? `留下它的原因：${e(m.note)}`:'还没写收藏理由，随时可以补。'}</p><details><summary>查看收藏时的简介与来源</summary><p class="topic-excerpt">${e(m.item.summary || (m.item.origin==='user_added' ? '手动添加链接，没有自动读取页面。':'来源未提供简介。'))}</p><p class="form-help">${practicalMaterialKind(m.item) ? 'AI 按官方说明整理，未实测' : m.item.origin==='user_added' ? '用户填写的标题与链接，未核对原文' : postReadingContext(m.item) ? e(postReadingContext(m.item).source) : m.item.content_status==='headline_only'?'仅读标题':'简介或来源摘要'} · ${postReadingContext(m.item) ? e(postReadingContext(m.item).scope) : '未自动读取全文'}${m.item.origin==='user_added' ? ` · 添加于 ${app.formatTime(m.item.added_at)}` : ` · ${practicalMaterialKind(m.item) ? '说明阅读于' : '获取于'} ${app.formatTime(m.item.captured_at)}`}</p><p class="form-help">保存于 ${app.formatTime(m.added_at)}；后续信息流更新不会改写这份简介。</p></details><div class="topic-material-actions"><a class="btn-source-link" href="${e(app.safeUrl(m.item.original_url))}" target="_blank" rel="noopener noreferrer">打开来源 ↗</a><button class="btn-quiet" data-topic-note="${e(m.item.id)}">${m.note || m.manual_excerpt?'修改摘录与理由':'补摘录与理由'}</button><button class="btn-quiet" data-topic-remove="${e(m.item.id)}">移出主题</button></div></article>`).join('') : '<div class="empty-state"><h4 class="empty-title">还没有材料</h4><p class="empty-desc">在首页点书签，再在收藏页放进主题。</p></div>'}
    </section><aside class="topic-notes" aria-label="我的想法与安排">
      ${startSteps.length ? `<section class="material-start-checklist"><p class="material-start-kicker">接下来可以这样做</p><ol>${startSteps.map(step=>`<li>${e(step)}</li>`).join('')}</ol><p class="form-help">本站起步建议，尚未执行；实际安排和结果由你记录。</p><button class="btn-secondary-quiet" data-topic-export>带着材料问 AI →</button></section>` : ''}
      ${field('我自己的想法',topic.thoughts,'还没写。可以是一句判断、疑问，或你想尝试的方向。')}
      ${field('还缺什么',topic.gaps,'还没记录缺口。比如费用没查清、缺一张实测截图。')}
      ${field('接下来做什么',topic.next_step,'还没安排下一步。')}
      ${field('结果与收获',topic.result,'还没有结果，不会把收藏或想法当成已经完成。')}
      <p class="form-help">以上由手动填写，不代表独立核验。原始材料保留在“收进来的材料”里。</p>
    </aside></div></section>`;
}

export function openTopicDialog(app,kind,context={},trigger=null) {
  if (kind==='sync') {
    try {context={...context,syncPreview:feedAdapter.previewTopicSync(context.topicId,context.itemId)};}
    catch(error) {app.showToast(error.message);return;}
  }
  if (kind==='export') {
    try { feedAdapter.exportTopic(context.topicId); }
    catch(error) { app.showToast(error.message);return; }
  }
  if (kind==='collect' || kind==='start') {
    try {
      const itemSnapshot=feedAdapter.topicItem(context.itemId);
      context={...context,itemId:itemSnapshot.id,itemSnapshot};
      if (kind==='start') context={...context,draft:buildMaterialStart(itemSnapshot,context.intent),startDetails:materialStartDetails(itemSnapshot,context.intent)};
    }
    catch(error) {app.showToast(error.message);return;}
  }
  app.topicContext={kind,...context};app.activeModal=`topic-${kind}`;
  app.triggerInfo={element:trigger,selector:trigger?.id ? `#${trigger.id}` : '[data-action="topic-save"]'};
  app.renderModals();
}

export function bindTopicActions(app,state) {
  const on=(selector,fn)=>document.querySelectorAll(selector).forEach(el=>el.addEventListener('click',()=>fn(el)));
  on('[data-action="topic-save"]',el=>openTopicDialog(app,'collect',{itemId:el.dataset.itemId},el));
  on('[data-material-start]',el=>openTopicDialog(app,'start',{itemId:el.dataset.itemId,intent:el.dataset.materialStart},el));
  on('[data-manual-add]',el=>openTopicDialog(app,'manual',{topicId:app.currentTab==='topics' ? app.selectedTopicId : null},el));
  on('[data-collection-note]',el=>openTopicDialog(app,'collection-note',{itemId:el.dataset.collectionNote},el));
  on('[data-topic-sync]',el=>openTopicDialog(app,'sync',{topicId:el.dataset.topicId,itemId:el.dataset.topicSync},el));
  on('#topic-new',el=>openTopicDialog(app,'create',{},el));
  on('[data-topic-open]',el=>{app.selectedTopicId=el.dataset.topicOpen;app.switchTab('topics');});
  on('#topic-back',()=>{app.selectedTopicId=null;app.switchTab('topics');});
  on('[data-topic-discover]',()=>app.switchTab('today'));
  on('#topic-edit',el=>openTopicDialog(app,'edit',{topicId:app.selectedTopicId},el));
  on('#topic-export',el=>openTopicDialog(app,'export',{topicId:app.selectedTopicId},el));
  on('[data-topic-export]',el=>openTopicDialog(app,'export',{topicId:app.selectedTopicId},el));
  on('[data-topic-note]',el=>openTopicDialog(app,'note',{topicId:app.selectedTopicId,itemId:el.dataset.topicNote},el));
  on('[data-topic-remove]',el=>{
    try {
      const topicId=app.selectedTopicId,material=feedAdapter.removeTopicMaterial(topicId,el.dataset.topicRemove);
      app.showToast('已移出主题；原信息和其他收藏保留。','撤销',()=>{
        try {feedAdapter.restoreTopicMaterial(topicId,material);app.showToast('已放回主题。');}
        catch(error){app.showToast(error.message);}
      },9000);
    } catch(error){app.showToast(error.message);}
  });
}

export function renderTopicDialog(app,root) {
  const {kind,topicId,itemId,itemSnapshot}=app.topicContext,state=feedAdapter.getState();
  if(kind==='sync') {renderTopicSyncDialog(app,root);return;}
  const topic=state.topics.find(t=>t.id===topicId),draft=topic || app.topicContext.draft || blankTopic();
  const e=value=>app.escapeHtml(value || '');
  const field=(name,label,value,placeholder,limit=4000,rows=3)=>`<div class="form-group"><label class="form-label" for="topic-${name}">${label}</label><textarea class="form-textarea" id="topic-${name}" name="${name}" rows="${rows}" maxlength="${limit}" placeholder="${placeholder}">${e(value)}</textarea></div>`;
  const titleInput=`<div class="form-group"><label class="form-label" for="topic-title">主题名字</label><input class="form-textarea" id="topic-title" name="title" maxlength="100" placeholder="比如：做一期视频转笔记教程" value="${e(draft.title)}"></div>`;
  const goalInput=field('goal','我想做什么（选填）',draft.goal,'例如：找到不用编程也能操作的办法，做一篇有截图的教程。',1000,2);
  let title,body,actions;
  if(kind==='manual') {
    title='添加材料';
    body=`<p class="trial-intro">从其他网站收下有用的链接。标题由你填写，保存时不会自动读取页面。</p><div class="form-group"><label class="form-label" for="manual-url">材料链接</label><input class="form-textarea" id="manual-url" name="url" type="url" maxlength="4000" placeholder="粘贴 https:// 开头的完整链接" required></div><div class="form-group"><label class="form-label" for="manual-title">材料标题</label><input class="form-textarea" id="manual-title" name="title" maxlength="200" placeholder="给它一个你看得懂的名字" required></div><div class="form-group"><label class="form-label" for="manual-choice">保存到</label><select class="form-textarea" id="manual-choice"><option value="collection" ${!topic ? 'selected':''}>先收进收藏</option>${state.topics.map(t=>`<option value="${e(t.id)}" ${t.id===topicId ? 'selected':''}>${e(t.title)}（同时收藏）</option>`).join('')}<option value="new">＋ 新建主题并收藏</option></select></div><div id="manual-topic-fields" hidden><div class="form-group"><label class="form-label" for="manual-topic-title">主题名字</label><input class="form-textarea" id="manual-topic-title" name="topic_title" maxlength="100" placeholder="比如：做一期视频转笔记教程"></div>${field('topic_goal','我想做什么（选填）','','一句话说明这份主题想解决什么。',1000,2)}</div><details class="manual-optional"><summary>补摘录与想法（选填）</summary>${renderExcerptField(app,'',null)}${field('note','我的想法（选填）','','比如：想结合自己的操作经历，写成一篇教程。',2000,2)}</details><p class="form-help">保存在当前浏览器，可备份。不要保存带登录凭据的链接、密码或私人资料。</p>`;
    actions='<button type="submit" class="btn-primary-action">保存材料</button>';
  } else if (kind==='start') {
    title=app.topicContext.intent==='write' ? '把它做成一个选题' : '从一个小试用开始';
    const details=app.topicContext.startDetails;
    body=`<p class="material-start-intro">名字和起步目标已填好，材料会一起带入。保存后在卡片里继续补想法，也能直接带给自己的 AI。</p><p class="topic-dialog-item">${e(materialTitle(itemSnapshot))}</p><div class="form-group"><label class="form-label" for="topic-choice">保存到</label><select class="form-textarea" id="topic-choice"><option value="new" selected>新建${details.intent==='write' ? '选题':'试用'}卡片</option>${state.topics.map(t=>`<option value="${e(t.id)}">加入：${e(t.title)}</option>`).join('')}</select></div><div id="topic-create-fields">${titleInput}<details class="material-start-optional"><summary>改一下目标，或留下自己的想法（选填）</summary>${goalInput}${field('thoughts','我自己的想法（选填）','','例如：想用它整理自己的录音；还不知道中文效果如何。')}</details></div><p class="form-help" id="material-start-existing" hidden>只把材料加入已有卡片，保留那张卡片的目标和想法。</p><details class="material-start-readiness"><summary>开始前看一下条件与费用</summary><dl><div><dt>准备条件</dt><dd>${e(details.preparation)}</dd></div><div><dt>费用</dt><dd>${e(details.cost)}</dd></div></dl><p class="form-help">按已有说明整理，未实测。缺少的条件需要到原文确认。</p><a class="btn-source-link" href="${e(app.safeUrl(itemSnapshot.original_url))}" target="_blank" rel="noopener noreferrer">打开来源 ↗</a></details><p class="form-help">已有收藏理由和摘录会随材料带入。保存在当前浏览器，可备份；AI 不会自动收到，也不会自动执行。</p>`;
    actions='<button type="submit" class="btn-primary-action" id="material-start-save">保存并开始 →</button>';
  } else if (kind==='collect') {
    title='收藏到主题';
    const item=feedAdapter.topicItem(itemId,itemSnapshot),presentation=repositoryPresentation(item);
    body=`<p class="topic-dialog-item">${e(materialTitle(item))}</p>${practicalMaterialKind(item) ? '<p class="form-help">本站整理的中文标题 · AI 按官方说明整理，未实测</p>' : presentation ? `<p class="form-help">${e(presentation.repository)} · ${e(presentation.basis)} · 尚未实测</p>` : ''}<div class="form-group"><label class="form-label" for="topic-choice">放到哪里</label><select class="form-textarea" id="topic-choice">${state.topics.map(t=>`<option value="${e(t.id)}">${e(t.title)}（${t.materials.length} 条）</option>`).join('')}<option value="new">＋ 新建主题</option></select></div><div id="topic-create-fields" ${state.topics.length?'hidden':''}>${titleInput}${goalInput}</div>${renderExcerptField(app,feedAdapter.collectionExcerpt(itemId)?.text,item.original_url)}${field('note','为什么留下它（选填）',feedAdapter.collectionNote(itemId),'比如：操作步骤很清楚，想对照试一次。',2000,2)}<p class="form-help">将这些内容作为一份副本放进主题，之后在收藏页修改不会改写这份副本。</p>`;
    actions='<button type="submit" class="btn-primary-action">收藏并打开主题</button>';
  } else if (kind==='create' || kind==='edit') {
    title=kind==='create'?'新建主题':'编辑想法与进度';
    body=titleInput+goalInput;
    if(kind==='edit') body+=field('thoughts','我自己的想法（选填）',draft.thoughts,'写判断、疑问或自己的切入点。')+`<details class="trial-plan-details"><summary>缺口、下一步与结果（选填）</summary>${field('gaps','还缺什么',draft.gaps,'例如：还没核对费用，需要亲自试一次。',2000)}${field('next_step','接下来做什么',draft.next_step,'写下一个具体动作。',2000)}${field('result','结果与收获',draft.result,'如实记录做了什么、发现了什么；还没做可以留空。')}<div class="form-group"><label class="form-label" for="topic-status">主题进度</label><select class="form-textarea" id="topic-status" name="status">${Object.entries(TOPIC_STATUS).map(([key,label])=>`<option value="${key}" ${draft.status===key?'selected':''}>${label}</option>`).join('')}</select></div></details>`;
    body+='<p class="form-help">只保存在本机。不要填写密码、密钥或私人原件。</p>';
    actions=`<button type="submit" class="btn-primary-action">${kind==='create'?'创建主题':'保存想法'}</button>`;
  } else if(kind==='collection-note') {
    title='留下关键内容';
    const item=feedAdapter.topicItem(itemId);
    body=`<p class="topic-dialog-item">${e(materialTitle(item))}</p>`+renderExcerptField(app,feedAdapter.collectionExcerpt(itemId)?.text,item.original_url)+field('note','我的想法（选填）',feedAdapter.collectionNote(itemId),'比如：想试它做一期教程；还没查清是否收费。',2000,2)+ '<p class="form-help">摘录与想法分开保存。可只填一项；放进主题时会带上，不会改写已有主题。</p>';
    actions='<button type="submit" class="btn-primary-action">保存摘录与想法</button>';
  } else if(kind==='note') {
    title='摘录与收藏理由';
    const material=topic?.materials.find(m=>m.item.id===itemId);
    body=renderExcerptField(app,material?.manual_excerpt?.text,material?.item.original_url)+field('note','我为什么留下这条材料',material?.note,'一句话就够；它和来源原文分开保存。',2000,2)+'<p class="form-help">只修改当前主题里的副本，不改收藏页或其他主题。</p>';
    actions='<button type="submit" class="btn-primary-action">保存摘录与理由</button>';
  } else {
    title='带走这份材料';
    const output=feedAdapter.exportTopic(topicId);
    body=`${renderExportReminder(app,state,topicId)}<p class="trial-intro">复制后，去你常用的 AI 粘贴并发送；接下来的工作在那个 AI 中进行。</p><label class="form-label" for="topic-output">将复制给 AI 的内容</label><textarea class="form-textarea topic-output" id="topic-output" readonly rows="16">${e(output)}</textarea><p class="form-help">当前主题 ${topic?.materials.length || 0} 条材料 · ${Array.from(output).length.toLocaleString('zh-CN')} 字。先检查原链接、摘录和自己的想法；Markdown 文件也可导入知识库。尚未自动发送，不包含网页全文或附件原件。</p>`;
    actions='<button type="button" class="btn-secondary-quiet" id="topic-download">导出 Markdown</button><button type="button" class="btn-primary-action" id="topic-copy">复制给 AI</button>';
  }
  root.innerHTML=`<div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="topic-dialog-title"><div class="modal-dialog topic-dialog"><div class="modal-header"><h3 class="modal-title" id="topic-dialog-title">${title}</h3><button class="modal-close-btn" id="modal-close-btn" aria-label="关闭">×</button></div><form id="topic-form" class="topic-form"><div class="modal-body">${body}<p class="trial-error" id="topic-error" role="alert" hidden></p><p class="form-help" id="topic-feedback" role="status"></p></div><div class="modal-footer"><button type="button" class="btn-secondary-quiet" id="modal-cancel-btn">${kind==='export'?'关闭':'取消'}</button>${actions}</div></form></div></div>`;
  document.getElementById('modal-close-btn').onclick=()=>app.closeModal();
  document.getElementById('modal-cancel-btn').onclick=()=>app.closeModal();
  document.getElementById('modal-backdrop').onclick=event=>{if(event.target.id==='modal-backdrop') app.closeModal();};
  const form=document.getElementById('topic-form'),errorEl=document.getElementById('topic-error');
  const showError=error=>{errorEl.hidden=false;errorEl.textContent=error.message;};
  document.getElementById('topic-review-first')?.addEventListener('click',event=>{const row=state.topicSyncRows.find(r=>r.topic_id===topicId);if(row)openTopicDialog(app,'sync',{topicId,itemId:row.item_id},event.currentTarget);});
  document.getElementById('topic-choice')?.addEventListener('change',event=>{
    const existing=event.target.value!=='new';
    document.getElementById('topic-create-fields').hidden=existing;
    const hint=document.getElementById('material-start-existing');if(hint)hint.hidden=!existing;
  });
  document.getElementById('manual-choice')?.addEventListener('change',event=>{document.getElementById('manual-topic-fields').hidden=event.target.value!=='new';});
  let submitting=false;
  form.onsubmit=event=>{
    event.preventDefault();if(kind==='export') return;
    if(submitting) return;
    submitting=true;
    const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
    try {
      const values=Object.fromEntries(new FormData(form));let saved;
      if(kind==='manual') {
        const choice=document.getElementById('manual-choice').value;
        const result=feedAdapter.addManualMaterial(values,{topicId:!['collection','new'].includes(choice) ? choice:null,newTopic:choice==='new' ? {title:values.topic_title,goal:values.topic_goal}:null});
        if(result.topic_id) {app.selectedTopicId=result.topic_id;app.currentTab='topics';}
        else {app.currentTab='saved';app.savedSubTab='items';app.collectionQuery='';}
        app.closeModal();app.render();app.showToast(result.topic_id ? '材料已收藏并放进主题。':'材料已收进收藏。');return;
      }
      if(kind==='collection-note') {
        feedAdapter.saveCollectionContent(itemId,{note:values.note,excerpt:values.excerpt});app.closeModal();app.render();app.showToast('摘录与想法已保存。');return;
      }
      if(kind==='start') {
        const choice=document.getElementById('topic-choice').value;
        saved=choice==='new' ? feedAdapter.createTopic({...draft,title:values.title,goal:values.goal,thoughts:values.thoughts || ''},itemId,undefined,undefined,itemSnapshot) : feedAdapter.addToTopic(choice,itemId,undefined,undefined,itemSnapshot);
      } else if(kind==='collect') {
        const choice=document.getElementById('topic-choice').value;
        saved=choice==='new' ? feedAdapter.createTopic({title:values.title,goal:values.goal},itemId,values.note,values.excerpt,itemSnapshot) : feedAdapter.addToTopic(choice,itemId,values.note,values.excerpt,itemSnapshot);
      } else if(kind==='create') saved=feedAdapter.createTopic(values);
      else if(kind==='edit') saved=feedAdapter.updateTopic(topicId,values);
      else saved=feedAdapter.updateTopicContent(topicId,itemId,{note:values.note,excerpt:values.excerpt});
      app.selectedTopicId=saved.id;app.currentTab='topics';app.closeModal();app.render();
      app.showToast(kind==='start'?'材料已放进卡片；接下来可补想法或带给 AI。':kind==='collect'?'已收藏到主题。':'主题已保存。');
    } catch(error){submitting=false;if(submit)submit.disabled=false;showError(error);}
  };
  document.getElementById('topic-copy')?.addEventListener('click',async event=>{
    const button=event.currentTarget,feedback=document.getElementById('topic-feedback');button.disabled=true;
    try {const text=feedAdapter.exportTopic(topicId);document.getElementById('topic-output').value=text;await navigator.clipboard.writeText(text);feedback.textContent='已复制；粘贴到常用 AI 后再开始工作。尚未自动发送。';}
    catch(error){feedback.textContent='未复制成功，请选中上方文本手动复制。';showError(error);}
    finally{button.disabled=false;}
  });
  document.getElementById('topic-download')?.addEventListener('click',()=>{
    try {
      const text=feedAdapter.exportTopic(topicId,{forAI:false});
      const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`${topicId}.md`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      document.getElementById('topic-feedback').textContent='已发起下载，请在浏览器下载记录里确认。';
    }catch(error){showError(error);}
  });
  requestAnimationFrame(()=>document.querySelector('#manual-url, #topic-choice, #topic-title, #topic-excerpt, #topic-note, #topic-output')?.focus());
}

function renderSyncNotice(app,row) {
  if(!row) return '';
  const unknown=row.fields.some(field=>field.kind==='untracked'),custom=row.fields.some(field=>field.kind==='custom');
  return `<div class="topic-sync-notice">${unknown ? '收藏与这份主题内容不同；旧主题没有记录关联，先对照再决定。' : custom ? '收藏已改，你也单独改过主题；请先对照。' : '收藏内容已改，这份主题还保留原来的副本。'}<button class="btn-quiet" data-topic-sync="${app.escapeHtml(row.item_id)}" data-topic-id="${app.escapeHtml(row.topic_id)}">查看变化</button></div>`;
}
function renderExportReminder(app,state,topicId) {
  const rows=(state.topicSyncRows || []).filter(row=>row.topic_id===topicId);
  return rows.length ? `<div class="topic-sync-notice">${rows.length} 条收藏内容与主题不同。本次仍带走主题保留的内容。<button type="button" class="btn-quiet" id="topic-review-first">先查看变化</button></div>` : '';
}
function renderTopicSyncDialog(app,root) {
  const row=app.topicContext.syncPreview,e=v=>app.escapeHtml(v || ''),labels={note:'我的想法',manual_excerpt:'手动摘录'};
  const topic=feedAdapter.getState().topics.find(topic=>topic.id===row.topic_id);
  const value=(key,v)=>key==='note' ? v || '（空）' : v?.text || '（无摘录）';
  root.innerHTML=`<div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="topic-dialog-title"><div class="modal-dialog topic-dialog"><div class="modal-header"><h3 class="modal-title" id="topic-dialog-title">对照收藏与主题</h3><button class="modal-close-btn" id="modal-close-btn" aria-label="关闭">×</button></div><form class="topic-form" id="topic-sync-form"><div class="modal-body"><p class="form-help">正在修改主题：${e(topic?.title)}</p><p class="topic-dialog-item">${e(row.title)}</p><p class="form-help">只更新你勾选的内容。原始来源、其他主题和这条材料的简介保持原样。</p>${row.fields.map(field=>`<section class="topic-sync-field"><label class="topic-sync-choice"><input type="checkbox" name="sync-field" value="${field.key}" ${field.kind==='stale' && field.canReplace ? 'checked' : ''} ${!field.canReplace ? 'disabled' : ''}>更新${labels[field.key]}</label><p class="form-help">${!field.canReplace ? '两个摘录的来源链接不同，不能自动替换；请分别打开来源核对。' : field.kind==='custom' ? '你单独改过主题，确认要替换才勾选。' : field.kind==='untracked' ? '旧主题没有关联记录，不能确认哪份更新；请自行选择。' : '收藏已变，主题仍是之前的副本。'}</p><div class="topic-sync-value"><strong>主题里保留的</strong><p>${e(value(field.key,field.topicValue))}</p></div><div class="topic-sync-value"><strong>收藏里当前的</strong><p>${e(value(field.key,field.collectionValue))}</p></div></section>`).join('')}<p class="trial-error" id="topic-error" hidden role="alert"></p><p class="form-help">“保留主题内容”会记下这次选择；下次收藏再变时仍会提醒。</p></div><div class="modal-footer"><button type="button" class="btn-secondary-quiet" id="topic-sync-keep">保留主题内容</button><button type="submit" class="btn-primary-action" id="topic-sync-update">更新选中内容</button></div></form></div></div>`;
  document.getElementById('modal-close-btn').onclick=()=>app.closeModal();
  document.getElementById('modal-backdrop').onclick=ev=>{if(ev.target.id==='modal-backdrop')app.closeModal();};
  const form=document.getElementById('topic-sync-form'),update=document.getElementById('topic-sync-update');
  const selected=()=>[...form.querySelectorAll('input[name="sync-field"]:checked')].map(el=>el.value);
  const setDisabled=()=>{update.disabled=!selected().length;};form.onchange=setDisabled;setDisabled();
  const save=keepAll=>{
    try {
      feedAdapter.applyTopicSync(row,{fields:keepAll ? [] : selected(),keepAll,explicitReplace:!keepAll});
      app.closeModal();app.render();app.showToast(keepAll ? '已保留主题内容；收藏再次修改时会提醒。' : '选中的主题内容已更新。');
    }catch(error){const el=document.getElementById('topic-error');el.hidden=false;el.textContent=error.message;}
  };
  document.getElementById('topic-sync-keep').onclick=()=>save(true);
  form.onsubmit=ev=>{ev.preventDefault();if(selected().length)save(false);};
}
