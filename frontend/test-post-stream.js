import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPostStream, postStatusId, postInstructionEvidence } from './src/postStream.js';

const source = (id = 'sopilot-ai', extra = {}) => ({id, name:id, link_kind:'post', group:'creators', status:'ok', ...extra});
const sources = [source(), source('sopilot-creators'), source('sopilot-author-builder')];
const post = (id, extra = {}) => ({id, title:`原帖 ${id}`, summary:'这是来源提供的帖子摘录。',
  original_url:`https://x.com/builder/status/${id}`, canonical_url:`https://x.com/builder/status/${id}`,
  link_kind:'post', content_status:'excerpt_only', source_refs:['sopilot-ai'], published_at:'2026-10-08T00:00:00Z', ...extra});
const state = items => ({allItems:items, sources:structuredClone(sources), hiddenItemIds:new Set(), profile:{}, refresh:{new_item_ids:[]}});

test('the same status ID appears once across categories and authors without changing records or source ranks', () => {
  const first = post('123', {source_rank:2, source_refs:['sopilot-ai','sopilot-creators'], alias_ids:['old-123']}),
    duplicate = post('duplicate-123', {original_url:'https://twitter.com/another/status/123?utm_source=rank',
      canonical_url:'https://x.com/another/status/123', source_refs:['sopilot-author-builder'], source_rank:1});
  const input = state([first, duplicate]), before = structuredClone(input), selection = selectPostStream(input);
  assert.equal(selection.rawCount, 3); assert.equal(selection.membershipCount, 3); assert.equal(selection.rawRecordCount, 2);
  assert.equal(selection.uniquePostCount, 1); assert.equal(selection.originalPostCount, 1); assert.equal(selection.overlapCount, 2);
  assert.equal(selection.visibleCount, 1); assert.equal(selection.groups.length, 1);
  const entry = selection.groups[0].primary;
  assert.equal(entry.statusId, '123'); assert.deepEqual(entry.sourceIds, ['sopilot-ai','sopilot-author-builder','sopilot-creators']);
  assert.deepEqual(new Set(entry.itemIds), new Set(['123','old-123','duplicate-123']));
  assert.equal(entry.records[0], first); assert.equal(entry.records[1], duplicate); assert.deepEqual(input, before);
});

test('post identity ignores tracking, X versus Twitter and media routes but rejects foreign or malformed URLs', () => {
  for (const url of ['https://twitter.com/builder/status/123?ref=feed','https://x.com/other/status/123/photo/1',
    'https://x.com/i/web/status/123']) assert.equal(postStatusId(url), '123');
  for (const url of ['https://x.com.evil.example/builder/status/123','https://example.com/status/123',
    'javascript:alert(1)','https://name:password@x.com/builder/status/123','https://x.com/builder/status/no']) assert.equal(postStatusId(url), null);
});

test('item hiding and new aliases apply globally to equivalent original posts', () => {
  const input = state([post('123', {alias_ids:['old-123']}), post('other-record', {
    original_url:'https://twitter.com/another/status/123', source_refs:['sopilot-author-builder']})]);
  input.refresh.new_item_ids = ['old-123'];
  assert.equal(selectPostStream(input, {onlyNew:true}).visibleCount, 1);
  input.hiddenItemIds.add('other-record'); assert.equal(selectPostStream(input).visibleCount, 0);
  input.hiddenItemIds.clear(); input.hiddenItemIds.add('old-123'); assert.equal(selectPostStream(input).visibleCount, 0);
});

test('passed source visibility includes an author-only subscription and excludes disabled X and other material kinds', () => {
  const input = state([post('123'), post('124', {source_refs:['sopilot-author-builder']}), post('125', {source_refs:['x']}),
    post('126', {source_refs:['sopilot-ai'], link_kind:'article'}), post('127', {source_refs:['sopilot-ai'], origin:'user_added'})]);
  const scoped = selectPostStream(input, {sources:[sources[2], {id:'x', link_kind:'post', disabled:true}]});
  assert.deepEqual(scoped.posts.map(entry => entry.item.id), ['124']);
  assert.equal(selectPostStream(input, {sources:[source('sopilot-ai', {enabled:false})]}).visibleCount, 0);
  assert.equal(selectPostStream(input, {sources:[]}).visibleCount, 0);
});

