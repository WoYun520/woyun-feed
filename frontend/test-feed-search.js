import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_PURPOSES, feedMaterialKind, selectFeedSearch } from './src/feedSearch.js';
import { PRACTICAL_ITEMS } from './src/practicalMaterials.js';

const row = (id, extra = {}) => ({id,title:`公开资料 ${id}`,summary:'',source_refs:['news'],original_url:`https://example.com/${id}`,...extra});
const state = (items, extra = {}) => ({allItems:items,sources:[{id:'news',status:'failed',last_success_at:'2020-01-01T00:00:00Z'},{id:'other',status:'ok'}],
  hiddenItemIds:new Set(),refresh:{new_item_ids:[]},...extra});
const found = (input, options) => selectFeedSearch(input,options).items.map(item => item.id);
const catalogItem = (id,extra) => ({...structuredClone(PRACTICAL_ITEMS.find(item=>item.id===id)),source_refs:['news'],...extra});
const tool = extra => catalogItem('news-47b588c6ab1206bc1fc07f93',extra);
const tutorial = extra => catalogItem('news-7bb3267fc3df79c39f516a6c',extra);
function freeze(value) {if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);} return value;}

test('the five shortcuts are explicit keyword choices, empty search preserves old and failed-source public items', () => {
  assert.deepEqual(FEED_PURPOSES.map(item=>item.id),['writing','media','automation','research','development']);
  const old = row('old',{content_status:'headline_only',published_at:'2020-01-01T00:00:00Z'}), input = state([old]);
  const result = selectFeedSearch(input);
  assert.deepEqual(result.items,[old]);assert.equal(result.items[0],old);
  assert.equal(result.total,1);assert.equal(result.active,false);assert.equal(result.query,'');assert.equal(result.purpose,'all');
});

test('results keep original identity and input order, deduplicate repeated IDs and do not mutate frozen data', () => {
  const first=row('first',{summary:'写作工具'}),second=row('second',{summary:'写作与笔记工具'}),input=state([second,first,second]);
  const before=JSON.stringify(input);freeze(input);
  const result=selectFeedSearch(input,{purpose:'writing'});
  assert.deepEqual(result.items,[second,first]);assert.equal(result.items[0],second);assert.equal(result.total,2);
  assert.equal(JSON.stringify(input),before);assert.equal(first.purpose,undefined);assert.equal(second.matches_query,undefined);
});

test('search reads only public metadata and existing guide fields, never user notes, prompts, URLs or nested objects', () => {
  const items=[row('title',{title:'合成字幕'}),row('summary',{summary:'公开原摘要中的线索'}),row('repo',{repository_name:'maker/UsefulRepo'}),
    row('guide',{repository_guide:{summary:'已有中文说明',example:'把分散资料整理成简报',audience:'文字创作者'}}),
    row('private',{note:'私人密码清单',personal_note:'私密整理记录',saved_item_excerpts:{text:'私人摘录'},suggested_question:'私人问题',
      original_url:'https://example.com/private-query',summary:{text:'对象中的未公开文字'}})];
  const input=state(items,{savedItemNotes:{private:'私人密码清单'},profile:{interests:'私人偏好'}});
  for(const [query,id] of [['合成字幕','title'],['原摘要','summary'],['UsefulRepo','repo'],['中文说明','guide'],['简报','guide'],['创作者','guide']]) assert.deepEqual(found(input,{query}),[id]);
  for(const query of ['私人密码','私密整理','私人摘录','私人问题','private-query','未公开文字','私人偏好']) assert.deepEqual(found(input,{query}),[]);
});

test('NFKC and case normalization with AND terms works across metadata fields and resets unknown purposes', () => {
  const input=state([row('both',{title:'ＣＯＤＥＸ 编辑器',summary:'可以制作视频字幕'}),row('one',{title:'Codex 编辑器'})]);
  assert.deepEqual(found(input,{query:'  codex\n字幕  '}),['both']);
  const result=selectFeedSearch(input,{query:' ＣＯＤＥＸ  字幕 ',purpose:'unknown'});
  assert.equal(result.query,'CODEX 字幕');assert.equal(result.purpose,'all');assert.equal(result.active,true);assert.equal(result.total,2);
  assert.equal(selectFeedSearch(input,{query:'\t \n',purpose:'unknown'}).active,false);
  assert.deepEqual(selectFeedSearch(null),{items:[],total:0,active:false,query:'',purpose:'all'});
});

test('small exact aliases match subtitle, caption, screenshot, screen capture and file management in either direction', () => {
  const input=state([row('sub',{summary:'Subtitle editor'}),row('caption',{summary:'Caption authoring'}),row('shot',{summary:'Screenshot tool'}),
    row('capture',{summary:'Screen capture utility'}),row('files',{summary:'File management and file organization'}),row('chinese',{summary:'字幕、截图和整理文件'})]);
  assert.deepEqual(found(input,{query:'字幕'}),['sub','caption','chinese']);
  assert.deepEqual(found(input,{query:'subtitle'}),['sub','caption','chinese']);
  assert.deepEqual(found(input,{query:'截图'}),['shot','capture','chinese']);
  assert.deepEqual(found(input,{query:'screen capture'}),['shot','capture','chinese']);
  assert.deepEqual(found(input,{query:'整理文件'}),['files','chinese']);
  assert.deepEqual(found(input,{query:'file organization'}),['files','chinese']);
  assert.deepEqual(found(input,{query:'字幕 截图'}),['chinese']);
  assert.deepEqual(found(input,{query:'screen'}),['shot','capture']); // literal title text only; no single-word alias expansion
});

