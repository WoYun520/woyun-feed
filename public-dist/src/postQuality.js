// Reversible presentation hints for existing public posts. No requests, AI calls,
// source changes, or claims that an author is a spammer. Uncertain cases stay open.
const keep = () => ({fold:false, reason:'', code:''});
const hint = (code, reason) => ({fold:true, reason:`${reason} · 规则提示，可能误筛`, code});
const text = value => typeof value === 'string' ? value.slice(0,16000).normalize('NFKC')
  .replace(/[\u200b-\u200f\u2060\ufeff]/g,'').replace(/\r\n?/g,'\n') : '';
const warning = /不要|请勿|切勿|别信|警惕|小心|拒绝|骗局|诈骗|虚假|(?:无需|不必|不用|不需要).{0,10}(?:私信|加我|进群|注册|充值|返佣|邀请码)|\b(?:avoid|scam|do not|don't)\b/i;
const action = /打开|点击|复制|粘贴|安装|配置|创建|选择|输入|运行|导出|保存|修改|录制|上传|下载|设置|编写|绑定|执行|连接|(?:^|\s)(?:open|click|install|configure|run|export)\b/i;
const object = /软件|插件|工具|文件|目录|网页|视频|字幕|图片|账号|模型|提示词|命令|终端|代码|快捷键|笔记|录屏|参数|API|MCP|GitHub|Obsidian|Docker|npm|pip|npx|settings/i;

function substantive(summary) {
  // Numbered benefits or revenue claims are not operational steps. A concrete
  // command, two useful steps, or an inline resource with an operation suffices.
  if (/(?:^|\n)\s*(?:npx\s+[\w@/-]+|npm\s+(?:install|run)\s+\S+|pip\s+install\s+\S+|git\s+clone\s+\S+|docker\s+(?:run|compose)\s+\S+)/i.test(summary)) return true;
  const steps = summary.split('\n').filter(line => /^\s*(?:[1-9][.、)）:\s]|[①②③④⑤⑥⑦⑧⑨]|第[一二三四五六七八九十\d]+步)/.test(line)
    && line.trim().length >= 14 && action.test(line) && object.test(line));
  if (steps.length >= 2) return true;
  // A short URL alone does not prove useful content. Require a named operation
  // alongside a resource that readers can already use without contacting anyone.
  return /https?:\/\/(?:github\.com|raw\.githubusercontent\.com|[^\s/]+\/(?:docs|guide|tutorial|download|releases|examples))(?:[\s/]|$)/i.test(summary)
    && action.test(summary) && object.test(summary) && summary.length >= 90;
}