test('already merged records count actual source memberships and cross-source overlap once', () => {
  const input = state(Array.from({length:269}, (_, index) => post(String(index + 5000), {
    source_refs:index < 96 ? ['sopilot-ai','sopilot-creators'] : ['sopilot-ai'],
  })));
  const before = structuredClone(input), selection = selectPostStream(input);
  assert.equal(selection.rawRecordCount, 269); assert.equal(selection.originalPostCount, 269);
  assert.equal(selection.membershipCount, 365); assert.equal(selection.rawCount, 365); assert.equal(selection.overlapCount, 96);
  assert.equal(selection.visibleCount, 269); assert.deepEqual(input, before);
});

test('disabled catalog authors lose only author-specific memberships while categories and unknown author sources remain', () => {
  const input = state([
    post('123', {source_refs:['sopilot-ai','sopilot-author-builder']}),
    post('124', {source_refs:['sopilot-author-builder']}),
    post('125', {source_refs:['sopilot-author-unknown']}),
  ]);
  input.sources.push(source('sopilot-author-unknown'));
  input.creatorCatalog = [{id:'creator-builder', handle:'BUILDER', enabled_by_default:true}];
  input.creatorPreferences = {'creator-builder':{enabled:false}};
  const before = structuredClone(input), selection = selectPostStream(input);
  assert.deepEqual(new Set(selection.posts.map(entry => entry.item.id)), new Set(['123','125']));
  assert.deepEqual(selection.posts.find(entry => entry.item.id === '123').sourceIds, ['sopilot-ai']);
  assert.equal(selection.membershipCount, 2); assert.equal(selection.overlapCount, 0); assert.deepEqual(input, before);
  input.creatorPreferences['creator-builder'].enabled = true;
  const enabled = selectPostStream(input);
  assert.equal(enabled.originalPostCount, 3); assert.equal(enabled.membershipCount, 4); assert.equal(enabled.overlapCount, 1);
});

test('explicit creator IDs and source IDs respect catalog defaults without filtering category sources', () => {
  const input = state([post('123', {source_refs:['sopilot-ai']}), post('124', {source_refs:['sopilot-author-builder']})]);
  input.sources[2] = source('sopilot-author-builder', {creator_id:'creator-builder'});
  input.creatorCatalog = [{id:'creator-builder', enabled_by_default:false}]; input.creatorPreferences = {};
  assert.deepEqual(selectPostStream(input).posts.map(entry => entry.item.id), ['123']);
  input.creatorCatalog = [{id:'creator-builder', source_id:'sopilot-author-builder', enabled_by_default:false}];
  delete input.sources[2].creator_id;
  assert.deepEqual(selectPostStream(input).posts.map(entry => entry.item.id), ['123']);
});

test('explicit same GitHub repository groups distinct originals while preserving each source item', () => {
  const first = post('123', {summary:'项目使用方法：https://github.com/Builder/Tool?utm_source=feed'}),
    second = post('124', {summary:'项目配置教程：https://www.github.com/builder/tool.git/'}),
    third = post('125', {summary:'另一个项目：https://github.com/builder/other'});
  const input = state([first, second, third]), before = structuredClone(input.allItems), selection = selectPostStream(input);
  assert.equal(selection.uniquePostCount, 3); assert.equal(selection.groupedCount, 2); assert.equal(selection.overlapCount, 0);
  const grouped = selection.groups.find(group => group.posts.length === 2);
  assert.equal(grouped.kind, 'repository'); assert.equal(grouped.resource.url, 'https://github.com/builder/tool');
  assert.deepEqual(new Set(grouped.posts.map(entry => entry.item.id)), new Set(['123','124']));
  assert.deepEqual(input.allItems, before);
});

test('resource grouping requires an explicit useful exact URL and keeps different pages and query values separate', () => {
  const selection = selectPostStream(state([
    post('123', {summary:'工具教程：https://docs.example.com/guide?version=1'}),
    post('124', {summary:'工具使用方法：https://docs.example.com/guide?version=1'}),
    post('125', {summary:'工具使用方法：https://docs.example.com/guide?version=2'}),
    post('126', {summary:'工具使用方法：https://docs.example.com/other'}),
    post('127', {summary:'工具教程 https://t.co/sameLink'}),
    post('128', {summary:'工具教程 https://t.co/sameLink'}),
    post('129', {summary:'工具教程 https://github.com/topics/ai'}),
    post('130', {summary:'工具教程 https://github.com/topics/ai'}),
  ]));
  assert.equal(selection.groupedCount, 7);
  assert.equal(selection.groups.filter(group => group.posts.length > 1).length, 1);
  assert.equal(selection.groups.find(group => group.posts.length === 2).resource.url, 'https://docs.example.com/guide?version=1');
});

