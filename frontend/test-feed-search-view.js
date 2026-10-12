import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_PURPOSES } from './src/feedSearch.js';
import { renderFeedSearchControls, renderFeedSearchResults, selectHomeSearch, bindFeedSearchActions } from './src/feedSearchView.js';
import { renderSourceBoard, bindSourceBoardActions } from './src/sourceBoard.js';
import { feedAdapter } from './src/dataAdapter.js';
import { sourcePreferenceKey } from './src/sourcePreferences.js';
import { PRACTICAL_SOURCE, PRACTICAL_ITEMS, practicalMaterialKind } from './src/practicalMaterials.js';

const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const preferences=(hidden=[])=>({version:1,hidden_source_ids:hidden,pinned_source_ids:[]});
const app=()=>({escapeHtml:escape,safeUrl:value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol) ? url.href : '#';}catch{return '#';}},
  formatTime:value=>value,sourceLimits:{},boardGroup:'all',sourcePreferences:preferences(),sourcePreferenceKey:sourcePreferenceKey('live'),
  currentTab:'today',feedView:'sources',activeModal:null});
const sources=[{id:'news',name:'工具来源',group:'tech',kind:'original',link_kind:'article',home_url:'https://news.example/',status:'ok'},
  {id:'video',name:'视频来源',group:'creators',kind:'original',link_kind:'video',home_url:'https://video.example/',status:'ok'}];
const item=(id='one',extra={})=>({id,title:'视频字幕工具',summary:'来源提供的视频字幕与截图工具简介。',source_refs:['news'],
  original_url:`https://news.example/${id}`,canonical_url:`https://news.example/${id}`,content_status:'excerpt_only',
  published_at:'2026-10-01T08:00:00Z',captured_at:'2026-10-01T09:00:00Z',...extra});
const state=(items=[item()])=>({mode:'live',allItems:items,sources:structuredClone(sources),hiddenItemIds:new Set(),savedItemIds:new Set(),archivedItemIds:new Set(),topics:[],refresh:{new_item_ids:[]}});

test('default search controls offer five honest purpose hints and leave the existing homepage intact',()=>{
  const viewApp=app(),input=state(),before=structuredClone(input),controls=renderFeedSearchControls(viewApp,input);
  assert.match(controls,/找我需要的工具/);assert.match(controls,/id="feed-search" maxlength="200"/);assert.match(controls,/搜索文章、项目或关键词…/);
  assert.equal([...controls.matchAll(/data-feed-search-purpose=/g)].length,6);
  for (const purpose of FEED_PURPOSES) assert.ok(controls.includes(purpose.label));
  assert.match(controls,/按已有标题和简介找，不等于实测/);assert.match(controls,/多个词用空格隔开，需同时匹配；不搜索网页全文/);assert.match(controls,/id="feed-search-clear" hidden/);
  assert.match(controls,/优先展示工具、操作教程和项目，其他资讯仍可查看/);
  assert.equal(renderFeedSearchResults(viewApp,input),'');
  const board=renderSourceBoard(viewApp,input);assert.match(board,/id="feed-board-content"/);assert.match(board,/id="daily-highlights"/);assert.match(board,/data-source-panel="news"/);
  assert.equal(viewApp.feedSearchState,undefined);assert.deepEqual(input,before);
});

test('flat search results show exact material identity, provenance and twenty entries before more',()=>{
  const input=state(Array.from({length:25},(_,index)=>item(`item-${index}`))),viewApp=app();viewApp.feedSearchQuery='字幕';
  const before=structuredClone(input),html=renderFeedSearchResults(viewApp,input);
  assert.match(html,/找到 25 条材料/);assert.match(html,/已显示 20 条/);assert.match(html,/再看 5 条/);
  assert.equal([...html.matchAll(/class="feed-search-result"/g)].length,20);assert.match(html,/来源：工具来源/);
  assert.match(html,/来源提供的视频字幕与截图工具简介/);assert.match(html,/依据：来源标题和简介，未核对全文或实测/);
  assert.match(html,/来源发布 <time datetime="2026-10-01T08:00:00Z"/);assert.match(html,/采集于 <time datetime="2026-10-01T09:00:00Z"/);
  assert.match(html,/id="feed-search-save-item-0" data-feed-search-action="save" data-item-id="item-0"/);
  assert.match(html,/id="feed-search-topic-item-0" data-feed-search-action="topic" data-item-id="item-0"/);assert.doesNotMatch(html,/\sdata-action=/);
  viewApp.feedSearchLimit=40;assert.equal([...renderFeedSearchResults(viewApp,input).matchAll(/class="feed-search-result"/g)].length,25);
  assert.deepEqual(input,before);
});

