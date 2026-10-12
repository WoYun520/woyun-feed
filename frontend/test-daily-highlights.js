import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDailyHighlights } from './src/dailyHighlights.js';
import { PRACTICAL_ITEMS, PRACTICAL_SOURCE } from './src/practicalMaterials.js';

const NOW = Date.parse('2026-10-02T08:00:00Z');
const iso = hours => new Date(NOW - hours * 3600000).toISOString();
const source = (id = 'news', extra = {}) => ({id, name:`来源 ${id}`, group:'tech', status:'ok', last_success_at:iso(1), ...extra});
const row = (id = 'one', extra = {}) => ({id, title:`整理资料的具体方法 ${id}`, summary:'这款工具可以整理书签与文件，并在本机查找已收藏的资料，保留可检索的链接。',
  original_url:`https://example.com/articles/${id}`, source_refs:['news'], content_status:'excerpt_only', published_at:iso(2), captured_at:iso(1), ...extra});
const repo = (id = 'repo', extra = {}) => row(id, {title:'截图与录屏 · sample', summary:'Open-source local search for saved bookmarks and files. No sign-in required.',
  original_url:'https://github.com/example/sample', repository_name:'example/sample', source_refs:['github'], content_status:'metadata_only', published_at:null, updated_at:iso(3),
  repository_guide:{summary:'在本机查找已收藏的书签与文件，整理分散的资料。', basis:'description', verification:'not_tested', source_url:'https://github.com/example/sample', recorded_at:iso(4)}, ...extra});
const select = (items, sources = [source()], options = {}) => selectDailyHighlights(items, sources, {now:NOW, ...options});
const ids = result => result.items.map(entry => entry.item.id);
function freeze(value) {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;}

test('dedicated posts group includes practical tutorials without AI keywords and still rejects news or promotions', () => {
  const author = {author_name:'示例作者', author_handle:'example', link_kind:'post'};
  const tutorial = row('tutorial', {...author, title:'给截图加箭头的操作步骤',
    summary:'使用截图工具编辑图片：第一步框选区域，第二步添加箭头和文字，最后导出图片用于说明操作。',
    original_url:'https://x.com/example/status/1234567890'});
  const news = row('news', {...author, title:'新一轮融资消息', summary:'大公司宣布融资，估值上升并刷新行业排行榜。',
    original_url:'https://x.com/example/status/1234567891'});
  const ad = row('ad', {...author, title:'限时抢购教程课程', summary:'限时抢购，课程报名后教你编辑图片并导出视频。',
    original_url:'https://x.com/example/status/1234567892'});
  const sources = [source('news', {group:'posts'})];
  assert.doesNotMatch(tutorial.title + tutorial.summary, /AI|人工智能/i);
  assert.deepEqual(ids(select([tutorial,news,ad], sources, {group:'posts'})), ['tutorial']);
  assert.deepEqual(ids(select([tutorial,news,ad], sources)), ['tutorial']);
  assert.match(select([tutorial],sources,{group:'posts'}).items[0].basis, /第三方榜单摘录.*未核对原帖/);
  assert.deepEqual(select([tutorial],sources,{group:'tech'}).items, []);
  assert.deepEqual(select([tutorial],sources,{hiddenSourceIds:['news']}).items, []);
});

test('selection uses the Beijing calendar, stays deterministic and returns unchanged original objects', () => {
  const items = [row('b'), row('a')], sources = [source()], before = JSON.stringify({items,sources});
  freeze(items); freeze(sources);
  const result = select(items, sources), shuffled = select([...items].reverse(), sources);
  assert.deepEqual(ids(result), ids(shuffled));
  assert.equal(result.items[0].item, items[1]);
  assert.equal(JSON.stringify({items,sources}), before);
  assert.equal(result.dateKey, '2026-10-02');
  assert.equal(selectDailyHighlights([], [], {now:'2026-10-01T16:01:00Z'}).dateKey, '2026-10-02');
  assert.throws(() => select([], [], {now:NaN}), /有效的当前时间/);
  assert.equal(result.candidateCount, 2); assert.equal(result.omittedCount, 0);
});

