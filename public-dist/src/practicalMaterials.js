import { PRACTICAL_HISTORY } from './practicalHistory.js';
/**
 * Small, hand-selected public material supplement. These notes were written by
 * AI after reading official documentation; they are not product trials or user
 * acceptance. A fixed capture time records that reading, not a software release.
 * This module does not fetch anything or alter the scheduled public feed.
 */
const READ_AT = '2026-10-03T04:18:51.000Z';
const SOURCE_ID = 'practical-materials';

export const PRACTICAL_SOURCE = Object.freeze({
  id: SOURCE_ID,
  name: '实用工具与教程',
  home_url: 'https://woyun-feed-preview.woyun520.workers.dev/about.html#practical-materials',
  kind: 'curated',
  group: 'tech',
  ranked: false,
  link_kind: 'article',
  status: 'ok',
  last_success_at: null,
  last_attempt_at: null,
  message: 'AI 按官方说明整理，未实测；不随云端信息流自动更新。',
  reading_note: 'AI 于 2026-10-03 阅读官方说明并整理用途、开始方法、限制与费用范围；不是用户核验，没有安装试用，不自动抓取或更新。请到各条原链接查看最新条件。',
});

// Keep the classification outside the feed contract. Only a matching ID AND
// exact official URL and unchanged note gets a tool/tutorial label; keywords
// or an edited backup with the same identity do not prove provenance.
const CATALOG = [
  {
    id: 'news-1f11cc93b184f6c82eff7bcc', kind: 'tool',
    url: 'https://subtitleedit.github.io/subtitleedit/',
    title: 'Subtitle Edit：改字幕、调时间，解决字幕对不上声音',
    summary: [
      '用途：编辑字幕文字、调整显示时间、转换字幕格式；支持从声音生成字幕，结果仍要校对。',
      '开始：从官方文档进入下载页，选自己的系统版本；已有字幕可用“File → Open”打开，修改后“Save as”另存。',
      '限制：当前第 5 版支持 Windows、Mac、Linux，各系统有版本条件；Windows 最低为 Windows 10 22H2，Mac 最低为 macOS 12、官方建议 14 及以上。识别和翻译效果未经本站试用，选择在线服务会把相关内容发送给服务商。',
      '费用：官方称免费、开源；当前第 5 版仓库为 MIT 许可。可选在线识别、翻译服务的收费另看服务商，本站未核对。',
      '依据：AI 按官方第 5 版文档和仓库整理，未安装、未实测；旧版许可和安装要求可能不同。',
    ],
    links: ['https://subtitleedit.github.io/subtitleedit/', 'https://subtitleedit.github.io/subtitleedit/features/file.html', 'https://github.com/SubtitleEdit/subtitleedit'],
  },
  {
    id: 'news-ba5a769f9d6e8944582d7faf', kind: 'tool',
    url: 'https://chidiwilliams.github.io/buzz/docs/usage/file_import',
    title: 'Buzz：把录音和视频转成文字或字幕文件',
    summary: [
      '用途：把本机录音、视频转为文字，导出 TXT 文稿、SRT 或 VTT 字幕；可选择在自己的电脑上识别。',
      '开始：从官方 Installation 页选系统安装包；打开后点“File → Import Media File”，选文件、语言和本地模型，再点 Run；完成后打开结果并导出字幕。',
      '限制：本地识别需要下载模型并占用电脑资源，速度和准确度未经本站测试。默认翻译主要转为英文；中文等其他目标语言需另配 AI 翻译服务。当前 Mac 安装包要求 Apple 芯片，Intel Mac 最后支持版本为 1.4.5；Windows 安装包未签名，下载前核对官方出处。',
      '费用：开源版采用 MIT 许可；此次阅读的官方说明未列安装包单独价格，价格未知。若选择在线识别或 AI 翻译，可能另有服务费，未核对具体价格。',
      '依据：AI 按官方用法、安装说明和仓库整理，未安装、未实测；这里指开源桌面版，不代表其他同名产品。',
    ],
    links: ['https://chidiwilliams.github.io/buzz/docs/usage/file_import', 'https://chidiwilliams.github.io/buzz/docs/installation', 'https://chidiwilliams.github.io/buzz/docs', 'https://chidiwilliams.github.io/buzz/docs/usage/translations', 'https://github.com/chidiwilliams/buzz'],
  },
  {
    id: 'news-5d6e4b8563e953ef6bfcf1ac', kind: 'tutorial',
    url: 'https://support.google.com/youtube/answer/2734705?hl=zh-Hans',
    title: 'YouTube 字幕教程：下载自己视频的字幕，再修改',
    summary: [
      '用途：从 YouTube 工作室下载自己管理的视频已有字幕，拿到带时间的字幕文件后修改；适合把自己的视频整理成文稿材料。',
      '开始：登录 YouTube 工作室 → 字幕 → 选视频和语言 → 修改 → 选项 → 下载字幕；下载后可用文本编辑器修改，再按官方说明上传。',
      '限制：需要有该视频的管理权限，并且已有相应字幕轨。不是任意视频字幕下载器，也不是替别人视频自动生成字幕的办法。',
      '费用：这是 YouTube 官方功能教程；页面没有列出此功能的单独收费，费用未知。官方说明文档不是开源软件许可。',
      '依据：AI 按 YouTube 帮助页整理，未登录账号操作、未实际下载；字幕准确性需要自己检查。',
    ],
    links: ['https://support.google.com/youtube/answer/2734705?hl=zh-Hans'],
  },
  {
    id: 'news-cbcacee9d968e9b128b936c0', kind: 'tool',
    url: 'https://flameshot.org/',
    title: 'Flameshot：截图后直接画箭头、标步骤和遮挡隐私',
    summary: [
      '用途：框选截图后，直接加箭头、文字、序号、圈框或马赛克，再保存到电脑；适合给教程截图加指引。',
      '开始：打开官网 Download，选自己系统的安装包；启动后选 Take screenshot，拖出截图范围，标注后保存。',
      '限制：支持 Windows、Mac、Linux，但系统权限和桌面环境会影响使用；部分 Linux Wayland 支持仍属实验。上传到 Imgur 是可选功能，分享前先检查截图里有没有隐私。',
      '费用：官方称免费、开源；主代码采用 GPLv3 或后续版本（GPLv3+）许可，图标等附带素材许可另列。',
      '依据：AI 按官网、安装说明和官方仓库整理，未安装、未实测；不保证每台电脑都能直接使用。',
    ],
    links: ['https://flameshot.org/', 'https://flameshot.org/docs/overview/overview/', 'https://flameshot.org/docs/installation/installation-linux/', 'https://github.com/flameshot-org/flameshot'],
  },
  {
    id: 'news-47b588c6ab1206bc1fc07f93', kind: 'tool',
    url: 'https://getsharex.com/',
    title: 'ShareX（Windows）：截图标注，也能截长网页',
    summary: [
      '用途：截取屏幕区域、标箭头和步骤，也能用滚动截图把较长网页或文档拼成一张图。',
      '开始：从官网 Download 安装；普通截图点“Capture → Region”，拖选区域；长截图点“Capture → Scrolling capture”，先框住想要的内容。',
      '限制：ShareX 面向 Windows。长截图遇到固定侧栏、动画或鼠标悬停效果时可能拼接失败或错位；截后上传、保存等行为取决于设置，首次先检查 after-capture tasks。',
      '费用：官方称完全免费、开源，无广告；仓库主许可证为 GPL-3.0。自行连接的外部存储或上传服务费用另看服务商。',
      '依据：AI 按官网、区域截图和滚动截图文档整理，未安装、未实测；不保证长截图一次成功。',
    ],
    links: ['https://getsharex.com/', 'https://getsharex.com/docs/region-capture', 'https://getsharex.com/docs/scrolling-screenshot', 'https://github.com/ShareX/ShareX'],
  },
  {
    id: 'news-7bb3267fc3df79c39f516a6c', kind: 'tutorial',
    url: 'https://support.apple.com/zh-cn/102646',
    title: 'Mac 截图教程：不用装新软件，截区域或单个窗口',
    summary: [
      '用途：用 Mac 自带功能截全屏、局部区域或单个窗口；点截屏缩略图还能编辑，适合先做简单教程配图。',
      '开始：局部截图按 Shift + Command + 4，再拖选区域；单个窗口先按这三个键，再按空格并点窗口；Shift + Command + 5 可打开截屏工具和保存位置选项。',
      '限制：适用于 Mac；截屏 App 需要 macOS 10.14 或更新系统。某些受保护的 App 窗口可能无法截取；这页没有提供自动滚动长截图办法。',
      '费用：使用随 macOS 提供的截屏功能，无需另装截图 App；这是官方使用教程，不是开源工具。',
      '依据：AI 按 Apple 支持页整理，未操作你的电脑实测；不同系统版本的界面可能有差异。',
    ],
    links: ['https://support.apple.com/zh-cn/102646'],
  },
  {
    id: 'news-3849eb8d0c08dc0069b1edd1', kind: 'tool',
    url: 'https://learn.microsoft.com/zh-cn/windows/powertoys/powerrename',
    title: 'PowerRename（Windows）：整理文件，一次改一批文件名',
    summary: [
      '用途：整理文件时批量替换文件名的一部分；可先预览所有新名字，再确认修改，减少逐个重命名。',
      '开始：从 Microsoft 官方说明安装 PowerToys，并启用 PowerRename；在文件资源管理器中选文件，右键“使用 PowerRename 重命名”，填写要查找和替换的文字，核对预览后确认。',
      '限制：需要 Windows 11 或 Windows 10 2004 及以上的 64 位系统。它负责改名字，不会自动理解内容、分目录或删除重复文件；先在文件副本上试改。',
      '费用：PowerToys 为微软免费、开源工具集，主仓库采用 MIT 许可。',
      '依据：AI 按 Microsoft 官方功能、安装说明和仓库整理，未安装、未执行文件改名。',
    ],
    links: ['https://learn.microsoft.com/zh-cn/windows/powertoys/powerrename', 'https://learn.microsoft.com/zh-cn/windows/powertoys/install', 'https://learn.microsoft.com/en-us/windows/powertoys', 'https://github.com/microsoft/PowerToys'],
  },
  {
    id: 'news-5c12ca7f514fb89563f1c75e', kind: 'tool',
    url: 'https://localsend.org/',
    title: 'LocalSend：整理文件时，把手机和电脑里的材料互相传送',
    summary: [
      '用途：在同一局域网内，把手机、电脑上的文件传给另一台设备，帮助集中收集待整理的照片和材料；不需要先上传网盘。',
      '开始：两台设备都从官网下载对应版本，连到同一 Wi-Fi；双方打开 LocalSend，发送端选文件和接收设备，接收端确认。',
      '限制：适用于 Windows、Mac、Linux、Android、iPhone 和 iPad，旧系统先查看下载页要求。这里只解决文件传输，不会自动归档、改名或找重复文件。设备需要能在局域网互相连接；访客 Wi-Fi 隔离、防火墙、VPN 和本地网络权限可能让设备互相看不见。',
      '费用：官方称免费、开源；主仓库采用 Apache-2.0 许可。',
      '依据：AI 按官网和官方仓库整理，未安装、未实际传文件；传输速度和设备兼容情况未实测。',
    ],
    links: ['https://localsend.org/', 'https://localsend.org/download', 'https://github.com/localsend/localsend'],
  },
];

