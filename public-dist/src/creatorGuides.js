import { creatorMaterialKind } from './creatorCatalog.js';

// Companion reading notes, not feed evidence or a saved user snapshot. A new feed
// item never inherits an old note just because it mentions the same tool.
const READ_AT = '2026-10-03T11:33:54.000Z';
const readmeScope = 'AI 阅读作者 README 的文字；适合谁与起步安排是本站建议，未安装或实测，当前费用与兼容性未核验。';
const articleScope = 'AI 阅读作者文章文字，未查看图片或嵌入视频；适合谁与起步安排是本站建议，未实测，作者案例不代表当前入口或效果已验证。';
const unknownCost = '费用未知：说明没有给出完整现行价格；使用前请核对相关软件与服务的当前条件。';
const notes = {
  'news-06a53817383bd897e2e5a535': {
    purpose:'从视频选定的时刻取一张图片，留作封面或教程素材。',
    audience:'经常处理录屏、视频素材的创作者；需要终端操作，可请自己的编程助手协助。',
    requirements:'本机已安装 FFmpeg，以及一份能正常解码的视频。安装过程未在本例验证；不要上传私人视频。',
    first_step:'先备份视频，按原文第 4.8 节把时间改成需要的时刻，再运行单帧截图命令，打开图片核对。',
    cost:'该教程公开可读；本轮使用已安装工具，没有新购买服务。其他环境的安装与使用条件未知。',
    basis_label:'作者的视频处理教程',basis_url:'https://www.ruanyifeng.com/blog/2020/01/ffmpeg.html',
    read_at:'2026-10-03T12:22:25.000Z',scope:'AI 阅读作者教程文字，未查看配图。这里只提供阅读建议；单帧截图的实际观察另列，不代表全部功能实测或用户验收。',
    trial_url:'https://woyun-feed-preview.woyun520.workers.dev/trials/ffmpeg-frame-20261003/',
    trial_label:'查看本站截图实测（合成素材）'
  },
  'news-128757c3f0af1b20937db237': {
    purpose:'把文章提纲或笔记大纲变成能展开的思维导图。',
    audience:'想梳理文章结构、课程笔记或资料层级的读者与创作者。',
    requirements:'网页用法需要浏览器和 Markdown 标题、列表；本地生成网页需要 Node.js/npm。当前在线条件未实测。',
    first_step:'先写一个主标题、两个小标题和几个列表项，再按官方入门文档打开在线编辑器查看脑图。',
    cost:'项目采用 MIT 许可；当前在线服务条件、费用与输出效果未知，未安装或运行。',
    basis_label:'Markmap 官方入门说明',basis_url:'https://markmap.js.org/docs/markmap',
    read_at:'2026-10-03T12:22:25.000Z',scope:'AI 阅读作者关联项目的官方入门、CLI 与许可证文字；中文用途与起步安排为本站整理，未安装或实测。'
  },
  'news-cff8800ba5135ef006d6eace': {
    purpose:'用浏览器显示大字幕，或给阅读加上标尺与朗读。',
    audience:'想试试网页阅读辅助工具的人；不能据此判断医疗效果。',
    requirements:'浏览器；本机下载网页文件即可按说明打开。发布到网上另需 GitHub 账号。',
    first_step:'在项目说明里选一个小工具，再按该工具的说明打开网页；先用普通文字试用。',
    cost:unknownCost, basis_label:'作者的项目说明',basis_url:'https://github.com/AmberTreelet/accessible-tools',scope:readmeScope
  },
  'news-25cf5cd16d59ed603f2ce195': {
    purpose:'把网站的操作写成检查清单，让编程助手按步骤检查。',
    audience:'正在做网站、想减少改完后漏查页面问题的人；有开发门槛。',
    requirements:'能运行的网站项目、编程助手和浏览器检查工具；作者流程还涉及自动化测试。',
    first_step:'先写一条验收清单：打开哪个页面、点击哪里、应该看到什么。',
    cost:'助手与测试环境的费用未知；文章没有给出完整现行价格。',basis_label:'作者的网站检查流程',basis_url:'https://vikingz.me/ai-e2e/',scope:articleScope
  },
  'news-8f7cc04850f47fd93a8d1c86': {
    purpose:'先让编程助手找出代码改动中的问题，再由自己决定修哪些。',
    audience:'已有代码项目、想在提交改动前做检查的开发者。',
    requirements:'自己的代码项目与支持技能安装的编程助手；多助手互查需要另行准备。',
    first_step:'先选一组代码改动，参照作者说明让助手输出问题报告；看完再决定是否修复。',
    cost:'编程助手与多模型的费用未知；文章没有给出完整现行价格。',basis_label:'作者的代码检查方法',basis_url:'https://vikingz.me/ai-code-review/',scope:articleScope
  },
  'news-ef4d1a43da7ccf87ca54159d': {
    purpose:'让编程助手按调查、制作、笔记库检查的流程开发 Obsidian 插件。',
    audience:'想做 Obsidian 插件的人；这是开发方法，仍有代码与环境门槛。',
    requirements:'Node.js 长期支持版本、支持技能安装的编程助手，以及独立测试笔记库。它本身不是 Obsidian 插件。',
    first_step:'按 README 检查 Node.js 与助手条件，准备测试笔记库，再采用其中的安装方法。',
    cost:unknownCost,basis_label:'作者的开发技能说明',basis_url:'https://github.com/joeseesun/qiaomu-obsidian-dev',scope:readmeScope
  },
  'news-5f89da57b68d6b7bae42946e': {
    purpose:'在 Obsidian 读订阅文章，把选中的段落留进笔记。',
    audience:'已经用 Obsidian 阅读与整理资料的人。',
    requirements:'Obsidian 1.13.0 或以上、一个笔记库和网络；插件兼容性本轮未实测。',
    first_step:'按 README 安装对应版本的插件，打开订阅面板，用“+”添加一份订阅。',
    cost:unknownCost,basis_label:'作者的订阅插件说明',basis_url:'https://github.com/joeseesun/qiaomu-ai-rss',scope:readmeScope
  },
  'news-44636a05bae30e333191e387': {
    purpose:'写笔记时选台听直播电台，收藏喜欢的频道。',
    audience:'用 Obsidian 写作、想顺便听广播的人。',
    requirements:'Obsidian 和网络；不同电台可能受地区与服务状态影响。安装现成插件不要求编译环境。',
    first_step:'参照 README 安装插件，点击电台图标，选一个频道试听。',
    cost:unknownCost,basis_label:'作者的电台插件说明',basis_url:'https://github.com/joeseesun/qiaomu-radio',scope:readmeScope
  },
  'news-13176883bff4d50563ee3832': {
    purpose:'学作者把日文产品 PDF 整理成网站、演示稿或视频材料的流程。',
    audience:'外贸、产品介绍或内容制作中，经常要处理外语资料的人。',
    requirements:'作者使用豆包工作模式与产品 PDF；连接团队文档另需相应访问权限。不要上传私人原件。',
    first_step:'先用一份可公开的产品 PDF，参照作者案例提出要做的介绍网站；检查信息是否被读对。',
    cost:'费用与当前入口未知；作者的八月案例不证明现在可以免费使用。',basis_label:'作者的日文 PDF 案例',basis_url:'https://blog.qiaomu.ai/japanese-pdf-ai-workflow',scope:articleScope
  },
  'news-84cadc26250e34fe526a230b': {
    purpose:'学作者把电脑里的材料同步到扣子，再制作演示稿等内容。',
    audience:'常在电脑与云端之间搬资料、整理办公内容的人。',
    requirements:'作者使用扣子桌面端与本机材料；部分联网例子另需接口。当前同步入口未实测。',
    first_step:'建议先选一份可公开的文件，按文中方法同步，再让它整理成演示稿；先核对原内容。',
    cost:'当前费用未知；文章中的八月新用户赠送活动不能当成现在的免费条件。',basis_label:'作者的桌面同步案例',basis_url:'https://blog.qiaomu.ai/coze-desktop-cloud-sync',scope:articleScope
  },
  'news-9cd21abee5efc0e7b0831743': {
    purpose:'学作者把教材 PDF 做成互动课件，或把文档做成演示稿。',
    audience:'要备课、读教材，或整理办公演示内容的人。',
    requirements:'作者使用豆包桌面端工作模式与 PDF 或文档；较长任务可能涉及其云端电脑。当前条件未知。',
    first_step:'先挑一小份可公开的教材 PDF，参考案例要求做互动网页课件，再检查内容与按钮。',
    cost:'费用与当前入口未知；文章没有提供完整现行价格。',basis_label:'作者的工作模式案例',basis_url:'https://blog.qiaomu.ai/doubao-work-mode',scope:articleScope
  },
  'news-71d5ac7f03bba9fe41cff50b': {
    purpose:'了解用自然语言描述操作、再用检查条件验证的网页与手机测试方法。',
    audience:'正在开发网页或手机应用、想研究测试方法的人。',
    requirements:'具体安装环境、模型账号与版本未知；当前只取得第三方推文摘录。',
    first_step:'先到原帖确认项目链接，再读安装与测试说明；本卡片的摘录不足以直接开跑。',
    cost:'费用未知；摘录没有提供价格或模型使用条件。',basis_label:'X 原帖入口（本站只读到 SoPilot 摘录）',basis_url:'https://x.com/vikingmute/status/2106028732884656198',
    scope:'AI 整理已取得的 SoPilot 摘录，未读取完整 X 原帖或项目说明；适合谁与下一步是本站建议，未实测。'
  },
  'news-7ae81b8e40adc641e33c27e6': {
    purpose:'了解在 DeepSeek Harness 里看海外资讯、播客和工具介绍的插件。',
    audience:'已使用 DeepSeek Harness、想在其中阅读资讯的人。',
    requirements:'摘录提到 DeepSeek Harness；版本、下载地址和兼容性未知。不要与同名 Obsidian 插件混用。',
    first_step:'到原帖确认插件地址与适用平台，再阅读安装说明；暂不直接执行摘录里的安装要求。',
    cost:'费用未知；摘录没有提供完整使用条件。',basis_label:'X 原帖入口（本站只读到 SoPilot 摘录）',basis_url:'https://x.com/vista8/status/2105323962674856009',
    scope:'AI 整理已取得的 SoPilot 摘录，未读取完整 X 原帖或这个版本的插件说明；适合谁与下一步是本站建议，未实测。'
  },
  'news-803ef974cda715f9084efa05': {
    purpose:'让编程助手按作者整理的经验，开始制作 Obsidian 插件。',
    audience:'想制作与发布 Obsidian 插件的人；仍有开发门槛。',
    requirements:'另读的 README 要求 Node.js 长期支持版本、支持技能安装的助手和独立测试笔记库。',
    first_step:'先看项目 README 检查环境、准备测试笔记库，再采用其中的安装方法。',
    cost:unknownCost,basis_label:'另行阅读的项目 README',basis_url:'https://github.com/joeseesun/qiaomu-obsidian-dev',
    scope:'原推文仍仅为 SoPilot 摘录；本轮另读项目 README 文字补充条件。适合谁与起步安排是本站建议，未安装或实测。'
  }
};