test('query, titles, raw summaries and source names are escaped and original links stay safe',()=>{
  const unsafe=item('unsafe',{title:'字幕 <img src=x onerror="bad">',summary:'字幕简介 <script>bad</script>',original_url:'javascript:bad',
    source_links:[{source_id:'news',url:'https://rank.example/other'}]});
  const input=state([unsafe]),viewApp=app();input.sources[0].name='工具 <b>来源</b>';
  viewApp.feedSearchQuery='字幕';const html=renderFeedSearchResults(viewApp,input);
  assert.match(html,/&lt;img src=x onerror=&quot;bad&quot;&gt;/);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);assert.match(html,/工具 &lt;b&gt;来源&lt;\/b&gt;/);
  assert.match(html,/href="#" target="_blank" rel="noopener noreferrer"/);assert.doesNotMatch(html,/<script>|<img|href="javascript:|rank\.example/);
  viewApp.feedSearchQuery='"><script>bad</script>';
  assert.match(renderFeedSearchControls(viewApp,input),/value="&quot;&gt;&lt;script&gt;bad&lt;\/script&gt;"/);
});

test('repository titles and post timestamps preserve their distinct source basis and original URL',()=>{
  const repository=item('repo',{title:'example/tool',repository_name:'example/tool',original_url:'https://github.com/example/tool',
    summary:'Original subtitle tool description',updated_at:'2026-10-01T07:00:00Z',repository_guide:{summary:'把视频语音转换为字幕，便于整理素材。',basis:'description'}});
  const post=item('post',{source_refs:['video'],link_kind:'post',published_at:'2026-10-01T06:00:00Z',source_item_time:'2026-10-01T08:00:00Z',
    original_url:'https://x.com/example/status/123',source_links:[{source_id:'video',url:'https://third.example/rank'}]});
  const input=state([repository,post]),viewApp=app();viewApp.feedSearchQuery='字幕';input.savedItemIds.add('repo');input.archivedItemIds.add('post');
  const html=renderFeedSearchResults(viewApp,input);
  assert.match(html,/把视频语音转换为字幕/);assert.match(html,/example\/tool/);assert.match(html,/AI 整理作者简介；尚未实测/);
  assert.match(html,/仓库更新 <time datetime="2026-10-01T07:00:00Z"/);assert.match(html,/原帖发布 <time datetime="2026-10-01T06:00:00Z"/);
  assert.match(html,/榜单条目更新 <time datetime="2026-10-01T08:00:00Z"/);assert.match(html,/未核对完整原帖、作者身份或热度/);
  assert.match(html,/href="https:\/\/x\.com\/example\/status\/123"/);assert.doesNotMatch(html,/third\.example/);
  assert.match(html,/data-feed-search-action="restore" data-item-id="post"/);assert.match(html,/取消收藏/);
});

test('search intersects purposes, saved source visibility, category and new IDs while empty reset does not promise restored sources',()=>{
  const video=item('video-one',{source_refs:['video'],alias_ids:['old-video']}),writing=item('writing',{title:'写作笔记工具',summary:'记录工作过程与笔记。'});
  const input=state([item(),video,writing]),viewApp=app();viewApp.feedSearchQuery='字幕';viewApp.feedSearchPurpose='media';
  assert.deepEqual(selectHomeSearch(viewApp,input).items.map(item=>item.id),['one','video-one']);
  viewApp.sourcePreferences=preferences(['news']);assert.deepEqual(selectHomeSearch(viewApp,input).items.map(item=>item.id),['video-one']);
  viewApp.boardGroup='tech';const empty=renderFeedSearchResults(viewApp,input);assert.match(empty,/没有找到匹配的材料/);assert.match(empty,/清空搜索与用途/);assert.doesNotMatch(empty,/恢复来源|恢复全部/);
  viewApp.boardGroup='creators';viewApp.onlyNew=true;assert.equal(selectHomeSearch(viewApp,input).items.length,0);
  input.refresh.new_item_ids=['old-video'];assert.equal(selectHomeSearch(viewApp,input).items[0],video);
  input.hiddenItemIds.add('old-video');assert.equal(selectHomeSearch(viewApp,input).items.length,0);
});

