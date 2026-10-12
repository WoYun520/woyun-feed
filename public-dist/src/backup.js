import { validateTrialInput } from './trialPlan.js';
import { validateWritingInput } from './writingBrief.js';
import { validateTopic, validateCollectionNote, validateManualExcerpt, sameMaterial } from './topicWorkspace.js';
import { validateManualMaterial } from './manualMaterial.js';
import { normalizePostImage } from './postMedia.js';
import { hasCredentialText } from './contentPrivacy.js';
import { validateDotCandidateRecords, validateDotItem, isCandidateImport } from './dotCandidates.js';

export const BACKUP_LIMIT = 4 * 1024 * 1024;
const FORMAT = 'personal-feed-backup';
const ACTIVE = ['requesting', 'reading', 'analyzing', 'submitted', 'running', 'needs_input'];
const STATUS = ['draft', ...ACTIVE, 'done', 'failed'];
const fail = message => { throw new Error(message || '备份内容不完整或格式不正确，未修改现有资料。'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 12000) => typeof value === 'string' && value.length <= max;
const id = value => text(value, 128) && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const array = (value, max = 1000) => Array.isArray(value) && value.length <= max;
const texts = (value, max = 1000) => array(value, max) && value.every(v => text(v));
const date = value => value == null || text(value, 64) && Number.isFinite(Date.parse(value));
const rank = value => value == null || Number.isSafeInteger(value) && value>0 && value<=1000;
const safeUrl = value => { if (value == null) return true; try { const u = new URL(value); return text(value, 4000) && ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
function inspect(value, depth = 0) {
  if (depth > 15) fail('备份结构过深，无法恢复。');
  if (typeof value === 'string') {
    if (!text(value, 30000)) fail('备份中有过长的内容，无法恢复。');
    if (hasCredentialText(value)) fail('资料中疑似含有密码或密钥，请先移除这些内容，再备份或恢复。');
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('备份中存在不支持的字段。');
      inspect(child, depth + 1);
    }
  }
}
function validateSource(source) {
  if (source == null) return;
  if (!object(source) || !safeUrl(source.url) || !safeUrl(source.api_url) || !text(source.sha, 40) || !/^[a-f0-9]{40}$/i.test(source.sha) || !date(source.captured_at) || typeof source.truncated !== 'boolean') fail();
}
function validateReport(report) {
  if (!object(report)) fail();
  for (const key of ['summary', 'who_for', 'cost_and_limits', 'next_step']) if (!text(report[key], 2000) || !report[key].trim()) fail();
  for (const key of ['can_do', 'first_steps', 'unknowns']) if (!texts(report[key], 8) || !report[key].length || report[key].some(v => v.length > 2000)) fail();
}
function validateState(state, mode) {
  if (!object(state) || !array(state.followups, 500) || !object(state.item_snapshots)) fail();
  if (state.dot_candidates!==undefined) validateDotCandidateRecords(state.dot_candidates);
  if (state.topics !== undefined) {
    if (!array(state.topics,60)) fail('最多保存 60 个主题，请先导出需要长期留存的资料。');
    const topicIds=new Set();
    for (const topic of state.topics) {
      validateTopic(topic);
      if (topicIds.has(topic.id)) fail('备份中存在重复主题编号。');
      topicIds.add(topic.id);
      validateState({saved_item_ids:topic.materials.map(m=>m.item.id),hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:Object.fromEntries(topic.materials.map(m=>[m.item.id,m.item]))},mode);
    }
  }
  const itemId = value => id(value) && (mode !== 'live' || /^(github-\d+|news-[a-f0-9]{24}|manual-[a-f0-9-]{36}|dot-x-[1-9]\d{7,24})$/.test(value));
  if (state.saved_item_notes!==undefined) {
    if (!object(state.saved_item_notes) || Object.keys(state.saved_item_notes).length>1000) fail();
    for (const [key,value] of Object.entries(state.saved_item_notes)) {
      if (!itemId(key) || !object(value) || !date(value.updated_at) || !value.updated_at || !Object.hasOwn(state.item_snapshots,key)) fail('收藏想法的来源或时间不完整，未恢复。');
      validateCollectionNote(value.note);
    }
  }
  if (state.saved_item_excerpts!==undefined) {
    if (!object(state.saved_item_excerpts) || Object.keys(state.saved_item_excerpts).length>1000) fail();
    for (const [key,value] of Object.entries(state.saved_item_excerpts)) {
      if (!itemId(key) || !Object.hasOwn(state.item_snapshots,key)) fail('正文摘录缺少关联材料，未恢复。');
      validateManualExcerpt(value,state.item_snapshots[key].original_url);
    }
  }
  for (const key of ['saved_item_ids', 'hidden_item_ids']) if (!array(state[key]) || !state[key].every(itemId) || new Set(state[key]).size !== state[key].length) fail();
  if (state.archived_item_ids!==undefined && (!array(state.archived_item_ids) || !state.archived_item_ids.every(key=>itemId(key) && state.saved_item_ids.includes(key)) || new Set(state.archived_item_ids).size!==state.archived_item_ids.length)) fail('归档记录必须关联已收藏的材料，未恢复。');
  if (state.profile_override !== null && (!object(state.profile_override) || !text(state.profile_override.interests, 8000) || !text(state.profile_override.exclude, 8000) || !text(state.profile_override.language, 32))) fail();
  if (Object.keys(state.item_snapshots).length > 1000) fail();
  for (const [key, item] of Object.entries(state.item_snapshots)) {
    if (!itemId(key) || !object(item) || item.id !== key || !text(item.title) || !text(item.summary) || !texts(item.source_refs, 30) || !safeUrl(item.original_url)) fail();
    if(key.startsWith('manual-') || item.origin==='user_added') validateManualMaterial(item);
    if(key.startsWith('dot-x-') || isCandidateImport(item)) {
      validateDotItem(item);
      const intake=state.dot_candidates?.find(record=>record.id===key);
      if (intake && Object.keys(intake.item).some(field=>JSON.stringify(item[field])!==JSON.stringify(intake.item[field]))) fail('采集保存副本与原始导入内容不一致，未恢复。');
    }
    if (item.repository_guide) {
      const guide=item.repository_guide;
      if (!object(guide) || !text(guide.summary) || guide.summary.length>100 || !['description','observation','readme'].includes(guide.basis) || !safeUrl(guide.source_url) || !date(guide.recorded_at) || guide.verification!=='not_tested') fail('项目中文用途整理格式不完整，未恢复。');
    }
    if (item.unknowns !== undefined && !texts(item.unknowns, 100)) fail();
    if (item.topics !== undefined && !texts(item.topics, 100)) fail();
    if (item.alias_ids !== undefined && (!array(item.alias_ids,30) || !item.alias_ids.every(itemId))) fail();
    if (item.evidence_refs !== undefined && !texts(item.evidence_refs,30)) fail();
    if (!safeUrl(item.canonical_url)) fail();
    if (item.source_links !== undefined && (!array(item.source_links,30) || !item.source_links.every(link=>object(link) && text(link.source_id,128) && safeUrl(link.url) && text(link.evidence_ref,256) && date(link.captured_at) && date(link.source_updated_at) && rank(link.source_rank) && (link.heat_label==null || text(link.heat_label,80))))) fail();
    if (!rank(item.source_rank) || item.heat_label!=null && !text(item.heat_label,80)) fail();
    if (item.link_kind!=null && !['article','repository','discussion','topic','search','video','post'].includes(item.link_kind)) fail();
    if (item.author_name!=null && (!text(item.author_name,100) || /[\u0000-\u001f\u007f]/.test(item.author_name))) fail('作者名称格式不正确，未恢复。');
    if (item.creator_id!=null && !id(item.creator_id)) fail('作者编号格式不正确，未恢复。');
    if (item.author_handle!=null && (!text(item.author_handle,15) || !/^[A-Za-z0-9_]{1,15}$/.test(item.author_handle))) fail('作者账号格式不正确，未恢复。');
    if (item.post_image !== undefined) {
      const image = item.link_kind === 'post' ? normalizePostImage(item.post_image,item.original_url) : null;
      if (!image || Object.keys(item.post_image).length !== 3
        || Object.keys(image).some(field => item.post_image[field] !== image[field])) fail('帖子附图的来源或地址不正确，未恢复。');
    }
    for (const field of ['recommendation_reason', 'suggested_question', 'content_status', 'verification_status', 'display_title', 'summary_label', 'repository_name', 'evidence_ref']) if (item[field] != null && !text(item[field])) fail();
    for (const field of ['published_at', 'captured_at', 'updated_at', 'repository_created_at', 'source_updated_at', 'source_item_time']) if (!date(item[field])) fail();
  }
  const taskIds = new Set();
  for (const task of state.followups) {
    if (!object(task) || !id(task.id) || taskIds.has(task.id) || !itemId(task.item_id) || !text(task.question, 2000) || !task.question.trim() || !STATUS.includes(task.status) || !date(task.created_at) || !date(task.updated_at)) fail();
    taskIds.add(task.id);
    if (task.error_message != null && !text(task.error_message)) fail();
    if (task.research_request_id != null && !id(task.research_request_id)) fail();
    if (task.research) {
      const job = task.research;
      if (!object(job) || !id(job.id) || job.item_id !== task.item_id || !['reading', 'analyzing', 'done', 'failed'].includes(job.status) || !date(job.updated_at) || !date(job.created_at)) fail();
      validateSource(job.source);
      if (job.report) validateReport(job.report);
      if (job.status === 'done' && !job.report) fail();
      if (job.error != null && !text(job.error)) fail();
    }
    if (task.result != null && (!object(task.result) || !text(task.result.conclusion) || !text(task.result.suggested_next_step) || !texts(task.result.sources_used || []) || !texts(task.result.unresolved || []))) fail();
    if (task.status === 'done' && !task.research?.report && !task.result) fail();
    if (task.trial_plan) {
      const plan = task.trial_plan;
      if (task.status !== 'done' || task.research?.status !== 'done' || !task.research?.report) fail();
      if (!object(plan) || plan.version !== 1 || plan.origin !== 'local-template' || plan.research_id !== task.research?.id || !texts(plan.edited_fields, 3) || !date(plan.created_at) || !date(plan.updated_at)) fail();
      validateTrialInput(plan); validateSource(plan.source);
      if (plan.source?.sha !== task.research?.source?.sha || plan.source?.url !== task.research?.source?.url) fail('试用清单与原整理的来源不一致，未恢复。');
    }
    if (task.writing_brief != null) {
      const brief = task.writing_brief;
      if (task.status !== 'done' || task.research?.status !== 'done' || !task.research?.report || !object(brief) || brief.version !== 1 || brief.research_id !== task.research.id || !date(brief.created_at) || !date(brief.updated_at)) fail();
      validateWritingInput(brief);
    }
  }
  for (const ref of [...state.saved_item_ids, ...state.hidden_item_ids, ...state.followups.map(t => t.item_id)]) if (!Object.hasOwn(state.item_snapshots, ref)) fail('备份缺少相关条目的内容，无法完整恢复。');
}

export function parseBackup(raw, mode) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > BACKUP_LIMIT) fail('备份文件超过 4 MB，暂不支持恢复。');
  let backup;
  try { backup = JSON.parse(raw); } catch { fail('这不是有效的备份文件，请选择下载过的 JSON 备份。'); }
  inspect(backup);
  if (!object(backup) || backup.format !== FORMAT || backup.version !== 1) fail('不是本应用支持的备份版本，请使用“备份到电脑”生成的文件。');
  if (backup.mode !== mode) fail('示例资料和真实资料不能混合恢复，请打开对应模式。');
  if (!date(backup.exported_at) || !backup.exported_at) fail();
  validateState(backup.state, mode);
  return backup;
}

