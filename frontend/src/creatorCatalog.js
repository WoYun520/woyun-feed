/**
 * Small public author/material seed, selected after reading the linked sources.
 * These are reading notes, not trials, identity certification or endorsements.
 * Author selection and per-post selection are intentionally separate.
 */
const READ_AT = '2026-10-03T07:45:31.000Z';
const SOURCE_ID = 'creator-materials';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const CREATOR_CATALOG = deepFreeze([
  {
    id: 'creator-ambertreelet', handle: 'AmberTreelet', name: 'AmberTreelet',
    category: 'tool-practice', category_label: '工具实操',
    reason: '公开小工具有浏览器打开、网站部署和扩展加载步骤，适合作为能照着开始的项目材料。',
    profile_url: 'https://x.com/AmberTreelet',
    material_urls: ['https://github.com/AmberTreelet/accessible-tools'],
    enabled_by_default: true,
    reading_scope: '已阅读同名 GitHub 仓库 README 与文件列表；未安装或运行。X 与 GitHub 同名关联未独立认证。',
  },
  {
    id: 'creator-vikingmute', handle: 'vikingmute', name: 'Viking',
    category: 'personal-projects', category_label: '个人项目',
    reason: '博客用实际页面操作与审查文件举例，解释开发后怎样检查、取舍和验证。',
    profile_url: 'https://x.com/vikingmute',
    blog_urls: ['https://vikingz.me/'],
    material_urls: ['https://vikingz.me/ai-e2e/', 'https://vikingz.me/ai-code-review/'],
    enabled_by_default: true,
    reading_scope: '已阅读作者博客正文；账号关联来自作者自有页面，未独立认证身份，未复现流程。',
  },
  {
    id: 'creator-vista8', handle: 'vista8', name: '向阳乔木',
    category: 'workflow', category_label: '资料与工作流程',
    reason: '公开项目说明给出插件安装、订阅和摘录方法，也写明宿主验证及发布边界。',
    profile_url: 'https://x.com/vista8',
    blog_urls: ['https://blog.qiaomu.ai/'],
    material_urls: ['https://github.com/joeseesun/qiaomu-obsidian-dev', 'https://github.com/joeseesun/qiaomu-ai-rss', 'https://github.com/joeseesun/qiaomu-radio'],
    enabled_by_default: true,
    reading_scope: '已阅读作者仓库 README，README 自述关联 X 账号；未独立认证身份，未安装或实测。',
  },
  {
    id: 'creator-ruanyifeng', name: '阮一峰', profile_label: '作者博客',
    category: 'tool-practice', category_label: '视频素材与工具',
    reason: '作者入门教程包含视频截图、裁剪和转码的具体命令，可从一张视频截图开始。',
    profile_url: 'https://www.ruanyifeng.com/blog/',
    blog_urls: ['https://www.ruanyifeng.com/blog/'],
    material_urls: ['https://www.ruanyifeng.com/blog/2020/01/ffmpeg.html'],
    enabled_by_default: true,
    reading_scope: '已阅读作者博客教程文字；作者公布的 Atom 入口本轮请求返回 403，未接通自动订阅。截图实测另有记录，不代表全部命令通过。',
  },
  {
    id: 'creator-gera2ld', name: 'Gerald（gera2ld）', profile_label: 'GitHub 主页',
    category: 'workflow', category_label: '文字大纲与脑图',
    reason: '个人主页关联 Markmap 项目，官方文档给出文字大纲转换交互脑图的步骤，适合整理笔记与文章结构。',
    profile_url: 'https://github.com/gera2ld',
    blog_urls: ['https://gera2ld.space/'],
    material_urls: ['https://markmap.js.org/docs/markmap', 'https://markmap.js.org/docs/packages--markmap-cli'],
    enabled_by_default: true,
    reading_scope: '已阅读个人主页、自有站关联与 Markmap 官方说明；未核验现实身份，未确认自动订阅入口，未运行 Markmap。',
  },
  {
    id: 'creator-esorhuang', name: 'Esor Huang · 电脑玩物', profile_label: '作者博客',
    category: 'workflow', category_label: '笔记与日常工具',
    reason: '个人作者分享笔记、任务整理与工具的具体操作，可从公开订阅找到没有上热榜的教程。',
    profile_url: 'https://www.playpcesor.com/', blog_urls: ['https://www.playpcesor.com/'],
    blog_source_ids: ['creator-blog-esorhuang'],
    material_urls: ['https://www.playpcesor.com/2026/09/chatgpt-memory-management-7-tips.html'],
    enabled_by_default: true,
    reading_scope: '主页声明个人作者并给出公开订阅；本轮实际读取订阅，按其文字线索初筛，不等于全文阅读、身份认证或实测。',
  },
  {
    id: 'creator-raymondhouch', name: '侯智薰 · 雷蒙', profile_label: '作者博客',
    category: 'workflow', category_label: '创作与工作流程',
    reason: '公开作者订阅中有封面制作与数字工作流程，先挑能看到操作线索的文章。',
    profile_url: 'https://raymondhouch.com/', blog_urls: ['https://raymondhouch.com/'],
    blog_source_ids: ['creator-blog-raymondhouch'],
    material_urls: ['https://raymondhouch.com/lifehacker/digital-workflow/codex-youtube-thumbnail-workflow/'],
    enabled_by_default: true,
    reading_scope: '主页给出官方订阅，订阅作者名为侯智薰（雷蒙）；本轮只将订阅摘录作为候选来源，未实测或认证现实身份。',
  },
  {
    id: 'creator-fqzlr', name: '番茄主理人 · Fqzlr', profile_label: '作者博客',
    category: 'personal-projects', category_label: '博客与个人工具',
    reason: '个人博客有从准备到部署的制作步骤；订阅中的锁定与测试文章先排除。',
    profile_url: 'https://blog.fqzlr.top/', blog_urls: ['https://blog.fqzlr.top/'],
    blog_source_ids: ['creator-blog-fqzlr'],
    material_urls: ['https://blog.fqzlr.top/posts/tech/firefly-ai-blog-setup/'],
    enabled_by_default: true,
    reading_scope: '新站订阅页公开提供 RSS，旧站声明迁移；本轮读取公开标题与摘要，不认证身份、不保存锁定文章或实测软件。',
  },
  {
    id: 'creator-abskoop', handle: 'abskoop', name: '@abskoop',
    category: 'tool-practice', category_label: '工具实操',
    reason: '已找到公开作者榜单入口，先作为候选；仍需逐篇核对操作材料，不能因上榜就视为教程。',
    profile_url: 'https://x.com/abskoop',
    material_urls: ['https://sopilot.net/zh/rank/creators/abskoop'],
    enabled_by_default: false,
    reading_scope: '网页读取曾返回 502，随后只读取得 6 条榜单摘录；来源仅提供近 7 日按曝光排序的前 10 条，不是完整时间线，尚未逐篇核对完整教程。',
  },
  {
    id: 'creator-imwsl90', handle: 'imwsl90', name: '@imwsl90',
    category: 'workflow', category_label: '资料与工作流程',
    reason: '已找到公开作者榜单入口，先作为候选；材料质量及具体赛道仍待核对。',
    profile_url: 'https://x.com/imwsl90',
    material_urls: ['https://sopilot.net/zh/rank/creators/imwsl90'],
    enabled_by_default: false,
    reading_scope: '网页读取曾返回 502，随后只读取得 5 条榜单摘录；来源仅提供近 7 日按曝光排序的前 10 条，不是完整时间线，尚未逐篇核对完整教程。',
  },
  {
    id: 'creator-saccc_c', handle: 'Saccc_c', name: '@Saccc_c',
    category: 'workflow', category_label: '资料与工作流程',
    reason: '用户曾提供工作流演示线索；先保留候选，完整操作材料尚未核对。',
    profile_url: 'https://x.com/Saccc_c',
    material_urls: ['https://x.com/Saccc_c/status/2103320579256565848'],
    enabled_by_default: false,
    reading_scope: '用户提供的公开链接线索；未读取完整演示过程，不作为已核对教程推荐。',
  },
  {
    id: 'creator-xiaohuiai666', handle: 'XiaohuiAI666', name: '@XiaohuiAI666',
    category: 'tool-practice', category_label: '工具实操',
    reason: '用户曾提供教程帖子线索；先保留候选，尚未取得完整正文来评估。',
    profile_url: 'https://x.com/XiaohuiAI666',
    material_urls: ['https://x.com/XiaohuiAI666/status/2099856276046180473'],
    enabled_by_default: false,
    reading_scope: '用户提供的公开链接线索；未读到完整原帖，不作为已核对教程推荐。',
  },
  {
    id: 'creator-goan999999', handle: 'goan999999', name: '@goan999999',
    category: 'tool-practice', category_label: '工具实操',
    reason: '用户曾提供教程帖子线索；先保留候选，尚未取得完整正文来评估。',
    profile_url: 'https://x.com/goan999999',
    material_urls: ['https://x.com/goan999999/status/2100550749776413040'],
    enabled_by_default: false,
    reading_scope: '用户提供的公开链接线索；未读到完整原帖，不作为已核对教程推荐。',
  },
]);

