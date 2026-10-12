// Local templates only. These functions never call AI or mark evidence verified.
import { hasCredentialText, containsCredentialText } from './contentPrivacy.js';

function requireSafeTrialMaterial(value) {
  if (containsCredentialText(value)) throw new Error('试用材料中疑似有密码或密钥，请移除后再保存或复制。');
}

export const TRIAL_OUTCOMES = Object.freeze({
  not_started: '还没开始', in_progress: '正在试', worked: '跑通了', blocked: '卡住了', skipped: '暂时不试',
});

export function createTrialPlan(task) {
  if (task?.status !== 'done' || !task.research?.report) throw new Error('请先完成项目说明整理，再准备试用清单。');
  const report = task.research.report;
  const plan = {
    version: 1, origin: 'local-template', research_id: task.research.id,
    source: structuredClone(task.research.source),
    goal: report.next_step || task.question,
    steps: (report.first_steps || []).join('\n'),
    shots: '开始前：准备的示例材料或输入内容。\n关键操作：最容易找不到的按钮、设置或操作位置。\n实际结果：输入与输出的对照；如果失败，记录报错位置。',
    outcome: 'not_started', notes: '', evidence_notes: '', edited_fields: [],
    created_at: null, updated_at: null,
  };
  requireSafeTrialMaterial(plan);
  return plan;
}

export function validateTrialInput(input) {
  if (!input || !Object.hasOwn(TRIAL_OUTCOMES, input.outcome)) throw new Error('请选择试用进度。');
  const limits = { goal: 2000, steps: 8000, shots: 3000, notes: 8000, evidence_notes: 3000 };
  const clean = { outcome: input.outcome };
  for (const [field, max] of Object.entries(limits)) {
    if (typeof input[field] !== 'string' || input[field].length > max) throw new Error('内容过长或格式不正确，请缩短后保存。');
    if (hasCredentialText(input[field])) throw new Error('内容中疑似有密码或密钥，请移除后再保存或复制。');
    clean[field] = input[field].trim();
  }
  if (!clean.goal || !clean.steps) throw new Error('请保留一个试用目标和至少一条操作步骤。');
  if (['worked', 'blocked'].includes(clean.outcome) && !clean.notes) throw new Error('请写一句实际看到了什么，再记录为跑通或卡住。');
  return clean;
}

export function exportTrialPlan(plan, title) {
  // Recheck legacy notes and source metadata at export time as they may have
  // been saved before the input guard existed.
  requireSafeTrialMaterial({plan, title});
  const edited = plan.edited_fields.length ? '根据原 AI 建议手动编辑' : '沿用原 AI 建议，套入本机清单模板';
  return `# 试用清单 · ${title || '项目'}

- 进度：${TRIAL_OUTCOMES[plan.outcome] || '未知'}（手动记录，不是自动核验）
- 清单准备方式：${edited}；没有再次调用 AI
- 保存时间：${plan.updated_at || '尚未保存'}

## 这次只验证一件事
${plan.goal}

## 准备与操作步骤（计划，不代表已执行）
${plan.steps.split('\n').filter(Boolean).map(x => '- [ ] ' + x).join('\n')}

## 要留下的截图（通用拍摄提示，不代表已有截图）
${plan.shots || '尚未安排'}

## 实际观察（手动填写）
${plan.notes || '尚未填写；没有试用结果。'}

## 截图或材料线索（手动填写，未读取文件）
${plan.evidence_notes || '尚未填写；没有已附加的截图。'}

## 原说明与核对入口
- 来源：${plan.source?.url || '未知'}
- 文件：${plan.source?.path || '未知'}
- 来源版本：${plan.source?.sha || '未知'}
- 读取时间：${plan.source?.captured_at || '未知'}
- 读取范围：${plan.source?.truncated ? 'README 前 28000 字符摘录' : '本次 README 文字'}
- 原整理编号：${plan.research_id}

说明：AI 的建议和手动记录都可能有误；这份清单不会安装或执行工具，不等于实测证据或用户验收。用它写教程时，只把实际操作并有材料支持的部分写成个人经历。
`;
}
