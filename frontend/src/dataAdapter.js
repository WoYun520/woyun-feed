import { makeTopicSyncBaseline, planTopicSync, applyTopicSync as applySync } from './topicSync.js';
/**
 * 集中数据适配层 · docs/feed-contract.md
 * 独立管理本地用户反馈（收藏、隐藏、跟进任务、偏好修改），不修改底层数据源。
 * 真实模式读取本机服务，示例模式单独读取演示数据，失败时不替换为示例。
 * 本地存储写入失败向外抛出异常，以便 UI 明确报错并保留用户输入。
 */

import { selectFeed } from './feedSelection.js';
import { containsCredentialText } from './contentPrivacy.js';
import { createTrialPlan, validateTrialInput, exportTrialPlan } from './trialPlan.js';
import { makeBackup, parseBackup, planRestore } from './backup.js';
import { WRITING_FORMATS, createWritingBrief, validateWritingInput, buildWritingMaterial } from './writingBrief.js';
import { blankTopic, validateTopicInput, sameMaterial, buildTopicMaterial, validateCollectionNote, makeManualExcerpt, postReadingContext, postAuthorLabel } from './topicWorkspace.js';
import { repositoryName } from './repositoryGuide.js';
import { makeManualMaterial, materialLinkKey } from './manualMaterial.js';
import { PUBLIC_PREVIEW } from './siteConfig.js';
import { withPracticalMaterials, practicalMaterialKind } from './practicalMaterials.js';
import { CREATOR_MATERIALS, CREATOR_MATERIAL_SOURCE } from './creatorCatalog.js';
import { feedCacheScope, readFeedCache, writeFeedCache, discardFeedCaches, validFeedResponse } from './feedCache.js';
import { parseDotCandidates, dotPostKey, makeDotCandidate, validateDotCandidateRecords, candidateSource, isCandidateImport, createDotFeaturedExport } from './dotCandidates.js';

const DEMO_STORAGE_KEY = 'personal-feed:demo:v1';
const LIVE_STORAGE_KEY = 'personal-feed:live:v1';
const MAX_FEED_RESPONSE_CHARS = 10_000_000;
const RETIRED_LIVE_SOURCES = new Set(['x', 'bilibili-hot-search']);
function kosxLink(value) {
  const key = dotPostKey(typeof value === 'string' ? value.trim() : '');
  if (!key) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  const author_handle = url.pathname.split('/')[1];
  const statusId = key.slice(2);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(author_handle)) return null;
  return {id:`kosx-${statusId}`, key, url:`https://x.com/${author_handle}/status/${statusId}`, author_handle};
}

function loadKosxPending(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rows = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const parsed = kosxLink(row.url);
    if (!parsed || row.key !== parsed.key || row.id !== parsed.id || seen.has(parsed.key)) continue;
    if (row.status !== 'pending' && row.status !== 'dismissed') continue;
    if (typeof row.submitted_at !== 'string' || row.submitted_at.length > 64 || !Number.isFinite(Date.parse(row.submitted_at))) continue;
    seen.add(parsed.key);
    rows.push({...parsed, status:row.status, submitted_at:row.submitted_at});
  }
  return rows.slice(0, 300);
}

function kosxCandidateViews(records) {
  return (Array.isArray(records) ? records : []).map(record => ({
    id:record.id, key:record.key, status:record.status, imported_at:record.submitted_at, featured_at:null, kosx:true,
    batch:{collector:'KOSX', collected_at:record.submitted_at, group:'items'},
    material:{
      original_url:record.url, author_handle:record.author_handle, published_at:null,
      title_zh:'待筛选的 X 链接',
      summary_zh:'访客通过 KOSX 助力计划粘贴的链接。尚未读取原文，未核对热度，未选入精选，不会出现在首页。',
      bookmark_count:null, like_count:null, view_count:null, metric_display:'',
      selection_reason:'只进入待筛选。提交不会自动公开。', my_angle:'',
      unknowns:['未读取原文', '热度未知', '未选入精选'],
    },
    item:null,
  }));
}

const loadDotRecords = value => {
  try {return {records:validateDotCandidateRecords(value || []),warning:null};}
  catch (error) {
    console.warn('采集筛选记录无法读取，原存储与其他资料未覆盖:',error);
    return {records:[],warning:'本地筛选记录格式异常，已暂停保存，原存储没有被覆盖。请先保留原浏览器数据，再检查或恢复筛选记录。'};
  }
};

const defaultLocalState = {
  saved_item_ids: [],
  archived_item_ids: [],
  saved_item_notes: {},
  saved_item_excerpts: {},
  hidden_item_ids: [],
  followups: [],
  profile_override: null,
  item_snapshots: {},
  topics: [],
  dot_candidates: [],
  kosx_pending: [],
};

export class FeedDataAdapter {
  constructor({ mode = 'live', publicPreview = PUBLIC_PREVIEW, feedTimeoutMs = 10000 } = {}) {
    this.mode = mode;
    this.publicPreview = publicPreview;
    this.storageKey = mode === 'demo' ? DEMO_STORAGE_KEY : LIVE_STORAGE_KEY;
    this.feedData = null;
    this.displayedItems = new Map();
    this.feedTimeoutMs = Number.isFinite(feedTimeoutMs) && feedTimeoutMs > 0 ? Math.min(feedTimeoutMs,10000) : 10000;
    this.loadStatus = {phase:'loading',fromCache:false,cachedAt:null,lastCheckedAt:null,errorKind:null,cacheWarning:false};
    this._feedRequest = null;
    this._refreshRequest = null;
    this.dotStorageWarning = null;
    this.localState = this._loadLocalState();
    this.listeners = new Set();
    this.researchNotice = null;
    this.pollingResearch = false;
  }