test('a valid Chinese repository guide overrides generated prefixes without promising price, safety or income', () => {
  const item = repo(), entry = select([item], [source('github')]).items[0];
  assert.ok(entry); assert.match(entry.purpose, /查找.*书签与文件/);
  assert.doesNotMatch(entry.title, /截图与录屏/);
  assert.match(entry.basis, /AI 整理作者简介.*未实测/);
  assert.equal(entry.cost, '费用待确认'); assert.equal(entry.audience, '阅读提示：想整理文件或收藏的人');
  assert.doesNotMatch(`${entry.purpose} ${entry.reason} ${entry.cost}`, /免费|赚钱|安全/);
  assert.equal(entry.timeLabel, '仓库更新'); assert.equal(entry.timeValue, item.updated_at);
  assert.equal(entry.capturedAt, item.captured_at);
  assert.match(select([item],[source('github')],{profile:{interests:'信息整理'}}).items[0].reason,/匹配关注词“信息整理”/);
});

test('cost preserves explicit source conditions and never treats open source or a guide claim as free', () => {
  const item = row('fee', {summary:'这款工具可以整理书签与文件。来源提供免费版，每月限用三次，超过额度需要付费。适合整理资料的用户。'});
  const entry = select([item]).items[0];
  assert.match(entry.cost, /^来源称：/); assert.match(entry.cost, /免费版.*每月限用三次.*需要付费/);
  assert.match(entry.cost, /条件待核对/); assert.match(entry.audience, /^来源描述：.*用户/);
  const aiClaim = repo('ai', {repository_guide:{...repo().repository_guide, summary:'永久免费整理书签与文件，支持在本机查找收藏资料。'}});
  const rejected = select([aiClaim], [source('github')]);
  assert.deepEqual(rejected.items, []);
  assert.doesNotMatch(JSON.stringify(rejected), /永久免费/);
  const trial = {...aiClaim,summary:'免费试用三次；支持在本机查找收藏的书签与文件，之后需要付费。'};
  const fallback = select([trial], [source('github')]).items[0];
  assert.ok(fallback); assert.match(fallback.basis,/作者中文简介/);
  assert.doesNotMatch(`${fallback.title} ${fallback.purpose}`,/永久免费/);
  assert.match(fallback.cost,/免费试用三次.*需要付费/);
  const invite = row('invite', {summary:'这款工具支持自动整理邮件与文件，提供任务管理。官方从未开设付费获取邀请码的渠道。'});
  assert.equal(select([invite]).items[0].cost, '费用待确认');
});

test('headlines, user materials, English-only repositories and malformed guides are not promoted by interests', () => {
  const invalidGuide = {...repo().repository_guide, source_url:'file:///private/notes'};
  const items = [row('headline', {content_status:'headline_only'}), row('manual', {origin:'user_added'}), row('pasted', {origin:'user_pasted'}),
    row('manual-one'), row('link', {content_status:'user_link'}),
    repo('english', {repository_guide:null}), repo('bad-guide', {repository_guide:invalidGuide}),
    repo('unknown-basis', {repository_guide:{...repo().repository_guide, basis:'made-up'}}),
    repo('fake-verified', {repository_guide:{...repo().repository_guide, verification:'tested_with_evidence'}}),
    row('title-only', {summary:'正文未读取，费用和用途待确认。'})];
  assert.deepEqual(select(items, [source(),source('github')], {profile:{interests:'免费，赚钱，AI工具'}}).items, []);
});

test('failed, disabled, disconnected and old sources do not borrow a recent global capture date', () => {
  const cases = [{status:'failed'},{status:'not_connected'},{enabled:false},{disabled:true},{last_success_at:iso(73)},{last_success_at:null}];
  for (const state of cases) assert.deepEqual(select([row()], [source('news', state)]).items, []);
  assert.deepEqual(select([row()], [], {}).items, []);
  assert.deepEqual(select([row()], [source('news', {last_success_at:new Date(NOW + 301000).toISOString()})]).items, []);
});