test('official practical materials show full start, limitations and costs with reading time and unchanged Chinese titles',()=>{
  const materials=structuredClone(PRACTICAL_ITEMS),input=state(materials),viewApp=app();input.sources=[{...PRACTICAL_SOURCE}];
  viewApp.feedSearchQuery='字幕';
  const selection=selectHomeSearch(viewApp,input),before=structuredClone(input),html=renderFeedSearchResults(viewApp,input,selection);
  assert.ok(selection.items.length>=3);assert.match(html,/feed-search-kind-tool">工具/);assert.match(html,/feed-search-kind-tutorial">操作教程/);
  assert.match(html,/本站中文整理标题/);assert.match(html,/依据：官方说明整理，未实测/);assert.match(html,/说明阅读时间/);
  assert.doesNotMatch(html,/仓库更新|来源发布|发布时间未提供|用途待整理/);
  assert.doesNotMatch(html,/class="feed-search-summary(?:\s|")/);
  for (const material of selection.items) {
    assert.ok(html.includes(escape(material.title)));
    assert.ok(html.includes(`datetime="${material.captured_at}"`));
    for (const line of material.summary.split('\n')) {
      const [,label,text]=line.match(/^(用途|开始|限制|费用|依据)[：:](.*)$/);
      assert.ok(html.includes(`class="feed-search-summary-label">${label}</span>${escape(text)}`));
    }
    assert.ok(html.includes(`data-feed-search-action="save" data-item-id="${material.id}"`));
  }
  assert.deepEqual(input,before);
});