export function makeBackup(localState, feed, mode) {
  const state = structuredClone(localState);
  const refs = new Set([...state.saved_item_ids, ...state.hidden_item_ids, ...state.followups.map(t => t.item_id),...Object.keys(state.saved_item_notes || {}),...Object.keys(state.saved_item_excerpts || {})]);
  const items = new Map([...(feed?.items || []), ...Object.values(state.item_snapshots)].map(item => [item.id, item]));
  state.item_snapshots = Object.fromEntries([...refs].filter(ref => items.has(ref)).map(ref => [ref, structuredClone(items.get(ref))]));
  const backup = {format: FORMAT, version: 1, mode, exported_at: new Date().toISOString(), state};
  const raw = JSON.stringify(backup, null, 2);
  parseBackup(raw, mode); // The exported format must be restorable before offering it.
  return {raw, filename:`personal-feed-${mode}-${backup.exported_at.replace(/[:.]/g, '-')}.json`, backup};
}

export function planRestore(current, backup, {restoreProfile = false} = {}) {
  const next = structuredClone(current);
  const incoming = backup.state;
  const existing = new Map(next.followups.map(t => [t.id, t]));
  const now = new Date().toISOString();
  const addedTasks = [], skippedTasks = [];
  const currentCandidates=next.dot_candidates || [],candidateKeys=new Set(currentCandidates.map(record=>record.key));
  const addedCandidates=(incoming.dot_candidates || []).filter(record=>!candidateKeys.has(record.key)).map(record=>structuredClone(record));
  if (next.dot_candidates!==undefined || incoming.dot_candidates!==undefined) next.dot_candidates=[...currentCandidates,...addedCandidates];
  const topics=next.topics || [],topicIds=new Set(topics.map(t=>t.id));
  const addedTopics=(incoming.topics || []).filter(t=>!topicIds.has(t.id)).map(t=>({...structuredClone(t),imported_backup:{exported_at:backup.exported_at,restored_at:now}}));
  next.topics=[...topics,...addedTopics];
  let paused = 0;
  for (const source of incoming.followups) {
    if (existing.has(source.id)) { skippedTasks.push(source); continue; }
    const task = structuredClone(source);
    task.imported_backup = {exported_at: backup.exported_at, restored_at: now, original_status: source.status};
    // Restoring a file must never resume work or bill the user.
    delete task.research_request_id;
    if (ACTIVE.includes(task.status)) {
      paused++; task.status = 'failed'; task.error_message = '备份里的整理尚未完成，未自动继续。需要时可手动重新整理。';
      if (task.research) { task.research.status = 'failed'; task.research.report = null; task.research.error = task.error_message; }
    }
    addedTasks.push(task); existing.set(task.id, task);
  }
  next.followups = [...next.followups, ...addedTasks];
  const addedSaved = incoming.saved_item_ids.filter(id => !next.saved_item_ids.includes(id));
  const addedArchived=(incoming.archived_item_ids || []).filter(id=>addedSaved.includes(id) && !current.saved_item_ids.some(key=>sameMaterial(current.item_snapshots[key] || {id:key},incoming.item_snapshots[id])));
  next.archived_item_ids=[...(next.archived_item_ids || []),...addedArchived];
  const addedHidden = incoming.hidden_item_ids.filter(id => !next.hidden_item_ids.includes(id));
  next.saved_item_notes ||= {};
  const addedNotes=Object.entries(incoming.saved_item_notes || {}).filter(([key])=>!Object.hasOwn(next.saved_item_notes,key));
  for (const [key,value] of addedNotes) next.saved_item_notes[key]=structuredClone(value);
  next.saved_item_excerpts ||= {};
  const addedExcerpts=Object.entries(incoming.saved_item_excerpts || {}).filter(([key])=>!Object.hasOwn(next.saved_item_excerpts,key));
  for (const [key,value] of addedExcerpts) next.saved_item_excerpts[key]=structuredClone(value);
  next.saved_item_ids.push(...addedSaved); next.hidden_item_ids.push(...addedHidden);
  for (const [key, item] of Object.entries(incoming.item_snapshots)) if (!Object.hasOwn(next.item_snapshots, key)) next.item_snapshots[key] = structuredClone(item);
  const profileChanged = !!restoreProfile && JSON.stringify(next.profile_override) !== JSON.stringify(incoming.profile_override);
  if (restoreProfile) next.profile_override = structuredClone(incoming.profile_override);
  const summary = {
    saved: addedSaved.length, archived:addedArchived.length, notes:addedNotes.length, excerpts:addedExcerpts.length, hidden: addedHidden.length, tasks: addedTasks.length, trials: addedTasks.filter(t => t.trial_plan).length,
    skipped: skippedTasks.length, paused, profileChanged,
    topics:addedTopics.length,skippedTopics:(incoming.topics || []).length-addedTopics.length,
    candidates:addedCandidates.length,skippedCandidates:(incoming.dot_candidates || []).length-addedCandidates.length,
    totalTasks: incoming.followups.length, totalSaved: incoming.saved_item_ids.length, totalTrials: incoming.followups.filter(t => t.trial_plan).length,
    titles: addedTasks.slice(0, 20).map(t => incoming.item_snapshots[t.item_id].title),
  };
  summary.hasChanges = !!(summary.saved || summary.notes || summary.excerpts || summary.hidden || summary.tasks || summary.topics || summary.candidates || profileChanged);
  // A merged collection must remain exportable and within the same supported limits.
  if (summary.hasChanges) parseBackup(JSON.stringify({...backup, state: next}), backup.mode);
  return {next, summary};
}