export const CREATOR_MATERIAL_SOURCE = deepFreeze({
  id: SOURCE_ID,
  name: '博主实用材料',
  home_url: 'https://woyun-feed-preview.woyun520.workers.dev/',
  kind: 'curated', group: 'posts', ranked: false, link_kind: 'article',
  status: 'ok', last_success_at: null, last_attempt_at: null,
  message: '按作者公开说明整理，未实测；固定材料不会冒充自动抓取的新推文。',
  reading_note: 'AI 于 2026-10-03 阅读作者公开博客与项目说明，整理用途、开始方法和边界；未安装或运行，不代表用户核验，不是完整 X 时间线。',
});

const MATERIAL_NOTES = [
  {
    id: 'news-cff8800ba5135ef006d6eace', creator_id: 'creator-ambertreelet',
    url: 'https://github.com/AmberTreelet/accessible-tools', kind: 'tool',
    title: '浏览器小工具：下载后打开，也能放到自己的网页',
    summary: [
      '用途：了解怎样打开一组网页工具，或把它部署成能分享的网页。',
      '开始：下载仓库后打开 index.html；想分享网址可 Fork 后在 Settings → Pages 选择 main 和根目录；阅读扩展按说明加载 reading-aid-extension 文件夹。',
      '适合：想试着使用或部署简单网页工具的人；需要浏览器，部署需要 GitHub 账号。',
      '限制与费用：README 声称采用 MIT 许可；离线、语音隐私及阅读辅助效果未核验，不能作为医疗效果证明。浏览器兼容性及部署费用未核对。',
      '依据：本站阅读作者 README 与文件列表，未下载、安装或实测。',
    ],
    links: ['https://github.com/AmberTreelet/accessible-tools'],
  },
  {
    id: 'news-25cf5cd16d59ed603f2ce195', creator_id: 'creator-vikingmute',
    url: 'https://vikingz.me/ai-e2e/', kind: 'method',
    title: '网站改完怎么检查：把“点哪里、应看到什么”写成清单',
    summary: [
      '用途：学习怎样把新功能的验收写成具体操作，减少改好一处又弄坏另一处。',
      '开始：先写操作与预期；完成开发后在浏览器走一遍，再编写自动检查；正文用修改个人资料、保存后核对姓名举例。',
      '适合：已经在做网站、希望规范检查流程的开发者；正文含代码和浏览器测试工具。',
      '限制与费用：这是作者在自己多框架项目里的方法，不证明任何项目照搬就有效；本地开发与模型服务条件、费用需另查。',
      '依据：本站阅读作者博客正文，未运行示例或复现其检查结果。',
    ],
    links: ['https://vikingz.me/ai-e2e/'],
  },
  {
    id: 'news-8f7cc04850f47fd93a8d1c86', creator_id: 'creator-vikingmute',
    url: 'https://vikingz.me/ai-code-review/', kind: 'method',
    title: '让多个助手检查代码，人来决定哪些问题值得修',
    summary: [
      '用途：处理改动较多、一个人看不完的代码；把不同助手的审查意见集中成待办。',
      '开始：分别生成报告 → 汇总清单 → 自己选要修的问题 → 修复并跑检查 → 交给另一位助手复核；正文有命令与文件结构示例。',
      '适合：已有项目和编程助手的人；要能判断问题是否真会发生以及修改代价。',
      '限制与费用：助手意见一致也不等于问题已证明；小修改不必照搬多轮审查。模型或订阅费用取决于实际服务，本站未核对。',
      '依据：本站阅读作者中文博客正文，未安装相关方法包或复现流程。',
    ],
    links: ['https://vikingz.me/ai-code-review/'],
  },
  {
    id: 'news-ef4d1a43da7ccf87ca54159d', creator_id: 'creator-vista8',
    url: 'https://github.com/joeseesun/qiaomu-obsidian-dev', kind: 'method',
    title: '做 Obsidian 插件：先查已有方案，再到测试笔记库验证',
    summary: [
      '用途：给编程助手一套插件开发方法，先比较已有项目，再制作和检查。',
      '开始：准备 Node.js 和支持 Skills 的助手；按 README 安装 qiaomu-obsidian-dev，要求先查官方资料和相近插件，再给方案；开发后用独立测试笔记库检查。',
      '适合：已有 Obsidian 和开发环境、想制作插件的人；这是助手方法包，不是直接装进 Obsidian 的插件。',
      '限制与费用：构建成功不代表真机可用或社区审核通过；移动端、联网服务和收费仍需单独核对。',
      '依据：本站阅读作者 README 的安装、验证与发布说明，未安装或执行脚本。',
    ],
    links: ['https://github.com/joeseesun/qiaomu-obsidian-dev'],
  },
  {
    id: 'news-5f89da57b68d6b7bae42946e', creator_id: 'creator-vista8',
    url: 'https://github.com/joeseesun/qiaomu-ai-rss', kind: 'tool',
    title: '把订阅文章放进 Obsidian，读完摘录到自己的笔记',
    summary: [
      '用途：在笔记软件里阅读订阅文章，收藏链接和摘录，不必来回切换工具。',
      '开始：按 README 安装插件；手动安装需要同版 main.js、manifest.json、styles.css；启用后点 RSS 图标，用 + 添加订阅地址，选中文字摘录。',
      '适合：使用 Obsidian 1.13.0 或更新版本、已有笔记库的人。',
      '限制与费用：个人订阅默认读原文，有些源只有摘要；中文改写缺失时不会自动生成。外部来源、在线服务和商业授权条件需核对。',
      '依据：本站阅读作者 README 的安装、订阅与摘录说明，未安装、联网刷新或实际保存笔记。',
    ],
    links: ['https://github.com/joeseesun/qiaomu-ai-rss'],
  },
  {
    id: 'news-44636a05bae30e333191e387', creator_id: 'creator-vista8',
    url: 'https://github.com/joeseesun/qiaomu-radio', kind: 'tool',
    title: '写作时听电台：在 Obsidian 里选台、播放和收藏',
    summary: [
      '用途：给阅读和写作添加电台声音；按名称搜索，或从场景频道选台。',
      '开始：按 README 从第三方插件入口安装 Qiaomu Radio；无法找到时可查看同版发布文件的手动安装说明；启用后点电台图标，选台并播放，点心形收藏。',
      '适合：已有 Obsidian、希望在笔记软件里听电台的人。',
      '限制与费用：需要联网，广播源可能下线或限制地区；作者的桌面检查不是本站实测，移动端和收费条件未核对。源码许可为 GPL v3 或后续版本。',
      '依据：本站阅读作者 README 的安装与使用说明，未安装、播放或核对社区目录状态。',
    ],
    links: ['https://github.com/joeseesun/qiaomu-radio'],
  },
  {
    id: 'news-06a53817383bd897e2e5a535', creator_id: 'creator-ruanyifeng',
    url: 'https://www.ruanyifeng.com/blog/2020/01/ffmpeg.html', kind: 'tool',
    title: '从视频取一张图片：FFmpeg 入门操作教程',
    read_at: '2026-10-03T12:22:25.000Z', published_at: '2020-01-14T04:59:12.000Z',
    summary: [
      '用途：学习从视频指定时刻取一张图片；原文另介绍转码、裁剪和提取音频。',
      '开始：准备 FFmpeg 与输入视频，按原文第 4.8 节设置时间，执行单帧截图命令，打开输出图片核对。',
      '适合：经常处理录屏或视频素材的人；需要能运行终端命令，也可请自己的编程助手协助。',
      '限制与费用：文章公开可读，视频格式、编码与安装环境仍需逐项核对；本记录仅阅读说明，实际试跑见本站独立记录。',
      '依据：阅读作者 2020 年教程文字，未读取配图；未复现全部命令，也不代表用户验收。',
    ],
    links: ['https://www.ruanyifeng.com/blog/2020/01/ffmpeg.html'],
  },
  {
    id: 'news-128757c3f0af1b20937db237', creator_id: 'creator-gera2ld',
    url: 'https://markmap.js.org/docs/markmap', kind: 'tool',
    title: '把文章提纲或笔记变成能展开的思维导图',
    read_at: '2026-10-03T12:22:25.000Z',
    summary: [
      '用途：把文字大纲的标题、列表层级变成可展开的树形脑图，便于梳理文章或笔记。',
      '开始：先写一份有标题与列表的 Markdown，按官方入门文档进入在线编辑器；本地生成网页另见 CLI 文档。',
      '适合：需要理清材料结构的读者与创作者；网页用法需要浏览器，本地 CLI 需要 Node.js/npm。',
      '限制与费用：项目采用 MIT 许可，当前在线服务条件与费用未实测；npx 会下载并运行包，不等于不用安装。',
      '依据：阅读 Markmap 官方入门、CLI 与许可证说明；未安装、运行或核验实际输出。',
    ],
    links: ['https://markmap.js.org/docs/markmap', 'https://markmap.js.org/docs/packages--markmap-cli', 'https://github.com/markmap/markmap/blob/master/LICENSE'],
  },
];