test('old publication and old repository changes are rejected even after fresh capture; future and malformed dates fail closed', () => {
  assert.deepEqual(select([row('old-article', {published_at:iso(73), updated_at:iso(1)})]).items, []);
  assert.deepEqual(select([repo('old-repo', {updated_at:iso(73)})], [source('github')]).items, []);
  for (const field of ['published_at', 'updated_at', 'captured_at','source_updated_at','source_item_time']) {
    assert.deepEqual(select([row(field, {[field]:new Date(NOW + 301000).toISOString()})]).items, []);
    assert.deepEqual(select([row(field, {[field]:'not a date'})]).items, []);
  }
  assert.equal(select([row('boundary', {published_at:iso(72)})]).items.length, 1);
  const futureGuide = repo('future-guide', {repository_guide:{...repo().repository_guide, recorded_at:new Date(NOW + 301000).toISOString()}});
  assert.deepEqual(select([futureGuide], [source('github')]).items, []);
});

test('a newly captured trend with unknown code date remains a capture, not publication or a new project', () => {
  const item = repo('trend', {updated_at:null, repository_created_at:'2020-01-01T00:00:00Z'}), entry = select([item], [source('github')]).items[0];
  assert.ok(entry); assert.equal(entry.timeLabel, '最近采集；发布未知');
  assert.equal(entry.timeValue, item.captured_at); assert.doesNotMatch(entry.reason, /今日更新|新项目|刚发布/);
  assert.deepEqual(select([row('old-capture', {published_at:null,captured_at:iso(73)})]).items, []);
});

test('merged entries use only a visible successful source and its own fresh capture', () => {
  const item = row('merged', {source_refs:['news','other'], source_links:[
    {source_id:'news',url:'https://example.com/articles/merged',captured_at:iso(2)},
    {source_id:'other',url:'https://example.com/articles/merged',captured_at:iso(1)}]});
  const sources = [source(),source('other',{group:'community'})];
  assert.deepEqual(select([item], sources, {hiddenSourceIds:['news']}).items[0].sourceNames, ['来源 other']);
  assert.deepEqual(select([item], sources, {hiddenSourceIds:['news','other']}).items, []);
  assert.deepEqual(select([item], [source('news',{status:'failed'}),source('other')]).items[0].sourceNames, ['来源 other']);
  const oldVisible = {...item, source_links:[{...item.source_links[0],captured_at:iso(80)},item.source_links[1]]};
  assert.deepEqual(select([oldVisible], sources, {hiddenSourceIds:['other']}).items, []);
});

test('paused creators do not feature their dedicated source, while enabled category copies remain eligible', () => {
  const authorId = 'sopilot-author-example';
  const tutorial = row('creator-steps', {link_kind:'post', title:'给截图加箭头的操作步骤',
    summary:'使用截图工具编辑图片：第一步框选区域，第二步添加箭头和文字，最后导出图片用于说明操作。',
    original_url:'https://x.com/example/status/1234567890', source_refs:[authorId]});
  const sources = [source(authorId, {group:'posts', creator_id:'creator-example', creator_handle:'example'}),
    source('sopilot-ai', {group:'posts'})];
  const creatorCatalog = [{id:'creator-example', handle:'@example', source_id:authorId, enabled_by_default:true}];
  const options = {creatorCatalog, creatorPreferences:{'creator-example':{enabled:false}}};
  freeze(tutorial); freeze(sources); freeze(options);
  assert.deepEqual(select([tutorial], sources, options).items, []);
  assert.equal(select([tutorial], sources, {...options, creatorPreferences:{'creator-example':{enabled:true}}}).items.length, 1);
  const merged = {...tutorial, source_refs:[authorId, 'sopilot-ai']};
  const result = select([merged], sources, options);
  assert.deepEqual(ids(result), ['creator-steps']);
  assert.deepEqual(result.items[0].sourceNames, ['来源 sopilot-ai']);
  assert.equal(result.items[0].item, merged);
  assert.deepEqual(select([merged], sources, {...options, hiddenSourceIds:['sopilot-ai']}).items, []);
});