test('shared phrasing, generic mentions and multiple resource links never collapse separate original posts', () => {
  const items = [post('123', {title:'AI 自动化工具'}), post('124', {title:'AI 自动化工具'}),
    post('125', {summary:'今天看看 https://example.com/article'}), post('126', {summary:'今天看看 https://example.com/article'}),
    post('127', {summary:'工具 https://github.com/builder/one 和 https://github.com/builder/two'}),
    post('128', {summary:'工具 https://github.com/builder/one 和 https://github.com/builder/two'})];
  assert.equal(selectPostStream(state(items)).allGroups.length, 6);
});

test('concrete operations rank before ordinary newer posts regardless of source order or rank', () => {
  const tutorial = post('123', {title:'批量转录视频字幕的配置教程', summary:'第一步安装字幕工具，再导出字幕文件。',
    source_refs:['sopilot-author-builder'], source_rank:99, published_at:'2026-10-01T00:00:00Z'});
  const ordinary = post('124', {title:'今天的行业消息', source_rank:1, heat_label:'100万曝光/小时'});
  assert.equal(selectPostStream(state([ordinary, tutorial])).groups[0].primary.item, tutorial);
  const recent = post('125', {published_at:'2026-10-07T00:00:00Z'}), input = state([ordinary, recent]);
  input.refresh.new_item_ids = ['125'];
  assert.deepEqual(selectPostStream(input).posts.map(entry => entry.item.id), ['125','124']);
});

test('the real command tutorial outranks school how-to news, the hacking report and AI drug investment descriptions', () => {
  // Short excerpts from the 2026-10-08 public feed. The source wording remains
  // evidence for sorting only; these posts are all still present and untested.
  const command = post('301', {title:'让豆包、Workbuddy、Claude Code、Deepseek Harness 都能调用 Codex 的内置生图能力！',
    summary:'安装这个 Skill 或 MCP 后，所有 Agent 工具都可以生图做出更精美的小红书、Youtube 封面，或者把任意内容转成信息图。\n\nSkill 安装指令：\nnpx skills add joeseesun/qiaomu-codex-imagegen',
    source_refs:['sopilot-author-builder'], source_rank:99, published_at:'2026-10-01T00:00:00Z'});
  const school = post('302', {title:'China brings AI literacy courses to all primary and secondary schools.',
    summary:'Students learn the basics of artificial intelligence, digital ethics and how to use AI wisely.', source_rank:1});
  const hacking = post('303', {title:'神了，一名广东大学生居然靠AI把韩国好几家大银行都给黑了......',
    summary:'攻击者使用了中国开发的开源 AI 渗透测试工具 ARTEX，主要接入 DeepSeek V4.1-Flash，同时还使用了 GLM-5.3、Grok 4.6 和 Claude Code 辅助操作。\n他还搭建了两套服务器，一套在香港负责控制，另一套运行 ARTEX。'});
  const investment = post('304', {title:'扎克伯格和妻子共同创立的非营利性生物医学研究机构Biohub宣布与美国政府、Google DeepMind、Isomorphic Labs及Meta合作，建设用于AI生物学研究的开放数据集',
    summary:'1）Meta、Google DeepMind和Isomorphic Labs共同投入约3亿美元；\n2）美国能源部未来五年投入超过5亿美元；\n这项合作希望利用自动化实验、测量和模型训练形成更高质量的数据集。\nAI药研的核心瓶颈，可能从模型计算能力逐渐转向可验证的实验数据和自动化实验能力。'});
  const steps = post('305', {title:'Obsidian 插件配置', summary:'1. 打开 Obsidian 设置面板。\n2. 安装插件，导入笔记文件。'});
  const weakTutorial = post('306', {title:'How to configure Obsidian', summary:'Obsidian plugin tutorial.'});
  const input = state([school, hacking, investment, weakTutorial, steps, command]), before = structuredClone(input);
  const result = selectPostStream(input), score = item => result.posts.find(entry => entry.item === item).score;
  assert.equal(result.posts[0].item, command); assert.equal(result.posts[1].item, steps);
  assert.ok(score(command) > score(steps)); assert.ok(score(steps) > score(weakTutorial));
  for (const news of [school, hacking, investment]) {
    assert.equal(score(news), 0); assert.ok(score(weakTutorial) > score(news));
  }
  assert.equal(result.originalPostCount, 6); assert.equal(result.visibleCount, 6); assert.deepEqual(input, before);
});

