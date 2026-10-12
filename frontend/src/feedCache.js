// Disposable feed cache; user collections use separate keys and are never read
// or written here. A cache is a previous response, not a new source success.
export const MAX_FEED_CACHE_CHARS = 2_500_000;
export const FEED_CACHE_KEYS = Object.freeze({
  'public-live':'personal-feed:feed-cache:public-live:v1',
  'local-live':'personal-feed:feed-cache:local-live:v1',
});
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value,max=200) => typeof value === 'string' && value.length > 0 && value.length <= max;
const optionalText = (value,max=20000) => value == null || typeof value === 'string' && value.length <= max;
const optionalDate = value => value == null || value === '' || typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const optionalRank = value => value == null || Number.isInteger(value) && value > 0 && value <= 100000;
const list = (value,max=5000) => Array.isArray(value) && value.length <= max && value.every(id=>text(id));

export function feedCacheScope(mode,publicPreview) {
  return mode === 'live' ? publicPreview ? 'public-live' : 'local-live' : null;
}

// Retains the existing network contract, including simplified old responses.
export function validFeedResponse(feed,mode,requireRefresh=false) {
  return record(feed) && text(feed.schema_version,20) && feed.mode === mode
    && Array.isArray(feed.items) && record(feed.sections) && Array.isArray(feed.sources)
    && (!requireRefresh || record(feed.refresh));
}

function boundedJson(value,depth=0,budget={nodes:200000}) {
  if (depth > 20 || --budget.nodes < 0) return false;
  if (value == null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 100000;
  if (Array.isArray(value)) return value.length <= 10000 && value.every(entry=>boundedJson(entry,depth+1,budget));
  if (!record(value)) return false;
  const keys=Object.keys(value);
  return keys.length <= 2000 && keys.every(key=>key.length <= 200 && !['__proto__','prototype','constructor'].includes(key)
    && boundedJson(value[key],depth+1,budget));
}

export function validCachedFeed(feed) {
  if (!validFeedResponse(feed,'live') || !['0.2','0.3'].includes(feed.schema_version)
    || !record(feed.profile) || feed.sources.length > 100 || feed.items.length > 5000
    || !list(feed.sections.daily) || !list(feed.sections.discover) || !boundedJson(feed)) return false;
  if (!['interests','exclude','language'].every(key=>optionalText(feed.profile[key],2000))) return false;
  const sourceIds=new Set();
  for (const source of feed.sources) {
    if (!record(source) || !text(source.id) || !text(source.name,500) || sourceIds.has(source.id)
      || !['home_url','group','kind','status','message','reading_note'].every(key=>optionalText(source[key]))
      || !['last_success_at','last_attempt_at','next_allowed_at'].every(key=>optionalDate(source[key]))) return false;
    sourceIds.add(source.id);
  }
  const itemIds=new Set();
  for (const item of feed.items) {
    if (!record(item) || !text(item.id) || !text(item.title,2000) || itemIds.has(item.id)
      || !list(item.source_refs,100) || !item.source_refs.length || !item.source_refs.some(id=>sourceIds.has(id))
      || !['summary','original_url','canonical_url','repository_name','origin','content_status','link_kind','author_name','author_handle','evidence_ref','heat_label'].every(key=>optionalText(item[key]))
      || !['published_at','captured_at','updated_at','source_updated_at','source_item_time','repository_created_at'].every(key=>optionalDate(item[key]))
      || !optionalRank(item.source_rank)
      || item.alias_ids != null && !list(item.alias_ids)
      || item.evidence_refs != null && !list(item.evidence_refs)
      || item.unknowns != null && !list(item.unknowns,100)
      || item.source_links != null && (!Array.isArray(item.source_links) || item.source_links.length > 100
        || !item.source_links.every(link=>record(link) && text(link.source_id)
          && ['url','evidence_ref','heat_label'].every(key=>optionalText(link[key])) && optionalRank(link.source_rank)
          && ['captured_at','source_updated_at'].every(key=>optionalDate(link[key]))))
      || item.repository_guide != null && (!record(item.repository_guide)
        || !['summary','example','audience','basis','repository'].every(key=>optionalText(item.repository_guide[key])))) return false;
    itemIds.add(item.id);
  }
  if (!optionalDate(feed.generated_at) || !optionalText(feed.update_notice)
    || feed.publication != null && (!record(feed.publication)
      || !['kind','version','schedule_label'].every(key=>optionalText(feed.publication[key])) || !optionalDate(feed.publication.published_at))
    || feed.repository_guide_status != null && (!record(feed.repository_guide_status)
      || !['status','message'].every(key=>optionalText(feed.repository_guide_status[key])))) return false;
  return feed.refresh == null || record(feed.refresh) && optionalText(feed.refresh.message) && optionalText(feed.refresh.status)
    && (feed.refresh.new_item_ids == null || list(feed.refresh.new_item_ids));
}

export function readFeedCache(storage,scope,now=Date.now()) {
  const key=Object.hasOwn(FEED_CACHE_KEYS,scope) ? FEED_CACHE_KEYS[scope] : null;
  if (!key) return {feed:null,cachedAt:null,warning:false};
  try {
    const raw=storage.getItem(key);
    if (raw == null) return {feed:null,cachedAt:null,warning:false};
    if (typeof raw !== 'string' || raw.length > MAX_FEED_CACHE_CHARS) throw Error('cache length');
    const cache=JSON.parse(raw),stamp=Date.parse(cache?.cachedAt);
    if (!record(cache) || Object.keys(cache).sort().join(',') !== 'cachedAt,feed,scope,version'
      || cache.version !== 1 || cache.scope !== scope || typeof cache.cachedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cache.cachedAt)
      || !Number.isFinite(stamp) || new Date(stamp).toISOString() !== cache.cachedAt || stamp > now+300000 || !validCachedFeed(cache.feed)) throw Error('cache format');
    return {feed:cache.feed,cachedAt:cache.cachedAt,warning:false};
  } catch { return {feed:null,cachedAt:null,warning:true}; }
}

export function writeFeedCache(storage,scope,feed,now=Date.now()) {
  const key=Object.hasOwn(FEED_CACHE_KEYS,scope) ? FEED_CACHE_KEYS[scope] : null;
  if (!key) return {cachedAt:null,warning:false};
  try {
    if (!validCachedFeed(feed)) throw Error('cache format');
    const cachedAt=new Date(now).toISOString();
    const raw=JSON.stringify({version:1,scope,cachedAt,feed});
    if (raw.length > MAX_FEED_CACHE_CHARS) throw Error('cache length');
    storage.setItem(key,raw);
    return {cachedAt,warning:false};
  } catch { return {cachedAt:null,warning:true}; }
}

export function discardFeedCaches(storage) {
  let removed=false;
  for (const key of Object.values(FEED_CACHE_KEYS)) {
    try {if (storage.getItem(key) != null) {storage.removeItem(key);removed=true;}} catch { /* User storage is untouched. */ }
  }
  return removed;
}