test('creator defaults, handle fallback and unknown authors match the post stream source policy', () => {
  const authorId = 'sopilot-author-example';
  const tutorial = row('default-steps', {link_kind:'post', title:'给截图加箭头的操作步骤',
    summary:'使用截图工具编辑图片：第一步框选区域，第二步添加箭头和文字，最后导出图片用于说明操作。',
    original_url:'https://x.com/example/status/1234567890', source_refs:[authorId]});
  const sources = [source(authorId, {group:'posts', creator_handle:'EXAMPLE'})];
  const creatorCatalog = [{id:'creator-example', handle:'@example', enabled_by_default:false}];
  assert.deepEqual(select([tutorial], sources, {creatorCatalog}).items, []);
  assert.equal(select([tutorial], sources, {creatorCatalog, creatorPreferences:{'creator-example':{enabled:true}}}).items.length, 1);
  assert.equal(select([tutorial], sources, {creatorCatalog:[]}).items.length, 1);
  assert.equal(select([tutorial], sources).items.length, 1);
});

test('exclusions, hidden aliases, source group and new-only scope apply before selection without unrelated fallback', () => {
  const item = row('one',{alias_ids:['older-id']}), sources = [source()];
  assert.deepEqual(select([item],sources,{hiddenIds:new Set(['older-id'])}).items, []);
  assert.deepEqual(select([item],sources,{profile:{exclude:'信息整理'}}).items, []);
  assert.deepEqual(select([item],sources,{profile:{exclude:'书签'}}).items, []);
  assert.deepEqual(select([item],sources,{group:'community'}).items, []);
  assert.equal(select([item],sources,{group:'group:tech'}).items.length, 1);
  assert.deepEqual(select([item],sources,{onlyNewIds:[]}).items, []);
  assert.equal(select([item],sources,{onlyNewIds:new Set(['older-id'])}).items.length, 1);
  const media = row('media',{title:'设计素材的具体编辑方法',summary:'这个工具可以编辑图片，并转换图像，帮助创作者准备公开发布的素材。'});
  for (const exclude of ['图片','编辑图片','图片与视频']) assert.deepEqual(select([media],sources,{profile:{exclude}}).items, []);
});

test('exact URLs, repositories and long normalized titles deduplicate while short titles and separate uses do not', () => {
  const shared = '明确介绍整理书签与文件的操作步骤和使用方法';
  const items = [row('a',{title:shared}), row('b',{title:shared.toUpperCase(),source_refs:['other']}),
    row('c',{title:'独立文章的方法',original_url:'https://example.com/articles/b?utm_source=test#section',source_refs:['third']}),
    repo('repo-a'), repo('repo-b',{original_url:'https://github.com/EXAMPLE/SAMPLE.git',repository_name:'EXAMPLE/SAMPLE'})];
  const result = select(items,[source(),source('other'),source('third'),source('github')]);
  assert.equal(result.candidateCount, 2); // b connects a by title, c by canonical URL.
  assert.equal(result.items.length, 2);
  assert.equal(select([row('x',{title:'简单工具'}),row('y',{title:'简单工具',source_refs:['other']})],[source(),source('other')]).candidateCount, 2);
  const different = [row('first',{title:'相同主题但独立的新工具方法一'}),row('second',{title:'相同主题但独立的新工具方法二',source_refs:['other']})];
  assert.equal(select(different,[source(),source('other')]).candidateCount, 2);
});

test('the shortlist limits each source and use, ignores platform popularity, and does not fill with unsuitable entries', () => {
  const sources = ['news','other','third','fourth'].map(id => source(id));
  const items = Array.from({length:5},(_,index) => row(`info-${index}`, {source_refs:[sources[index % 4].id],stars:index * 100000,heat_label:'百万热度'}));
  items.push(row('writing',{source_refs:['other'],summary:'这款软件可以自动记下工作过程和完成事项，整理每日摘要与项目任务草稿。'}),
    row('network',{source_refs:['third'],summary:'使用一条命令就能连接两台设备，建立临时内网隧道，结束后自行关闭连接。'}),
    row('media',{source_refs:['fourth'],summary:'这个工具可以把视频转录为字幕，并编辑图片与音频，提供操作步骤和导出示例。'}));
  const result = select(items,sources,{limit:99});
  assert.equal(result.items.length, 5);
  assert.ok(result.items.filter(entry=>entry.item.id.startsWith('info-')).length <= 2);
  for (const src of sources) assert.ok(result.items.filter(entry=>entry.item.source_refs.includes(src.id)).length <= 2);
  const popularityChanged = items.map(item => ({...item,stars:99999999,heat_label:'最低热度',source_rank:1}));
  assert.deepEqual(ids(select(popularityChanged,sources)),ids(result));
  const limited = select([row('a'),row('b'),row('c')]);
  assert.equal(limited.items.length,2); assert.equal(limited.omittedCount,1); assert.match(limited.message,/有限/);
});

