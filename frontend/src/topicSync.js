import { sameMaterial, validateCollectionNote, validateManualExcerpt } from './topicWorkspace.js';

const FIELD_KEYS = ['note', 'manual_excerpt'];
const record = value => value && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const own = (value, key) => Object.hasOwn(value || {}, key);
const clone = value => structuredClone(value);
const safeUrl = value => {
  if (typeof value !== 'string' || value.length > 4000) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};
const excerptValue = value => value == null ? null : clone(value);
const semanticValue = (key, value) => key === 'note' ? value : value == null ? null : {
  text:value.text, url:value.url, origin:value.origin, verification:value.verification,
};
const equal = (key, left, right) => JSON.stringify(semanticValue(key, left)) === JSON.stringify(semanticValue(key, right));

// Missing metadata is supported for old themes and old backups. A present
// baseline is a historical association, not evidence of reading or approval.
export function validateTopicSyncBaseline(value) {
  if (!record(value) || Object.keys(value).some(key => !['version','source_item_id','source_url','fields'].includes(key))
    || value.version !== 1 || !validId(value.source_item_id) || !safeUrl(value.source_url)
    || !record(value.fields) || Object.keys(value.fields).some(key => !FIELD_KEYS.includes(key))) {
    throw Error('主题关联记录格式不完整，未修改资料。');
  }
  if (own(value.fields, 'note')) validateCollectionNote(value.fields.note);
  if (own(value.fields, 'manual_excerpt') && value.fields.manual_excerpt != null) {
    validateManualExcerpt(value.fields.manual_excerpt, value.source_url);
  }
  return value;
}

export function makeTopicSyncBaseline(item, note = '', excerpt = null) {
  const baseline = {version:1, source_item_id:item?.id, source_url:item?.original_url,
    fields:{note:validateCollectionNote(note), manual_excerpt:excerptValue(excerpt)}};
  validateTopicSyncBaseline(baseline);
  return baseline;
}

function collectionFor(localState, material) {
  const candidates = [...new Set(localState.saved_item_ids || [])]
    .map(id => ({id, item:localState.item_snapshots?.[id]}))
    .filter(({item}) => record(item) && sameMaterial(material.item, item));
  // Restored aliases may contain distinct user notes. Never silently choose
  // one of several matched collections, even if the page deduplicates them.
  if (candidates.length !== 1) return null;
  const {id, item} = candidates[0];
  const note = localState.saved_item_notes?.[id]?.note ?? '';
  const excerpt = excerptValue(localState.saved_item_excerpts?.[id]);
  validateCollectionNote(note);
  if (excerpt) validateManualExcerpt(excerpt, item.original_url);
  return {id, item, values:{note, manual_excerpt:excerpt}};
}

function rowFor(localState, topic, material) {
  const collection = collectionFor(localState, material);
  if (!collection) return null;
  const baseline = material.collection_sync;
  if (baseline != null) validateTopicSyncBaseline(baseline);
  const values = {note:material.note ?? '', manual_excerpt:excerptValue(material.manual_excerpt)};
  const fields = [];
  for (const key of FIELD_KEYS) {
    const topicValue = values[key], collectionValue = collection.values[key];
    const tracked = baseline != null && own(baseline.fields, key);
    if (equal(key, topicValue, collectionValue)
      || tracked && equal(key, baseline.fields[key], collectionValue)) continue;
    const kind = !tracked ? 'untracked' : equal(key, topicValue, baseline.fields[key]) ? 'stale' : 'custom';
    fields.push({key, kind, topicValue:clone(topicValue), collectionValue:clone(collectionValue),
      canReplace:key !== 'manual_excerpt' || collectionValue == null || collectionValue.url === material.item.original_url});
  }
  if (!fields.length) return null;
  // Exact preview comparison includes dates and source snapshots even though
  // equal text with a different paste date is not a new-content reminder.
  const preview = JSON.stringify({topic_id:topic.id, topic_updated_at:topic.updated_at,
    material:clone(material), collection_item_id:collection.id, collection_item:clone(collection.item),
    collection_note:clone(localState.saved_item_notes?.[collection.id] ?? null),
    collection_excerpt:collection.values.manual_excerpt});
  return {topic_id:topic.id, item_id:material.item.id, collection_item_id:collection.id,
    title:material.item.title, fields, preview};
}

export function planTopicSync(localState, topicId = null) {
  const rows = [];
  for (const topic of localState.topics || []) {
    if (topicId != null && topic.id !== topicId) continue;
    for (const material of topic.materials || []) {
      const row = rowFor(localState, topic, material);
      if (row) rows.push(row);
    }
  }
  return rows;
}

export function applyTopicSync(localState, row, {fields = [], keepAll = false, explicitReplace = false, now = new Date().toISOString()} = {}) {
  if (!row || !validId(row.topic_id) || !validId(row.item_id) || typeof row.preview !== 'string'
    || !Array.isArray(fields) || fields.some(key => !FIELD_KEYS.includes(key)) || new Set(fields).size !== fields.length
    || typeof keepAll !== 'boolean' || typeof explicitReplace !== 'boolean'
    || typeof now !== 'string' || now.length > 64 || !Number.isFinite(Date.parse(now))) {
    throw Error('请选择要更新的内容，未修改资料。');
  }
  const current = planTopicSync(localState, row.topic_id)
    .find(candidate => candidate.item_id === row.item_id && candidate.collection_item_id === row.collection_item_id);
  if (!current || current.preview !== row.preview) throw Error('资料在预览后有更新，请重新查看后再选择。');
  const selected = keepAll ? current.fields : fields.map(key => current.fields.find(field => field.key === key));
  if (!selected.length || selected.some(field => !field)) throw Error('请选择要更新的内容，未修改资料。');
  if (!keepAll && selected.some(field => !field.canReplace)) throw Error('摘录关联的原链接不同，请手动核对，未改写主题。');
  if (!keepAll && !explicitReplace && selected.some(field => field.kind !== 'stale')) {
    throw Error('主题中有单独修改或未记录关联的内容，请明确选择替换，未改写主题。');
  }
  const state = clone(localState);
  const topic = state.topics.find(value => value.id === current.topic_id);
  const material = topic.materials.find(value => value.item.id === current.item_id);
  const baseline = material.collection_sync ? clone(material.collection_sync) : {
    version:1, source_item_id:current.collection_item_id,
    source_url:state.item_snapshots[current.collection_item_id].original_url, fields:{},
  };
  for (const field of selected) {
    if (!keepAll) material[field.key] = clone(field.collectionValue);
    baseline.fields[field.key] = clone(field.collectionValue);
  }
  baseline.source_item_id = current.collection_item_id;
  baseline.source_url = baseline.fields.manual_excerpt?.url || state.item_snapshots[current.collection_item_id].original_url;
  validateTopicSyncBaseline(baseline);
  material.collection_sync = baseline;
  topic.updated_at = now;
  return {state, summary:{topic_id:topic.id, item_id:material.item.id, updated:keepAll ? 0 : selected.length,
    kept:keepAll ? selected.length : 0, fields:selected.map(field => field.key)}};
}