  _loadLocalState() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      this.lastPersistedText = saved;
      if (saved) {
        const parsed = JSON.parse(saved);
        const dot=loadDotRecords(parsed.dot_candidates);
        this.dotStorageWarning=dot.warning;
        return {
          saved_item_ids: Array.isArray(parsed.saved_item_ids) ? parsed.saved_item_ids : [],
          archived_item_ids: Array.isArray(parsed.archived_item_ids) ? parsed.archived_item_ids : [],
          saved_item_notes: parsed.saved_item_notes && typeof parsed.saved_item_notes==='object' && !Array.isArray(parsed.saved_item_notes) ? parsed.saved_item_notes : {},
          saved_item_excerpts: parsed.saved_item_excerpts && typeof parsed.saved_item_excerpts==='object' && !Array.isArray(parsed.saved_item_excerpts) ? parsed.saved_item_excerpts : {},
          hidden_item_ids: Array.isArray(parsed.hidden_item_ids) ? parsed.hidden_item_ids : [],
          followups: Array.isArray(parsed.followups) ? parsed.followups : [],
          topics: Array.isArray(parsed.topics) ? parsed.topics : [],
          dot_candidates: dot.records,
          kosx_pending: loadKosxPending(parsed.kosx_pending),
          profile_override: parsed.profile_override || null,
          item_snapshots: parsed.item_snapshots && typeof parsed.item_snapshots === 'object' && !Array.isArray(parsed.item_snapshots) ? parsed.item_snapshots : {},
        };
      }
    } catch (err) {
      console.warn('读取本地存储失败，使用默认状态:', err);
    }
    return structuredClone(defaultLocalState);
  }

  _persistLocalState() {
    if (this.dotStorageWarning) throw new Error(this.dotStorageWarning);
    try {
      const encoded = JSON.stringify(this.localState);
      try {localStorage.setItem(this.storageKey, encoded);}
      catch (err) {
        if (!['QuotaExceededError','NS_ERROR_DOM_QUOTA_REACHED'].includes(err.name) || !discardFeedCaches(localStorage)) throw err;
        this.loadStatus={...this.loadStatus,cacheWarning:true};
        localStorage.setItem(this.storageKey, encoded);
      }
      this.lastPersistedText = encoded;
      this._notifyListeners('local');
      return true;
    } catch (err) {
      console.error('保存本地状态失败:', err);
      throw new Error(`本地存储写入失败 (${err.name || 'Error'}): ${err.message || '请检查浏览器存储权限与配额'}`);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notifyListeners(reason = 'data') {
    for (const listener of this.listeners) {
      try {
        listener(this.getState(), { reason });
      } catch (e) {
        console.error('Listener callback error:', e);
      }
    }
  }

  /**
   * 加载信息流数据
   * 从当前模式对应的来源获取，失败抛出错误，严禁静默伪造替换。
   */
  restoreCachedFeed() {
    if (this.feedData) return this.getState();
    const scope=feedCacheScope(this.mode,this.publicPreview);
    if (!scope) return null;
    let cached;
    try {cached=readFeedCache(localStorage,scope);}
    catch {cached={feed:null,cachedAt:null,warning:true};}
    const changedWarning=this.loadStatus.cacheWarning !== cached.warning;
    this.loadStatus={...this.loadStatus,cacheWarning:cached.warning};
    if (!cached.feed) {if(changedWarning) this._notifyListeners();return null;}
    this.feedData=withPracticalMaterials(cached.feed);
    this.loadStatus={...this.loadStatus,phase:'cached',fromCache:true,cachedAt:cached.cachedAt,errorKind:null};
    this._notifyListeners();
    return this.getState();
  }

  loadFeed(force = false) {
    if (this._feedRequest) return this._feedRequest;
    if (this.feedData && !force) return Promise.resolve(this.getState());
    const url=this.publicPreview ? '/data/public-feed.json' : this.mode === 'demo' ? '/data/demo-feed.json' : '/api/feed';
    return this._startFeedRequest(url,this.publicPreview ? {cache:'no-store'} : {},this.feedTimeoutMs);
  }

  _feedError(kind,message) {return Object.assign(new Error(message),{errorKind:kind});}

  async _readFeedResponse(url,options,timeoutMs,requireRefresh) {
    const controller=new AbortController(),started=Date.now();
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{
      reject(this._feedError('timeout','读取超时，请稍后重试；已保留当前内容。'));
      controller.abort();
    },timeoutMs);});
    const request=(async()=>{
      const response=await fetch(url,{...options,signal:controller.signal});
      if (!response.ok) {
        await response.body?.cancel().catch(()=>{});
        throw this._feedError('network',`HTTP ${response.status} ${response.statusText || ''}`);
      }
      let data;
      try {
        if (typeof response.text === 'function') {
          const raw=await response.text();
          if (typeof raw !== 'string' || raw.length > MAX_FEED_RESPONSE_CHARS) throw this._feedError('format','内容长度超出读取范围');
          data=JSON.parse(raw);
        } else data=await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw this._feedError('timeout','读取超时，请稍后重试；已保留当前内容。');
        if (error.errorKind) throw error;
        if (error instanceof SyntaxError) throw this._feedError('format','内容格式异常，请稍后重试：无法解析内容');
        throw error;
      }
      if (Date.now()-started >= timeoutMs) throw this._feedError('timeout','读取超时，请稍后重试；已保留当前内容。');
      if (!validFeedResponse(data,this.mode,requireRefresh)) throw this._feedError('format',requireRefresh ? '更新内容不完整，保留当前内容。' : '内容格式异常，请稍后重试');
      if (requireRefresh && data.refresh.status === 'failed') throw this._feedError('network','暂时无法更新，保留页面当前内容，请稍后重试。');
      return data;
    })();
    try {return await Promise.race([request,timeout]);}
    finally {clearTimeout(timer);}
  }

  _startFeedRequest(url,options,timeoutMs,requireRefresh=false) {
    if (this._feedRequest) return this._feedRequest;
    // Assign the shared promise before notifying: a listener may request a load.
    const operation=Promise.resolve().then(()=>this._readFeedResponse(url,options,timeoutMs,requireRefresh)).then(data=>{
      const previous=this.feedData;
      try {this.feedData=withPracticalMaterials(data);this.getState();}
      catch {this.feedData=previous;throw this._feedError('format',requireRefresh ? '更新内容不完整，保留当前内容。' : '内容格式异常，请稍后重试');}
      let cached;
      try {cached=writeFeedCache(localStorage,feedCacheScope(this.mode,this.publicPreview),data);}
      catch {cached={cachedAt:null,warning:this.mode==='live'};}
      this.loadStatus={phase:'ready',fromCache:false,cachedAt:cached.cachedAt || this.loadStatus.cachedAt,
        lastCheckedAt:new Date().toISOString(),errorKind:null,cacheWarning:cached.warning};
      this._notifyListeners();
      return this.getState();
    }).catch(error=>{
      const errorKind=error.errorKind || 'network';
      this.loadStatus={...this.loadStatus,phase:'error',lastCheckedAt:new Date().toISOString(),errorKind};
      this._notifyListeners();
      if (errorKind !== 'network') throw error;
      const label=this.publicPreview ? '已发布内容' : this.mode==='demo' ? 'data/demo-feed.json' : '本机内容';
      throw this._feedError(errorKind,`读取 ${label} 失败: ${error.message || '无法读取内容'}`);
    }).finally(()=>{if(this._feedRequest===operation) this._feedRequest=null;});
    this._feedRequest=operation;
    this.loadStatus={...this.loadStatus,phase:'loading',errorKind:null};
    this._notifyListeners();
    return operation;
  }

  refreshFeed() {
    if (this.publicPreview) return this.loadFeed(true).then(()=>this.feedData.publication?.automatic_update
      ? '已读取最近完成的云端更新。每天自动更新两次；本次点击不会触发抓取。'
      : '已重新读取发布内容。获取时间见各来源；这里不实时采集原站。');
    if (this.mode === 'demo') return Promise.reject(new Error('示例模式不获取真实内容'));
    if (this._refreshRequest) return this._refreshRequest;
    const operation=Promise.resolve().then(async()=>{
      // A local POST asks the service to collect, unlike a GET. Queue it after
      // an existing read, and let concurrent POST callers share this operation.
      if (this._feedRequest) {try {await this._feedRequest;} catch { /* A manual retry may still work. */ }}
      await this._startFeedRequest('/api/feed/refresh',{method:'POST',headers:{'X-Personal-Feed':'1'}},this.feedTimeoutMs*2,true);
      return this.feedData.update_notice || this.feedData.refresh.message;
    }).finally(()=>{if(this._refreshRequest===operation) this._refreshRequest=null;});
    this._refreshRequest=operation;
    return operation;
  }

  rememberItem(itemId) {
    if (this.localState.saved_item_ids.includes(itemId) && this.localState.item_snapshots[itemId]) return;
    const available=this.displayedItems.has(itemId) || this.localState.item_snapshots[itemId] || this.feedData?.items.some(item=>item.id===itemId || item.alias_ids?.includes(itemId)) || this.mode==='live' && CREATOR_MATERIALS.some(item=>item.id===itemId) || this.localState.dot_candidates?.some(record=>record.status==='featured' && record.id===itemId);
    if (available) this.localState.item_snapshots[itemId] = this.topicItem(itemId);
  }

  setDisplayedItems(items) {
    // Only a real page paint replaces these transient copies. A background
    // response must not change the material behind an untouched card.
    this.displayedItems = new Map();
    for (const item of items) {
      const snapshot=structuredClone(item);
      this.displayedItems.set(item.id,snapshot);
      for (const alias of item.alias_ids || []) this.displayedItems.set(alias,snapshot);
    }
  }

  getState() {
    if (!this.feedData) return null;

    const profile = this.localState.profile_override || this.feedData.profile;
    const baseVisibleItems = this.mode === 'live'
      ? this.feedData.items.filter(item => !item.source_refs?.length || item.source_refs.some(id => !RETIRED_LIVE_SOURCES.has(id)))
      : this.feedData.items;
    const storedCandidates=structuredClone(this.localState.dot_candidates || []);
    const dotFeaturedItems=storedCandidates.filter(record=>record.status==='featured').map(record=>record.item);
    const dotCandidates=[...storedCandidates, ...kosxCandidateViews(this.localState.kosx_pending)];
    const visibleItems=[...baseVisibleItems,...dotFeaturedItems];
    const practicalCount = this.feedData.items.filter(item => practicalMaterialKind(item)).length;
    const creatorItems = this.mode==='live' ? CREATOR_MATERIALS : [];
    const itemMap = new Map([...creatorItems, ...dotFeaturedItems, ...Object.values(this.localState.item_snapshots), ...this.feedData.items].map(item => [item.id, item]));
    const sourceMap = new Map(this.feedData.sources.map(s => [s.id, s]));
    if (!sourceMap.has('bilibili-hot-search') && [...itemMap.values()].some(item => item.source_refs?.includes('bilibili-hot-search'))) {
      sourceMap.set('bilibili-hot-search',{id:'bilibili-hot-search',name:'B站热搜',home_url:'https://www.bilibili.com'});
    }
    sourceMap.set('user-added',{id:'user-added',name:'手动添加'});
    for (const item of [...dotCandidates.map(record=>record.item),...itemMap.values()].filter(isCandidateImport)) {
      const source=candidateSource(item.collector);sourceMap.set(source.id,source);
    }
    if (creatorItems.length) sourceMap.set(CREATOR_MATERIAL_SOURCE.id,CREATOR_MATERIAL_SOURCE);

    // 过滤出可见的 daily 和 discover 条目（排除 hidden_item_ids）
    let dailyItems = (this.feedData.sections.daily || [])
      .map(id => itemMap.get(id))
      .filter(item => item && !this.localState.hidden_item_ids.includes(item.id));

    let discoverItems = (this.feedData.sections.discover || [])
      .map(id => itemMap.get(id))
      .filter(item => item && !this.localState.hidden_item_ids.includes(item.id));

    let selection = null;
    if (this.mode === 'live') {
      // The curated reference shelf is not a newly published news feed. Keep
      // documentation read times out of the generic recent-material shortlist.
      selection = selectFeed(baseVisibleItems.filter(item => !practicalMaterialKind(item)), profile, this.localState.hidden_item_ids);
      // Presentation is derived. Never rewrite stored source items or snapshots.
      for (const item of selection.decorated) itemMap.set(item.id, item);
      dailyItems = selection.daily;
      discoverItems = selection.discover;
    }
    for (const item of [...itemMap.values()]) for (const alias of item.alias_ids || []) itemMap.set(alias, item);

    // 收藏条目
    const savedItems = [];
    for (const id of this.localState.saved_item_ids) {
      const item=this.localState.item_snapshots[id] || itemMap.get(id);
      if (item && !savedItems.some(saved=>sameMaterial(saved,item) || sameMaterial(itemMap.get(saved.id) || saved,itemMap.get(id) || item))) savedItems.push(structuredClone(item));
    }
    const savedItemIds=new Set([...this.localState.saved_item_ids,...savedItems.map(item=>item.id)]);
    for (const item of this.feedData.items) if (savedItems.some(saved=>sameMaterial(saved,item))) {
      savedItemIds.add(item.id);for (const alias of item.alias_ids || []) savedItemIds.add(alias);
    }
    const archivedSnapshots=(this.localState.archived_item_ids || []).map(id=>this.localState.item_snapshots[id]).filter(Boolean);
    const archivedItems=savedItems.filter(item=>archivedSnapshots.some(archived=>sameMaterial(archived,item)));
    const archivedItemIds=new Set(archivedItems.map(item=>item.id));
    for (const item of this.feedData.items) if (archivedItems.some(archived=>sameMaterial(archived,item))) {
      archivedItemIds.add(item.id);for (const alias of item.alias_ids || []) archivedItemIds.add(alias);
    }

    // 隐藏条目
    const hiddenItems = [...new Map(this.localState.hidden_item_ids
      .map(id => itemMap.get(id))
      .filter(Boolean).map(item => [item.id, item])).values()];

    return {
      schema_version: this.feedData.schema_version,
      mode: this.feedData.mode,
      publicPreview: this.publicPreview,
      loadStatus: {...this.loadStatus},
      publication: this.feedData.publication || null,
      generated_at: this.feedData.generated_at,
      underratedPins: Array.isArray(this.feedData.underrated_pins) ? this.feedData.underrated_pins : [],
      refresh: this.feedData.refresh || null,
      update_notice: this.feedData.mode === 'live' && practicalCount ? [this.feedData.update_notice, `另附 ${practicalCount} 条官方说明整理，未实测；这些材料不随云端定时更新。`].filter(Boolean).join(' ') : this.feedData.update_notice || null,
      profile,
      has_profile_override: Boolean(this.localState.profile_override),
      // Hide retired sources in old caches without deleting saved snapshots or
      // the source map used by historical materials.
      sources: this.mode === 'live' ? this.feedData.sources.filter(source => !RETIRED_LIVE_SOURCES.has(source.id)) : this.feedData.sources,
      sourceMap,
      itemMap,
      allItems: visibleItems,
      dotCandidates,
      dotPendingCandidates:dotCandidates.filter(record=>record.status==='pending'),
      dotFeaturedItems,
      dotStorageWarning:this.dotStorageWarning,
      creatorItems,
      selection,
      researchNotice: this.researchNotice,
      repositoryGuideStatus: this.feedData.repository_guide_status || null,
      dailyItems,
      discoverItems,
      savedItems,
      activeSavedItems:savedItems.filter(item=>!archivedItemIds.has(item.id)),
      archivedItems,
      archivedItemIds,
      hiddenItems,
      savedItemIds,
      savedItemNotes: structuredClone(this.localState.saved_item_notes || {}),
      savedItemExcerpts: structuredClone(this.localState.saved_item_excerpts || {}),
      hiddenItemIds: new Set(this.localState.hidden_item_ids),
      followups: this.localState.followups,
      topicSyncRows: planTopicSync(this.localState),
      topics: structuredClone(this.localState.topics || []).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)),
    };
  }

  ensureCurrentStorage() {
    if (this.dotStorageWarning) throw new Error(this.dotStorageWarning);
    if (localStorage.getItem(this.storageKey) !== (this.lastPersistedText ?? null)) throw new Error('资料已在另一个页面更新，请先刷新本页，再继续操作。');
  }

  topicTransaction(change) {
    this.ensureCurrentStorage();
    const previous=this.localState, next=structuredClone(previous);
    next.topics ||= [];
    const result=change(next);
    // A saved topic must remain fully recoverable in the existing backup format.
    makeBackup(next,this.feedData,this.mode);
    this.localState=next;
    try { this._persistLocalState(); return structuredClone(result); }
    catch(error) { this.localState=previous; throw error; }
  }

  topicItem(itemId,itemSnapshot=null) {
    if (itemSnapshot && itemSnapshot.id!==itemId && !itemSnapshot.alias_ids?.includes(itemId)) throw Error('材料副本与所选条目不一致，请重新选择。');
    const preserved=this.localState.saved_item_ids.includes(itemId) ? this.localState.item_snapshots[itemId] : null;
    const item=itemSnapshot || preserved || this.displayedItems.get(itemId) || this.feedData?.items.find(item=>item.id===itemId || item.alias_ids?.includes(itemId)) || this.localState.item_snapshots[itemId] || (this.mode==='live' && CREATOR_MATERIALS.find(item=>item.id===itemId)) || this.localState.dot_candidates?.find(record=>record.status==='featured' && record.id===itemId)?.item;
    if (!item) throw Error('这条材料暂不可用，请先返回信息流重新选择。');
    const saved=this.localState.saved_item_ids.map(id=>this.localState.item_snapshots[id]).find(saved=>saved && sameMaterial(saved,item));
    return structuredClone(itemSnapshot || saved || item);
  }

  collectionNote(itemId) {
    const item=this.topicItem(itemId);
    return this.localState.saved_item_notes?.[item.id]?.note || '';
  }

  collectionExcerpt(itemId) {
    const item=this.topicItem(itemId);
    return structuredClone(this.localState.saved_item_excerpts?.[item.id] || null);
  }

  addManualMaterial(input,{topicId=null,newTopic=null}={}) {
    const item=makeManualMaterial(input),note=validateCollectionNote(input.note ?? '');
    const excerpt=makeManualExcerpt(input.excerpt ?? '',item.original_url);
    const values=newTopic ? validateTopicInput({...blankTopic(),...newTopic}) : null;
    if(topicId && newTopic) throw Error('请选择一个保存位置。');
    return this.topicTransaction(state=>{
      if(state.saved_item_ids.some(id=>materialLinkKey(state.item_snapshots[id]?.original_url)===item.canonical_url))
        throw Error('这条链接已经收藏。请在收藏页修改摘录，或把已有材料放进主题。');
      const now=new Date().toISOString();
      let topic=topicId ? state.topics.find(t=>t.id===topicId) : null;
      if(topicId && !topic) throw Error('主题不存在，请刷新后重新选择。');
      if(topic?.materials.some(m=>materialLinkKey(m.item.original_url)===item.canonical_url)) throw Error('这条链接已在这个主题里，请修改已有材料。');
      if(values) {
        topic={...values,id:`topic-${crypto.randomUUID()}`,created_at:now,updated_at:now,materials:[]};
        state.topics.push(topic);
      }
      state.item_snapshots[item.id]=item;state.saved_item_ids.unshift(item.id);
      state.saved_item_notes ||= {};state.saved_item_excerpts ||= {};
      if(note) state.saved_item_notes[item.id]={note,updated_at:now};
      if(excerpt) state.saved_item_excerpts[item.id]=excerpt;
      if(topic) {topic.materials.push({item:structuredClone(item),note,manual_excerpt:excerpt,added_at:now,collection_sync:makeTopicSyncBaseline(item,note,excerpt)});topic.updated_at=now;}
      return {item,topic_id:topic?.id || null};
    });
  }

  importDotCandidates(raw) {
    const parsed=parseDotCandidates(raw);
    return this.topicTransaction(state=>{
      state.dot_candidates ||= [];
      const candidateKeys=new Set(state.dot_candidates.map(record=>record.key));
      const existingKeys=new Set([...(this.feedData?.items || []),...Object.values(state.item_snapshots || {}),...(state.topics || []).flatMap(topic=>topic.materials.map(material=>material.item))]
        .map(item=>dotPostKey(item.original_url) || dotPostKey(item.canonical_url)).filter(Boolean));
      const seen=new Set(),now=new Date().toISOString(),importedIds=[];
      let duplicates=0,existing=0,alternatives=0;
      for (const [group,materials] of [['items',parsed.items],['alternatives',parsed.alternatives]]) for (const material of materials) {
        const key=dotPostKey(material.original_url);
        if (seen.has(key) || candidateKeys.has(key)) {duplicates++;seen.add(key);continue;}
        seen.add(key);
        if (existingKeys.has(key)) {existing++;continue;}
        const record=makeDotCandidate(material,{collector:parsed.collector,collected_at:parsed.collected_at,group},now);
        state.dot_candidates.push(record);candidateKeys.add(key);importedIds.push(record.id);
        if (group==='alternatives') alternatives++;
      }
      validateDotCandidateRecords(state.dot_candidates);
      return {added:importedIds.length,duplicates,existing,total:parsed.total,alternatives,alternativesTotal:parsed.alternatives.length,importedIds};
    });
  }

  async submitKosxLink(raw) {
    const parsed=kosxLink(raw);
    if (!parsed) throw Error('请粘贴有效的 X 链接');
    let response;
    try {
      response=await fetch('/api/dot/pending', {
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({url:parsed.url}),
      });
    } catch {
      throw Error('没有放入待筛选。');
    }
    let body={};
    try { body=await response.json(); } catch { body={}; }
    if (!response.ok || !body || body.status!=='pending') throw Error(typeof body?.message==='string' && body.message ? body.message : '没有放入待筛选。');
    const restored=(this.localState.kosx_pending || []).some(row=>row.key===parsed.key && row.status==='dismissed');
    try { this.rememberKosxPending(parsed, body); } catch { /* 服务端已收下；本机列表写失败时仍按待筛选成功返回。 */ }
    return {added:body.existing!==true && !restored, restored, duplicate:body.existing===true && !restored, id:typeof body.id==='string' && body.id ? body.id : parsed.id};
  }

  rememberKosxPending(parsed, body) {
    const submitted_at=typeof body?.submitted_at==='string' && body.submitted_at.length<=64 && Number.isFinite(Date.parse(body.submitted_at)) ? body.submitted_at : new Date().toISOString();
    return this.topicTransaction(state=>{
      state.kosx_pending ||= [];
      const existing=state.kosx_pending.find(row=>row.key===parsed.key);
      if (existing) {
        if (existing.status==='dismissed') existing.status='pending';
        return {mirrored:true};
      }
      if (state.kosx_pending.length>=300) throw Error('待筛选已满，请先处理已有链接。');
      state.kosx_pending.push({...parsed, status:'pending', submitted_at});
      return {mirrored:true};
    });
  }

  setDotCandidateStatus(ids,status) {
    if (!Array.isArray(ids) || !ids.length || ids.length>300 || new Set(ids).size!==ids.length || ids.some(id=>typeof id!=='string') || !['pending','featured','dismissed'].includes(status)) throw Error('请勾选素材，再选择筛选结果。');
    return this.topicTransaction(state=>{
      state.kosx_pending ||= [];
      const kosxWanted=ids.filter(id=>state.kosx_pending.some(row=>row.id===id));
      if (kosxWanted.length && status==='featured') throw Error('KOSX 提交只留在待筛选，不会自动出现在首页。');
      const records=state.dot_candidates || [];
      const dotIds=ids.filter(id=>!kosxWanted.includes(id));
      const wanted=new Set(dotIds);
      if (dotIds.some(id=>!records.some(record=>record.id===id))) throw Error('素材已变化，请刷新后重新选择。');
      let changed=0;const now=new Date().toISOString();
      for (const row of state.kosx_pending) if (kosxWanted.includes(row.id) && row.status!==status) { row.status=status; changed++; }
      for (const record of records) if (wanted.has(record.id) && record.status!==status) {
        record.status=status;record.featured_at=status==='featured' ? now : null;changed++;
      }
      validateDotCandidateRecords(records);
      return {changed,status,ids:[...ids]};
    });
  }

  createDotFeaturedExport() {
    this.ensureCurrentStorage();
    return createDotFeaturedExport(this.localState.dot_candidates || []);
  }

  saveCollectionContent(itemId,{note,excerpt}) {
    const value=validateCollectionNote(note),item=this.topicItem(itemId);
    if (!this.getState().savedItemIds.has(itemId)) throw Error('请先收藏这条材料，再补摘录与想法。');
    const pasted=makeManualExcerpt(excerpt,item.original_url,this.collectionExcerpt(itemId));
    return this.topicTransaction(state=>{
      state.saved_item_notes ||= {};state.saved_item_excerpts ||= {};
      if (value) state.saved_item_notes[item.id]={note:value,updated_at:new Date().toISOString()};
      else delete state.saved_item_notes[item.id];
      if (pasted) state.saved_item_excerpts[item.id]=pasted;
      else delete state.saved_item_excerpts[item.id];
      return {item_id:item.id,note:value,manual_excerpt:pasted};
    });
  }

  saveCollectionNote(itemId,note) {
    const value=validateCollectionNote(note),item=this.topicItem(itemId);
    if (!this.getState().savedItemIds.has(itemId)) throw Error('请先收藏这条材料，再补想法。');
    return this.topicTransaction(state=>{
      state.saved_item_notes ||= {};
      if (value) state.saved_item_notes[item.id]={note:value,updated_at:new Date().toISOString()};
      else delete state.saved_item_notes[item.id];
      return {item_id:item.id,note:value};
    });
  }

  setArchived(itemId,archived) {
    if (typeof archived!=='boolean') throw Error('请选择归档或恢复。');
    const item=this.topicItem(itemId),current=this.getState();
    if (!current.savedItemIds.has(itemId)) throw Error('请先收藏这条材料，再归档。');
    return this.topicTransaction(state=>{
      const flags=(state.archived_item_ids || []).filter(id=>!sameMaterial(state.item_snapshots[id] || {id},item));
      if (archived) flags.push(item.id);
      state.archived_item_ids=flags;
      return {item_id:item.id,archived};
    });
  }

  restoreSaved(itemId,{archived=false}={}) {
    const item=structuredClone(this.localState.item_snapshots[itemId] || this.topicItem(itemId));
    return this.topicTransaction(state=>{
      if (!state.saved_item_ids.some(id=>sameMaterial(state.item_snapshots[id] || {id},item))) state.saved_item_ids.unshift(item.id);
      state.item_snapshots[item.id] ||= item;
      state.archived_item_ids=(state.archived_item_ids || []).filter(id=>!sameMaterial(state.item_snapshots[id] || {id},item));
      if (archived) state.archived_item_ids.push(item.id);
      return {item_id:item.id,archived};
    });
  }

  createTopic(input,itemId=null,note=undefined,excerpt=undefined,itemSnapshot=null) {
    const values=validateTopicInput({...blankTopic(),...input});
    const now=new Date().toISOString();
    const item=itemId ? this.topicItem(itemId,itemSnapshot) : null;
    const priorExcerpt=item ? this.localState.saved_item_excerpts?.[item.id] || null : null;
    const pasted=item ? (excerpt===undefined ? structuredClone(priorExcerpt) : makeManualExcerpt(excerpt,item.original_url,priorExcerpt)) : null;
    const baseline=item && this.localState.saved_item_ids.includes(item.id) ? makeTopicSyncBaseline(item,this.localState.saved_item_notes?.[item.id]?.note ?? '',priorExcerpt) : null;
    const topic={...values,id:`topic-${crypto.randomUUID()}`,created_at:now,updated_at:now,materials:item ? [{item,note:validateCollectionNote(note ?? this.localState.saved_item_notes?.[item.id]?.note ?? ''),manual_excerpt:pasted,added_at:now,...(baseline ? {collection_sync:baseline}: {})}]:[]};
    return this.topicTransaction(state=>{ state.topics.push(topic);return topic; });
  }

  updateTopic(topicId,input) {
    const values=validateTopicInput(input);
    return this.topicTransaction(state=>{
      const topic=state.topics.find(t=>t.id===topicId);if (!topic) throw Error('主题不存在，请刷新后重试。');
      Object.assign(topic,values,{updated_at:new Date().toISOString()});return topic;
    });
  }

  addToTopic(topicId,itemId,note=undefined,excerpt=undefined,itemSnapshot=null) {
    const item=this.topicItem(itemId,itemSnapshot);
    const reason=validateCollectionNote(note ?? this.localState.saved_item_notes?.[item.id]?.note ?? '');
    const priorExcerpt=this.localState.saved_item_excerpts?.[item.id] || null;
    const pasted=excerpt===undefined ? structuredClone(priorExcerpt) : makeManualExcerpt(excerpt,item.original_url,priorExcerpt);
    return this.topicTransaction(state=>{
      const topic=state.topics.find(t=>t.id===topicId);if (!topic) throw Error('请先选择一个主题。');
      if (topic.materials.some(m=>sameMaterial(m.item,item))) throw Error('这条材料已在主题里，不用重复收藏。');
      const baseline=state.saved_item_ids.includes(item.id) ? makeTopicSyncBaseline(item,state.saved_item_notes?.[item.id]?.note ?? '',priorExcerpt) : null;
      const now=new Date().toISOString();topic.materials.push({item,note:reason,manual_excerpt:pasted,added_at:now,...(baseline ? {collection_sync:baseline}: {})});topic.updated_at=now;return topic;
    });
  }

  updateTopicNote(topicId,itemId,note) {
    return this.topicTransaction(state=>{
      const topic=state.topics.find(t=>t.id===topicId), material=topic?.materials.find(m=>m.item.id===itemId);
      if (!material) throw Error('这条主题材料不存在。');
      material.note=note.trim();topic.updated_at=new Date().toISOString();return topic;
    });
  }

  updateTopicContent(topicId,itemId,{note,excerpt}) {
    const reason=validateCollectionNote(note);
    return this.topicTransaction(state=>{
      const topic=state.topics.find(t=>t.id===topicId),material=topic?.materials.find(m=>m.item.id===itemId);
      if (!material) throw Error('这条主题材料不存在。');
      material.manual_excerpt=makeManualExcerpt(excerpt,material.item.original_url,material.manual_excerpt);
      material.note=reason;topic.updated_at=new Date().toISOString();return topic;
    });
  }

  removeTopicMaterial(topicId,itemId) {
    return this.topicTransaction(state=>{
      const topic=state.topics.find(t=>t.id===topicId),index=topic?.materials.findIndex(m=>m.item.id===itemId);
      if (!topic || index<0) throw Error('这条主题材料不存在。');
      const [material]=topic.materials.splice(index,1);topic.updated_at=new Date().toISOString();return material;
    });
  }

  restoreTopicMaterial(topicId,material) {
    return this.topicTransaction(state=>{
      const topic=state.topics.find(t=>t.id===topicId);if (!topic) throw Error('主题不存在。');
      if (!topic.materials.some(m=>sameMaterial(m.item,material.item))) topic.materials.push(structuredClone(material));
      topic.updated_at=new Date().toISOString();return topic;
    });
  }

  previewTopicSync(topicId,itemId) {
    this.ensureCurrentStorage();
    const row=planTopicSync(this.localState,topicId).find(row=>row.item_id===itemId);
    if (!row) throw Error('这条材料已没有待处理变化，请刷新查看。');
    return structuredClone(row);
  }

  applyTopicSync(preview,options={}) {
    return this.topicTransaction(state=>{
      const result=applySync(state,preview,{...options,now:new Date().toISOString()});
      state.topics=result.state.topics;return result.summary;
    });
  }

  exportTopic(topicId,options) {
    this.ensureCurrentStorage();
    const topic=this.localState.topics?.find(t=>t.id===topicId);if (!topic) throw Error('主题不存在。');
    const count=planTopicSync(this.localState,topicId).length;
    const output=buildTopicMaterial(topic,options);
    return count ? output+'\n\n## 尚待选择的收藏变化\n\n'+count+' 条材料的收藏摘录或想法与主题不同。本次仍带走主题中保留的内容，没有自动替换；不要把它们当成最新收藏版本。\n' : output;
  }

  createBackup() {
    this.ensureCurrentStorage();
    return makeBackup(this.localState, this.feedData, this.mode);
  }

  previewBackup(raw, options = {}) {
    this.ensureCurrentStorage();
    const backup = parseBackup(raw, this.mode);
    return { raw, backup, ...planRestore(this.localState, backup, options), baseline: JSON.stringify(this.localState) };
  }

  restoreBackup(preview, options = {}) {
    this.ensureCurrentStorage();
    if (!preview || preview.baseline !== JSON.stringify(this.localState)) throw new Error('资料在预览后有更新，请点击“重新预览”，核对后再恢复。');
    const backup = parseBackup(preview.raw, this.mode);
    const { next, summary } = planRestore(this.localState, backup, options);
    if (!summary.hasChanges) return summary;
    const previous = this.localState;
    this.localState = next;
    try { this._persistLocalState(); return summary; }
    catch (error) { this.localState = previous; throw error; }
  }

  // 1. 切换收藏状态
  setSaved(itemId, isSaved) {
    this.ensureCurrentStorage();
    const item=this.topicItem(itemId);
    const previous=structuredClone(this.localState);
    const set = new Set(this.localState.saved_item_ids);
    if (isSaved) {
      if (this.getState().savedItemIds.has(itemId) || this.getState().savedItems.some(saved=>sameMaterial(saved,item))) return true;
      this.localState.item_snapshots[item.id] ||= structuredClone(item);
      this.localState.saved_item_ids=[item.id,...set];
    } else {
      const current=this.getState().itemMap.get(itemId) || item;
      for (const id of set) if ([itemId,item.id,current.id,...(current.alias_ids || [])].includes(id) || sameMaterial(this.localState.item_snapshots[id] || {id},current)) set.delete(id);
      this.localState.saved_item_ids=Array.from(set);
      this.localState.archived_item_ids=(this.localState.archived_item_ids || []).filter(id=>set.has(id));
    }

    try {
      this._persistLocalState();
      return true;
    } catch (err) {
      this.localState=previous;
      throw err;
    }
  }

  // 2. 隐藏（不感兴趣）
  setHidden(itemId, isHidden) {
    const prev = [...this.localState.hidden_item_ids];
    const prevSnapshots = structuredClone(this.localState.item_snapshots);
    if (isHidden) this.rememberItem(itemId);
    const set = new Set(this.localState.hidden_item_ids);
    if (isHidden) {
      set.add(itemId);
    } else {
      const item = this.getState().itemMap.get(itemId);
      for (const id of [itemId, item?.id, ...(item?.alias_ids || [])]) set.delete(id);
    }
    this.localState.hidden_item_ids = Array.from(set);

    try {
      this._persistLocalState();
      return true;
    } catch (err) {
      this.localState.hidden_item_ids = prev;
      this.localState.item_snapshots = prevSnapshots;
      throw err;
    }
  }

  // 恢复所有已隐藏条目
  restoreAllHidden() {
    const prev = [...this.localState.hidden_item_ids];
    this.localState.hidden_item_ids = [];

    try {
      this._persistLocalState();
      return true;
    } catch (err) {
      this.localState.hidden_item_ids = prev;
      throw err;
    }
  }

  // 3. 保存关注偏好
  saveProfile(profile) {
    const prev = this.localState.profile_override;
    this.localState.profile_override = {
      interests: profile.interests || '',
      exclude: profile.exclude || '',
      language: profile.language || 'zh-CN',
    };

    try {
      this._persistLocalState();
      return true;
    } catch (err) {
      this.localState.profile_override = prev;
      throw err;
    }
  }

  // 重置关注偏好为默认示例偏好
  resetProfile() {
    const prev = this.localState.profile_override;
    this.localState.profile_override = null;

    try {
      this._persistLocalState();
      return true;
    } catch (err) {
      this.localState.profile_override = prev;
      throw err;
    }
  }

  // 清空偏好用于测试“尚未设置关注”状态
  clearProfile() {
    const prev = this.localState.profile_override;
    this.localState.profile_override = {
      interests: '',
      exclude: '',
      language: 'zh-CN',
    };

    try {
      this._persistLocalState();
      return true;
    } catch (err) {
      this.localState.profile_override = prev;
      throw err;
    }
  }

  // 4. 跟进任务管理
  getFollowupForItem(itemId) {
    const item=this.getState()?.itemMap.get(itemId);
    return this.localState.followups.find(f => f.item_id === itemId || item?.alias_ids?.includes(f.item_id));
  }

  saveFollowupDraft(itemId, question) {
    const prevSnapshots = structuredClone(this.localState.item_snapshots);
    this.rememberItem(itemId);
    const now = new Date().toISOString();
    const existing = this.getFollowupForItem(itemId);
    const active = existing && ['requesting', 'reading', 'analyzing'].includes(existing.status);
    if (active && existing.question !== question.trim()) throw new Error('这项整理正在进行，请等结果返回后再修改问题。');
    if (existing?.status === 'done' && existing.question === question.trim()) return existing;
    const newQuestion = existing && ['done', 'failed'].includes(existing.status) && existing.question !== question.trim();

    if (existing && !newQuestion) {
      const prevQuestion = existing.question;
      const prevUpdated = existing.updated_at;
      existing.question = question.trim();
      existing.updated_at = now;

      try {
        this._persistLocalState();
        return existing;
      } catch (err) {
        existing.question = prevQuestion;
        existing.updated_at = prevUpdated;
        this.localState.item_snapshots = prevSnapshots;
        throw err;
      }
    }

    const newTask = {
      id: 'followup-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      item_id: itemId,
      question: question.trim(),
      status: 'draft', // 待交给 AI
      created_at: now,
      updated_at: now,
      target_agent: null,
      delivery_receipt: null,
      result: null,
    };

    this.localState.followups.unshift(newTask);

    try {
      this._persistLocalState();
      return newTask;
    } catch (err) {
      this.localState.followups.shift();
      this.localState.item_snapshots = prevSnapshots;
      throw err;
    }
  }

  async startResearch(taskId) {
    if (this.publicPreview) throw new Error('公开预览只保存问题与材料。请复制给你自己的 AI 继续，不会连接站长的 Codex。');
    if (this.mode !== 'live') throw new Error('示例模式不能启动真实整理');
    const task = this.localState.followups.find(t => t.id === taskId);
    if (!task) throw new Error('请先保存问题');
    if(this.getState().itemMap.get(task.item_id)?.origin==='user_added') throw Error('手动链接目前只用于收藏和主题整理；不会自动读取网页或调用 AI。');
    if (!repositoryName(this.getState().itemMap.get(task.item_id) || {})) throw new Error('资讯条目可以保存问题、打开原文或导出材料；目前自动整理仅支持 GitHub 项目说明。');
    if (task.status === 'done') return task;
    if (['reading', 'analyzing'].includes(task.status)) return task;
    const old = structuredClone(task);
    task.research_request_id = task.status === 'requesting' && task.research_request_id ? task.research_request_id : crypto.randomUUID();
    task.status = 'requesting'; task.error_message = null;
    try { this._persistLocalState(); } catch (error) { for (const key of Object.keys(task)) delete task[key]; Object.assign(task, old); throw error; }
    let response;
    try {
      response = await fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Personal-Feed': '1' },
        body: JSON.stringify({ request_id: task.research_request_id, item_id: task.item_id, question: task.question }), signal: AbortSignal.timeout(25000) });
    } catch {
      this.researchNotice = '暂时无法确认整理是否已开始。可点“重试连接”，不会重复启动同一请求。';
      this._notifyListeners(); throw new Error(this.researchNotice);
    }
    const data = await response.json();
    if (!response.ok) {
      task.status = 'failed'; task.error_message = data.error || '未能开始整理';
      this._persistLocalState(); throw new Error(task.error_message);
    }
    this.applyResearchJob(task, data);
    return task;
  }

  applyResearchJob(task, job) {
    if (job.id !== task.research_request_id || job.item_id !== task.item_id || !['reading', 'analyzing', 'done', 'failed'].includes(job.status)) throw new Error('收到的整理记录与当前任务不一致');
    if (job.status === 'done' && !job.report) throw new Error('结果尚不完整');
    if (task.research?.id === job.id && ['done', 'failed'].includes(task.research.status) && ['reading', 'analyzing'].includes(job.status)) return;
    if (JSON.stringify(task.research) === JSON.stringify(job)) return;
    const before = structuredClone(task);
    task.research = job; task.status = job.status; task.target_agent = 'Codex';
    task.error_message = job.error || null; task.updated_at = job.updated_at;
    this.researchNotice = null;
    try { this._persistLocalState(); }
    catch (error) { for (const key of Object.keys(task)) delete task[key]; Object.assign(task, before); throw error; }
  }

  async syncResearch() {
    if (this.publicPreview || this.mode !== 'live' || this.pollingResearch) return;
    this.pollingResearch = true;
    const tasks = this.localState.followups.filter(task => task.research_request_id && ['requesting', 'reading', 'analyzing'].includes(task.status));
    try {
      for (const task of tasks) {
        const response = await fetch(`/api/research/${encodeURIComponent(task.research_request_id)}`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('整理状态暂时无法读取。服务恢复后会继续查看，也可手动重试连接。');
        this.applyResearchJob(task, await response.json());
      }
    } catch (error) {
      this.researchNotice = error.message || '暂时无法读取整理结果'; this._notifyListeners();
    } finally { this.pollingResearch = false; }
  }

  getTrialPlan(taskId) {
    const task = this.localState.followups.find(entry => entry.id === taskId);
    if (!task) throw new Error('没有找到这项跟进。');
    return structuredClone(task.trial_plan || createTrialPlan(task));
  }

  saveTrialPlan(taskId, input) {
    const task = this.localState.followups.find(entry => entry.id === taskId);
    const original = createTrialPlan(task);
    const values = validateTrialInput(input);
    const before = task.trial_plan;
    if (before && ['worked', 'blocked'].includes(values.outcome) && (values.goal !== before.goal || values.steps !== before.steps) && values.notes === before.notes) throw new Error('目标或步骤变了，请同步更新实际观察，或把进度改回还没开始。');
    const now = new Date().toISOString();
    task.trial_plan = {
      ...original, ...values,
      edited_fields: ['goal', 'steps', 'shots'].filter(field => values[field] !== original[field]),
      created_at: before?.created_at || now, updated_at: now,
    };
    try { this._persistLocalState(); return structuredClone(task.trial_plan); }
    catch (error) { if (before) task.trial_plan = before; else delete task.trial_plan; throw error; }
  }

  exportTrialText(taskId) {
    const task = this.localState.followups.find(entry => entry.id === taskId);
    if (!task?.trial_plan) throw new Error('请先保存试用清单。');
    const item = this.getState().itemMap.get(task.item_id);
    const origin = task.imported_backup ? '资料来源：从备份恢复的历史记录，本轮未重新核验。\n\n' : '';
    return origin + exportTrialPlan(task.trial_plan, item?.display_title || item?.title);
  }

  getWritingBrief(taskId) {
    const task = this.localState.followups.find(entry => entry.id === taskId);
    const initial = createWritingBrief(task);
    return structuredClone(task.writing_brief || initial);
  }

  prepareWritingMaterial(taskId, input) {
    const task = this.localState.followups.find(entry => entry.id === taskId);
    const item = this.getState().itemMap.get(task?.item_id);
    return buildWritingMaterial(task, item, input || this.getWritingBrief(taskId));
  }

  saveWritingBrief(taskId, input) {
    this.ensureCurrentStorage();
    const task = this.localState.followups.find(entry => entry.id === taskId);
    const initial = createWritingBrief(task);
    const values = validateWritingInput(input);
    const before = task.writing_brief;
    const now = new Date().toISOString();
    task.writing_brief = {...initial, ...values, created_at: before?.created_at || now, updated_at: now};
    try { this._persistLocalState(); return structuredClone(task.writing_brief); }
    catch (error) { if (before) task.writing_brief = before; else delete task.writing_brief; throw error; }
  }

  removeFollowup(taskId) {
    const current = this.localState.followups.find(task => task.id === taskId);
    if (current && ['requesting', 'reading', 'analyzing'].includes(current.status)) throw new Error('整理仍在进行，请结束后再移除。');
    const prev = [...this.localState.followups];
    this.localState.followups = this.localState.followups.filter(f => f.id !== taskId);

    try {
      this._persistLocalState();
      return true;
    } catch (err) {
      this.localState.followups = prev;
      throw err;
    }
  }

  // 导出跟进材料文本
  exportFollowupText(taskId) {
    const state = this.getState();
    const task = this.localState.followups.find(f => f.id === taskId);
    if (!task) return '';

    const item = state.itemMap.get(task.item_id);
    const sourceEntries = (item?.source_refs || [])
      .map(ref => {
        const src = state.sourceMap.get(ref);
        if (!src) return ref;
        return src.home_url ? `[${src.name}](${src.home_url})` : src.name;
      })
      .join(', ');
    if (containsCredentialText([task,item,sourceEntries])) throw new Error('材料中疑似有密码或密钥，请移除后再导出。');
    const post=postReadingContext(item),author=post ? postAuthorLabel(item) : '';
    const authorText=author.replace(/\\/g,'\\\\').replace(/([`*_{}\[\]#])/g,'\\$1').replaceAll('<','&lt;').replaceAll('>','&gt;');

    const practical = practicalMaterialKind(item);
    const contentStatusLabel = practical ? 'AI 按官方说明整理用途、开始方法、限制与费用；未安装或实测，不代表用户核验'
      : item?.origin==='user_added' ? '用户填写的标题和链接，未自动读取页面'
      : item?.link_kind==='video' ? '频道标题与公开简介，未观看视频或读取字幕'
      : post ? post.scope
      : ({demo:'界面示例',metadata_only:'仅读取项目简介，未实测',headline_only:'仅读标题，未读取正文',excerpt_only:'读过来源摘要，未读取完整正文',media_unread:'媒体尚未阅读'})[item?.content_status] || '未知';
    const verificationLabel = item?.verification_status === 'not_tested' ? '未实测' : item?.verification_status==='not_verified' ? '未核验、未实测' : (item?.verification_status || '未知');
    const dotText=value=>String(value ?? '').replace(/\\/g,'\\\\').replace(/([`*_{}\[\]#])/g,'\\$1').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const dot=isCandidateImport(item),collector=item?.collector || '采集者';

    return `# ${task.research?.report ? '项目说明整理' : '跟进任务材料'}

- 主题：${item?.display_title || item?.title || '未知主题'}
- 状态：${task.research ? ({reading:'正在读取说明',analyzing:'Codex 正在整理',done:'整理已完成，未实测',failed:'整理失败'}[task.status] || task.status) : task.status === 'draft' ? '待交给 AI（本地草稿）' : task.status}
- 创建时间：${task.created_at}
- 更新时间：${task.updated_at}
${task.imported_backup ? '- 资料来源：从备份恢复的历史记录，本轮未重新核验。\n' : ''}

## 1. 用户具体问题
${task.question}

## 2. 背景与推荐理由
${item?.recommendation_reason || '暂无说明'}
${item?.selection_reason ? `本机匹配说明（规则筛选，不是来源事实）：${item.selection_reason}\n` : ''}
${practical ? 'AI 按官方说明整理，未实测' : dot ? `${collector}${collector==='feedgrab' ? ' 采集材料' : ' 整理摘要'}，尚未独立核验` : '简介'}：${item?.summary || '暂无'}
${dot && item.my_angle ? `\n${collector} 附带的二创切入点（采集者建议，不是用户经历或已执行任务）：\n${dotText(item.my_angle)}\n` : ''}

## 3. 来源与发现线索
- 来源入口：${sourceEntries || '未指定'}
${post ? `- 帖子摘录来源：${post.source}\n${author ? `- 来源标注作者：${authorText}\n` : ''}${item.source_item_time ? `- 榜单条目更新于：${item.source_item_time}\n` : ''}` : ''}- ${item?.link_kind && item.link_kind !== 'article' ? '来源链接' : '原文链接'}：${item?.original_url ? item.original_url : '原文地址未知（未伪造入口为原帖）'}
- 链接类型：${item?.origin==='user_added' ? '用户添加的网页链接，页面类型未核对' : ({search:'话题搜索结果，不是文章原文',topic:'热点话题页',discussion:'讨论页',repository:'项目主页',article:'来源文章',video:'视频',post:'原帖'})[item?.link_kind] || '来源链接'}
- 采集状态：${contentStatusLabel}
- ${practical ? 'AI 阅读官方说明时间' : '获取时间'}：${item?.captured_at || '未知'}
- ${item?.repository_name ? '项目代码更新' : '来源标注发布'}：${(item?.repository_name ? item?.updated_at : item?.published_at) || '未知'}
- 原始资料编号：${item?.evidence_ref || '示例无原始资料'}
- 同链接的来源记录：${item?.source_links?.map(link => `${link.source_id}：${link.url}（获取于 ${link.captured_at}；资料编号 ${link.evidence_ref}）`).join('；') || '无其他记录'}
- 核实状态：${verificationLabel}
${dot ? `- ${collector} 报告的热度观察时间：${item.metrics_checked_at}\n- ${collector} 报告热度：收藏 ${item.bookmark_count ?? '未知'}；点赞 ${item.like_count ?? '未知'}；浏览 ${item.view_count ?? '未知'}\n- 原显示文字：${dotText(item.metric_display || '未提供')}\n- 热度依据：${item.metrics_source_url}\n- 热度与摘要均为采集者记录，未独立核验；选入精选不代表实测、用户验收或公开发布。\n` : ''}

## 4. 已知盲区与待核对事项
${(item?.unknowns || []).map((u, i) => `${i + 1}. ${u}`).join('\n') || '暂无'}

${task.research?.report ? `## 5. Codex 整理结果（阅读说明，未实测）
一句话：${task.research.report.summary}
作者说明提到：\n${task.research.report.can_do.map(x => '- ' + x).join('\n')}
适合谁（AI 建议）：${task.research.report.who_for}
上手步骤（未执行）：\n${task.research.report.first_steps.map((x, i) => `${i+1}. ${x}`).join('\n')}
费用与限制：${task.research.report.cost_and_limits}
待核对：\n${task.research.report.unknowns.map(x => '- ' + x).join('\n')}
下一步建议：${task.research.report.next_step}
来源：${task.research.source?.url || '未知'}
来源文件 SHA：${task.research.source?.sha || '未知'}
读取范围：${task.research.source?.truncated ? 'README 前 28000 字符摘录' : '本次获取的 README 文字'}
` : ''}
${task.trial_plan ? this.exportTrialText(task.id) : ''}
${task.writing_brief ? `## 发文准备（手动填写，尚未发布）\n文章形式：${WRITING_FORMATS[task.writing_brief.format] || '未知'}\n读者：${task.writing_brief.audience || '未指定'}\n个人看法：${task.writing_brief.angle || '尚未填写'}\n` : ''}
---
说明：${task.research ? '本材料包含本机保存的 Codex 整理记录，不代表安装实测或用户验收。' : '本材料由“我的信息流”本地生成，不代表已向任何外部模型发出请求。'}
`;
  }

  // 提供状态演练示例（用于完整展示 feed-contract.md 规定的 submitted, running, done, failed 演示状态）
  getDemoStatusExamples() {
    return [
      {
        id: 'demo-sample-submitted',
        item_id: 'demo-video',
        title: '看长视频前，先拿到一份能跳回原片的文字笔记',
        question: '核对开源视频字幕工具的使用要求和最小可复现步骤。',
        status: 'submitted',
        created_at: '2026-09-28T09:00:00Z',
        updated_at: '2026-09-28T09:01:00Z',
        target_agent: '本地演示助手',
        delivery_receipt: 'REC-DEMO-001',
        is_demo_example: true,
        result: null,
      },
      {
        id: 'demo-sample-running',
        item_id: 'demo-collect',
        title: '把散落在各处的收藏，整理成每天看得完的简报',
        question: '对比三款本地书签工具的导出格式和 API 支持情况。',
        status: 'running',
        created_at: '2026-09-28T08:30:00Z',
        updated_at: '2026-09-28T08:35:00Z',
        target_agent: '本地演示助手',
        delivery_receipt: 'REC-DEMO-002',
        is_demo_example: true,
        result: null,
      },
      {
        id: 'demo-sample-done',
        item_id: 'demo-post',
        title: '一个帖子为什么值得学：先看它解决了什么问题',
        question: '拆解原帖问题并给出最小实验切口。',
        status: 'done',
        created_at: '2026-09-27T16:00:00Z',
        updated_at: '2026-09-27T16:15:00Z',
        target_agent: '本地演示助手',
        delivery_receipt: 'REC-DEMO-003',
        is_demo_example: true,
        result: {
          conclusion: '原帖核心痛点是收藏后不再回看。建议制作脚本自动生成周报，并在自己真实收藏夹实测。',
          sources_used: ['SoPilot 热门帖样本', '个人收藏夹测试数据'],
          unresolved: ['原帖提及的付费插件未购买实测', '跨浏览器同步兼容性未覆盖全平台'],
          suggested_next_step: '选取 10 条真实链接，手工按模板输出一次 Markdown 验证阅读感受。'
        }
      },
      {
        id: 'demo-sample-failed',
        item_id: 'demo-discover',
        title: '一个关注度不高的小工具，能不能替我省掉重复操作？',
        question: '验证某个特定 GitHub 项目的依赖安装步骤。',
        status: 'failed',
        created_at: '2026-09-27T10:00:00Z',
        updated_at: '2026-09-27T10:02:00Z',
        target_agent: '本地演示助手',
        delivery_receipt: 'REC-DEMO-004',
        is_demo_example: true,
        result: null,
        error_message: '未连接外部 AI 执行环境（演示状态）'
      }
    ];
  }
}

export const feedAdapter = new FeedDataAdapter({ mode: !PUBLIC_PREVIEW && typeof location !== 'undefined' && new URLSearchParams(location.search).get('demo') === '1' ? 'demo' : 'live' });