test('known practical identities keep official provenance after restoration while changed notes lose that claim',()=>{
  const restored={...structuredClone(PRACTICAL_ITEMS[0]),origin:'user_added',published_at:'2026-01-01T00:00:00Z',updated_at:'2026-02-01T00:00:00Z'};
  const input=state([restored]),viewApp=app();input.sources=[{...PRACTICAL_SOURCE}];
  assert.equal(practicalMaterialKind(restored),'tool');
  // Restored materials remain excluded from public search; direct rendering checks their presentation boundary.
  assert.equal(selectHomeSearch(viewApp,input).items.length,0);
  const selection={active:true,total:1,items:[restored]},html=renderFeedSearchResults(viewApp,input,selection);
  assert.match(html,/官方说明整理，未实测/);assert.match(html,/feed-search-practical-summary/);assert.match(html,/说明阅读时间/);
  assert.doesNotMatch(html,/仓库更新|来源发布|2026-02-01/);
  restored.summary+='\n这是恢复后改写的用途。';assert.equal(practicalMaterialKind(restored),null);
  const edited=renderFeedSearchResults(viewApp,input,selection);
  assert.doesNotMatch(edited,/依据：官方说明整理，未实测|本站中文整理标题|feed-search-practical-summary/);
  assert.match(edited,/feed-search-kind-content">资讯/);
});

test('explicit tool, tutorial and repository labels appear before ordinary content without keyword upgrades',()=>{
  const tool=structuredClone(PRACTICAL_ITEMS.find(material=>practicalMaterialKind(material)==='tool'));
  const tutorial=structuredClone(PRACTICAL_ITEMS.find(material=>practicalMaterialKind(material)==='tutorial'));
  const repository=item('repo',{original_url:'https://github.com/example/tool',repository_name:'example/tool',link_kind:'repository'});
  const post=item('post',{link_kind:'post'}),video=item('clip',{link_kind:'video'}),selfClaim=item('claim',{link_kind:'tool'});
  const input=state([post,tool,repository,video,tutorial,selfClaim]),viewApp=app();input.sources.push({...PRACTICAL_SOURCE});viewApp.feedSearchQuery='字幕';
  const selected=selectHomeSearch(viewApp,input);assert.deepEqual(selected.items.map(item=>item.id),[tool.id,'repo',tutorial.id,'post','clip','claim']);
  const html=renderFeedSearchResults(viewApp,input,selected);
  assert.match(html,/feed-search-kind-repository">GitHub 项目/);assert.match(html,/feed-search-kind-content">帖子/);assert.match(html,/feed-search-kind-content">视频/);
  const claim=html.slice(html.indexOf('id="feed-search-result-claim"'));
  assert.match(claim,/feed-search-kind-content">资讯/);assert.doesNotMatch(claim,/feed-search-kind-tool/);
  assert.ok(html.indexOf(`id="feed-search-result-${tool.id}"`)<html.indexOf('id="feed-search-result-post"'));
});

test('practical source visibility and aliases still filter official results and preserve the original item',()=>{
  const material=structuredClone(PRACTICAL_ITEMS[0]);material.alias_ids=['old-practical'];
  const input=state([material]),viewApp=app();input.sources=[{...PRACTICAL_SOURCE}];viewApp.feedSearchQuery='字幕';
  assert.equal(selectHomeSearch(viewApp,input).items[0],material);
  viewApp.sourcePreferences=preferences([PRACTICAL_SOURCE.id]);assert.equal(selectHomeSearch(viewApp,input).items.length,0);
  viewApp.sourcePreferences=preferences();viewApp.onlyNew=true;input.refresh.new_item_ids=['old-practical'];assert.equal(selectHomeSearch(viewApp,input).items[0],material);
  input.hiddenItemIds.add('old-practical');assert.equal(selectHomeSearch(viewApp,input).items.length,0);
});

function withSearchDocument(run,input=state()) {
  const globals=['document','window','requestAnimationFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  const originalGetState=feedAdapter.getState,originalSetArchived=feedAdapter.setArchived,originalTopicItem=feedAdapter.topicItem;
  let nodes=new Map(),purposeButtons=[],contentNodes=[],content;
  const raf=[],scrolls=[],viewApp={...app(),feedSearchQuery:'',feedSearchPurpose:'all',renderCount:0,toasts:[],savedCalls:[],modalCount:0};
  const doc={activeElement:null,getElementById:id=>nodes.get(id)||null,querySelector:()=>null,
    querySelectorAll:selector=>selector==='[data-feed-search-purpose]' ? purposeButtons
      : selector==='[data-source-more]' ? contentNodes.filter(node=>node.dataset.sourceMore) : []};
  const control=(id,dataset={})=>({id,dataset,isConnected:true,listeners:{},attributes:{},addEventListener(type,handler){(this.listeners[type] ||= []).push(handler);},
    focus(){doc.activeElement=this;},setAttribute(key,value){this.attributes[key]=value;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
    querySelector(){return this.count || null;},closest(){return this.dataset.feedSearchAction ? this : null;}});
  const buildContent=html=>{
    for (const node of contentNodes) {node.isConnected=false;if(node.id) nodes.delete(node.id);}
    contentNodes=[];
    for (const match of html.matchAll(/<(?:button|a|h3)\b([^>]*)>/g)) {
      const attributes=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(pair=>[pair[1],pair[2]]));
      const dataset=Object.fromEntries(Object.entries(attributes).filter(([key])=>key.startsWith('data-'))
        .map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
      const node=control(attributes.id,dataset);node.parentContent=content;contentNodes.push(node);if(node.id) nodes.set(node.id,node);
    }
  };
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:doc});
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:{scrollY:42,scrollX:0,scrollTo:value=>scrolls.push(value),addEventListener(){}}});
  Object.defineProperty(globalThis,'requestAnimationFrame',{configurable:true,writable:true,value:callback=>raf.push(callback)});
  feedAdapter.getState=()=>input;
  feedAdapter.topicItem=id=>{
    const selected=input.allItems.find(item=>item.id===id);
    if(!selected) throw Error('所选测试材料不存在');
    return structuredClone(selected);
  };
  viewApp.showToast=message=>viewApp.toasts.push(message);viewApp.renderModals=()=>viewApp.modalCount++;
  viewApp.toggleSaved=(id,button)=>{viewApp.savedCalls.push([id,button.id]);input.savedItemIds.add(id);viewApp.render();};
  viewApp.render=()=>{
    viewApp.renderCount++;viewApp.pendingRender=false;viewApp.html=renderSourceBoard(viewApp,input);
    for(const node of nodes.values()) node.isConnected=false;
    nodes=new Map();contentNodes=[];doc.activeElement=null;
    const field=control('feed-search');field.value=viewApp.feedSearchQuery || '';nodes.set(field.id,field);
    const clear=control('feed-search-clear');clear.hidden=!selectHomeSearch(viewApp,input).active;nodes.set(clear.id,clear);
    purposeButtons=[{id:'all',label:'全部用途'},...FEED_PURPOSES].map(purpose=>{
      const button=control(`feed-search-purpose-${purpose.id}`,{feedSearchPurpose:purpose.id});button.count={textContent:String(selectHomeSearch(viewApp,input,purpose.id).items.length)};
      nodes.set(button.id,button);return button;
    });
    content=control('feed-board-content');content.contains=node=>node.parentContent===content && node.isConnected;
    Object.defineProperty(content,'innerHTML',{get(){return this.html;},set(value){this.html=value;buildContent(value);}});
    nodes.set(content.id,content);
    const prefix='<div id="feed-board-content">';content.innerHTML=viewApp.html.slice(viewApp.html.indexOf(prefix)+prefix.length,-6);
    const featured=control('editorial-featured-surface'),featuredPrefix='<div id="editorial-featured-surface">';
    const featuredStart=viewApp.html.indexOf(featuredPrefix)+featuredPrefix.length;
    featured.innerHTML=viewApp.html.slice(featuredStart,viewApp.html.indexOf('<div class="board-toolbar">',featuredStart)).replace(/<\/div>\s*$/,'');
    nodes.set(featured.id,featured);
    bindSourceBoardActions(viewApp);
  };
  const fire=(node,type,event={})=>{assert.ok(node,`missing ${type} control`);for(const handler of node.listeners[type] || []) handler(event);};
  const type=(value,isComposing=false)=>{const field=doc.getElementById('feed-search');field.value=value;field.focus();fire(field,'input',{isComposing});};
  const click=id=>{
    const button=doc.getElementById(id);assert.ok(button,`missing control ${id}`);
    if(button.dataset.feedSearchAction) fire(content,'click',{target:button});else fire(button,'click');
  };
  try {viewApp.render();run({app:viewApp,input,doc,type,click,fire,content:()=>content,flushRAF:()=>{while(raf.length) raf.shift()();},scrolls});}
  finally {feedAdapter.getState=originalGetState;feedAdapter.setArchived=originalSetArchived;feedAdapter.topicItem=originalTopicItem;for(const [key,descriptor] of globals){if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('composition keeps the input and draft text in place; committed search changes only the result content',()=>{
  withSearchDocument(({app,doc,type,fire,content})=>{
    const field=doc.getElementById('feed-search'),root=content(),before=root.innerHTML,renders=app.renderCount;
    fire(field,'compositionstart');type('字',true);assert.equal(app.feedSearchQuery,'字');assert.equal(root.innerHTML,before);assert.equal(app.renderCount,renders);
    field.value='字幕';fire(field,'compositionend');
    assert.equal(app.feedSearchQuery,'字幕');assert.equal(app.feedSearchComposing,false);assert.equal(app.renderCount,renders);
    assert.equal(doc.getElementById('feed-search'),field);assert.equal(content(),root);assert.equal(doc.activeElement,field);
    assert.match(root.innerHTML,/找到 1 条材料/);assert.equal(doc.getElementById('feed-search-clear').hidden,false);
    assert.equal(doc.getElementById('feed-search-purpose-media').count.textContent,'1');
  });
});

test('live search clears the separate featured cover without replacing input and clear restores the original shelf',()=>{
  const input=state();input.dotFeaturedItems=[item('chosen',{title:'我选的教程材料',summary:'这是一条已经由用户选入的材料。'})];
  const before=structuredClone(input);
  withSearchDocument(({app,doc,type,click,content})=>{
    const field=doc.getElementById('feed-search'),featured=doc.getElementById('editorial-featured-surface'),renders=app.renderCount;
    assert.match(featured.innerHTML,/我选的教程材料/);assert.match(featured.innerHTML,/手动选入/);
    type('字幕');assert.equal(featured.innerHTML,'');assert.equal(app.renderCount,renders);
    assert.equal(doc.getElementById('feed-search'),field);assert.equal(doc.activeElement,field);
    assert.match(content().innerHTML,/找到 1 条材料/);assert.doesNotMatch(content().innerHTML,/我选的教程材料/);
    click('feed-search-clear');assert.equal(app.renderCount,renders+1);
    assert.match(doc.getElementById('editorial-featured-surface').innerHTML,/我选的教程材料/);
    assert.match(content().innerHTML,/来源初筛/);assert.equal(doc.activeElement.id,'feed-search');
  },input);
  assert.deepEqual(input,before);
});

test('purpose clicks preserve the query and clearing restores original board controls and open-state models',()=>{
  withSearchDocument(({app,doc,type,click,content,fire})=>{
    app.openExcerptDetails.add('news:item-0');app.openRepositoryDetails.add('github-example');
    type('字幕');const renders=app.renderCount;click('feed-search-purpose-writing');
    assert.equal(app.feedSearchQuery,'字幕');assert.equal(app.feedSearchPurpose,'writing');assert.match(content().innerHTML,/没有找到匹配的材料/);
    assert.equal(app.renderCount,renders);assert.equal(doc.getElementById('feed-search-purpose-writing').attributes['aria-pressed'],'true');
    click('feed-search-purpose-media');assert.match(content().innerHTML,/找到 25 条材料/);
    click('feed-search-clear');assert.equal(app.feedSearchQuery,'');assert.equal(app.feedSearchPurpose,'all');assert.equal(doc.activeElement.id,'feed-search');
    assert.match(content().innerHTML,/data-source-panel="news"/);assert.match(content().innerHTML,/data-excerpt-details="news:item-0" open/);
    assert.equal(app.openRepositoryDetails.has('github-example'),true);
    const more=doc.querySelectorAll('[data-source-more]')[0];assert.equal(more.listeners.click.length,1);fire(more,'click');assert.equal(app.sourceLimits.news,10);
  },state(Array.from({length:25},(_,index)=>item(`item-${index}`))));
});

test('delegated more, save and theme actions survive result replacements and are bound once to real IDs',()=>{
  withSearchDocument(({app,doc,type,click,content})=>{
    type('字幕');bindFeedSearchActions(app);assert.equal(content().listeners.click.length,1);
    click('feed-search-more');assert.equal(app.feedSearchLimit,40);assert.match(content().innerHTML,/已显示 25 条/);assert.equal(doc.activeElement.id,'feed-search-link-item-20');
    type('字幕');assert.equal(app.feedSearchLimit,20);click('feed-search-save-item-0');
    assert.deepEqual(app.savedCalls,[['item-0','feed-search-save-item-0']]);assert.match(content().innerHTML,/取消收藏/);
    click('feed-search-topic-item-0');assert.equal(app.topicContext.itemId,'item-0');assert.equal(app.activeModal,'topic-collect');assert.equal(app.modalCount,1);
    assert.equal(app.triggerInfo.selector,'#feed-search-topic-item-0');assert.doesNotMatch(content().innerHTML,/\sdata-action=/);
  },state(Array.from({length:25},(_,index)=>item(`item-${index}`))));
});

test('restore uses original material ID and reports write failures without claiming success',()=>{
  withSearchDocument(({app,input,type,click,doc,scrolls})=>{
    input.archivedItemIds.add('one');type('字幕');const calls=[];
    feedAdapter.setArchived=(id,value)=>{calls.push([id,value]);throw Error('存储不可用');};click('feed-search-save-one');
    assert.deepEqual(calls,[['one',false]]);assert.match(app.toasts[0],/未保存：存储不可用/);assert.equal(input.archivedItemIds.has('one'),true);
    feedAdapter.setArchived=(id,value)=>{calls.push([id,value]);input.archivedItemIds.delete(id);input.savedItemIds.add(id);app.render();};
    click('feed-search-save-one');assert.deepEqual(calls,[['one',false],['one',false]]);assert.equal(app.toasts.at(-1),'已恢复到收藏。');
    assert.equal(doc.activeElement.id,'feed-search-save-one');assert.equal(scrolls.length,1);
  });
});

test('a result made invisible by newer state cannot dispatch save or topic actions from stale markup',()=>{
  withSearchDocument(({app,input,type,click,content})=>{
    type('字幕');assert.match(content().innerHTML,/feed-search-save-one/);
    input.hiddenItemIds.add('one');click('feed-search-save-one');click('feed-search-topic-one');
    assert.deepEqual(app.savedCalls,[]);assert.equal(app.modalCount,0);assert.equal(app.topicContext,undefined);
    type('字幕');assert.match(content().innerHTML,/没有找到匹配的材料/);
  });
});

test('reset leaves source visibility and new-only filters intact and a pending editor refresh waits for blur',()=>{
  withSearchDocument(({app,doc,type,click,fire,flushRAF})=>{
    app.sourcePreferences=preferences(['video']);app.boardGroup='tech';app.onlyNew=true;type('不存在');
    click('feed-search-clear');assert.deepEqual(app.sourcePreferences,preferences(['video']));assert.equal(app.boardGroup,'tech');assert.equal(app.onlyNew,true);
    type('字幕');let field=doc.getElementById('feed-search'),renders=app.renderCount;
    doc.activeElement=null;app.pendingRender=true;app.activeModal='topic-collect';fire(field,'blur');flushRAF();assert.equal(app.renderCount,renders);
    app.activeModal=null;app.feedSearchComposing=true;fire(field,'blur');flushRAF();assert.equal(app.renderCount,renders);
    app.feedSearchComposing=false;fire(field,'blur');flushRAF();assert.equal(app.renderCount,renders+1);assert.equal(app.feedSearchQuery,'字幕');
  });
});
