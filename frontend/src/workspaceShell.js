import { TOPIC_STATUS } from './topicWorkspace.js';
import { renderVisitorFeedback } from './visitorFeedback.js';

const e=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
  cloud:'<path d="M7 18a5 5 0 1 1 .5-10A6 6 0 0 1 19 9a4.5 4.5 0 0 1-1 9Z"/>',
  today:'<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
  tutorials:'<path d="M6 3h9l4 4v14H6Z M14 3v5h5M9 12h7M9 16h7"/>',
  candidates:'<path d="M5 5h14l3 9v6H2v-6Z M2 14h6l2 3h4l2-3h6"/>',
  saved:'<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9Z"/>',
  topics:'<path d="m12 3 9 5-9 5-9-5Z M3 12l9 5 9-5M3 16l9 5 9-5"/>',
  profile:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3Z"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/>',
};
export const workspaceIcon=name=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cloud}</svg>`;

export function renderWorkspaceNavigation(tab,state,options={}) {
  const nav=(id,label,count=0)=>`<button class="nav-tab ${tab===id?'active':''}" id="nav-${id}"${tab===id?' aria-current="page"':''}>${workspaceIcon(id)}<span>${label}</span>${count>0?`<span class="nav-badge">${count}</span>`:''}</button>`;
  const mode=state.publicPreview?'公开预览':state.mode==='demo'?'示例预览':'本机版';
  const publication=tab==='today';
  if (publication) {
    const homeView=['latest','yesterday','week','kept'].includes(options.homeView) ? options.homeView : 'latest';
    const catsOpen=options.catsOpen===true;
    const cat=(id,label)=>`<button type="button" class="lift-cat" data-home-view="${id}"${homeView===id?' aria-current="page"':''}>${label}</button>`;
    const feedback=state.publicPreview?renderVisitorFeedback(options.feedback):'';
    return `<a class="workspace-skip" href="#workspace-main">跳到内容</a><header class="site-header lift-header workspace-publication-nav" role="banner"><div class="site-header-inner"><div class="lift-bar"><button type="button" class="lift-pill shape-pill" id="home-brand" data-shape="pill" data-home-view="latest"${homeView==='latest'?' aria-current="page"':''}>Levi flow</button><button type="button" class="lift-cats-button" id="home-cats-button" aria-expanded="${catsOpen?'true':'false'}" aria-controls="home-cats" aria-label="精华帖分类"><span class="lift-menu-icon" aria-hidden="true"><span></span><span></span><span></span></span></button><nav class="lift-cats${catsOpen?' is-open':''}" id="home-cats" aria-label="精华帖分类">${cat('yesterday','昨日全部')}${cat('week','七日精选')}${cat('kept','卧云精选')}</nav>${feedback}</div></div></header>`;
  }
  return `<a class="workspace-skip" href="#workspace-main">跳到内容</a><header class="site-header workspace-sidebar${publication?' workspace-publication-nav':''}" role="banner"><div class="site-header-inner">
    ${publication?`<div class="publication-topline"><span>卧云 · 给创作者的信息刊物</span><span>${mode}</span></div>`:''}
    <div class="brand">${workspaceIcon('cloud')}<h1 class="brand-title">Levi flow</h1><span class="brand-badge">${mode}</span></div>
    ${publication?'<p class="publication-deck">发现好工具，留下好方法，做成自己的内容。</p>':''}
    <nav class="main-nav" aria-label="主要导航"><div class="workspace-nav-group"><p class="workspace-nav-label">发现</p>${nav('today','今日')}</div><div class="workspace-nav-group"><p class="workspace-nav-label">整理</p>${nav('candidates','待筛选',state.dotPendingCandidates?.length || 0)}${nav('saved','收藏与跟进',(state.savedItems?.length || 0)+(state.followups?.length || 0))}${nav('topics','主题工作台')}</div><div class="workspace-nav-bottom">${nav('profile','我的关注')}<img class="workspace-guides" src="/assets/woyun-guides.png" alt="卧云的两位伙伴" width="1374" height="1145" loading="lazy"><p class="workspace-brand-note">留下有用的，做出自己的。</p></div></nav>
  </div></header>`;
}

export function recentWorkspaceTopic(topics=[]) {
  const valid=topics.filter(topic=>topic && typeof topic.id==='string' && typeof topic.title==='string');
  const active=valid.filter(topic=>topic.status!=='done');
  return [...(active.length?active:valid)].sort((a,b)=>(Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0))[0] || null;
}

export function renderWorkspaceResume(state,formatTime) {
  const topic=recentWorkspaceTopic(state.topics);
  if(!topic)return '';
  return `<section class="workspace-resume" aria-label="接着上次做"><div><p>接着上次做 <span>${e(TOPIC_STATUS[topic.status] || '收集材料')}</span></p><h3>${e(topic.title)}</h3><p class="workspace-resume-next">${e(topic.next_step?`下一步：${topic.next_step}`:topic.goal || '打开主题，补上自己的想法和下一步。')}</p><small>主题更新于 ${e(formatTime(topic.updated_at))}</small></div><button class="btn-primary-action" data-topic-open="${e(topic.id)}">继续整理</button></section>`;
}

export function renderWorkspaceStorageNotice(state, options={}) {
  if(!state.publicPreview || options.audience==='visitor') return '';
  return `<details class="workspace-storage-note"><summary>本浏览器保存 · 重要材料请备份</summary><aside class="public-preview-note" aria-label="公开预览说明"><span>收藏、主题和筛选结果只存在当前浏览器。Dot、feedgrab 可投递到私人云端接收箱；精选仍由你选，不会自动公开。清理浏览器或换设备前，请到主题工作台备份。</span><a href="/about.html" target="_blank" rel="noopener">关于这个预览</a></aside></details>`;
}