test('private links, credentials and mismatched canonical URLs are excluded; public material stays eligible', () => {
  const unsafe = ['file:///tmp/readme','javascript:alert(1)','http://localhost/readme','http://127.1/readme','http://10.0.0.1/readme','http://172.16.4.2/readme',
    'http://192.168.0.2/readme','https://private.local/readme','https://user:pass@example.com/readme','https://example.com/readme?api_key=secret','http://[::1]/readme'];
  for (const url of unsafe) assert.deepEqual(select([row('unsafe',{original_url:url})]).items, []);
  assert.deepEqual(select([row('mismatch',{canonical_url:'https://example.com/different'})]).items, []);
  assert.equal(select([row('valid',{alias_ids:'malformed',source_links:'malformed'})]).items.length,1);
});

test('advertisements, financing, benchmarks and generic social statistics do not acquire a purpose from AI words', () => {
  const bad = [row('ad',{title:'广告：整理资料的免费课程',summary:'这款工具可以整理书签与文件，立即购买课程，扫码购买即可获得折扣码。'}),
    row('finance',{title:'融资后推出AI工具',summary:'自动管理代码和模型的公司完成十亿元融资，最新估值创纪录。'}),
    row('benchmark',{title:'模型跑分排行榜第一',summary:'新模型可以生成文本，跑分刷新纪录，参数规模达到最新水平。'}),
    row('statistics',{title:'生成式AI用户超七亿',summary:'研究机构发布生成式人工智能应用发展报告，用户规模突破七亿，普及率创历史新高。'}),
    row('social',{link_kind:'post',summary:'该博主用AI制作视频，把编造的旅行说成亲历，事件引发激烈争议。'}),
    row('industry',{link_kind:'post',summary:'一年前的行业热点是cli浏览器、cli邮件、cli生成视频音频，以及模型部署热潮。'}),
    row('deploy-list',{link_kind:'post',summary:'当下最值得部署的模型有三个，大家可以关注这些模型的性能和参数。'}),
    row('hype',{title:'最能赚钱的插件组合',summary:'操作步骤：配置插件，运行代码并编辑图片，然后立即获得收入。'})];
  assert.deepEqual(select(bad,[source()],{profile:{interests:'AI，赚钱，免费'}}).items, []);
  assert.deepEqual(select([row('hot')],[source('news',{group:'hot'})]).items, []);
  assert.deepEqual(select([row('finance-group')],[source('news',{group:'finance'})]).items, []);
});

test('purpose chooses an actual capability over bylines or positioning; any shortened quote is marked', () => {
  const item = row('capability',{summary:'文｜匿名作者 编辑|匿名编辑，产品定位升级为AI管家。它可以按用户指令完成安装软件、查找文件等任务，提供操作示例。'});
  const entry = select([item]).items[0];
  assert.match(entry.purpose,/完成安装软件、查找文件/); assert.doesNotMatch(entry.purpose,/匿名|定位/);
  const long = row('long',{summary:`这个工具可以整理书签与文件，并提供使用方法：${'保留可检索的链接及来源说明，'.repeat(15)}`});
  assert.match(select([long]).items[0].purpose,/…$/);
  const opinion = row('opinion',{summary:'完全重构的软件是我的心目中最佳的任务管理工具。'});
  assert.equal(select([opinion]).items[0].purpose,'任务管理工具');
  assert.doesNotMatch(select([opinion]).items[0].reason,/最佳/);
});