test('malicious search punctuation is literal and cannot become a regular expression or execute code', () => {
  const input=state([row('literal',{summary:'文档示例 literal.* [abc] (a+)+$ <script>literal</script>'}),row('ordinary',{summary:'正常文字'})]);
  assert.deepEqual(found(input,{query:'literal.*'}),['literal']);
  assert.deepEqual(found(input,{query:'[abc]'}),['literal']);
  assert.deepEqual(found(input,{query:'.*'}),['literal']);
  assert.deepEqual(found(input,{query:'(a+)+$'}),['literal']);
  assert.deepEqual(found(input,{query:'['}),['literal']);
  assert.deepEqual(found(input,{query:'constructor.prototype'}),[]);
});

test('query length and term count are bounded; ignored extra words do not silently appear in the returned query', () => {
  const query='one two three four five six seven eight nine ten absent';
  const result=selectFeedSearch(state([row('long',{summary:'one two three four five six seven eight nine ten'})]),{query});
  assert.equal(result.items.length,1);assert.equal(result.query.split(' ').length,10);assert.doesNotMatch(result.query,/absent/);
  assert.equal(selectFeedSearch(state([]),{query:'界'.repeat(220)}).query.length,200);
  assert.equal(selectFeedSearch(state([]),{query:{toString(){throw Error('do not stringify');}}}).active,false);
});

test('source visibility checks source existence and returns a merged item once while retaining failed-source content', () => {
  const merged=row('merged',{source_refs:['news','other']}),input=state([merged,row('unknown',{source_refs:['missing']}),row('other',{source_refs:['other']})]);
  assert.deepEqual(found(input,{sourceIds:['news']}),['merged']);
  assert.deepEqual(found(input,{sourceIds:new Set(['other'])}),['merged','other']);
  assert.deepEqual(found(input,{sourceIds:['missing']}),[]);assert.deepEqual(found(input,{sourceIds:[]}),[]);
  assert.equal(selectFeedSearch(input,{sourceIds:['news']}).total,1);
  assert.equal(selectFeedSearch(input,{sourceIds:['news']}).active,false);
});

test('hidden aliases and new aliases apply before query and purpose, without unrelated fallback', () => {
  const first=row('first',{alias_ids:['old-first'],summary:'字幕编辑器'}),second=row('second',{summary:'视频编辑器'});
  const input=state([first,second],{hiddenItemIds:new Set(['old-first']),refresh:{new_item_ids:['old-first']}});
  assert.deepEqual(found(input,{onlyNew:true}),[]);
  input.hiddenItemIds.clear();assert.deepEqual(found(input,{onlyNew:true,purpose:'media'}),['first']);
  assert.equal(selectFeedSearch(input,{onlyNew:true,query:'不匹配'}).total,1);
  input.refresh.new_item_ids=[];assert.deepEqual(found(input,{onlyNew:true}),[]);
  input.hiddenItemIds=['second'];assert.deepEqual(found(input,{}),['first']);
});

test('manual or pasted user materials do not enter the public search corpus even with source-like fields', () => {
  const items=[row('real',{summary:'公开字幕信息'}),row('manual-one',{summary:'公开字幕信息'}),row('user',{origin:'user_added',summary:'公开字幕信息'}),
    row('pasted',{origin:'user_pasted',summary:'公开字幕信息'}),row('link',{content_status:'user_link',summary:'公开字幕信息'}),row('unknown',{source_refs:['user-added']})];
  const input=state(items,{sources:[{id:'news'},{id:'user-added'}]});
  assert.deepEqual(found(input,{query:'字幕'}),['real']);assert.equal(selectFeedSearch(input).total,1);
});

test('purpose buttons use existing keywords; generic AI never supplies automation or an inferred default purpose', () => {
  const input=state([row('generic',{title:'AI Agent 新消息',summary:'人工智能助手新版本发布'}),row('automation',{summary:'Automated workflow for repeated tasks'}),
    row('media',{summary:'Image and video editor'}),row('writing',{summary:'Markdown notebook'}),row('research',{summary:'RSS bookmarks and reading'}),row('development',{summary:'Terminal developer CLI'})]);
  for(const purpose of ['automation','media','writing','research','development']) assert.deepEqual(found(input,{purpose}),[purpose]);
  assert.equal(selectFeedSearch(input,{purpose:'automation'}).active,true);
  assert.equal(selectFeedSearch(input,{purpose:'automation'}).total,6);
  assert.deepEqual(found(state([row('empty')]),{purpose:'automation'}),[]);
});