function normalizeMaterial(entry) {
  const creator = CREATOR_CATALOG.find(author => author.id === entry.creator_id);
  const readAt = entry.read_at || READ_AT;
  const evidence = `author-reading:${entry.id}:2026-10-03`;
  return deepFreeze({
    id: entry.id, title: entry.title, summary: entry.summary.join('\n'),
    summary_label: 'AI 按作者说明整理，未实测',
    source_refs: [SOURCE_ID], original_url: entry.url, canonical_url: entry.url,
    published_at: entry.published_at || null, updated_at: null, source_updated_at: null,
    captured_at: readAt, checked_at: readAt, origin: 'curated',
    link_kind: entry.url.startsWith('https://github.com/') ? 'repository' : 'article',
    content_status: 'metadata_only', verification_status: 'not_tested',
    creator_id: creator.id, ...(creator.handle ? {author_handle: creator.handle} : {}), author_name: creator.name,
    material_kind: entry.kind, evidence_scope: 'author_document_reading',
    recommendation_reason: '有可读原始说明及具体开始步骤；按材料实用性收录，不以热度或 AI 关键词为门槛。',
    unknowns: ['本站只阅读作者公开说明，未安装、运行或接受用户验收；兼容性、效果及最新服务条件未核对。'],
    evidence_ref: evidence,
    evidence_refs: entry.links.map((_, index) => `${evidence}:${index + 1}`),
    source_links: entry.links.map((url, index) => ({
      source_id: SOURCE_ID, url, evidence_ref: `${evidence}:${index + 1}`,
      captured_at: readAt, source_updated_at: null, source_rank: null, heat_label: '',
    })),
  });
}

