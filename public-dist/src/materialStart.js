import { creatorGuideFor } from './creatorGuides.js';
import { repositoryPresentation } from './repositoryGuide.js';
import { practicalMaterialKind } from './practicalMaterials.js';

export const START_SUGGESTION = '本站起步建议（可修改，尚未执行）：';
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export function materialStartDetails(item, intent = 'try') {
  if (!item || typeof item.id !== 'string' || !text(item.title, 200)) throw Error('这条材料暂不可用，请刷新后重试。');
  if (!['try', 'write'].includes(intent)) throw Error('请选择试用或选题。');
  const guide = creatorGuideFor(item);
  const practical = practicalMaterialKind(item);
  const sourceLine = prefix => (item.summary || '').split('\n').find(line => line.startsWith(prefix))?.slice(prefix.length).trim();
  return {
    intent,
    name: text(practical ? item.title : repositoryPresentation(item)?.title || item.title, 90),
    purpose: text(guide?.purpose || (practical ? sourceLine('用途：') : '') || repositoryPresentation(item)?.title || item.title, 240),
    preparation: text(guide?.requirements || (practical ? sourceLine('限制：') : ''), 500) || '准备条件还不清楚，先查看原文的适用平台、账号和安装要求。',
    firstStep: text(guide?.first_step || (practical ? sourceLine('开始：') : ''), 400) || '先打开来源，确认具体用法，再选一个最小案例亲自试一次。',
    cost: text(guide?.cost || (practical ? sourceLine('费用：') : ''), 500) || '费用待确认；不能从开源、热度或旧活动推断现在免费。',
  };
}

export function buildMaterialStart(item, intent = 'try') {
  const details = materialStartDetails(item, intent);
  const goal = intent === 'write'
    ? `选题目标：围绕“${details.purpose}”准备一份讲清实际用途的内容，加入自己亲自验证的过程，区分作者说明与自己的体验。`
    : `试用目标：${details.purpose.replace(/[。！？!?]+$/, '')}。先确认条件，用一份可公开的小材料试一次，判断是否适合自己的需要。`;
  return {
    title: `${intent === 'write' ? '选题' : '试用'}：${details.name}`.slice(0, 100),
    goal: `${START_SUGGESTION}\n${goal}\n起步：${details.firstStep}`.slice(0, 1000),
    status: 'collecting', thoughts: '', gaps: '', next_step: '', result: '',
  };
}

// These are website suggestions, never persisted as the user's thoughts or results.
export function topicStartSteps(topic) {
  if (topic?.status === 'done' || !topic?.goal?.startsWith(START_SUGGESTION)) return [];
  return topic.goal.includes('\n选题目标：') ? [
    '打开原文，确认它能解决谁的什么问题，以及费用和使用条件。',
    '亲自跑一个小案例，留下关键截图、实际效果和遇到的问题。',
    '补上自己的观点，再带走材料请 AI 帮忙整理；发布前核对事实与出处。',
  ] : [
    '打开原文，确认适用平台、准备条件和费用。',
    '用一个小案例亲自试试，记录效果和遇到的问题。',
    '补上自己的想法和结果；需要协助时，把材料带给常用 AI。',
  ];
}