test('fixed official notes supplement action picks without becoming recent publications or test results', () => {
  const originals = structuredClone(PRACTICAL_ITEMS), before = JSON.stringify(originals), at = '2026-10-07T03:00:00Z';
  const result = selectDailyHighlights(originals, [PRACTICAL_SOURCE], {now:at,includePractical:true});
  assert.equal(result.items.length, 2); // The same fixed source cannot occupy the whole entry.
  for (const entry of result.items) {
    assert.equal(entry.fixed,true);
    assert.equal(entry.timeLabel,'说明阅读时间');
    assert.equal(entry.timeValue,entry.item.captured_at);
    assert.match(entry.reason,/固定.*非今日更新/);
    assert.match(entry.basis,/官方说明.*未安装、未实测/);
    assert.match(entry.preparation,/整理说明：/);
    assert.doesNotMatch(entry.reason+entry.basis,/已验证|本站已试用|今日发布/);
    assert.equal(entry.item,originals.find(item=>item.id===entry.item.id));
  }
  assert.equal(JSON.stringify(originals),before);
  assert.equal(selectDailyHighlights(originals,[PRACTICAL_SOURCE],{now:at}).items.length,0);
});

test('fixed notes keep current hidden, excluded, category and new-only scope and reject altered provenance', () => {
  const at='2026-10-07T03:00:00Z', item=structuredClone(PRACTICAL_ITEMS[0]);
  const options={now:at,includePractical:true};
  const pick=(items=[item], extra={}, sources=[PRACTICAL_SOURCE])=>selectDailyHighlights(items,sources,{...options,...extra}).items;
  assert.equal(pick().length,1);
  assert.equal(pick([item],{hiddenSourceIds:[PRACTICAL_SOURCE.id]}).length,0);
  assert.equal(pick([item],{hiddenIds:[item.id]}).length,0);
  assert.equal(pick([item],{group:'posts'}).length,0);
  assert.equal(pick([item],{profile:{exclude:'字幕'}}).length,0);
  assert.equal(pick([item],{onlyNewIds:[]}).length,0);
  assert.equal(pick([item],{onlyNewIds:[item.id]}).length,1);
  assert.equal(pick([item],{},[{...PRACTICAL_SOURCE,status:'failed'}]).length,0);
  for (const changed of [{summary:item.summary+'\nAI 新增了一项能力。'}, {captured_at:at}, {origin:'user_added'},
    {verification_status:'tested_with_evidence'}, {original_url:'https://example.com/copied'}]) assert.equal(pick([{...item,...changed}]).length,0);
  assert.equal(pick([item],{now:'2026-11-07T03:00:00Z'}).length,0);
  assert.equal(pick([item],{now:'2026-10-02T03:00:00Z'}).length,0);
});

test('preparation quotes stated requirements and never invents setup from a category or AI summary', () => {
  const item=row('setup',{summary:'这个工具可以编辑图片与视频，提供使用方法。需要先安装插件，并使用 Windows 系统。'});
  assert.match(select([item]).items[0].preparation,/来源说明：需要先安装插件.*Windows/);
  assert.equal(select([row('unknown')]).items[0].preparation,'准备条件未说明，先查看原文。');
  const withGuide=repo('guide',{repository_guide:{...repo().repository_guide,summary:'在本机查找已收藏的书签与文件，需先安装插件并使用 Windows 系统。'}});
  assert.equal(select([withGuide],[source('github')]).items[0].preparation,'准备条件未说明，先查看原文。');
});

test('giveaway onboarding and model launch specifications do not take an action pick from a usable tutorial',()=>{
  const giveaway=row('giveaway',{title:'准备了11份币安周边抽给大家',link_kind:'post',summary:'注册、下载、入金、基础操作和教程已经整理在启航台里，新手可以收藏资料。'});
  const launch=row('launch',{title:'谷歌发布了 Nano Banana 2.1 图像模型',link_kind:'post',summary:'它比其他模型的主要优势在于可以生成 4K 图片，感觉一下又有用了。'});
  const tutorial=row('steps',{title:'新图像模型推出后的使用方法',link_kind:'post',summary:'具体步骤：打开编辑界面，上传自己的图片，再用文字提示生成图片，最后导出保存。'});
  assert.deepEqual(ids(select([giveaway,launch,tutorial])),['steps']);
});