const KNOWN_DESCRIPTIONS = [...CATALOG.map(entry=>({...entry,summary:entry.summary.join('\n')})),...PRACTICAL_HISTORY];
export function practicalMaterialKind(item) {
  const entry=KNOWN_DESCRIPTIONS.find(entry=>entry.id===item?.id && item.original_url===entry.url && item.title===entry.title && item.summary===entry.summary);
  return entry?.kind || null;
}

function freezeItem(entry) {
  const evidence = `official-reading:${entry.id}:2026-10-03`;
  return Object.freeze({
    id: entry.id,
    title: entry.title,
    summary: entry.summary.join('\n'),
    summary_label: 'AI 按官方说明整理，未实测',
    source_refs: Object.freeze([SOURCE_ID]),
    original_url: entry.url,
    canonical_url: entry.url,
    published_at: null,
    updated_at: null,
    source_updated_at: null,
    captured_at: READ_AT,
    origin: 'curated',
    link_kind: 'article',
    content_status: 'metadata_only',
    verification_status: 'not_tested',
    unknowns: Object.freeze(['本站未安装或实际使用；用户未验收。软件兼容性、实际效果和最新收费条件需要另行核对。']),
    evidence_ref: evidence,
    evidence_refs: Object.freeze(entry.links.map((_,index) => `${evidence}:${index+1}`)),
    source_links: Object.freeze(entry.links.map((url,index) => Object.freeze({
      source_id: SOURCE_ID,
      url,
      evidence_ref: `${evidence}:${index+1}`,
      captured_at: READ_AT,
      source_updated_at: null,
      source_rank: null,
      heat_label: '',
    }))),
  });
}
export const PRACTICAL_ITEMS = Object.freeze(CATALOG.map(freezeItem));

function linkKey(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch { return null; }
}

/** Append safe public notes to real feeds without rewriting any old metadata. */
export function withPracticalMaterials(feed) {
  if (!feed || feed.mode !== 'live' || !Array.isArray(feed.items) || !Array.isArray(feed.sources)) return feed;
  const ids = new Set(feed.items.map(item => item.id));
  const urls = new Set(feed.items.flatMap(item => [linkKey(item.original_url), linkKey(item.canonical_url)]).filter(Boolean));
  const additions = PRACTICAL_ITEMS.filter(item => !ids.has(item.id) && !urls.has(linkKey(item.original_url)));
  const needsSource = !feed.sources.some(source => source.id === SOURCE_ID)
    && (additions.length || feed.items.some(item => practicalMaterialKind(item) && item.source_refs?.includes(SOURCE_ID)));
  if (!additions.length && !needsSource) return feed;
  return {
    ...feed,
    items: additions.length ? [...feed.items, ...structuredClone(additions)] : feed.items,
    sources: needsSource ? [...feed.sources, {...PRACTICAL_SOURCE}] : feed.sources,
  };
}