test('standalone package, repository and container commands rank above numbered software steps', () => {
  const steps = post('399', {summary:'第一步打开字幕工具，导入视频文件。'});
  for (const [index, suppliedCommand] of ['npx skills add author/tool', 'npm install subtitle-tool',
    'pip install whisper', 'git clone https://github.com/author/tool', 'docker run subtitle-tool'].entries()) {
    const command = post(String(index + 400), {summary:`安装指令：\n${suppliedCommand}`, published_at:'2026-10-01T00:00:00Z'});
    const result = selectPostStream(state([steps, command]));
    assert.equal(result.posts[0].item, command, suppliedCommand);
  }
});

test('existing exclusion matching removes benchmark text while interests do not discard author-only subscriptions', () => {
  const input = state([post('123', {title:'模型 benchmark 跑分更新'}),
    post('124', {title:'把字幕整理成写作笔记', source_refs:['sopilot-author-builder']})]);
  input.profile = {interests:'Mac 工具', exclude:'模型跑分'};
  const result = selectPostStream(input);
  assert.deepEqual(result.posts.map(entry => entry.item.id), ['124']); assert.equal(result.rawCount, 1);
});

test('promotional folds are reversible view groups and never destroy original state', () => {
  const raffle = post('123', {title:'国庆节准备了11份币安周边抽给大家！！', summary:'国庆节准备了11份币安周边抽给大家！！'}),
    tutorial = post('124', {title:'配置字幕工具教程', summary:'第一步安装插件，第二步导出字幕文件。'});
  const input = state([raffle, tutorial]), before = structuredClone(input), result = selectPostStream(input);
  assert.equal(result.foldedCount, 1); assert.equal(result.visibleCount, 1);
  assert.equal(result.foldedGroups[0].primary.item, raffle); assert.equal(result.foldedGroups[0].primary.quality.code, 'raffle');
  assert.deepEqual(input, before);
});

test('five groups initially and five more never remove accessible originals or change the full counts', () => {
  const input = state(Array.from({length:12}, (_, index) => post(String(index + 100))));
  const first = selectPostStream(input), next = selectPostStream(input, {limit:10});
  assert.equal(first.groups.length, 5); assert.equal(first.hasMore, true); assert.equal(next.groups.length, 10);
  assert.equal(first.visibleCount, 12); assert.equal(next.allGroups.length, 12); assert.equal(next.rawCount, 12);
});

test('instruction evidence needs concrete supplied action, not an AI keyword, resource link or tutorial slogan',()=>{
  const cases=[
    [post('600',{title:'给截图加箭头',summary:'1. 打开截图工具，选择需要的图片。\n2. 点击箭头按钮，然后导出图片文件。'}),'steps'],
    [post('601',{title:'字幕工具',summary:'安装指令：\nnpx skills add example/subtitles'}),'command'],
    [post('602',{title:'Obsidian 配置教程',summary:'先打开 Obsidian 设置面板，安装插件。'}),'instruction'],
    [post('603',{title:'让笔记更好找',summary:'你可以打开笔记工具，选择导入文档文件。'}),'directed_action'],
  ];
  for(const [item,code] of cases) {
    const before=structuredClone(item),result=postInstructionEvidence(item);
    assert.equal(result.eligible,true);assert.equal(result.code,code);assert.match(result.label,/摘录/);assert.deepEqual(item,before);
  }
  for(const summary of ['AI 又有大新闻了','实用教程收藏合集，值得一看','项目源码：https://github.com/example/tool',
    '1. 公司投入三亿美元。\n2. AI 数据集正式发布。','海巡船今天到港，大家有什么看法？'])
    assert.deepEqual(postInstructionEvidence(post('604',{title:'公开线索',summary})),{eligible:false,code:'',label:''});
  assert.equal(postInstructionEvidence(null).eligible,false);
});