test('material kinds use precise repositories and keep keyword mentions or unknown type labels as ordinary content', () => {
  const repository=row('repository',{original_url:'https://github.com/example/ScreenReader'});
  assert.equal(feedMaterialKind(repository),'repository');
  assert.equal(feedMaterialKind(row('named',{original_url:null,repository_name:'example/ScreenReader'})),'repository');
  for (const item of [null, row('article',{title:'截图成为讨论热点',link_kind:'article'}),
    row('post',{summary:'帖子提到字幕和截图工具',link_kind:'post'}),row('video',{summary:'视频提到截图',link_kind:'video'}),
    row('unverified',{link_kind:'tool'}),row('issue',{original_url:'https://github.com/example/ScreenReader/issues/1'}),
    row('lookalike',{original_url:'https://github.com.example.com/example/ScreenReader'}),
    row('article-link',{original_url:'https://github.com/example/ScreenReader',link_kind:'article'}),
    row('invalid',{original_url:'https://example.com',repository_name:'example/ScreenReader'})]) {
    assert.equal(feedMaterialKind(item),'content');
  }
});

test('repository priority applies only to active search and preserves original object identity and order within each level', () => {
  const news=row('news',{title:'截图资讯'}),post=row('post',{title:'截图争议',link_kind:'post'});
  const first=row('repository-first',{summary:'Screenshot utility',original_url:'https://github.com/example/First'});
  const second=row('repository-second',{summary:'截图项目',original_url:'https://github.com/example/Second'});
  const input=state([news,first,post,second]),before=JSON.stringify(input);freeze(input);
  assert.deepEqual(selectFeedSearch(input).items,[news,first,post,second]);
  assert.deepEqual(selectFeedSearch(input,{query:' ',purpose:'unknown'}).items,[news,first,post,second]);
  for (const options of [{query:'截图'},{purpose:'media'}]) {
    const result=selectFeedSearch(input,options);
    assert.deepEqual(result.items,[first,second,news,post]);assert.equal(result.total,4);
    assert.equal(result.items[0],first);assert.equal(result.items[1],second);
  }
  assert.equal(JSON.stringify(input),before);
});

test('tool and tutorial kinds require catalog identity, URL and unchanged official notes, excluding user copies and keyword-only claims', () => {
  assert.equal(feedMaterialKind(tool()),'tool');assert.equal(feedMaterialKind(tutorial()),'tutorial');
  for (const item of [tool({id:'copied-id'}),tool({original_url:'https://example.com/copied-link'}),
    tutorial({id:'different-id'}),tutorial({original_url:'https://support.apple.com/zh-cn/unknown'}),
    tool({title:'任意编辑的截图工具标题'}),tutorial({summary:'私人改写的截图教程简介'}),
    tool({origin:'user_added'}),tutorial({origin:'user_pasted'}),tool({content_status:'user_link'}),
    row('manual-copied',{original_url:'https://getsharex.com/'}),row('headline',{title:'截图工具引发争议',link_kind:'article'})]) {
    assert.equal(feedMaterialKind(item),'content');
  }
});

test('active search treats tools, tutorials and projects as one stable priority level before ordinary screenshot news', () => {
  const news=row('news',{title:'普通截图新闻'}),post=row('post',{summary:'Screenshot controversy',link_kind:'post'});
  const guide=tutorial(),project=row('project',{title:'截图项目',original_url:'https://github.com/example/Project',link_kind:'repository'}),utility=tool();
  const original=[news,guide,post,project,utility],input=state(original),before=JSON.stringify(input);freeze(input);
  assert.deepEqual(selectFeedSearch(input).items,original);
  for (const options of [{query:'截图'},{purpose:'media'}]) {
    const result=selectFeedSearch(input,options);
    assert.deepEqual(result.items,[guide,project,utility,news,post]);assert.equal(result.total,5);
    assert.equal(result.items[0],guide);assert.equal(result.items[1],project);assert.equal(result.items[2],utility);
  }
  assert.equal(JSON.stringify(input),before);
});

test('practical priority never bypasses hidden aliases, new aliases, visible sources or user-material exclusions', () => {
  const news=row('news',{summary:'截图相关新闻'}),utility=tool({alias_ids:['old-tool']}),guide=tutorial({alias_ids:['old-guide'],source_refs:['other']});
  const project=row('project',{title:'截图项目',original_url:'https://github.com/example/Project',alias_ids:['old-project']});
  const copied=tool({id:'copied',origin:'user_added'});
  const input=state([news,utility,guide,project,copied],{hiddenItemIds:new Set(['old-tool']),
    refresh:{new_item_ids:['news','old-tool','old-guide','old-project','copied']}});
  const result=selectFeedSearch(input,{query:'截图',onlyNew:true,sourceIds:['news']});
  assert.deepEqual(result.items,[project,news]);assert.equal(result.total,2);
  assert.deepEqual(selectFeedSearch(input,{query:'截图',onlyNew:true,sourceIds:['other']}).items,[guide]);
  input.refresh.new_item_ids=[];assert.deepEqual(selectFeedSearch(input,{query:'截图',onlyNew:true}).items,[]);
});
