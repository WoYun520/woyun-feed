import test from 'node:test';
import assert from 'node:assert/strict';
import { postQuality } from './src/postQuality.js';

const post = (summary, patch={}) => ({id:'news-test',title:summary.split('\n')[0],summary,
  source_refs:['sopilot-ai'],link_kind:'post',content_status:'excerpt_only',...patch});
const useful = '给网页截图加箭头的具体步骤\n1. 打开截图工具，选择需要的区域并保存为 PNG 文件。\n2. 点击箭头按钮标清界面操作位置，最后导出图片保存到文件夹。';
const folded = (summary, code) => {const result=postQuality(post(summary));assert.equal(result.fold,true,summary);assert.equal(result.code,code);assert.match(result.reason,/规则提示，可能误筛/);};
const kept = summary => assert.deepEqual(postQuality(post(summary)),{fold:false,reason:'',code:''},summary);

test('only public post scope is eligible; unknown and manually saved materials stay open',()=>{
  for (const item of [null,undefined,7,'抽奖',[],{},post('抽奖送周边',{origin:'user_added'}),post('抽奖送周边',{origin:'manual'}),
    post('抽奖送周边',{id:'manual-123'}),post('抽奖送周边',{content_status:'user_link'}),
    post('抽奖送周边',{source_refs:['news-site'],link_kind:'article'})]) assert.equal(postQuality(item).fold,false);
  assert.equal(postQuality(post('转发抽周边',{source_refs:[],link_kind:'post'})).fold,true);
  assert.equal(postQuality(post('转发抽周边',{link_kind:undefined})).fold,true);
});

test('clear raffle and participation prizes fold, including across lines and full-width text',()=>{
  for (const summary of ['国庆节准备了11份币安周边抽给大家！！','关注转发，抽奖送三个周边！',
    '评论抽取3位送礼品。','转发抽周边\n详情在评论区','关注直播，现场+直播总计1000 USDT福利',
    '关\u200b注转发，抽奖送３个周边']) folded(summary,'raffle');
  folded(useful+'\n转发抽周边，感谢大家支持。','raffle');
});

test('signup and deposit rewards fold even when presented as numbered instructions',()=>{
  for (const summary of ['注册入金即可领100 USDT奖励！','新用户开户，送20元红包。','领取100 USDT，需要先入金200 U。',
    '注册后\n充值100元\n领取返现奖励。',useful+'\n注册交易所入金后领100 USDT。']) folded(summary,'deposit_reward');
});

test('referral invitations fold but a term in a factual account does not',()=>{
  folded('使用我的邀请码 abc123 注册，享受手续费返佣。','referral');
  folded('专属返佣链接：https://example.com/refer','referral');
  kept('介绍交易所返佣制度，说明如何计算费用，以及返佣可能带来的利益冲突。');
  kept('我的邀请码已经过期，正在检查账号设置。');
  kept('研究获客渠道：邀请码、抽奖、返佣各有哪些成本？这是经营复盘，不承诺收益。');
});

test('keyword or private-group materials without inline value fold',()=>{
  for (const summary of ['评论“工具”，进群领取插件下载地址。','回复关键词 AI，我发你完整教程。',
    '私信我领取资料包和课程链接。','想要安装包请扫码进群，群文件直接下载。',
    '留言666，领取提示词模板。']) folded(summary,'gated_resource');
  kept('安装地址见评论区，作者讨论了浏览器插件的兼容性。');
  kept('我的 Grok bot 定时管理私信，草拟回复后由我确认发送。感兴趣的话题可以给我发私信。');
});

test('inline steps and resources survive a small contact or referral footer',()=>{
  kept(useful+'\n私信我领取资料包。');
  kept(useful+'\n使用我的邀请码注册，有返佣链接。');
  kept('Skill 安装指令：\nnpx skills add example/screenshots\n私信我领取完整课程资料。');
  kept('这个开源工具可以整理字幕并导出 Markdown 文件。先下载软件并配置字幕输出目录，在测试视频上运行命令，核对输出文件，再处理长视频。说明和代码：https://github.com/example/subtitles\n回复“工具”领取更多模板。');
});