test('real recent opinions, school news and off-page meme setup do not become featured actions',()=>{
  // Small original excerpts from the 2026-10-08 read-only public snapshot.
  // Source claims are not facts verified by this test.
  const examples=[
    row('golang',{link_kind:'post',title:'我发现在今天此时此刻，golang简直太重要了。',
      summary:'如果你经常管理~50个的subagent，你会明显感受到单机的编译速度、运行速度、内存、硬盘占用明显会成为瓶颈，要么硬盘用完，要么某几个nodejs或者python吃光内存，要么rust和C++给你漫长编译。\n本地运行~50个subagent的前提下，golang几乎就是最好的实践，其他选项可能是C# Native AOT和zig，不过编译速度依然全都远远不如go。',
      original_url:'https://x.com/lidangzzz/status/2108017850405249251'}),
    row('meme',{link_kind:'post',title:'meme雷达V2版本来了，兄弟们可以去体验了。',
      summary:'希望今年都能抓到金狗，把老版本直接删除清理终端后下载V2最新版。\n想省事直接把开源网址丢给Codex，hermes，豆包桌面版等AI就行。提示词：帮我安装这个开源软件，适配我的电脑和VPN网络，并且在桌面创建快捷方式！\n安装完成后看我X推特主页的置顶教程进行配置API即可完成！',
      original_url:'https://x.com/bi_9527zx/status/2108126862287204827'}),
    row('school',{link_kind:'post',title:'在美读书实习打工的门槛更高了。',
      summary:'在美读书实习打工的门槛更高了。美国国土安全部今早发布公告，计划对在美留学生的实习工作许可 OPT，加一笔手续费，首次申请校方要向美国政府缴纳 7 万美元，之后再申请需缴 3 万美元。\n学校必须先把钱交给美国政府，才能在系统里给学生推荐 OPT，而如果没交，移民局就不批工卡。',
      original_url:'https://x.com/_FORAB/status/2108115510378512576'}),
  ];
  const before=JSON.stringify(examples);freeze(examples);
  assert.deepEqual(select(examples,[source()],{profile:{interests:'开发工具，AI'}}).items,[]);
  assert.equal(JSON.stringify(examples),before);
});

test('copyable commands and concrete ordinary software steps precede weak tutorial announcements',()=>{
  const command=row('command',{link_kind:'post',title:'安装字幕插件的具体用法',published_at:iso(50),
    summary:'这个插件可以把视频转录为字幕并导出字幕文件，用于整理已有视频资料。安装指令：\nnpx skills add example/subtitles\n安装后先在一段测试视频上核对字幕输出。'});
  const steps=row('ordinary',{link_kind:'post',title:'给截图加箭头的操作步骤',published_at:iso(1),
    summary:'使用截图工具编辑图片：第一步框选区域，第二步添加箭头和文字，最后导出图片用于说明操作。'});
  const weak=row('weak',{link_kind:'post',title:'整理书签的使用方法和教程已经发布',published_at:iso(0),
    summary:'这个软件可以整理书签与文件，我已经在主页准备了教程和配置方法，需要的朋友可以去看看。'});
  const selected=select([weak,steps,command]);
  assert.deepEqual(ids(selected),['command','ordinary']);
  assert.doesNotMatch(steps.title+steps.summary,/AI|人工智能|npx|npm|pip/i);
  assert.equal(selected.items[0].item,command);
  assert.match(selected.items[0].basis,/未核对原帖.*未实测/);
  assert.equal(selected.items[0].reason,'摘录提供了可复制的命令；具体效果尚未实测。');
  assert.equal(selected.items[1].reason,'摘录提供了具体的软件操作步骤；具体效果尚未实测。');
});