export function postQuality(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)
    || /^(?:user[_-]|manual)/.test(typeof item.origin === 'string' ? item.origin : '')
    || /^manual-/.test(typeof item.id === 'string' ? item.id : '')
    || item.content_status === 'user_link') return keep();
  const refs = Array.isArray(item.source_refs) ? item.source_refs : [];
  if (item.link_kind !== 'post' && !refs.some(id => typeof id === 'string' && id.startsWith('sopilot-'))) return keep();
  const summary = text(item.summary), title = text(item.title);
  // Ignore individual warning/reporting clauses, without allowing a generic
  // "注意风险" footer to neutralize a real prize or deposit invitation.
  const clauses = `${title}\n${summary}`.split(/[。！？!?\n]+/).map(value => value.trim()).filter(Boolean);
  const affirmative = clauses.filter(value => !warning.test(value)).join('\n');
  if (!affirmative) return keep();

  const raffle = /转发抽|关注抽|抽给|抽送|抽(?:出|取)\s*\d+\s*(?:位|名)|抽奖.{0,18}(?:送|奖品|福利)|(?:准备|拿出).{0,18}(?:周边|礼品|\d+份).{0,18}抽/i;
  const participation = /关注|转发|评论|回复|点赞|参与活动|注册|到场|观看直播|现场.{0,8}直播/i;
  const prize = /(?:送|抽).{0,15}(?:周边|礼品|红包|奖金|奖品)|(?:\d+(?:\.\d+)?\s*(?:USDT|美元|元|U)\s*(?:福利|奖励|红包))|(?:福利|奖励|红包).{0,8}\d+\s*(?:USDT|美元|元|U)/i;
  if (raffle.test(affirmative) || participation.test(affirmative) && /抽奖|抽取|抽名额/.test(affirmative) && /送|奖品|奖金|周边|红包|USDT/i.test(affirmative))
    return hint('raffle','含抽奖或参与领奖信号');

  const deposit = /(?:注册|开户|入金|充值|首充|充币|首次交易)[\s\S]{0,45}(?:奖励|返现|红包|赠金|奖金|福利|(?:送|领|赚).{0,12}(?:\d+\s*(?:U|USDT|元|美元)|现金))|(?:奖励|返现|红包|赠金|奖金|领取\s*\d+\s*(?:U|USDT|元|美元))[\s\S]{0,45}(?:注册|开户|入金|充值|首充|充币|首次交易)/i;
  if (deposit.test(affirmative)) return hint('deposit_reward','含注册、入金或充值换奖励信号');
  if (participation.test(affirmative) && prize.test(affirmative)) return hint('raffle','含抽奖或参与领奖信号');

  // A small contact/referral footer does not hide a tutorial whose useful steps
  // or resource are already inline. Prize and deposit pitches above still fold.
  if (substantive(summary)) return keep();

  if (/(?:使用|填写|输入|通过|点击).{0,18}(?:邀请码|返佣链接|推荐链接)|(?:我的|专属).{0,18}(?:邀请码|返佣链接|推荐链接).{0,35}(?:注册|领取|返佣|奖励|https?:\/\/)|(?:返佣|返点)[\s\S]{0,35}(?:注册|点击|领取|私信)|(?:注册|点击|领取|私信)[\s\S]{0,35}(?:返佣|返点)/i.test(affirmative))
    return hint('referral','含邀请码或返佣推广信号');

  const contact = /私信(?:我)?|加我(?:微信|VX|vx)|进群|加入.{0,8}(?:群|社群)|扫码.{0,8}(?:群|微信)|(?:评论|回复|留言).{0,16}(?:关键词|[“"「『][^”"」』]{1,16}[”"」』]|\d{2,8})/i;
  const delivery = /领取|获取|下载|发你|发给|拿到|群文件|群内/i;
  const resource = /资料|工具|插件|软件|安装包|源码|模板|课程|教程|链接|地址|提示词|手册/i;
  if (contact.test(affirmative) && delivery.test(affirmative) && resource.test(affirmative))
    return hint('gated_resource','含私信、关键词或进群后领取材料信号');

  const sales = /开放代理|招募代理|招代理|招募加盟|代理加盟|购买课程|报名课程|课程报名|加入.{0,8}付费社群|订阅.{0,8}(?:我的|我们).{0,8}(?:会员|社群)/i;
  if (sales.test(affirmative) && /\d+\s*元|价格|费用|名额|购买|报名|来聊|找我|联系|下单|网址|网站|https?:\/\//i.test(affirmative))
    return hint('sales_pitch','含代理招募、课程或社群销售邀约信号');
  if (/(?:保证收益|稳赚不赔|零风险|躺赚|日赚\s*\d+)/.test(affirmative)
    && /加我|跟我|私信|报名|入群|进群|购买|注册|扫码/.test(affirmative))
    return hint('income_pitch','含收益承诺与报名或联系邀约信号');
  if (/(?:^|[\s:：(（#【])(?:广告|赞助|商业推广)(?:[\s:：)）】]|$)|付费推广|推广合作/i.test(affirmative)
    && /购买|下单|优惠码|折扣码|扫码|注册|点击|领取|链接|https?:\/\//i.test(affirmative))
    return hint('promotion','含明确推广标识及购买或领取邀约信号');
  return keep();
}