test('numbered sales benefits cannot masquerade as operational tutorial steps',()=>{
  folded('AI 代充网站开放代理。\n1、支持开发票\n2、已支付102笔订单，收入28030元。\n3、代理手册已经写好。\n99元起，有客户的朋友可以来聊聊。网站：https://example.com','sales_pitch');
  folded('报名课程，价格99元，剩余10个名额。','sales_pitch');
  kept('营销教程：\n1. 创建网站的课程介绍页，写清功能和退款条件。\n2. 配置软件支付回调，在测试账号核对订单和收入记录。\n学习如何把副业内容变现，商业工具需要付费。');
});

test('income figures, commercial tutorials and paid tool terms alone stay open',()=>{
  for (const summary of ['月入20000元，这是我经营网站的成本与收入复盘。','这个字幕工具付费，每月99元，需要先试用确认效果。',
    'AI漫剧这么赚钱吗？粉丝1411个，6月份收入93万元，真的假的？',
    '如何用 YouTube Partner 挣广告费：记录城市街景、剪辑视频、制作封面，并核对版权。',
    'Max订阅会员每月送100美元API额度，在Settings > Billing里领取，需订阅满7天。']) kept(summary);
  folded('保证收益，日赚1000！扫码进群跟我做。','income_pitch');
});

test('warnings and reports containing noisy phrases do not become invitations',()=>{
  for (const summary of ['警惕“注册入金送100 USDT”的骗局，不要注册。','不要参加转发抽周边，这是虚假广告。',
    '这类所谓“私信领取工具”的套路值得警惕。','不要使用我的邀请码；我正在检查返佣问题。',
    '抽奖的随机算法怎么设计？本文讨论概率。','不用私信或进群领取资料，已公开全部下载地址。']) kept(summary);
  folded('转发抽周边！\n注意风险。','raffle');
});

test('clear paid promotion needs an invitation, without hiding ordinary ad discussion',()=>{
  folded('【广告】点击购买付费插件，折扣码 SAVE。','promotion');
  kept('广告收入是网站收入的一部分，本文讨论营销和付费模式。');
  kept(useful+'\n【广告】点击购买额外模板。');
});

// Small verbatim excerpts from the read-only 2026-10-08 source audit. They are
// classification fixtures, not endorsements or independently verified claims.
test('real sales and event reward samples fold; real useful and ambiguous samples remain visible',()=>{
  const samples=[
    {original_url:'https://x.com/Zesee/status/2108124312821543006',text:'我、泊州 @bozhou_ai 和 乌云 @Pluvio9byte 的AI代充网站开放代理了，跟我们做有几个实在的好处。\n5、99 元起，可以先从初级开始\n如果你平时做 AI 内容、带社群，或者身边经常有人问怎么买 AI 会员，可以来聊聊。\n我的网站：https://t.co/S9E7TktN3U',code:'sales_pitch'},
    {original_url:'https://x.com/dashubtc/status/2108099034451984706',text:'今天看到WEEX TOKEN2049 Day 2的安排，很有感觉。\n🕓 16:00（UTC+8）线上直播\n🎁 现场+直播总计1000 USDT福利\n感兴趣的朋友可以去关注一下，看看这次WEEX准备了什么新玩法。',code:'raffle'},
  ];
  for(const sample of samples) assert.equal(postQuality(post(sample.text,{original_url:sample.original_url})).code,sample.code);
  kept('币安 VIP 我干了好几年，费率打折、返佣、专属客服、绿色通道，一堆东西全冲账户来的\n这回他们管的是人\n今天新加坡那场体检，量血压、抽血、看报告');
  kept('让豆包、Workbuddy、Claude Code、Deepseek Harness 都能调用 Codex 的内置生图能力！\nSkill 安装指令：\nnpx skills add joeseesun/qiaomu-codex-imagegen\n开源地址见评论区');
});

test('classification does not mutate or promote unknown fields into evidence',()=>{
  const item=post('转发抽周边。');Object.freeze(item.source_refs);Object.freeze(item);
  const before=JSON.stringify(item);assert.equal(postQuality(item).fold,true);assert.equal(JSON.stringify(item),before);
  assert.deepEqual(postQuality(post('',{title:{toString(){throw Error('must not execute');}},summary:null,isAd:true,quality:'spam'})),{fold:false,reason:'',code:''});
  const hostile={toString(){throw Error('must not execute');}};
  assert.equal(postQuality(post('',{id:hostile,origin:hostile,source_refs:[hostile]})).fold,false);
});