test('a complete inline example is reusable while paid and revenue words alone never remove practical steps',()=>{
  const prompt=row('prompt',{link_kind:'post',title:'制作人物图片的完整提示词',
    summary:'这套提示词可以生成人物图片，用于制作内容封面。完整提示词：\n成年人物站在窗边，窗外的柔和自然光照亮脸部，人物面向镜头，手中拿着一本打开的书。保留头发、衣服和书本的细节，背景是安静的书房，使用浅景深，画面上方为标题留出清楚的空白，下方保留完整的双手与书本。'});
  const paid=row('paid',{link_kind:'post',title:'用付费工具制作营销视频的操作步骤',
    summary:'这套工作流程可以整理文件并制作视频。具体步骤：打开剪辑软件，导入视频并配置字幕，最后导出文件。该付费工具用于经营复盘与营销制作，月收入2000元是过去项目收入，并非收益承诺。'});
  const recap=row('recap',{link_kind:'post',title:'月收入2000元的经营复盘',
    summary:'这次推广带来更多订单。我观察到营销视频可以帮团队整理文件，工具费用和获客成本需要一起核算，但这里没有软件操作步骤。'});
  const result=select([prompt,paid,recap]);
  assert.deepEqual(new Set(ids(result)),new Set(['prompt','paid']));
  assert.equal(result.items.find(entry=>entry.item.id==='prompt').reason,'摘录提供了可复制的完整提示词；具体效果尚未实测。');
});

test('repository picks require an existing Chinese purpose instead of generated titles or mostly English descriptions',()=>{
  const english=repo('english-purpose',{title:'文件整理工具 · sample', repository_guide:null,
    summary:'Local-first media manager that auto-catalogs files as you open them. Built with Electron + Vue 3.'});
  const chineseTag={...english,id:'chinese-tag',summary:english.summary+' 日常效率工具，使用方法。'};
  const mixedSentence={...english,id:'tiny-suffix',summary:'Local-first media manager that auto-catalogs files as you open them and supports private tagging, sharing, synchronization and backups, 可以整理文件资料。'};
  const before=JSON.stringify([english,chineseTag,mixedSentence]);freeze(english);freeze(chineseTag);freeze(mixedSentence);
  assert.deepEqual(select([english,chineseTag,mixedSentence],[source('github')]).items,[]);
  assert.equal(JSON.stringify([english,chineseTag,mixedSentence]),before);
  assert.equal(select([repo('existing-guide')],[source('github')]).items.length,1);
});

test('the real bilingual AI-Cubby description features only its supplied Chinese purpose, and altstack keeps its existing Chinese guide',()=>{
  const cubby=repo('cubby',{title:'AI 工作助手 · AI-Cubby', repository_name:'miragecoa/AI-Cubby', original_url:'https://github.com/miragecoa/AI-Cubby', repository_guide:null,
    summary:'Local-first media manager that auto-catalogs files as you open them. AI-powered tagging for images, games & apps. Built with Electron + Vue 3. 本地优先的 AI小抽屉 (AI资源管家) — 自动记录你打开过的文件，AI 智能打标签，告别手动整理。'});
  const altstack=repo('altstack',{title:'日常效率工具 · altstack-data', repository_name:'altstackHQ/altstack-data', original_url:'https://github.com/altstackHQ/altstack-data',
    summary:'A curated list of 450+ awesome open-source alternatives to proprietary SaaS. Deployment configs, self-hosting guides, and tool directory.',
    repository_guide:{summary:'查找450多个商业在线软件的开源替代品，并获取部署配置、自行搭建指南和工具目录。',basis:'description',verification:'not_tested',source_url:'https://github.com/altstackHQ/altstack-data',recorded_at:iso(4)}});
  freeze(cubby);freeze(altstack);
  const result=select([cubby,altstack],[source('github')]);
  assert.deepEqual(new Set(ids(result)),new Set(['cubby','altstack']));
  const entry=result.items.find(entry=>entry.item.id==='cubby');
  assert.match(entry.purpose,/自动记录你打开过的文件/);
  assert.doesNotMatch(entry.purpose+entry.title,/Local-first|AI-powered|Built with|Electron|Vue/);
  assert.ok(cubby.summary.includes(entry.purpose));
  assert.equal(entry.item,cubby);
  assert.match(result.items.find(entry=>entry.item.id==='altstack').purpose,/查找450多个/);
});