const guards = {
  'news-13176883bff4d50563ee3832':['vista8','https://blog.qiaomu.ai/japanese-pdf-ai-workflow','creator-blog-vista8','282:39bd5ac9'],
  'news-84cadc26250e34fe526a230b':['vista8','https://blog.qiaomu.ai/coze-desktop-cloud-sync','creator-blog-vista8','199:6776bd59'],
  'news-9cd21abee5efc0e7b0831743':['vista8','https://blog.qiaomu.ai/doubao-work-mode','creator-blog-vista8','261:4e2762c8'],
  'news-71d5ac7f03bba9fe41cff50b':['vikingmute','https://x.com/vikingmute/status/2106028732884656198','sopilot-author-vikingmute','483:5f21435a'],
  'news-7ae81b8e40adc641e33c27e6':['vista8','https://x.com/vista8/status/2105323962674856009','sopilot-author-vista8','268:45c278e8'],
  'news-803ef974cda715f9084efa05':['vista8','https://x.com/vista8/status/2104939501508591710','sopilot-author-vista8','224:e8b4b11f']
};

function signature(item) {
  // Only a stale-note guard, not an authenticity or cryptographic check.
  const content=JSON.stringify([item.title,item.summary,item.link_kind,item.content_status,item.read_scope,item.blog_method_hint ?? null,item.excerpt_truncated===true]);
  let hash=2166136261;
  for (let i=0;i<content.length;i++) hash=Math.imul(hash^content.charCodeAt(i),16777619);
  return content.length+':'+(hash>>>0).toString(16);
}

export function creatorGuideFor(item) {
  if (!item || item.origin==='user_added' || !Object.hasOwn(notes,item.id)) return null;
  if (creatorMaterialKind(item)) {
    if (item.read_scope!==undefined) return null;
  } else {
    const guard=guards[item.id];
    if (!guard || item.author_handle!==guard[0] || item.original_url!==guard[1]
      || !Array.isArray(item.source_refs) || !item.source_refs.includes(guard[2]) || signature(item)!==guard[3]) return null;
  }
  // A caller may modify the returned note without changing shared notes or evidence.
  return {...notes[item.id],read_at:notes[item.id].read_at || READ_AT};
}

export function creatorGuideSearchText(guide) {
  return guide ? [guide.purpose,guide.audience,guide.requirements,guide.first_step,guide.cost].join(' ') : '';
}