export const CREATOR_MATERIALS = deepFreeze(MATERIAL_NOTES.map(normalizeMaterial));

/** A familiar name or keywords alone do not establish a curated reading note. */
export function creatorMaterialKind(item) {
  const known = CREATOR_MATERIALS.find(entry => entry.id === item?.id
    && entry.original_url === item.original_url && entry.title === item.title
    && entry.summary === item.summary && entry.creator_id === item.creator_id
    && entry.author_handle === item.author_handle && entry.author_name === item.author_name
    && entry.published_at === item.published_at
    && entry.summary_label === item.summary_label && entry.checked_at === item.checked_at
    && entry.captured_at === item.captured_at && entry.canonical_url === item.canonical_url
    && entry.material_kind === item.material_kind && entry.evidence_scope === item.evidence_scope
    && entry.verification_status === item.verification_status && entry.content_status === item.content_status
    && entry.evidence_ref === item.evidence_ref
    && JSON.stringify(entry.source_refs) === JSON.stringify(item.source_refs)
    && JSON.stringify(entry.evidence_refs) === JSON.stringify(item.evidence_refs)
    && JSON.stringify(entry.source_links) === JSON.stringify(item.source_links)
    && JSON.stringify(entry.unknowns) === JSON.stringify(item.unknowns));
  return known?.material_kind || null;
}

function publicLinkKey(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch { return null; }
}

/** Add read notes to live feeds without replacing existing items or timestamps. */
export function withCreatorMaterials(feed) {
  if (!feed || feed.mode !== 'live' || !Array.isArray(feed.items) || !Array.isArray(feed.sources)) return feed;
  const ids = new Set(feed.items.map(item => item.id));
  const urls = new Set(feed.items.flatMap(item => [publicLinkKey(item.original_url), publicLinkKey(item.canonical_url)]).filter(Boolean));
  const additions = CREATOR_MATERIALS.filter(item => !ids.has(item.id) && !urls.has(publicLinkKey(item.original_url)));
  const needsSource = !feed.sources.some(source => source.id === SOURCE_ID)
    && (additions.length || feed.items.some(item => creatorMaterialKind(item) && item.source_refs?.includes(SOURCE_ID)));
  if (!additions.length && !needsSource) return feed;
  return {
    ...feed,
    items: additions.length ? [...feed.items, ...structuredClone(additions)] : feed.items,
    sources: needsSource ? [...feed.sources, {...CREATOR_MATERIAL_SOURCE}] : feed.sources,
  };
}