test('tutorial view does not fill empty space with ordinary posts and all clues retain them without mutation',()=>{
  const tutorial=post('610',{title:'截图导出教程',summary:'1. 打开截图工具并保存图片文件。'}),
    event=post('611',{title:'Axis 币安活动消息',summary:'新加坡活动的所见所闻，谈谈账户服务。'}),
    joke=post('612',{title:'CuiMao 随手调侃',summary:'今天随便聊几句，真有意思。'}),
    news=post('613',{title:'海巡新闻',summary:'舰船抵达港口，今天的公共新闻。'});
  const input=state([event,joke,news,tutorial]);input.savedItemIds=new Set([event.id]);input.topics=[{materials:[{item:event,note:'我的个人判断'}]}];
  const before=structuredClone(input),selected=selectPostStream(input,{view:'tutorials'});
  assert.deepEqual(selected.groups.map(group=>group.primary.item),[tutorial]);
  assert.equal(selected.visibleCount,1);assert.equal(selected.tutorialCount,1);assert.equal(selected.allVisibleCount,4);assert.equal(selected.unmatchedCount,3);
  assert.equal(selected.originalPostCount,4);assert.equal(selected.posts.length,4);assert.equal(selected.selectedPosts.length,1);
  const all=selectPostStream(input,{view:'all'});assert.equal(all.visibleCount,4);assert.equal(all.groups.length,4);
  assert.equal(selectPostStream(state([news]),{view:'tutorials'}).groups.length,0);
  assert.deepEqual(input,before);
});

test('tutorial and all counts keep reversible promotion folds separate from instruction eligibility',()=>{
  const tutorial=post('620',{summary:'1. 打开字幕工具并导出文件。'}),
    mixed=post('621',{summary:'1. 打开字幕工具并导出文件。\n关注转发抽周边！'}),
    raffle=post('622',{summary:'关注转发抽周边！'}),
    news=post('623',{summary:'普通公共新闻报道。'});
  const input=state([tutorial,mixed,raffle,news]),before=structuredClone(input),selected=selectPostStream(input,{view:'tutorials'});
  assert.equal(selected.visibleCount,1);assert.equal(selected.foldedCount,1);assert.equal(selected.tutorialCount,1);
  assert.equal(selected.originalPostCount,4);assert.equal(selected.allVisibleCount,2);assert.equal(selected.allFoldedCount,2);
  assert.equal(selected.foldedGroups[0].primary.item,mixed);
  const all=selectPostStream(input,{view:'all'});assert.equal(all.visibleCount,2);assert.equal(all.foldedCount,2);assert.deepEqual(input,before);
});

test('tutorial scope still respects new aliases, hiding and paused author memberships',()=>{
  const category=post('630',{alias_ids:['old-630'],source_refs:['sopilot-ai','sopilot-author-builder'],summary:'安装指令：\nnpm install subtitle-tool'}),
    authorOnly=post('631',{source_refs:['sopilot-author-builder'],summary:'安装指令：\npip install whisper'});
  const input=state([category,authorOnly]);input.creatorCatalog=[{id:'creator-builder',handle:'builder',enabled_by_default:true}];
  input.creatorPreferences={'creator-builder':{enabled:false}};input.refresh.new_item_ids=['old-630'];
  const selected=selectPostStream(input,{view:'tutorials',onlyNew:true});assert.deepEqual(selected.groups.map(group=>group.primary.item),[category]);
  assert.deepEqual(selected.groups[0].primary.sourceIds,['sopilot-ai']);
  input.hiddenItemIds.add('old-630');assert.equal(selectPostStream(input,{view:'tutorials'}).visibleCount,0);
});

test('tutorial filtering happens before resource grouping and pagination without changing original identity',()=>{
  const first=post('640',{summary:'安装指令：\ngit clone https://github.com/example/tool'}),
    second=post('641',{summary:'项目源码：https://github.com/example/tool'}),
    items=[first,second,...Array.from({length:5},(_,index)=>post(String(index+650),{summary:`安装指令：\nnpm install subtitle-${index}`}))];
  const input=state(items),before=structuredClone(input),selected=selectPostStream(input,{view:'tutorials'});
  assert.equal(selected.originalPostCount,7);assert.equal(selected.visibleCount,6);assert.equal(selected.groups.length,5);assert.equal(selected.hasMore,true);
  const grouped=selected.allGroups.find(group=>group.resource?.url==='https://github.com/example/tool');
  assert.equal(grouped.posts.length,1);assert.equal(grouped.primary.item,first);
  const all=selectPostStream(input);assert.equal(all.allGroups.find(group=>group.resource?.url==='https://github.com/example/tool').posts.length,2);
  assert.equal(selectPostStream(input,{view:'tutorials',limit:10}).groups.length,6);assert.deepEqual(input,before);
});
