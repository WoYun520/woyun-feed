/**
 * 我的信息流 · 前端交互主逻辑
 * 遵从 docs/antigravity-brief.md 及 docs/feed-contract.md
 * 零静默伪造、严谨错误呈现、完备无障碍与焦点管理
 */

import { feedAdapter } from './dataAdapter.js';
import { TOPICS, selectFeed } from './feedSelection.js';
import { TRIAL_OUTCOMES } from './trialPlan.js';
import { BACKUP_LIMIT } from './backup.js';
import { WRITING_FORMATS } from './writingBrief.js';
import { SOURCE_GROUPS, matchesSource } from './sourceGroups.js';
import { renderTopicWorkspace, bindTopicActions, renderTopicDialog, openTopicDialog } from './topicViews.js';
import { renderSourceBoard, bindSourceBoardActions, feedUpdateInfo, boardUpdateMessage } from './sourceBoard.js';
import { renderHomeShowcase } from './homeShowcaseView.js';
import { boostVisitorId, readBoostTotal, recordKosxBoost, writeBoostTotal } from './homeShowcase.js';
import { repositoryName } from './repositoryGuide.js';
import { renderCollectionPanel, bindCollectionActions } from './collectionViews.js';
import { needsWelcome, rememberWelcome, renderWelcome, renderGuide } from './welcome.js';
import { feedLoadMessage, renderFeedLoadStatus, renderInitialFeedLoad } from './feedLoadingView.js';
import { CREATOR_CATALOG } from './creatorCatalog.js';
import { creatorPreferenceKey, readCreatorPreferences, saveCreatorPreference, selectCreatorTutorials, selectCreatorCandidates } from './creatorTutorials.js';
import { renderCreatorPage, bindCreatorActions } from './creatorViews.js';
import { bindPostMediaEvents } from './postMediaView.js';
import { DOT_IMPORT_MAX_BYTES } from './dotCandidates.js';
import { renderDotCandidatesView, bindDotCandidatesEvents, renderDotInboxPanel, bindDotInboxEvents, renderDotInboxFeedback, bindDotInboxFeedbackEvents } from './dotCandidatesView.js';
import { DotInboxClient, DOT_INBOX_STORAGE_KEY } from './dotInboxClient.js';
import { renderWorkspaceNavigation, renderWorkspaceResume, renderWorkspaceStorageNotice } from './workspaceShell.js';
import { DOT_FILTER_DEFAULTS } from './dotCandidateFilters.js';

class PersonalFeedApp {
  constructor() {
    this.currentTab = 'today'; // 'today' | 'saved' | 'profile'
    this.creatorView = 'tutorials';
    this.creatorAuthorFilter = 'all';
    this.creatorQuery = '';
    this.savedSubTab = 'items'; // 'items' | 'archived' | 'tasks'
    this.dotView = 'pending';
    this.activeCandidateId = '';
    this.dotFilters = {...DOT_FILTER_DEFAULTS};
    this.postStreamView = 'tutorials';
    this.dotIntakeOpen = false;
    this.dotSelectedIds = new Set();
    this.dotBusy = false;
    this.dotMessage = '';
    this.dotError = '';
    this.dotInbox = new DotInboxClient();
    this.dotInboxBusy = false;
    this.dotInboxMessage = '';
    this.dotInboxError = '';
    this.dotInboxPendingNew = 0;
    this.collectionQuery = '';
    this.feedSearchQuery = '';
    this.feedSearchPurpose = 'all';
    this.feedSearchLimit = 20;
    this.feedSearchComposing = false;
    this.showDemoStatusExamples = false;
    this.activeFollowupItem = null;
    this.activeModal = null; // 'followup' | 'profile' | 'update' | 'hidden'
    this.toastTimer = null;
    this.refreshing = false;
    this.refreshError = "";
    this.feedView = 'sources';
    this.homeView = 'latest';
    this.homeMenuOpen = false;
    this.catsOpen = false;
    this.kosxOpen = false;
    this.kosxDraft = '';
    this.kosxMessage = '';
    this.kosxError = '';
    this.homeBoostCount = readBoostTotal(this.boostStore());
    this.homeSourcesOpen = false;
    this.boardGroup = 'all';
    this.sourceLimits = {};
    this.sourceFilter = 'all';
    this.onlyNew = false;
    this.candidateLimit = 10;
    this.selectedTopicId = null;
    this.triggerInfo = null; // 保存触发弹窗的元素及选择器信息，用于精准恢复焦点

    this.init();
  }

  boostStore() {
    try { return globalThis.localStorage || null; } catch { return null; }
  }

  paintBoost(count) {
    if (!Number.isSafeInteger(count) || count < 0) return;
    this.homeBoostCount = count;
    const node = document.getElementById('home-boost-count');
    if (node) node.textContent = String(count);
  }

  async refreshHomeBoost() {
    try {
      const response = await fetch('/api/home-boost', {headers:{Accept:'application/json'}});
      if (!response.ok) return;
      const body = await response.json();
      if (!Number.isSafeInteger(body.count) || body.count < 0) return;
      writeBoostTotal(this.boostStore(), body.count);
      this.paintBoost(body.count);
    } catch { /* Keep the last total painted in this browser. */ }
  }

  async noteHomeBoost(href) {
    const store = this.boostStore();
    const local = recordKosxBoost(store, href);
    if (!local.counted) return;
    const optimistic = readBoostTotal(store) + 1;
    writeBoostTotal(store, optimistic);
    this.paintBoost(optimistic);
    const visitor = boostVisitorId(store);
    if (!visitor || !local.id) return;
    try {
      const response = await fetch('/api/home-boost', {
        method:'POST',
        headers:{'Content-Type':'application/json', Accept:'application/json'},
        body:JSON.stringify({visitor, status:local.id}),
      });
      if (!response.ok) return;
      const body = await response.json();
      if (!Number.isSafeInteger(body.count) || body.count < 0) return;
      writeBoostTotal(store, body.count);
      this.paintBoost(body.count);
    } catch { /* The local once-only mark stays, and the painted total waits for the next read. */ }
  }

  async init() {
    this.bindGlobalEvents();
    await this.loadAndRender();
    this.refreshHomeBoost();
    this.startDotInboxReception();
  }

  setupFeedSubscription() {
    if (this.feedSubscription) return;
    this.feedSubscription = feedAdapter.subscribe((state, change) => this.onFeedStateChange(state, change));
  }

  onFeedStateChange(state, change = {}) {
    if (!state) return;
    if (this.dotInboxBusy && change.reason === 'local') { this.pendingRender = true; return; }
    if (state.loadStatus?.phase === 'loading' && change.reason !== 'local') { this.updateFeedStatus(state); return; }
    if (this.shouldDeferBackgroundRender()) {
      this.pendingRender = true;
      this.updateFeedStatus(state);
      return;
    }
    this.ensureWelcome(state);
    this.render();
  }

  ensureWelcome(state) {
    if (this.welcomeVisible !== undefined) return;
    try { this.welcomeVisible = needsWelcome(localStorage, state); }
    catch { this.welcomeVisible = true; }
  }

  updateFeedStatus(state = feedAdapter.getState()) {
    if (!state) return;
    const container = document.getElementById('feed-load-status');
    if (container) {
      container.innerHTML = state.loadStatus?.phase==='ready' && !this.pendingRender ? '' : renderFeedLoadStatus(this, state, { deferred: !!this.pendingRender });
      document.getElementById('btn-retry-feed')?.addEventListener('click', () => this.retryFeedRead());
    }
    const button = document.getElementById('btn-check-update');
    if (button) {
      const busy = this.refreshing || state.loadStatus?.phase === 'loading';
      button.disabled = busy;
      button.textContent = busy ? '正在读取…' : state.publicPreview ? '查看更新' : state.mode === 'demo' ? '检查更新' : '更新内容';
    }
    // Historical source results remain separate from this connection attempt.
    // Patch just the message while inputs or an editor keep the rest of the page.
    const notice = document.querySelector('[data-feed-update-notice]');
    if (notice) {
      const update = feedUpdateInfo(state);
      notice.textContent = this.pendingRender ? feedLoadMessage(state,{deferred:true}) : update.notice;
    }
    const visibleNotice = document.querySelector('[data-board-update-message]');
    if (visibleNotice) {
      const update = boardUpdateMessage(state,{refreshError:this.refreshError,deferred:!!this.pendingRender});
      visibleNotice.hidden = !update.message;
      visibleNotice.classList.toggle('update-failed',update.failed);
      const text = visibleNotice.querySelector('span');
      if (text) text.textContent = update.message;
    }
  }

  async loadAndRender() {
    if (this.loadingInitial) return;
    this.loadingInitial = true;
    const appEl = document.getElementById('app');
    feedAdapter.restoreCachedFeed();
    const existing = feedAdapter.getState();
    this.setupFeedSubscription();
    if (existing) { this.ensureWelcome(existing); this.render(); }
    else {
      if (appEl) appEl.innerHTML = renderInitialFeedLoad(this);
      this.initialLoadTimer = setTimeout(() => {
        if (this.loadingInitial && !feedAdapter.getState() && appEl) appEl.innerHTML = renderInitialFeedLoad(this, null, { slow: true });
      }, 3000);
    }
    try {
      await feedAdapter.loadFeed(Boolean(existing));
      this.ensureWelcome(feedAdapter.getState());
      if (this.shouldDeferBackgroundRender()) { this.pendingRender = true; this.updateFeedStatus(); }
      if (!feedAdapter.publicPreview) {
        if (feedAdapter.getState().repositoryGuideStatus?.status === 'working') this.watchRepositoryGuides();
        feedAdapter.syncResearch();
        if (!this.researchTimer) this.researchTimer = setInterval(() => feedAdapter.syncResearch(), 4000);
      }
    } catch (error) {
      if (feedAdapter.getState()) {
        if (this.shouldDeferBackgroundRender()) { this.pendingRender = true; this.updateFeedStatus(); }
        else this.render();
      } else if (appEl) {
        appEl.innerHTML = renderInitialFeedLoad(this, error);
        document.getElementById('btn-retry-load')?.addEventListener('click', () => this.retryFeedRead());
      }
    } finally {
      clearTimeout(this.initialLoadTimer);
      this.initialLoadTimer = null;
      this.loadingInitial = false;
    }
  }

  async retryFeedRead() {
    if (!feedAdapter.getState()) return this.loadAndRender();
    if (feedAdapter.loadStatus?.phase === 'loading') return;
    this.refreshError = '';
    this.setupFeedSubscription();
    try { await feedAdapter.loadFeed(true); }
    catch { /* The current content and the inline retry state are preserved. */ }
  }

  shouldDeferBackgroundRender() {
    if (this.dotBusy) return true;
    if (document.querySelector?.('.item-full-summary[open]')) return true;
    if (this.currentTab === 'candidates' && (this.dotSelectedIds?.size
      || document.querySelector?.('.dot-candidate-details[open], .dot-candidate-fulltext[open]')
      || this.hasDotFilterDraft())) return true;
    return this.activeModal || this.sourceManagerOpen || this.currentTab === 'profile' || this.feedSearchComposing
      || ['collection-search','feed-search','creator-search','dot-inbox-code'].includes(document.activeElement?.id)
      || !!document.activeElement?.closest?.('#dot-filter-form')
      || !!document.activeElement?.matches?.('[data-creator-reason]');
  }

  dotInboxState() {
    return {...this.dotInbox.getState(),busy:this.dotInboxBusy,message:this.dotInboxMessage,error:this.dotInboxError,pendingNew:this.dotInboxPendingNew};
  }

  bindDotInboxActions(root) {
    bindDotInboxEvents(root,{
      onInboxConnect:code=>this.connectDotInbox(code),
      onInboxSync:()=>this.syncDotInbox({manual:true}),
      onInboxDisconnect:()=>this.disconnectDotInbox(),
      onInboxShowNew:()=>{this.dotInboxPendingNew=0;this.renderDotInboxResults();},
    });
  }

  updateDotInboxPanel() {
    const panel=document.getElementById('dot-inbox-panel');
    if (!panel || document.activeElement?.id==='dot-inbox-code') return;
    const focused=document.activeElement?.id;
    panel.outerHTML=renderDotInboxPanel(this.dotInboxState());
    this.bindDotInboxActions(document.getElementById('dot-inbox-panel'));
    const inboxState=this.dotInboxState();
    const slot=document.getElementById('dot-inbox-feedback');
    if(slot) {
      slot.innerHTML=renderDotInboxFeedback(inboxState);
      bindDotInboxFeedbackEvents(slot,{onIntakeOpen:()=>{
        this.dotIntakeOpen=true;
        const details=document.getElementById('dot-candidates-intake');
        if(details) {details.open=true;details.scrollIntoView({behavior:'smooth',block:'start'});details.querySelector('summary')?.focus({preventScroll:true});}
      },onInboxShowNew:()=>{this.dotInboxPendingNew=0;this.renderDotInboxResults();}});
    }
    const intake=document.getElementById('dot-candidates-intake');
    if(intake && (inboxState.error || inboxState.warning)) { intake.open=true;this.dotIntakeOpen=true; }
    const intakeState=intake?.querySelector('.dot-intake-state');
    if(intakeState) intakeState.textContent=inboxState.error || inboxState.warning ? '需要检查' : inboxState.connected ? '已连接 · 自动接收' : '连接一次，自动收材料';
    if (focused?.startsWith('dot-inbox-')) (document.getElementById(focused) || document.getElementById('dot-inbox-sync'))?.focus({preventScroll:true});
  }

  startDotInboxReception() {
    if (this.dotInboxTimer) return;
    const receive=()=>{
      if (document.visibilityState==='visible' && feedAdapter.getState()?.mode==='live' && !this.dotBusy) this.syncDotInbox();
    };
    this.dotInboxTimer=setInterval(receive,60000);
    document.addEventListener('visibilitychange',receive);
    window.addEventListener('storage',event=>{
      if (event.key===DOT_INBOX_STORAGE_KEY || event.key===null) {
        this.dotInbox.reload();this.updateDotInboxPanel();receive();
      }
    });
    receive();
  }

  async connectDotInbox(code) {
    if (this.dotInboxBusy) return;
    this.dotInboxBusy=true;this.dotInboxError='';this.dotInboxMessage='正在检查接收码…';this.updateDotInboxPanel();
    try {
      await this.dotInbox.connect(code);
      this.dotInboxMessage='已连接。以后素材投递完成后，打开页面即可自动接收。';
    } catch(error) { this.dotInboxError=error.message;this.dotInboxMessage=''; }
    finally { this.dotInboxBusy=false;this.updateDotInboxPanel(); }
    if (!this.dotInboxError) await this.syncDotInbox({manual:true});
  }

  disconnectDotInbox() {
    try {
      this.dotInbox.disconnect();this.dotInboxError='';this.dotInboxMessage='已断开自动接收。浏览器里已经保存的材料保留。';
    } catch(error) { this.dotInboxError=error.message; }
    this.updateDotInboxPanel();
  }

  renderWorkspaceResume(state) { return renderWorkspaceResume(state,value=>this.formatTime(value)); }

  readDotFilterDraft() {
    const fields={query:'query',category:'category',collector:'collector',minBookmarks:'bookmarks',sort:'sort'};
    const draft={};
    for (const [key,suffix] of Object.entries(fields)) {
      const field=document.getElementById(`dot-filter-${suffix}`);
      if(field) draft[key]=field.value;
    }
    return draft;
  }

  hasDotFilterDraft() {
    return Object.entries(this.readDotFilterDraft()).some(([key,value])=>value!==(this.dotFilters?.[key] ?? DOT_FILTER_DEFAULTS[key]));
  }

  renderDotInboxResults() {
    const x=window.scrollX,y=window.scrollY;
    const active=document.activeElement;
    const focusedId=active?.id;
    const choice=active?.dataset?.dotSelect;
    const filterDraft=this.readDotFilterDraft();
    const cursor=active?.id==='dot-filter-query' ? [active.selectionStart,active.selectionEnd] : null;
    this.dotIntakeOpen=!!document.getElementById('dot-candidates-intake')?.open;
    const advancedOpen=!!document.querySelector('.dot-filter-advanced')?.open;
    const listScroll=document.querySelector('.dot-candidates-grid')?.scrollTop || 0;
    const reader=document.querySelector('[data-dot-reader-id]');
    const readerId=reader?.dataset.dotReaderId;
    const readerScroll=reader?.scrollTop || 0;
    const details=[...document.querySelectorAll('[data-dot-candidate] details, [data-dot-reader-id] details')].map(detail=>({
      id:detail.closest('[data-dot-candidate]')?.dataset.dotCandidate || detail.closest('[data-dot-reader-id]')?.dataset.dotReaderId,
      className:detail.classList.contains('dot-candidate-fulltext') ? 'dot-candidate-fulltext' : 'dot-candidate-details',
      open:detail.open,
    })).filter(detail=>detail.id);
    this.render();
    for (const [key,value] of Object.entries(filterDraft)) {
      const suffix=key==='minBookmarks' ? 'bookmarks' : key;
      const field=document.getElementById(`dot-filter-${suffix}`);
      if(field) field.value=value;
    }
    for (const {id,className,open} of details) document.querySelector(`[data-dot-candidate="${id}"] .${className}, [data-dot-reader-id="${id}"] .${className}`)?.toggleAttribute('open',open);
    document.querySelector('.dot-filter-advanced')?.toggleAttribute('open',advancedOpen);
    const nextList=document.querySelector('.dot-candidates-grid');
    if(nextList) nextList.scrollTop=listScroll;
    const nextReader=document.querySelector('[data-dot-reader-id]');
    if(nextReader && readerId && nextReader.dataset.dotReaderId===readerId) nextReader.scrollTop=readerScroll;
    const restore=focusedId ? document.getElementById(focusedId) : choice ? document.querySelector(`[data-dot-select="${choice}"]`) : null;
    restore?.focus({preventScroll:true});
    if(cursor && restore?.setSelectionRange && cursor.every(Number.isInteger)) restore.setSelectionRange(...cursor);
    window.scrollTo({top:y,left:x,behavior:'instant'});
  }

  async syncDotInbox({manual=false}={}) {
    if (this.dotInboxBusy || this.dotBusy || document.visibilityState==='hidden' || !feedAdapter.getState() || feedAdapter.getState().mode!=='live') return;
    this.dotInbox.reload();
    if (!this.dotInbox.getState().connected) { if(manual) this.updateDotInboxPanel();return; }
    this.dotInboxBusy=true;this.dotInboxError='';
    if(manual) this.dotInboxMessage='正在检查素材投递…';
    this.updateDotInboxPanel();
    let added=0;
    try {
      const result=await this.dotInbox.sync(raw=>{
        const imported=feedAdapter.importDotCandidates(raw);added+=imported.added;return imported;
      });
      this.dotInboxMessage=result.more ? `已接收这一批，${result.added} 条新增；下一次会继续接收剩余批次。` : result.added ? `自动收到 ${result.added} 条新材料，已去重，等待你选入精选。` : result.batches ? `投递已接收，重复原帖已跳过，没有新增材料。` : '已检查投递箱，暂时没有新材料。';
    } catch(error) {
      if(this.dotInbox.getState().connected) {this.dotInboxError=error.message;this.dotInboxMessage=added ? `已收到 ${added} 条；其余投递稍后重试。` : '';}
    }
    finally {
      this.dotInboxBusy=false;
      this.dotInboxPendingNew+=added;
      if (added && !(this.shouldDeferBackgroundRender() || (this.currentTab==='candidates' && (this.dotSelectedIds.size || document.querySelector('.dot-candidate-details[open], .dot-candidate-fulltext[open]') || document.activeElement?.closest?.('.dot-candidates-page'))))) {
        this.dotInboxPendingNew=0;this.renderDotInboxResults();
      } else {
        const badge=document.querySelector('#nav-candidates .nav-badge');
        const total=feedAdapter.getState()?.dotPendingCandidates?.length || 0;
        if(badge) badge.textContent=String(total);
        else if(total) {
          const newBadge=document.createElement('span');newBadge.className='nav-badge';newBadge.textContent=String(total);document.getElementById('nav-candidates')?.appendChild(newBadge);
        }
        this.updateDotInboxPanel();
      }
    }
  }

  setCreatorPreference(id,patch) {
    const state=feedAdapter.getState();
    saveCreatorPreference(localStorage,creatorPreferenceKey(state.mode,state.publicPreview),id,patch);
    this.render();
  }

  async startRepositoryGuides() {
    if (feedAdapter.publicPreview) return;
    if (this.repositoryGuideRunning) return;
    this.repositoryGuideRunning=true;
    this.repositoryGuideNotice='使用本机 Codex 整理公开简介，已有介绍会复用。';
    this.render();
    try {
      const response=await fetch('/api/repository-guides',{method:'POST',headers:{'X-Personal-Feed':'1'},signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw Error('暂时无法开始整理，原内容保留。');
      const status=await response.json();
      this.repositoryGuideNotice=status.message;
    } catch (error) {
      this.repositoryGuideNotice=error.message+' 可稍后点击重试；不会重复启动正在进行的整理。';
      this.repositoryGuideRunning=false; this.render(); return;
    }
    this.repositoryGuideRunning=false;
    await this.watchRepositoryGuides();
  }

  async watchRepositoryGuides() {
    if (feedAdapter.publicPreview) return;
    if (this.repositoryGuideRunning) return;
    this.repositoryGuideRunning=true;
    try {
      let status;
      do {
        const response=await fetch('/api/repository-guides',{signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw Error('暂时无法查看中文整理进度。刷新后可继续查看。');
        status=await response.json();
        this.repositoryGuideNotice=status.message+(status.status==='working' ? ` 已整理 ${status.completed}/${status.total} 项。` : '');
        const notice=document.querySelector('.repository-guide-notice');
        if (notice) notice.textContent=this.repositoryGuideNotice;
        else if (!this.shouldDeferBackgroundRender()) this.render();
        else this.pendingRender=true;
        if (status.status==='working') await new Promise(resolve=>setTimeout(resolve,3500));
      } while (status.status==='working');
      await feedAdapter.loadFeed(true);
    } catch (error) { this.repositoryGuideNotice=error.message; }
    finally {
      this.repositoryGuideRunning=false;
      if (this.shouldDeferBackgroundRender()) this.pendingRender=true;
      else this.render();
    }
  }

  bindGlobalEvents() {
    // 弹窗键盘无障碍监听：Esc 关闭与 Tab 循环限制 (Focus Trap)
    window.addEventListener('keydown', (e) => {
      if (!this.activeModal) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeModal();
        return;
      }

      if (e.key === 'Tab') {
        const backdrop = document.getElementById('modal-backdrop');
        if (!backdrop) return;

        const focusables = Array.from(backdrop.querySelectorAll(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !backdrop.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !backdrop.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    });
  }

  isPublicHome(state = feedAdapter.getState()) {
    return this.currentTab === 'today' && state?.mode === 'live' && this.feedView === 'sources';
  }

  switchTab(tab) {
    this.homeMenuOpen = false;
    this.currentTab = tab;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.render();
    document.getElementById('workspace-main')?.focus({ preventScroll: true });
  }

  dismissWelcome() {
    this.welcomeVisible = false;
    let remembered = false;
    try { remembered = rememberWelcome(localStorage, feedAdapter.getState().mode); } catch { /* The guide remains usable without storage. */ }
    this.render();
    if (!remembered) this.showToast('本次已收起引导；浏览器未能记住，下次可能再次显示。');
  }

  openGuide(triggerEl) {
    this.triggerInfo = { element: triggerEl, selector: '#open-guide' };
    this.activeModal = 'guide'; this.renderModals();
  }

  addFromGuide() {
    openTopicDialog(this, 'manual', { topicId: this.currentTab === 'topics' ? this.selectedTopicId : null }, document.getElementById('open-guide'));
  }

  showToast(message, actionLabel = null, onAction = null, duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    if (this.toastTimer) clearTimeout(this.toastTimer);
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.setAttribute('role', 'alert');

    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    if (actionLabel && onAction) {
      const btn = document.createElement('button');
      btn.className = 'toast-undo-btn';
      btn.textContent = actionLabel;
      btn.onclick = () => {
        onAction();
        toast.remove();
      };
      toast.appendChild(btn);
    }

    container.appendChild(toast);

    this.toastTimer = setTimeout(() => {
      toast.remove();
    }, duration);
  }

  openFollowupModal(itemId, triggerEl = null) {
    const state = feedAdapter.getState();
    const item = state.itemMap.get(itemId);
    if (!item) return;

    this.triggerInfo = {
      element: triggerEl || document.activeElement,
      selector: `[data-action="followup"][data-item-id="${itemId}"]`,
      itemId: itemId,
    };

    this.activeFollowupItem = item;
    this.activeModal = 'followup';
    this.renderModals();
  }

  openBackupModal(triggerEl) {
    this.backupPreview = null; this.backupRaw = null; this.backupError = ''; this.backupRestoreProfile = false;
    this.backupFilename = ''; this.backupBusy = false; this.backupSession = Symbol('backup');
    this.triggerInfo = { element: triggerEl, selector: '#open-backup', itemId: null };
    this.activeModal = 'backup'; this.renderModals();
  }

  openTrialModal(taskId, triggerEl) {
    try { this.trialDraft = feedAdapter.getTrialPlan(taskId); }
    catch (error) { this.showToast(error.message); return; }
    this.activeTrialTask = taskId;
    this.triggerInfo = { element: triggerEl, selector: `[data-action="trial-plan"][data-task-id="${taskId}"]`, itemId: null };
    this.activeModal = 'trial';
    this.renderModals();
  }

  openWritingModal(taskId, triggerEl) {
    try { this.writingDraft = feedAdapter.getWritingBrief(taskId); }
    catch (error) { this.showToast(error.message); return; }
    this.activeWritingTask = taskId;
    this.triggerInfo = {element: triggerEl, selector: `[data-action="writing-brief"][data-task-id="${taskId}"]`, itemId: null};
    this.activeModal = 'writing'; this.renderModals();
  }

  openProfileModal(triggerEl = null, selector = '#sidebar-edit-profile-btn') {
    this.triggerInfo = {
      element: triggerEl || document.activeElement,
      selector: selector,
      itemId: null,
    };
    this.activeModal = 'profile';
    this.renderModals();
  }

  openUpdateModal(triggerEl = null) {
    this.triggerInfo = {
      element: triggerEl || document.activeElement,
      selector: '#btn-check-update',
      itemId: null,
    };
    this.activeModal = 'update';
    this.renderModals();
  }

  closeModal() {
    this.activeModal = null;
    this.backupSession = null; this.backupRaw = null; this.backupPreview = null;
    this.activeFollowupItem = null;
    this.activeTrialTask = null; this.trialDraft = null;
    this.activeWritingTask = null; this.writingDraft = null;
    const backdrop = document.getElementById('modal-root');
    if (backdrop) backdrop.innerHTML = '';

    const info = this.triggerInfo;
    this.triggerInfo = null;

    if (this.pendingRender && !this.shouldDeferBackgroundRender()) { this.pendingRender = false; this.render(); }
    if (!info) return;

    // 焦点恢复逻辑：处理重渲染后原 DOM 节点脱落的情况
    requestAnimationFrame(() => {
      // 1. 若旧节点依然存在于文档中，直接聚焦
      if (info.element && document.contains(info.element) && typeof info.element.focus === 'function') {
        info.element.focus();
        return;
      }

      // 2. 若因保存/重新渲染导致原 DOM 节点脱落，根据稳定 selector 重新定位新节点聚焦
      if (info.selector) {
        const freshEl = document.querySelector(info.selector);
        if (freshEl && typeof freshEl.focus === 'function') {
          freshEl.focus();
          return;
        }
      }

      // 3. 兜底回退
      const fallback = document.querySelector('.page-headline') || document.querySelector('#nav-today');
      fallback?.focus?.();
    });
  }

  // 渲染整体框架
  rememberDisplayedItems(state) {
    const visibleIds=new Set([...document.querySelectorAll('[data-item-id]')].map(node=>node.dataset?.itemId).filter(Boolean));
    const candidates=new Map([...(state.allItems || []),...(state.creatorItems || []),...(state.dotFeaturedItems || []),...(state.savedItems || [])].map(item=>[item.id,item]));
    const snapshots=[];
    for (const id of visibleIds) {
      const item=candidates.get(id) || [...candidates.values()].find(item=>item.alias_ids?.includes(id)) || feedAdapter.displayedItems?.get(id);
      if (item) snapshots.push(item);
    }
    feedAdapter.setDisplayedItems?.(snapshots);
  }

  render() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    const state = feedAdapter.getState();
    if (!state) return;
    if(this.currentTab==='candidates') this.dotInboxPendingNew=0;
    if (this.currentTab==='tutorials') {
      const creatorSettings=readCreatorPreferences(localStorage,creatorPreferenceKey(state.mode,state.publicPreview));
      state.creatorCatalog=CREATOR_CATALOG;
      state.creatorPreferences=creatorSettings.preferences;
      state.creatorPreferenceWarning=creatorSettings.warning;
      state.creatorAllTutorials=state.mode==='live' ? selectCreatorTutorials([...state.creatorItems,...state.allItems],{
        preferences:Object.fromEntries(CREATOR_CATALOG.map(creator=>[creator.id,{enabled:true}])),hiddenItemIds:state.hiddenItemIds,
      }) : [];
      state.creatorTutorials=state.mode==='live' ? selectCreatorTutorials([...state.creatorItems,...state.allItems],{
        preferences:state.creatorPreferences,hiddenItemIds:state.hiddenItemIds,author:this.creatorAuthorFilter,query:this.creatorQuery,
      }) : [];
      state.creatorCandidates=state.mode==='live' ? selectCreatorCandidates([...state.creatorItems,...state.allItems],{
        preferences:state.creatorPreferences,hiddenItemIds:state.hiddenItemIds,author:this.creatorAuthorFilter,
        query:this.creatorQuery,refresh:state.refresh,
      }) : [];
    }
    this.pendingRender = false;
    this.renderedGeneratedAt = state.generated_at;
    const publicHome = this.isPublicHome(state);

    appEl.innerHTML = `
      <div class="workspace-shell" data-workspace-tab="${this.currentTab}">
      ${renderWorkspaceNavigation(this.currentTab,state,{homeView:this.homeView,catsOpen:this.catsOpen})}
      <main id="workspace-main" tabindex="-1" class="page-container ${publicHome ? 'source-board-page' : ''}" role="main">
        ${publicHome ? '' : renderWorkspaceStorageNotice(state)}
        <div id="feed-load-status" role="status" aria-live="polite">${state.loadStatus?.phase === 'ready' ? '' : renderFeedLoadStatus(this, state)}</div>
        ${!publicHome && this.currentTab === 'today' && this.welcomeVisible ? renderWelcome() : ''}
        ${this.renderMainContent(state)}
        ${publicHome ? renderWorkspaceStorageNotice(state, {audience:'visitor'}) : ''}
      </main></div>
      <div id="modal-root"></div>
      <div id="toast-container" class="toast-container" aria-live="polite"></div>
    `;

    document.getElementById('nav-today')?.addEventListener('click', () => this.switchTab('today'));
    document.getElementById('nav-tutorials')?.addEventListener('click', () => this.switchTab('tutorials'));
    document.getElementById('nav-candidates')?.addEventListener('click', () => this.switchTab('candidates'));
    document.getElementById('nav-topics')?.addEventListener('click', () => { this.selectedTopicId=null; this.switchTab('topics'); });
    document.getElementById('nav-saved')?.addEventListener('click', () => this.switchTab('saved'));
    document.getElementById('nav-profile')?.addEventListener('click', () => this.switchTab('profile'));
    document.getElementById('open-guide')?.addEventListener('click', e => this.openGuide(e.currentTarget));
    document.getElementById('welcome-example')?.addEventListener('click', e => this.openGuide(e.currentTarget));
    document.getElementById('welcome-dismiss')?.addEventListener('click', () => { this.dismissWelcome(); document.getElementById('open-guide')?.focus(); });
    document.getElementById('welcome-start')?.addEventListener('click', () => { this.dismissWelcome(); document.querySelector('.page-headline')?.focus(); });

    document.getElementById('btn-retry-feed')?.addEventListener('click', () => this.retryFeedRead());
    this.rememberDisplayedItems(state);
    this.bindContentActions(state);
    this.renderModals();
  }

  renderMainContent(state) {
    if (this.currentTab === 'candidates') return renderDotCandidatesView({candidates:state.dotCandidates || [],view:this.dotView,filters:this.dotFilters,intakeOpen:this.dotIntakeOpen,activeCandidateId:this.activeCandidateId,selectedIds:[...this.dotSelectedIds],busy:this.dotBusy,message:this.dotMessage,error:this.dotError || state.dotStorageWarning || '',inbox:this.dotInboxState()});
    if (this.currentTab === 'tutorials') return renderCreatorPage(this,state);
    if (this.currentTab === 'topics') return renderTopicWorkspace(this,state);
    if (this.currentTab === 'saved') {
      return this.renderSavedView(state);
    }
    if (this.currentTab === 'profile') {
      return this.renderProfileView(state);
    }
    return this.renderTodayFeedView(state);
  }

  async importDotFile(file) {
    if (!file || this.dotBusy) return;
    this.dotBusy=true;this.dotError='';this.dotMessage='正在读取素材…';
    this.renderDotInboxResults();
    try {
      if (file.size>DOT_IMPORT_MAX_BYTES) throw Error(`文件太大，请使用不超过 ${DOT_IMPORT_MAX_BYTES/1024/1024} MB 的素材 JSON 文件。`);
      const raw=await file.text();
      const result=feedAdapter.importDotCandidates(raw);
      this.dotView='pending';this.activeCandidateId='';this.dotSelectedIds.clear();
      this.dotMessage=`已新增 ${result.added} 条待筛选。${result.duplicates ? `跳过 ${result.duplicates} 条重复交付。` : ''}${result.existing ? `${result.existing} 条已在信息流或收藏中，没有重复导入。` : ''}${result.alternatives ? `其中 ${result.alternatives} 条为备选材料。` : ''}尚未选入精选。`;
    } catch(error) {
      this.dotMessage='';this.dotError=error.message || '文件读取失败，请重新选择 JSON 文件。';
    } finally {
      this.dotBusy=false;this.renderDotInboxResults();
      document.getElementById(this.dotError ? 'dot-candidates-error' : 'dot-candidates-message')?.focus();
    }
  }

  updateDotStatus(ids,status) {
    try {
      const result=feedAdapter.setDotCandidateStatus(ids,status);
      this.dotSelectedIds.clear();this.dotError='';
      this.dotMessage=status==='featured' ? `已将 ${result.changed} 条选入我的精选，可在“今日”查看。手动入选不代表已经实测。` : status==='dismissed' ? `已略过 ${result.changed} 条，之后仍可恢复。` : `已退回 ${result.changed} 条待筛选。`;
      this.renderDotInboxResults();document.getElementById('dot-candidates-message')?.focus();
    } catch(error) {
      this.dotError=error.message;this.renderDotInboxResults();document.getElementById('dot-candidates-error')?.focus();
    }
  }

  downloadDotFeatured() {
    try {
      const result=feedAdapter.createDotFeaturedExport();
      const url=URL.createObjectURL(new Blob([result.raw],{type:'application/json;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=result.filename;
      link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      this.dotError='';this.dotMessage=`已发起 ${result.count} 条精选的下载，请在浏览器下载记录中确认文件。导出不等于公开发布。`;
      this.renderDotInboxResults();
    } catch(error) { this.dotError=error.message;this.renderDotInboxResults(); }
  }

  renderMyDotHighlights(state) {
    const all=state.dotFeaturedItems || [];
    const items=all.filter(item=>!state.hiddenItemIds.has(item.id));
    if (!all.length) return '';
    return `<section class="dot-home-featured" aria-labelledby="dot-home-title"><header class="dot-home-heading"><div><p class="dot-eyebrow">我留下的好材料</p><h2 id="dot-home-title">我选的精选 <small>${all.length}</small></h2><p>手动选入 · 采集来源与范围见每条材料，尚未实测 · 只保存在这个浏览器</p></div><button class="btn-secondary-quiet" data-dot-open-featured>管理我的精选 →</button></header>${items.length ? `<div class="items-list">${items.slice(0,3).map(item=>this.renderFeedItem(item,state,{compact:true})).join('')}</div>` : '<p>这些精选已被隐藏，可以到“我的关注”恢复。</p>'}${items.length>3 ? `<button class="btn-secondary-quiet" data-dot-open-featured>查看全部 ${items.length} 条精选 →</button>` : ''}</section>`;
  }

  readingState(state) {
    if (state.mode !== 'live') return state;
    const newIds = new Set(state.refresh?.new_item_ids || []);
    const items = state.allItems.filter(item => matchesSource(item,this.sourceFilter,state.sources) && (!this.onlyNew || newIds.has(item.id)));
    const rankSource=state.sources.find(source=>source.id===this.sourceFilter && source.ranked)?.id;
    const selection = selectFeed(items, state.profile, [...state.hiddenItemIds], {rankSource});
    return {...state, selection, dailyItems:selection.daily, discoverItems:selection.discover};
  }

  // 1. 今日首页视图
  renderTodayFeedView(state) {
    if (state.mode === 'live' && this.feedView === 'sources') return renderHomeShowcase(this, state);
    state = this.readingState(state);
    const isProfileEmpty = state.mode === 'demo' && !state.profile.interests && !state.profile.exclude;
    const totalVisible = state.dailyItems.length + state.discoverItems.length;
    const update = feedUpdateInfo(state);

    // 来源类别通俗中文映射（避免展示英文 aggregator/repository 等术语）
    const kindMap = {
      aggregator: '资讯聚合',
      repository: '开源仓库',
      community: '讨论社区',
      original: '独立发布',
    };

    return `
      <!-- 顶部导言区：紧凑不占大半屏，直观呈现示例身份 -->
      <div class="page-intro">
        <div class="intro-main">
          <h2 class="page-headline" tabindex="-1">今日精选</h2>
          <p class="page-subtext">围绕你的关注，每次只看几条值得花时间的信息。${state.mode === 'live' ? '按关键词筛选，内容尚未核实。' : ''}</p>
        </div>
        <div class="intro-meta">
          <button class="btn-secondary-quiet" data-manual-add>添加材料</button>
          <span class="demo-watermark ${state.mode === "live" ? "live-watermark" : ""}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            ${state.publicPreview ? update.automatic ? "公开来源 · 自动更新" : "公开来源 · 已发布内容" : state.mode === "demo" ? "示例内容 · 尚未连接信息源" : state.generated_at ? "公开来源 · 本机整理" : "等待首次更新"}
          </span>
          <button class="btn-secondary-quiet" id="btn-check-update" ${this.refreshing || state.loadStatus?.phase === 'loading' ? "disabled" : ""}>${state.mode === "demo" ? "检查更新" : this.refreshing || state.loadStatus?.phase === 'loading' ? "正在读取…" : state.publicPreview ? "查看更新" : "更新内容"}</button>
        </div>
      </div>

      ${this.renderMyDotHighlights(state)}
      ${state.mode === 'live' ? `<div class="update-summary ${['failed','partial'].includes(state.refresh?.status) || this.refreshError ? 'update-failed' : ''}" role="status" aria-live="polite">
        <span data-feed-update-notice>${this.escapeHtml(this.refreshError || update.notice)}</span>
        ${update.lastSuccess ? `<span>最近有来源成功更新：${this.formatTime(update.lastSuccess)}</span>` : ''}
        ${update.automatic ? `<span>${this.escapeHtml(update.schedule)}自动更新 · “查看更新”读取最近完成的内容</span>` : ''}
      </div>` : ''}
      <!-- 移动端关注偏好条（桌面端隐藏） -->
      <div class="mobile-profile-bar">
        <div class="mobile-profile-content">
          <strong>当前关注：</strong>${this.escapeHtml(state.profile.interests || '尚未设置具体偏好')}
        </div>
        <button class="mobile-profile-action" id="mobile-edit-profile-btn">修改偏好 →</button>
      </div>

      <!-- 主双列栅格 -->
      <div class="layout-grid">
        <!-- 左列：主阅读区 -->
        <div class="feed-column">
          ${state.mode === 'live' ? this.renderSelectionControls(state) : ''}
          ${state.mode === 'live' && this.feedView === 'all' ? this.renderCandidates(state) : `
            ${isProfileEmpty ? this.renderNoProfileState() : ''}
            ${!isProfileEmpty && totalVisible === 0 ? this.renderEmptyFeedState(state) : ''}
            ${!isProfileEmpty && totalVisible > 0 ? this.renderFeedSections(state) : ''}
          `}
        </div>

        <!-- 右列：辅助侧边栏 -->
        <aside class="sidebar-column" role="complementary" aria-label="辅助信息">
          <!-- 关注概况卡片 -->
          <div class="sidebar-card">
            <div class="sidebar-title">
              <span>我的关注</span>
              <button class="btn-secondary-quiet" id="sidebar-edit-profile-btn" style="padding: 2px 8px; font-size: 12px;">编辑</button>
            </div>
            <div class="profile-summary-box">
              <div class="profile-tag-label">想看</div>
              <div>${this.escapeHtml(state.profile.interests || '（未设置）')}</div>
              ${state.profile.exclude ? `
                <div class="profile-tag-label">少看</div>
                <div style="color: var(--text-light);">${this.escapeHtml(state.profile.exclude)}</div>
              ` : ''}
            </div>
            <div style="font-size: 12px; color: var(--text-light); line-height: 1.4;">
              ${this.profileNote(state)}
            </div>
          </div>

          <!-- 正在跟进小卡片 -->
          <div class="sidebar-card">
            <div class="sidebar-title">
              <span>正在跟进</span>
              <span class="sidebar-subtitle">${state.followups.length} 个任务</span>
            </div>
            ${state.followups.length === 0 ? `
              <div style="font-size: 13px; color: var(--text-light); padding: 8px 0;">
                暂无跟进中的选题。阅读条目时点击“继续查一查”即可建立任务。
              </div>
            ` : `
              <div class="followups-mini-list">
                ${state.followups.slice(0, 3).map(task => {
                  const item = state.itemMap.get(task.item_id);
                  return `
                    <div class="followup-mini-item" data-followup-id="${task.id}" data-item-id="${task.item_id}" role="button" tabindex="0">
                      <div class="followup-mini-title">${this.escapeHtml(item?.display_title || item?.title || '跟进任务')}</div>
                      <div class="followup-mini-meta">
                        <span class="task-badge-pill ${this.taskStatus(task).class}">${this.taskStatus(task).text}</span>
                        <span>${this.formatTime(task.updated_at)}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
              <div style="margin-top: 12px; text-align: right;">
                <button class="btn-secondary-quiet" id="sidebar-view-all-followups" style="padding: 3px 8px; font-size: 12px;">
                  查看全部任务 →
                </button>
              </div>
            `}
          </div>

          <!-- 信息来源状态卡片 -->
          <div class="sidebar-card">
            <div class="sidebar-title">
              <span>信息来源状态</span>
              <span class="sidebar-subtitle">${state.sources.length} 个来源</span>
            </div>
            ${this.renderSourceStatus(state,kindMap)}
            <div style="margin-top: 12px; font-size: 12px; color: var(--text-light);">
              ${state.publicPreview ? update.automatic ? "云端定时读取已接通来源，失败时保留上次内容。查看更新只读取最近完成的内容，获取时间见各来源。YouTube 是指定频道的新视频；X 尚未自动接通，可手动添加原帖。本站不提供全文镜像。" : "展示站长已发布的公开标题与简介，获取时间见来源。查看更新只读取发布内容，不实时采集原站。标题前往原网站，本站不提供全文镜像。" : state.mode === "demo" ? "示例来源尚未连接。" : "直接读取原站公开列表，来源接入方式参考 NewsNow。每个频道最多 30 条，相同链接合并。失败时保留该来源旧内容。点击更新才获取，不在后台定时抓取。"}
            </div>
          </div>
        </aside>
      </div>
    `;
  }

  sourceGroups(sources) {
    return [...SOURCE_GROUPS,{id:'other',name:'其他来源'}].map(group=>({...group,sources:sources.filter(source=>(source.group || 'other')===group.id)})).filter(group=>group.sources.length);
  }

  renderSourceStatus(state,kindMap) {
    return `<div class="sources-list">${this.sourceGroups(state.sources).map(group=>{
      const failed=group.sources.filter(source=>source.status==='failed').length;
      const waiting=group.sources.filter(source=>source.status==='not_connected').length;
      return `<details class="source-group" ${failed ? 'open' : ''}><summary><span>${group.name}</span><small>${group.sources.length} 个${failed ? ` · ${failed} 个暂不可用` : waiting ? ` · ${waiting} 个尚未接通或读到内容` : ''}</small></summary>${group.sources.map(src=>`<div class="source-item-row"><div><span class="source-name">${this.escapeHtml(src.name)}</span><small> · ${src.link_kind==='video' ? '视频频道' : src.link_kind==='post' ? '公开帖子' : kindMap[src.kind] || '信息源'}</small></div><span class="source-status ${src.status==='failed' ? 'source-failed' : ''}">${this.escapeHtml(src.message || (src.status==='not_connected' ? '尚未读到内容' : ''))}</span>${src.last_success_at ? `<small class="source-last-read">最近成功获取：${this.formatTime(src.last_success_at)}</small>` : ''}</div>`).join('')}</details>`;
    }).join('')}</div>`;
  }

  renderSelectionControls(state) {
    const selection = state.selection;
    const ranked=state.sources.some(source=>source.id===this.sourceFilter && source.ranked);
    return `<div class="selection-controls">
      <div class="selection-tabs" role="group" aria-label="内容范围">
        <button class="btn-secondary-quiet" id="feed-sources-btn">按来源浏览</button>
        <button class="btn-secondary-quiet" id="feed-selected-btn" aria-pressed="${this.feedView === 'selected'}">按我的关注</button>
        <button class="btn-secondary-quiet" id="feed-all-btn" aria-pressed="${this.feedView === 'all'}">全部候选（${selection.candidates.length}）</button>
      </div>
      <div class="feed-filters"><label for="feed-source">信息来源 <select id="feed-source"><option value="all">全部来源</option>${this.sourceGroups(state.sources).map(group=>`<optgroup label="${group.name}"><option value="group:${group.id}" ${this.sourceFilter===`group:${group.id}` ? 'selected' : ''}>全部${group.name}</option>${group.sources.map(source=>`<option value="${this.escapeHtml(source.id)}" ${this.sourceFilter===source.id ? 'selected' : ''}>${this.escapeHtml(source.name)}</option>`).join('')}</optgroup>`).join('')}</select></label><label class="feed-new-filter"><input id="feed-only-new" type="checkbox" ${this.onlyNew ? 'checked' : ''}>只看最近一次新增</label></div>
      <p class="selection-note">${selection.matchedCount} 条匹配关注${selection.excludedCount ? `，${selection.excludedCount} 条包含不想看的方向` : ''}${selection.hiddenCount ? `，${selection.hiddenCount} 条已隐藏` : ''}。${this.feedView === 'all' ? '包含未匹配和按偏好移开的内容。' : '优先展示匹配方向较多的内容。'}${ranked ? '同等匹配按该来源榜单顺序排列；榜单不代表质量。' : '按来源时间排列，时间缺失时用获取时间。'}</p>
    </div>`;
  }

  renderCandidates(state) {
    const candidates = state.selection.candidates;
    if (!candidates.length) return this.renderEmptyFeedState(state);
    const shown = candidates.slice(0, this.candidateLimit);
    return `<section aria-label="全部候选">
      <div class="section-header"><h3 class="section-title">全部候选</h3><span class="section-desc">已展示 ${shown.length} / ${candidates.length} 条</span></div>
      <div class="items-list">${shown.map(item => this.renderFeedItem(item, state)).join('')}</div>
      ${shown.length < candidates.length ? `<button class="btn-secondary-quiet load-more" id="feed-load-more">再看 ${Math.min(10, candidates.length - shown.length)} 条</button>` : '<p class="selection-note">本批候选已全部展示。</p>'}
    </section>`;
  }

  renderTopicChoices(inputId, state) {
    if (state.mode === 'demo') return '';
    return `<div class="topic-choices" role="group" aria-label="快捷添加关注方向">
      ${TOPICS.map(topic => `<button type="button" class="topic-choice" data-topic-input="${inputId}" data-topic-label="${this.escapeHtml(topic.label)}">＋ ${this.escapeHtml(topic.label)}</button>`).join('')}
    </div>`;
  }

  bindTopicChoices(root) {
    root.querySelectorAll('[data-topic-input]').forEach(button => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.topicInput);
        if (!input) return;
        const values = input.value.split(/[，,、;；\n]+/).map(value => value.trim()).filter(Boolean);
        if (!values.includes(button.dataset.topicLabel)) values.push(button.dataset.topicLabel);
        input.value = values.join('、');
        input.focus();
      });
    });
  }

  // 渲染条目分区
  renderFeedSections(state) {
    let html = '';

    if (state.dailyItems.length > 0) {
      html += `
        <section class="feed-section" aria-labelledby="sec-daily-title">
          <div class="section-header">
            <h3 class="section-title" id="sec-daily-title">${state.mode === "demo" ? "今日推荐" : "按你的关注挑选"}</h3>
            <span class="section-desc">${state.dailyItems.length} 条精选 · 每次只看几条</span>
          </div>
          <div class="items-list">
            ${state.dailyItems.map(item => this.renderFeedItem(item, state)).join('')}
          </div>
        </section>
      `;
    }

    if (state.discoverItems.length > 0) {
      html += `
        <section class="feed-section" aria-labelledby="sec-discover-title">
          <div class="section-header">
            <h3 class="section-title" id="sec-discover-title">值得挖掘</h3>
            <span class="section-desc">${state.mode === "demo" ? "新工具或新方法 · 不与今日推荐重复" : "符合关注的其他内容 · 不与上方重复"}</span>
          </div>
          <div class="items-list">
            ${state.discoverItems.map(item => this.renderFeedItem(item, state)).join('')}
          </div>
        </section>
      `;
    }

    return html;
  }

  // 单条条目卡片渲染
  renderFeedItem(item, state, {compact=false}={}) {
    const isSaved = state.savedItemIds.has(item.id);
    const existingFollowup = feedAdapter.getFollowupForItem(item.id);
    const externalCandidate = ['dot_import','feedgrab_import'].includes(item.origin);
    const feedgrabCandidate = item.origin==='feedgrab_import';

    const sourceRefs = item.source_refs.map(ref => state.sourceMap.get(ref)).filter(Boolean);
    const sourceNames = sourceRefs.map(s => s.name).join(' / ');
    const sourceHome = sourceRefs[0]?.home_url || '#';

    const hasOriginalUrl = Boolean(item.original_url);
    const sourceButtonLabel = hasOriginalUrl ? ({search:'查看热搜',topic:'查看话题',discussion:'查看讨论',repository:'查看项目',video:'观看视频',post:'查看原帖'})[item.link_kind] || '查看原文' : '打开来源';
    const sourcePosition=item.source_links?.find(link=>link.source_id===this.sourceFilter) || item;
    const sourceButtonHref = hasOriginalUrl ? item.original_url : sourceHome;
    const summary=Array.from(item.summary || '');
    const foldedSummary=compact && summary.length>240;
    const summaryPreview=foldedSummary ? summary.slice(0,240).join('')+'…' : item.summary;

    return `
      <article class="item-card" data-item-id="${item.id}" id="item-${item.id}">
        <!-- 标题 -->
        <header class="item-header">
          <h4 class="item-title"><a class="item-title-link" href="${this.escapeHtml(this.safeUrl(sourceButtonHref))}" target="_blank" rel="noopener noreferrer" title="${sourceButtonLabel}（新标签页）">${this.escapeHtml(item.display_title || item.title)} <span aria-hidden="true">↗</span></a></h4>
          ${state.refresh?.new_item_ids?.includes(item.id) ? '<span class="new-item-badge">最近一次新增</span>' : ''}
        </header>

        <!-- 简述：能帮用户解决什么 -->
        <p class="item-summary">${item.summary_label ? `<span class="original-summary-label">${this.escapeHtml(item.summary_label)}：</span>` : ""}${this.escapeHtml(summaryPreview)}</p>
        ${foldedSummary ? `<details class="item-full-summary"><summary>展开保存的完整摘录</summary><p>这里只折叠显示，没有改写保存的材料；采集范围和未知项仍见来源记录。</p><div>${this.escapeHtml(item.summary)}</div></details>` : ''}

        <!-- 推荐理由：AI 建议，非原文事实 -->
        <div class="item-context-box">
          <div class="recommendation-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            ${externalCandidate ? feedgrabCandidate ? 'feedgrab 采集依据 · 手动选入' : `${this.escapeHtml(item.collector || 'Dot')} 选题建议 · 手动选入` : item.selection_reason ? "与你的关注 · 关键词匹配" : item.recommendation_kind === "rule" ? "入选理由 · 公开信息初筛" : "建议理由 · 基于你的关注"}
          </div>
          <div class="recommendation-text">${this.escapeHtml(item.selection_reason || item.recommendation_reason)}</div>
        </div>

        <!-- 来源与证据边界元信息 -->
        <div class="item-meta-row">
          <div class="meta-group">
            <span>来源：${this.escapeHtml(sourceNames || '未知来源')}</span>
          </div>
          <div class="meta-group">
            <span>${item.repository_name && item.updated_at ? `代码更新：${this.formatTime(item.updated_at)}` : `发布：${item.published_at ? this.formatTime(item.published_at) : "时间未提供"}`}</span>
            ${item.captured_at ? `<span>获取：${this.formatTime(item.captured_at)}</span>` : ''}
          </div>
          <div class="meta-group">
            <span class="status-badge highlight">${externalCandidate ? feedgrabCandidate ? 'feedgrab 采集 · 尚未 AI 分析' : '采集者整理' : ({demo:'示例选题',headline_only:'仅读标题',excerpt_only:'读过来源摘要'})[item.content_status] || '仅读简介'}</span>
            <span class="status-badge">${item.verification_status === 'tested_with_evidence' ? '有实测记录' : '未实测'}</span>
            ${Number.isFinite(item.stars) ? `<span>${item.stars.toLocaleString('zh-CN')} star</span>` : ''}
            ${sourcePosition.source_rank ? `<span>来源榜单第 ${this.escapeHtml(sourcePosition.source_rank)} 位</span>` : ''}
            ${sourcePosition.heat_label ? `<span>${this.escapeHtml(sourcePosition.heat_label)}（来源标注）</span>` : ''}
          </div>
          ${item.unknowns && item.unknowns.length > 0 ? `
            <button class="unknowns-toggle" data-toggle-unknowns="${item.id}" aria-expanded="false">
              <span>待核对事项 (${item.unknowns.length})</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
          ` : ''}
        </div>

        ${item.source_links?.length > 1 ? `<details class="item-provenance"><summary>这个链接来自 ${item.source_links.length} 个来源</summary><ul>${item.source_links.map(link=>`<li><a href="${this.escapeHtml(this.safeUrl(link.url))}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(state.sourceMap.get(link.source_id)?.name || link.source_id)} ↗</a> · 获取于 ${this.formatTime(link.captured_at)}</li>`).join('')}</ul></details>` : ''}
        <!-- 展开的待核对事项列表 -->
        ${item.unknowns && item.unknowns.length > 0 ? `
          <ul class="unknowns-list" id="unknowns-${item.id}" style="display: none;">
            ${item.unknowns.map(u => `<li>${this.escapeHtml(u)}</li>`).join('')}
          </ul>
        ` : ''}

        <!-- 交互动作行 -->
        <div class="item-actions-row">
          <div class="action-buttons-group">
            <button class="btn-primary-action" id="card-save-${item.id}" data-action="${state.archivedItemIds.has(item.id) ? 'restore-collection' : 'toggle-save'}" data-item-id="${item.id}" aria-pressed="${isSaved}">${state.archivedItemIds.has(item.id) ? '恢复收藏' : isSaved ? '取消收藏' : '先收藏'}</button>
            <button class="btn-quiet" data-action="topic-save" data-item-id="${item.id}">放进主题</button>
            <button class="btn-quiet" data-action="followup" data-item-id="${item.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              ${existingFollowup ? '查看跟进 · ' + this.taskStatus(existingFollowup).text : '继续查一查'}
            </button>

            <!-- 低强调动作：不感兴趣 -->
            <button class="btn-quiet" data-action="hide" data-item-id="${item.id}" title="隐藏并在当前列表不再显示">
              不感兴趣
            </button>
          </div>

          <!-- 来源链接 -->
          <div>
            <a href="${this.escapeHtml(this.safeUrl(sourceButtonHref))}" target="_blank" rel="noopener noreferrer" class="btn-source-link">
              ${sourceButtonLabel}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
          </div>
        </div>
      </article>
    `;
  }

  // 2. 收藏与跟进视图
  renderSavedView(state) {
    const savedCount = state.activeSavedItems.length;
    const archivedCount = state.archivedItems.length;
    const taskCount = state.followups.length;
    const demoExamples = feedAdapter.getDemoStatusExamples();

    return `
      <div class="saved-followup-container">
        <div class="page-intro">
          <div class="intro-main">
            <h2 class="page-headline" tabindex="-1">收藏与跟进</h2>
            <p class="page-subtext">先收下，稍后再看。补一句想法，或放进主题继续整理。</p>
          </div>
          <div class="topic-actions"><button class="btn-primary-action" data-manual-add>添加材料</button><button class="btn-secondary-quiet" id="open-backup">备份与恢复</button></div>
        </div>

        <!-- 二级导航 -->
        <div class="tabs-subnav" role="tablist" aria-label="已保存的资料">
          <button class="subtab-btn ${this.savedSubTab === 'items' ? 'active' : ''}" id="subtab-items" role="tab" aria-selected="${this.savedSubTab==='items'}">
            已收藏 (${savedCount})
          </button>
          <button class="subtab-btn ${this.savedSubTab === 'archived' ? 'active' : ''}" id="subtab-archived" role="tab" aria-selected="${this.savedSubTab==='archived'}">归档 (${archivedCount})</button>
          <button class="subtab-btn ${this.savedSubTab === 'tasks' ? 'active' : ''}" id="subtab-tasks" role="tab" aria-selected="${this.savedSubTab==='tasks'}">
            跟进任务 (${taskCount})
          </button>
        </div>

        <!-- 收藏条目列表 -->
        ${this.savedSubTab!=='tasks' ? renderCollectionPanel(this,state) : ''}

        ${state.researchNotice ? `<div class="research-notice" role="status">${this.escapeHtml(state.researchNotice)} <button class="btn-secondary-quiet" id="retry-research-sync">重试连接</button></div>` : ''}
        <!-- 跟进任务列表 -->
        ${this.savedSubTab === 'tasks' ? `
          <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div style="font-size: 13px; color: var(--text-muted);">
              ${state.publicPreview ? '保存想继续查的问题，再复制材料给你自己的 AI。公开预览不调用 AI，也不会自动读取网页正文。' : '保存想继续看的内容。“GitHub 小型工具”项目可用 Codex 整理说明，阅读说明不等于安装实测。'}
            </div>
            ${state.mode === "demo" ? `<label style="font-size: 13px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="toggle-demo-status" ${this.showDemoStatusExamples ? 'checked' : ''}>
              预览跟进状态
            </label>` : ""}
          </div>

          ${taskCount === 0 && !this.showDemoStatusExamples ? `
            <div class="empty-state">
              <h3 class="empty-title">暂无跟进任务</h3>
              <p class="empty-desc">遇到想进一步核实工具、查找教程的选题，点击“继续查一查”输入具体问题并建立任务。</p>
              <button class="btn-primary-action" id="btn-return-feed">返回今日精选</button>
            </div>
          ` : `
            <div class="task-list">
              <!-- 本地实际保存的 draft 任务 -->
              ${state.followups.map(task => {
                const item = state.itemMap.get(task.item_id);
                return this.renderTaskCard(task, item, false);
              }).join('')}

              <!-- 仅在勾选时展示的状态样例 (带清晰的演示状态标签) -->
              ${this.showDemoStatusExamples ? `
                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed var(--border-light);">
                  <div style="font-size: 14px; font-weight: 600; color: #b91c1c; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                    <span>演示状态样例（仅供检查界面样式，非真实任务记录）：</span>
                  </div>
                  <div class="task-list">
                    ${demoExamples.map(task => {
                      const item = state.itemMap.get(task.item_id);
                      return this.renderTaskCard(task, item, true);
                    }).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `}
        ` : ''}
      </div>
    `;
  }

  taskStatus(task) {
    const statusMap = {
      draft: { text: '待交给 AI', class: 'badge-draft' },
      submitted: { text: '已送达 AI', class: 'badge-submitted' },
      running: { text: '正在研究', class: 'badge-running' },
      requesting: { text: '正在连接', class: 'badge-running' },
      reading: { text: '正在读项目说明', class: 'badge-running' },
      analyzing: { text: 'Codex 正在整理', class: 'badge-running' },
      done: { text: '整理完成 · 未实测', class: 'badge-done' },
      failed: { text: '整理未完成', class: 'badge-failed' },
    };

    return statusMap[task.status] || { text: '状态未知', class: 'badge-draft' };
  }

  renderResearchResult(job) {
    if (!job?.report) return '';
    const r = job.report;
    const list = (values, ordered = false) => `<${ordered ? 'ol' : 'ul'}>${values.map(value => `<li>${this.escapeHtml(value)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
    return `<section class="research-result" aria-label="Codex 整理结果">
      <div class="research-eyebrow">CODEX 读说明 · 尚未实测</div>
      <p class="research-summary">${this.escapeHtml(r.summary)}</p>
      <h4>能做什么 <small>根据作者说明整理</small></h4>${list(r.can_do)}
      <h4>适合谁 <small>AI 建议</small></h4><p>${this.escapeHtml(r.who_for)}</p>
      <h4>第一步怎么用 <small>尚未执行</small></h4>${list(r.first_steps, true)}
      <h4>费用与限制</h4><p>${this.escapeHtml(r.cost_and_limits)}</p>
      <h4>还要核对</h4>${list(r.unknowns)}
      <div class="research-next"><strong>下一步建议</strong><p>${this.escapeHtml(r.next_step)}</p></div>
      <details class="research-source"><summary>查看这次读取的来源</summary>
        <p><a href="${this.escapeHtml(this.safeUrl(job.source?.url))}" target="_blank" rel="noopener noreferrer">项目原始说明 ↗</a></p>
        <p>读取于 ${this.formatTime(job.source?.captured_at)} · ${job.source?.truncated ? '仅 README 前 28000 字符' : '本次 README 文字'}，未读取其他链接或代码。</p>
        <p>来源版本：<code>${this.escapeHtml(job.source?.sha || '未知')}</code></p>
        <p>结果由 AI 整理，可能有误；没有安装、执行或验证工具。</p>
      </details>
    </section>`;
  }

  async startResearchTask(taskId) {
    this.currentTab = 'saved'; this.savedSubTab = 'tasks';
    this.render();
    try {
      await feedAdapter.startResearch(taskId);
      this.showToast('已连接，进度和结果会显示在这里。');
      await feedAdapter.syncResearch();
    } catch (error) { this.showToast(error.message, null, null, 6500); }
  }

  // 渲染任务卡片
  renderTaskCard(task, item, isDemoExample) {
    const statusInfo = this.taskStatus(task);
    const active = ['requesting', 'reading', 'analyzing'].includes(task.status);

    return `
      <div class="task-card" data-task-id="${task.id}">
        <div class="task-header">
          <div class="task-title">
            ${this.escapeHtml(item?.display_title || item?.title || task.title || '未知选题')}
            ${isDemoExample ? `<span class="demo-state-banner">演示状态样例</span>` : ''}
          </div>
          <div>
            <span class="task-badge-pill ${statusInfo.class}">${statusInfo.text}</span>
          </div>
        </div>

        <div class="task-question-box">
          <div class="task-question-label">研究问题：</div>
          <div>${this.escapeHtml(task.question)}</div>
        </div>

        ${!isDemoExample && task.status === 'done' && task.research?.report ? `
          <details class="task-more"><summary>更多操作：试用与发文</summary>
          <section class="trial-entry" aria-label="试用清单入口">
            <div><strong>${task.trial_plan ? '试用清单 · ' + TRIAL_OUTCOMES[task.trial_plan.outcome] : '下一步，拿它做一件小事'}</strong>
              <p>${task.trial_plan ? '清单和实际观察单独保存，原来的 AI 整理保留。' : '沿用这份整理，列出操作和截图清单。不再消耗 AI 额度。'}</p></div>
            <button class="btn-primary-action" data-action="trial-plan" data-task-id="${task.id}">${task.trial_plan ? '查看 / 记录试用' : '准备试用清单'}</button>
            ${task.trial_plan ? `<div class="trial-entry-links"><button class="btn-secondary-quiet" data-action="trial-copy" data-task-id="${task.id}">复制清单</button><button class="btn-secondary-quiet" data-action="trial-download" data-task-id="${task.id}">下载清单</button><span>进度为手动记录，未自动核验</span></div>` : ''}
          </section>` : ''}
        ${!isDemoExample && task.status === 'done' && task.research?.status === 'done' && task.research?.report ? `<div class="writing-entry"><div><strong>把这份材料变成自己的内容</strong><p>说明、试用记录和原文一起带走，再补上你的看法。</p></div><button class="btn-secondary-quiet" data-action="writing-brief" data-task-id="${task.id}">${task.writing_brief ? '继续准备发文' : '准备发文'}</button></div>` : ''}
        ${!isDemoExample && task.status === 'done' && task.research?.report ? '</details>' : ''}
        ${task.imported_backup ? '<p class="backup-origin">从备份恢复的历史记录 · 本轮未重新核验</p>' : ''}
        ${task.research?.report ? this.renderResearchResult(task.research) : ''}
        ${active ? `<p class="research-progress" role="status">${task.status === 'reading' ? '正在读取公开的项目说明。' : task.status === 'analyzing' ? 'Codex 正在把说明整理成中文。可以离开此页，保持本机服务运行即可。' : '正在确认请求状态；重试连接不会重复启动同一请求。'}</p>` : ''}
        ${!isDemoExample && !feedAdapter.publicPreview && feedAdapter.getState().mode === 'live' && Boolean(repositoryName(item || {})) && ['draft', 'failed', 'requesting'].includes(task.status) ? `<div class="research-start-row"><button class="btn-primary-action" data-action="start-research" data-task-id="${task.id}">${task.status === 'requesting' ? '重试连接' : task.status === 'failed' ? '重新整理' : '用 Codex 整理'}</button><span>使用本机 Codex 账号额度；只发送公开说明和本次问题。</span></div>` : ''}
        ${task.result ? `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px 14px; margin-bottom: 12px; font-size: 13px;">
            <div style="font-weight: 600; color: #166534; margin-bottom: 4px;">研究结论：</div>
            <div style="color: #15803d; margin-bottom: 6px;">${this.escapeHtml(task.result.conclusion)}</div>
            <div style="color: #4b5563;"><strong>建议下一步：</strong>${this.escapeHtml(task.result.suggested_next_step)}</div>
          </div>
        ` : ''}

        ${task.error_message ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; color: #991b1b;">
            <strong>失败原因：</strong>${this.escapeHtml(task.error_message)}
          </div>
        ` : ''}

        <div class="task-actions">
          <span>更新时间：${this.formatTime(task.updated_at)}</span>
          <span style="color: var(--border-light);">|</span>
          ${!isDemoExample ? `
            <button class="btn-secondary-quiet" data-action="export-copy" data-task-id="${task.id}">复制材料</button>
            <button class="btn-secondary-quiet" data-action="export-download" data-task-id="${task.id}">下载 Markdown</button>
            <button class="btn-secondary-quiet" ${active ? 'disabled' : ''} data-action="edit-task" data-task-id="${task.id}" data-item-id="${task.item_id}">${task.status === 'done' ? '换个问题' : '编辑问题'}</button>
            <button class="btn-secondary-quiet" ${active ? 'disabled' : ''} data-action="delete-task" data-task-id="${task.id}" style="color: #991b1b;">删除任务</button>
          ` : `
            <span style="font-size: 12px; color: var(--text-light);">（示例只读展示）</span>
          `}
        </div>
      </div>
    `;
  }

  // 3. 我的关注独立视图
  renderProfileView(state) {
    const hiddenCount = state.hiddenItems.length;

    return `
      <div class="saved-followup-container">
        <div class="page-intro">
          <div class="intro-main">
            <h2 class="page-headline" tabindex="-1">我的关注偏好</h2>
            <p class="page-subtext">选几个方向或输入关键词，保存后立即在首页看到结果。</p>
          </div>
        </div>

        <div class="sidebar-card" style="padding: 24px; margin-bottom: 24px;">
          <form id="profile-full-form">
            <div class="form-group">
              <label class="form-label" for="profile-interests-input">想看的内容方向</label>
              <div class="form-help">用逗号分隔，例如：AI 工具、自动化、Mac。留空则不限制方向。</div>
              ${this.renderTopicChoices("profile-interests-input", state)}
              <textarea id="profile-interests-input" class="form-textarea" rows="4">${this.escapeHtml(state.profile.interests || '')}</textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="profile-exclude-input">过滤/少看的内容</label>
              <div class="form-help">命中这些词会从精选中移开，例如：开发工具、模型跑分。仍可在全部候选中查看。</div>
              <textarea id="profile-exclude-input" class="form-textarea" rows="3">${this.escapeHtml(state.profile.exclude || '')}</textarea>
            </div>

            <div class="transparency-callout">
              <strong>说明：</strong>${this.profileNote(state)}
            </div>

            <div id="profile-full-error" style="display: none; margin-top: 12px; color: #b91c1c; font-size: 13px;"></div>

            <div style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
              <button type="submit" class="btn-primary-action">保存偏好</button>
              <button type="button" class="btn-secondary-quiet" id="btn-reset-profile">恢复默认偏好</button>
              ${state.mode === "demo" ? `<button type="button" class="btn-secondary-quiet" id="btn-clear-profile" style="color: #991b1b;">清空偏好（测试未设置状态）</button>` : ""}
            </div>
          </form>
        </div>

        <section class="backup-entry sidebar-card">
          <div><h3>备份与恢复</h3><p>把已保存的收藏、关注偏好、整理结果和试用清单带走，换浏览器也能恢复。</p></div>
          <button class="btn-secondary-quiet" id="open-backup">管理备份</button>
        </section>
        <!-- 已隐藏条目管理 -->
        <div class="sidebar-card" style="padding: 20px;">
          <div class="sidebar-title">
            <span>已隐藏条目（不感兴趣）</span>
            <span class="sidebar-subtitle">${hiddenCount} 条</span>
          </div>
          ${hiddenCount === 0 ? `
            <div style="font-size: 13px; color: var(--text-light);">
              当前没有被隐藏的条目。当对某条推荐点击“不感兴趣”时，条目将从首页隐去，并可在此撤销。
            </div>
          ` : `
            <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
              以下内容已被隐藏，不会在今日推荐中出现：
            </div>
            <ul style="font-size: 13px; padding-left: 20px; margin-bottom: 16px; color: var(--text-muted);">
              ${state.hiddenItems.map(item => `
                <li style="margin-bottom: 6px;">
                  <span>${this.escapeHtml(item.display_title || item.title)}</span>
                  <button class="btn-secondary-quiet" data-restore-item-id="${item.id}" style="padding: 1px 6px; font-size: 11px; margin-left: 8px;">
                    取消隐藏
                  </button>
                </li>
              `).join('')}
            </ul>
            <button class="btn-secondary-quiet" id="btn-restore-all-hidden">恢复全部已隐藏条目</button>
          `}
        </div>
      </div>
    `;
  }

  // 空状态：没有设置关注
  renderNoProfileState() {
    return `
      <div class="empty-state">
        <h3 class="empty-title">尚未设置关注偏好</h3>
        <p class="empty-desc">记录你想了解的方向，例如“普通人能用的 AI 工具与自动化教程”。智能筛选尚未接入。</p>
        <button class="btn-primary-action" id="btn-setup-profile">设置我的关注</button>
      </div>
    `;
  }

  // 空状态：没有新内容
  renderEmptyFeedState(state) {
    if (state.mode === 'live' && (this.sourceFilter !== 'all' || this.onlyNew)) return '<div class="empty-state"><h3 class="empty-title">当前筛选没有内容</h3><p class="empty-desc">可以切换来源、关闭“只看本次新增”，或选择“全部候选”。来源未读到内容时，可在右侧查看原因。</p></div>';
    if (state.mode === 'live' && state.allItems.length) {
      const allHidden = state.selection.candidates.length === 0;
      return `<div class="empty-state">
        <h3 class="empty-title">${allHidden ? '本批候选已全部隐藏' : '这批资料没有匹配你的关注'}</h3>
        <p class="empty-desc">${allHidden ? '可以恢复已隐藏条目，再重新挑选。' : '可以调整关键词，或点上方“全部候选”看看。没有合适的内容时，不用无关项目凑数。'}</p>
        <button class="btn-secondary-quiet" id="${allHidden ? 'btn-restore-from-empty' : 'feed-adjust-profile'}">${allHidden ? '恢复已隐藏条目' : '调整我的关注'}</button>
      </div>`;
    }
    const hasHidden = state.hiddenItems.length > 0;
    return `
      <div class="empty-state">
        <h3 class="empty-title">${hasHidden ? "当前条目已隐藏" : state.mode === "live" && !state.generated_at ? "还没有获取真实内容" : "本次没有找到符合条件的内容"}</h3>
        <p class="empty-desc">
          ${hasHidden ? "可以在我的关注里恢复隐藏的条目。" : state.mode === "live" && !state.generated_at ? "点击上方更新内容，开始读取公开信息源。" : "不足条数不凑数，可选择全部候选或稍后再更新。"}
          ${hasHidden ? `（你隐藏了 ${state.hiddenItems.length} 条不感兴趣的内容）` : ''}
        </p>
        ${hasHidden ? `
          <button class="btn-secondary-quiet" id="btn-restore-from-empty">恢复已隐藏条目</button>
        ` : ''}
      </div>
    `;
  }

  toggleSaved(itemId,button) {
    const state=feedAdapter.getState(),saved=state.savedItemIds.has(itemId),archived=state.archivedItemIds.has(itemId);
    const y=window.scrollY,x=window.scrollX;
    try {
      feedAdapter.setSaved(itemId,!saved);
      window.scrollTo({top:y,left:x,behavior:'instant'});
      if(button.id) (document.getElementById(button.id) || document.querySelector('.page-headline'))?.focus({preventScroll:true});
      if(!saved) {
        if (this.isPublicHome()) this.showToast('已收藏，只留在这个浏览器。');
        else this.showToast('已收藏，继续浏览就好。','查看收藏',()=>{this.savedSubTab='items';this.switchTab('saved');},7000);
      }
      else if (this.isPublicHome()) this.showToast('已取消收藏。');
      else this.showToast('已取消收藏，主题里的材料保留。','撤销',()=>{
        try {feedAdapter.restoreSaved(itemId,{archived});this.showToast(archived ? '已恢复到归档。' : '已恢复收藏。');}
        catch(error){this.showToast(error.message);}
      },7000);
    } catch(error){this.showToast(`收藏操作未保存：${error.message}`);}
  }

  // 绑定主界面事件
  bindContentActions(state) {
    if (this.currentTab==='candidates') {
      bindDotCandidatesEvents(document,{
        onFile:file=>this.importDotFile(file),
        onView:view=>{this.dotView=view;this.activeCandidateId='';this.dotSelectedIds.clear();this.dotError='';this.render();document.querySelector(`[data-dot-view="${view}"]`)?.focus();},
        onFilters:filters=>{this.dotFilters=filters;this.activeCandidateId='';this.dotSelectedIds.clear();this.render();document.getElementById('dot-filter-query')?.focus({preventScroll:true});},
        onOpenCandidate:id=>{
          const mobile=window.matchMedia?.('(max-width: 820px)')?.matches;
          if(mobile && !document.querySelector('.dot-reader-layout.is-reader-open')) this.dotListWindowScroll=window.scrollY;
          this.activeCandidateId=id;this.renderDotInboxResults();
          if(mobile) document.querySelector('.dot-reader-pane')?.scrollIntoView?.({block:'start',behavior:'instant'});
          document.getElementById('dot-reader-title')?.focus({preventScroll:true});
        },
        onCloseCandidate:()=>{
          const id=document.querySelector('[data-dot-reader-id]')?.dataset.dotReaderId || this.activeCandidateId;
          this.activeCandidateId='';this.renderDotInboxResults();
          if(window.matchMedia?.('(max-width: 820px)')?.matches) window.scrollTo({top:this.dotListWindowScroll || 0,behavior:'instant'});
          document.querySelector(`[data-dot-open="${id}"]`)?.focus({preventScroll:true});
        },
        onIntakeToggle:open=>{this.dotIntakeOpen=open;},
        onSelect:(id,checked)=>{checked ? this.dotSelectedIds.add(id) : this.dotSelectedIds.delete(id);this.renderDotInboxResults();document.querySelector(`[data-dot-select="${id}"]`)?.focus({preventScroll:true});},
        onSelectAll:(ids,checked)=>{for (const id of ids) checked ? this.dotSelectedIds.add(id) : this.dotSelectedIds.delete(id);this.renderDotInboxResults();document.querySelector('[data-dot-select-all]')?.focus({preventScroll:true});},
        onSetStatus:(ids,status)=>this.updateDotStatus(ids,status),
        onExport:()=>this.downloadDotFeatured(),
        onInboxConnect:code=>this.connectDotInbox(code),
        onInboxSync:()=>this.syncDotInbox({manual:true}),
        onInboxDisconnect:()=>this.disconnectDotInbox(),
        onInboxShowNew:()=>{this.dotInboxPendingNew=0;this.renderDotInboxResults();},
      });
    }
    document.querySelectorAll('[data-dot-open-featured]').forEach(button=>button.addEventListener('click',()=>{this.dotView='featured';this.dotSelectedIds.clear();this.switchTab('candidates');}));
    bindPostMediaEvents(document);
    if (this.currentTab==='tutorials') bindCreatorActions(this,state);
    bindSourceBoardActions(this);
    document.querySelectorAll('[data-home-view]').forEach(button=>button.addEventListener('click',()=>{
      const view=button.dataset.homeView;
      if(!['latest','yesterday','week','kept'].includes(view)) return;
      this.homeView=view;this.homeMenuOpen=false;this.catsOpen=false;this.feedView='sources';this.currentTab='today';
      this.render();window.scrollTo({top:0,behavior:'instant'});
      document.querySelector(`[data-home-view="${view}"]`)?.focus();
    }));
    document.getElementById('home-cats-button')?.addEventListener('click',()=>{
      const top=window.scrollY;this.catsOpen=!this.catsOpen;this.render();
      window.scrollTo({top,behavior:'instant'});
      document.getElementById(this.catsOpen ? 'home-cats' : 'home-cats-button')?.focus();
    });
    document.getElementById('home-cats')?.addEventListener('keydown',event=>{
      if(event.key!=='Escape') return;
      event.preventDefault();this.catsOpen=false;this.render();document.getElementById('home-cats-button')?.focus();
    });
    document.getElementById('kosx-open')?.addEventListener('click',()=>{
      const top=window.scrollY;
      this.kosxOpen=!this.kosxOpen;
      if(!this.kosxOpen){this.kosxMessage='';this.kosxError='';}
      this.render();
      window.scrollTo({top,behavior:'instant'});
      document.getElementById(this.kosxOpen ? 'kosx-link' : 'kosx-open')?.focus();
    });
    document.getElementById('kosx-panel')?.addEventListener('submit',event=>{
      event.preventDefault();
      const draft=document.getElementById('kosx-link')?.value || '';
      const top=window.scrollY;
      try {
        const result=feedAdapter.submitKosxLink(draft);
        this.kosxOpen=true;this.kosxDraft='';this.kosxError='';
        this.kosxMessage=result.duplicate ? '这条已在待筛选里' : '已进入待筛选';
      } catch(error) {
        this.kosxOpen=true;this.kosxDraft=draft;this.kosxMessage='';
        this.kosxError=error.message || '没有放入待筛选。';
      }
      this.render();
      window.scrollTo({top,behavior:'instant'});
      document.getElementById('kosx-status')?.focus();
    });
    document.querySelectorAll('.cover-card a[href]').forEach(link=>link.addEventListener('click',()=>{
      this.noteHomeBoost(link.getAttribute('href') || '');
    }));
    document.getElementById('home-open-sources')?.addEventListener('click',()=>{
      this.homeSourcesOpen=true;this.render();document.querySelector('.home-legacy-board .page-headline')?.focus();
    });
    bindTopicActions(this,state);
    bindCollectionActions(this);
    this.bindTopicChoices(document);
    document.getElementById('open-backup')?.addEventListener('click', e => this.openBackupModal(e.currentTarget));
    document.getElementById('feed-selected-btn')?.addEventListener('click', () => {
      this.feedView = 'selected'; this.render(); document.getElementById('feed-selected-btn')?.focus();
    });
    document.getElementById('feed-all-btn')?.addEventListener('click', () => {
      this.feedView = 'all'; this.candidateLimit = 10; this.render(); document.getElementById('feed-all-btn')?.focus();
    });
    document.getElementById('feed-load-more')?.addEventListener('click', () => {
      const firstNew = this.readingState(state).selection.candidates[this.candidateLimit]?.id;
      this.candidateLimit += 10; this.render();
      if (firstNew) {
        const card = document.getElementById(`item-${firstNew}`);
        card?.setAttribute('tabindex', '-1'); card?.focus();
      }
    });
    document.getElementById('feed-source')?.addEventListener('change', e => {
      this.sourceFilter = e.target.value; this.candidateLimit = 10; this.render(); document.getElementById('feed-source')?.focus();
    });
    document.getElementById('feed-only-new')?.addEventListener('change', e => {
      this.onlyNew = e.target.checked; this.candidateLimit = 10; this.render(); document.getElementById('feed-only-new')?.focus();
    });
    document.getElementById('feed-adjust-profile')?.addEventListener('click', e => this.openProfileModal(e.currentTarget, '#feed-adjust-profile'));

    // 检查更新按钮
    document.getElementById('btn-check-update')?.addEventListener('click', (e) => {
      if (state.mode === "demo") this.openUpdateModal(e.currentTarget);
      else this.refreshFeed();
    });

    // 移动端和侧边栏偏好编辑
    document.getElementById('mobile-edit-profile-btn')?.addEventListener('click', (e) => {
      this.openProfileModal(e.currentTarget, '#mobile-edit-profile-btn');
    });

    document.getElementById('sidebar-edit-profile-btn')?.addEventListener('click', (e) => {
      this.openProfileModal(e.currentTarget, '#sidebar-edit-profile-btn');
    });

    document.getElementById('sidebar-view-all-followups')?.addEventListener('click', () => {
      this.currentTab = 'saved';
      this.savedSubTab = 'tasks';
      this.render();
    });

    document.getElementById('btn-setup-profile')?.addEventListener('click', (e) => {
      this.openProfileModal(e.currentTarget, '#btn-setup-profile');
    });

    document.getElementById('btn-return-feed')?.addEventListener('click', () => this.switchTab('today'));

    document.getElementById('subtab-items')?.addEventListener('click', () => {
      this.savedSubTab = 'items';
      this.render();
    });
    document.getElementById('subtab-archived')?.addEventListener('click', () => {
      this.savedSubTab='archived';this.render();document.getElementById('subtab-archived')?.focus();
    });
    document.getElementById('subtab-tasks')?.addEventListener('click', () => {
      this.savedSubTab = 'tasks';
      this.render();
    });

    document.getElementById('toggle-demo-status')?.addEventListener('change', (e) => {
      this.showDemoStatusExamples = e.target.checked;
      this.render();
    });

    document.getElementById('btn-restore-all-hidden')?.addEventListener('click', () => {
      try {
        feedAdapter.restoreAllHidden();
        this.showToast('已恢复所有隐藏条目');
      } catch (err) {
        this.showToast(`恢复失败：${err.message}`);
      }
    });

    document.getElementById('btn-restore-from-empty')?.addEventListener('click', () => {
      try {
        feedAdapter.restoreAllHidden();
        this.showToast('已恢复所有隐藏条目');
      } catch (err) {
        this.showToast(`恢复失败：${err.message}`);
      }
    });

    // 偏好完整表单
    const profileForm = document.getElementById('profile-full-form');
    if (profileForm) {
      profileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const interestsInput = document.getElementById('profile-interests-input');
        const excludeInput = document.getElementById('profile-exclude-input');
        const errEl = document.getElementById('profile-full-error');

        const interests = interestsInput ? interestsInput.value.trim() : '';
        const exclude = excludeInput ? excludeInput.value.trim() : '';

        try {
          feedAdapter.saveProfile({ interests, exclude });
          if (errEl) errEl.style.display = 'none';
          if (state.mode === 'live') { this.feedView = 'selected'; this.switchTab('today'); }
          this.showToast(state.mode === 'demo' ? this.profileNote(state) : '已按你的关注重新筛选');
        } catch (err) {
          if (errEl) {
            errEl.textContent = `偏好保存失败：${err.message}`;
            errEl.style.display = 'block';
          }
          this.showToast(`保存失败：${err.message}`);
        }
      });

      document.getElementById('btn-reset-profile')?.addEventListener('click', () => {
        try {
          feedAdapter.resetProfile();
          this.showToast('已恢复默认偏好');
        } catch (err) {
          this.showToast(`重置失败：${err.message}`);
        }
      });

      document.getElementById('btn-clear-profile')?.addEventListener('click', () => {
        try {
          feedAdapter.clearProfile();
          this.showToast('已清空偏好');
        } catch (err) {
          this.showToast(`清空失败：${err.message}`);
        }
      });
    }

    // 单个条目的交互
    document.querySelectorAll('[data-toggle-unknowns]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-toggle-unknowns');
        const list = document.getElementById(`unknowns-${id}`);
        if (!list) return;
        const isHidden = list.style.display === 'none';
        list.style.display = isHidden ? 'block' : 'none';
        btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      });
    });

    // 条目收藏、隐藏、跟进
    document.querySelectorAll('[data-action="toggle-save"]').forEach(btn => {
      btn.addEventListener('click',()=>this.toggleSaved(btn.dataset.itemId,btn));
    });

    document.querySelectorAll('[data-action="hide"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-item-id');
        try {
          feedAdapter.setHidden(itemId, true);
          this.showToast('已隐藏该条目', '撤销', () => {
            try {
              feedAdapter.setHidden(itemId, false);
              this.showToast('已撤销隐藏');
            } catch (err) {
              this.showToast(`撤销失败：${err.message}`);
            }
          });
        } catch (err) {
          this.showToast(`隐藏操作未保存：${err.message}`);
        }
      });
    });

    document.querySelectorAll('[data-action="followup"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const itemId = btn.getAttribute('data-item-id');
        this.openFollowupModal(itemId, e.currentTarget);
      });
    });

    document.querySelectorAll('[data-restore-item-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.getAttribute('data-restore-item-id');
        try {
          feedAdapter.setHidden(itemId, false);
          this.showToast('已恢复条目显示');
        } catch (err) {
          this.showToast(`恢复失败：${err.message}`);
        }
      });
    });

    document.querySelectorAll('.followup-mini-item').forEach(el => {
      const openTask = (e) => {
        const itemId = el.getAttribute('data-item-id');
        this.openFollowupModal(itemId, e.currentTarget);
      };
      el.addEventListener('click', openTask);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openTask(e);
        }
      });
    });

    document.getElementById('retry-research-sync')?.addEventListener('click', async () => {
      const tasks = feedAdapter.getState().followups.filter(task => task.status === 'requesting');
      for (const task of tasks) await this.startResearchTask(task.id);
      await feedAdapter.syncResearch();
    });
    document.querySelectorAll('[data-action="start-research"]').forEach(btn => {
      btn.addEventListener('click', () => this.startResearchTask(btn.dataset.taskId));
    });
    document.querySelectorAll('[data-action="export-copy"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.getAttribute('data-task-id');
        const text = feedAdapter.exportFollowupText(taskId);
        try {
          await navigator.clipboard.writeText(text);
          this.showToast('已复制跟进材料到剪贴板');
        } catch (_) {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          const copied = document.execCommand('copy');
          ta.remove();
          this.showToast(copied ? '已复制跟进材料' : '浏览器未允许复制，请用“导出材料”下载文件。');
        }
      });
    });

    document.querySelectorAll('[data-action="export-download"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const taskId = btn.getAttribute('data-task-id');
        const text = feedAdapter.exportFollowupText(taskId);
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `followup-${taskId}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.showToast('已发起下载，请查看浏览器下载记录');
      });
    });

    document.querySelectorAll('[data-action="trial-plan"]').forEach(btn => {
      btn.addEventListener('click', () => this.openTrialModal(btn.dataset.taskId, btn));
    });
    document.querySelectorAll('[data-action="writing-brief"]').forEach(btn => {
      btn.addEventListener('click', () => this.openWritingModal(btn.dataset.taskId, btn));
    });
    document.querySelectorAll('[data-action="trial-copy"], [data-action="trial-download"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const text = feedAdapter.exportTrialText(btn.dataset.taskId);
          if (btn.dataset.action === 'trial-copy') {
            await navigator.clipboard.writeText(text);
            this.showToast('试用清单已复制；尚未发送给任何 AI。');
          } else {
            const url = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}));
            const link = document.createElement('a'); link.href = url;
            link.download = `trial-${btn.dataset.taskId}.md`;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.showToast('已发起下载，请查看浏览器下载记录。');
          }
        } catch (error) { this.showToast(btn.dataset.action === 'trial-copy' ? '暂时无法复制，可用“下载清单”保存。' : error.message); }
      });
    });

    document.querySelectorAll('[data-action="edit-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const itemId = btn.getAttribute('data-item-id');
        this.openFollowupModal(itemId, e.currentTarget);
      });
    });

    document.querySelectorAll('[data-action="delete-task"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const taskId = btn.getAttribute('data-task-id');
        try {
          feedAdapter.removeFollowup(taskId);
          this.showToast('已删除跟进任务');
        } catch (err) {
          this.showToast(`删除失败：${err.message}`);
        }
      });
    });
  }

  // 渲染弹窗
  renderModals() {
    const modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;

    if (!this.activeModal) {
      modalRoot.innerHTML = '';
      return;
    }

    if (this.activeModal.startsWith('topic-')) { renderTopicDialog(this,modalRoot); return; }
    if (this.activeModal === 'guide') { renderGuide(this, modalRoot); return; }

    if (this.activeModal === 'followup' && this.activeFollowupItem) {
      this.renderFollowupModal(modalRoot);
    } else if (this.activeModal === 'backup') {
      this.renderBackupModal(modalRoot);
    } else if (this.activeModal === 'trial') {
      this.renderTrialModal(modalRoot);
    } else if (this.activeModal === 'writing') {
      this.renderWritingModal(modalRoot);
    } else if (this.activeModal === 'profile') {
      this.renderProfileModal(modalRoot);
    } else if (this.activeModal === 'update') {
      this.renderUpdateModal(modalRoot);
    }
  }

  // 1. 跟进任务弹窗
  renderFollowupModal(root) {
    const item = this.activeFollowupItem;
    const existingTask = feedAdapter.getFollowupForItem(item.id);
    const initialQuestion = existingTask ? existingTask.question : (item.suggested_question || '');
    const active = ['requesting', 'reading', 'analyzing'].includes(existingTask?.status);
    const live = feedAdapter.getState().mode === 'live';
    const canResearch = live && !feedAdapter.publicPreview && item.origin!=='user_added' && Boolean(repositoryName(item));

    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="followup-dialog-title">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3 class="modal-title" id="followup-dialog-title">
              ${existingTask ? '查看跟进' : '继续查一查'}
            </h3>
            <button class="modal-close-btn" id="modal-close-btn" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom: 14px;">
              <div style="font-size: 13px; color: var(--text-light);">选题主题：</div>
              <div style="font-size: 16px; font-weight: 600; color: var(--text-main); margin-top: 2px;">
                ${this.escapeHtml(item.display_title || item.title)}
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="followup-question-input">具体想查清的问题：</label>
              <div class="form-help">可直接使用推荐问题，也可以改成你关心的切口</div>
              <textarea ${active ? 'disabled' : ''} maxlength="2000" id="followup-question-input" class="form-textarea" rows="4">${this.escapeHtml(initialQuestion)}</textarea>
            </div>

            <div class="transparency-callout">
              ${canResearch ? '<strong>用 Codex 读项目说明：</strong>使用本机已登录账号的额度，把公开 README 和本次问题交给 Codex，结果返回这里。不会安装项目；问题里不要填写密码或私人资料。' : live ? '<strong>保留阅读线索：</strong>这里只保存问题，不调用 AI。可打开原文阅读，或到跟进任务里复制、下载材料。' : '<strong>示例模式：</strong>只保存问题，不会调用 AI。'}
              ${existingTask ? `<p>当前：${this.taskStatus(existingTask).text}${existingTask.status === 'done' ? '。换个问题会新建一份整理，原结果保留。' : ''}</p>` : ''}
            </div>

            ${existingTask?.research?.report ? this.renderResearchResult(existingTask.research) : ''}
            ${active ? '<p role="status">这项整理正在进行，可关闭窗口，在“收藏与跟进”查看最新进度。</p>' : ''}
            <div id="followup-modal-error" style="display: none; margin-top: 12px; color: #b91c1c; font-size: 13px;"></div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary-quiet" id="modal-cancel-btn">取消</button>
            ${!active ? `<button class="btn-secondary-quiet" id="modal-save-followup-btn">只保存问题</button>` : ''}
            ${canResearch && !active ? '<button class="btn-primary-action" id="modal-start-research-btn">用 Codex 整理</button>' : ''}
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-cancel-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') this.closeModal();
    });

    const saveQuestion = (run) => {
      const input = document.getElementById('followup-question-input');
      const errEl = document.getElementById('followup-modal-error');
      const question = input?.value.trim() || '';
      if (!question) { errEl.textContent = '请输入具体的问题。'; errEl.style.display = 'block'; input?.focus(); return; }
      try {
        const task = feedAdapter.saveFollowupDraft(item.id, question);
        this.closeModal();
        if (run && task.status !== 'done') this.startResearchTask(task.id);
        else {
          this.currentTab = 'saved'; this.savedSubTab = 'tasks'; this.render();
          this.showToast(task.status === 'done' ? '这个问题已有结果，可直接查看；修改问题才会重新整理。' : '问题已保存，还未调用 AI。');
        }
      } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
    };
    document.getElementById('modal-save-followup-btn')?.addEventListener('click', () => saveQuestion(false));
    document.getElementById('modal-start-research-btn')?.addEventListener('click', () => saveQuestion(true));

    setTimeout(() => {
      document.getElementById('followup-question-input')?.focus();
    }, 50);
  }

  renderBackupModal(root) {
    const state = feedAdapter.getState();
    const preview = this.backupPreview;
    const stats = preview?.summary;
    root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="backup-dialog-title">
      <div class="modal-dialog backup-dialog">
        <div class="modal-header"><h3 class="modal-title" id="backup-dialog-title">备份与恢复</h3><button class="modal-close-btn" id="modal-close-btn" aria-label="关闭">×</button></div>
        <div class="modal-body">
          <section class="backup-section">
            <h4>把已保存的资料带走</h4>
            <p>${state.mode === 'demo' ? '示例资料' : '当前资料'}：${state.savedItems.length} 条收藏（含 ${state.archivedItems.length} 条归档），${state.followups.length} 份跟进，${state.followups.filter(t => t.trial_plan).length} 份试用清单，${state.topics.length} 个主题，${state.dotCandidates?.length || 0} 条素材筛选记录。</p>
            <p class="form-help">还包含手动摘录、收藏想法、主题材料与想法、关注偏好、隐藏条目、发文准备和来源信息。不包含完整 README、软件或截图原件。文件里有你的记录，请自己保管。</p>
            <button class="btn-primary-action" id="download-backup">备份到电脑</button>
            <p id="backup-download-note" class="form-help" role="status"></p>
          </section>
          <section class="backup-section">
            <h4>从备份里找回资料</h4><p class="form-help">只在本机读取，先预览再合并；同编号的跟进保留当前版本。不会自动启动 AI。</p>
            <label class="backup-file-label" for="backup-file">选择备份文件（JSON，最多 4 MB）</label>
            <input id="backup-file" type="file" accept=".json,application/json" ${this.backupBusy ? 'disabled' : ''}>
            ${this.backupBusy ? '<p role="status">正在读取备份…</p>' : ''}
            ${preview ? `<div class="backup-summary">
              <h4>恢复前预览</h4><p>${this.escapeHtml(this.backupFilename)} · ${this.formatTime(preview.backup.exported_at)}</p>
              <ul><li>将新增 ${stats.saved} 条收藏（含 ${stats.archived || 0} 条归档）、${stats.hidden} 条隐藏记录</li><li>将新增 ${stats.excerpts || 0} 份手动摘录、${stats.notes || 0} 条收藏想法，已有内容保留当前版本</li><li>将新增 ${stats.tasks} 份跟进，其中 ${stats.trials} 份带试用清单</li><li>将新增 ${stats.topics} 个主题，同编号 ${stats.skippedTopics} 个保留当前版本</li><li>将新增 ${stats.candidates || 0} 条素材筛选记录，同原帖 ${stats.skippedCandidates || 0} 条保留当前筛选结果</li><li>同编号 ${stats.skipped} 份跟进保留当前版本</li>${stats.paused ? `<li>${stats.paused} 份未完成任务将暂停，等待你手动决定是否重做</li>` : ''}</ul>
              <label class="backup-option"><input type="checkbox" id="restore-profile" ${this.backupRestoreProfile ? 'checked' : ''}> 同时恢复备份里的关注偏好</label>
              ${stats.titles.length ? `<details><summary>查看将新增的跟进${stats.tasks > 20 ? '（前 20 份）' : ''}</summary><ul>${stats.titles.map(title => `<li>${this.escapeHtml(title)}</li>`).join('')}</ul></details>` : ''}
              ${!stats.hasChanges ? '<p class="form-help">这些记录已在当前浏览器中，没有需要新增的内容。</p>' : ''}
            </div>` : ''}
            ${this.backupRaw ? '<button class="btn-secondary-quiet" id="recheck-backup">重新预览</button>' : ''}
            ${this.backupError ? `<p class="trial-error" id="backup-error" tabindex="-1" role="alert">${this.escapeHtml(this.backupError)}</p>` : ''}
          </section>
        </div>
        <div class="modal-footer"><button class="btn-secondary-quiet" id="modal-cancel-btn">关闭</button><button class="btn-primary-action" id="restore-backup" ${!stats?.hasChanges || this.backupBusy ? 'disabled' : ''}>合并恢复</button></div>
      </div>
    </div>`;
    document.getElementById('modal-close-btn').onclick = () => this.closeModal();
    document.getElementById('modal-cancel-btn').onclick = () => this.closeModal();
    document.getElementById('modal-backdrop').onclick = event => { if (event.target.id === 'modal-backdrop') this.closeModal(); };
    document.getElementById('download-backup').onclick = () => {
      try {
        const backup = feedAdapter.createBackup();
        const url = URL.createObjectURL(new Blob([backup.raw], {type: 'application/json;charset=utf-8'}));
        const link = document.createElement('a'); link.href = url; link.download = backup.filename;
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        document.getElementById('backup-download-note').textContent = '已发起下载，请在浏览器下载记录中确认 JSON 文件已保存。';
      } catch (error) { this.backupError = error.message; this.renderBackupModal(root); document.getElementById('backup-error')?.focus(); }
    };
    const recheck = () => {
      try { this.backupPreview = feedAdapter.previewBackup(this.backupRaw, {restoreProfile: this.backupRestoreProfile}); this.backupError = ''; }
      catch (error) { this.backupPreview = null; this.backupError = error.message; }
      this.renderBackupModal(root);
    };
    document.getElementById('backup-file').onchange = async event => {
      const file = event.target.files?.[0]; if (!file) return;
      const session = this.backupSession;
      this.backupPreview = null; this.backupRaw = null; this.backupError = ''; this.backupFilename = file.name; this.backupBusy = true;
      this.renderBackupModal(root);
      try {
        if (file.size > BACKUP_LIMIT) throw new Error('备份文件超过 4 MB，暂不支持恢复。');
        const raw = await file.text();
        if (session !== this.backupSession || this.activeModal !== 'backup') return;
        this.backupRaw = raw; this.backupBusy = false; recheck();
      } catch (error) {
        if (session !== this.backupSession || this.activeModal !== 'backup') return;
        this.backupBusy = false; this.backupError = error.message; this.renderBackupModal(root);
      }
    };
    document.getElementById('restore-profile')?.addEventListener('change', event => { this.backupRestoreProfile = event.target.checked; recheck(); document.getElementById('restore-profile')?.focus(); });
    document.getElementById('recheck-backup')?.addEventListener('click', recheck);
    document.getElementById('restore-backup').onclick = () => {
      try {
        const summary = feedAdapter.restoreBackup(this.backupPreview, {restoreProfile: this.backupRestoreProfile});
        this.closeModal(); this.currentTab = summary.topics ? 'topics' : 'saved'; this.selectedTopicId=null; this.savedSubTab = summary.tasks ? 'tasks' : 'items'; this.render();
        this.showToast(`已恢复 ${summary.saved} 条收藏、${summary.excerpts || 0} 份摘录、${summary.notes || 0} 条想法、${summary.tasks} 份跟进、${summary.topics} 个主题、${summary.candidates || 0} 条素材筛选记录。当前已有记录保留，未启动 AI。`, null, null, 6000);
      } catch (error) { this.backupError = error.message; this.renderBackupModal(root); document.getElementById('backup-error')?.focus(); }
    };
  }

  renderWritingModal(root) {
    const draft = this.writingDraft;
    const taskId = this.activeWritingTask;
    root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="writing-dialog-title">
      <div class="modal-dialog writing-dialog">
        <div class="modal-header"><h3 class="modal-title" id="writing-dialog-title">准备发文</h3><button class="modal-close-btn" id="modal-close-btn" aria-label="关闭">×</button></div>
        <form id="writing-form" class="writing-form">
          <div class="modal-body">
            <p class="trial-intro">材料已经带好。补一句自己的看法，复制到 Muse 或你常用的 AI，让它帮你写初稿。</p>
            <p class="writing-status" id="writing-source-status"></p>
            <div class="form-group"><label class="form-label" for="writing-format">想写成什么</label><select class="form-textarea" id="writing-format" name="format">${Object.entries(WRITING_FORMATS).map(([key,label]) => `<option value="${key}" ${draft.format === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label" for="writing-angle">我自己的看法或切入点 <small>选填</small></label><textarea class="form-textarea" id="writing-angle" name="angle" rows="3" maxlength="3000" placeholder="比如：我更关心它能不能少让我复制粘贴。现在还没试，先别写成推荐。">${this.escapeHtml(draft.angle)}</textarea></div>
            <details class="trial-plan-details"><summary>指定读者（选填）</summary><label class="form-label" for="writing-audience">这篇给谁看</label><input class="form-textarea" id="writing-audience" name="audience" maxlength="300" placeholder="比如：经常看英文资料、但不想折腾设置的人" value="${this.escapeHtml(draft.audience)}"></details>
            <details class="trial-plan-details" id="writing-preview-details"><summary>预览将复制的材料</summary><label class="form-label" for="writing-output">写作要求、说明来源与当前试用记录</label><textarea class="form-textarea writing-output" id="writing-output" readonly rows="12"></textarea></details>
            <p class="form-help">在本机整理，不额外调用 AI。截图只带备注，不读取文件。复制前检查私人信息；复制后仍需自己粘贴，尚未发送或发布。</p>
            <p id="writing-feedback" class="form-help" role="status"></p>
            <p id="writing-error" class="trial-error" role="alert" tabindex="-1" hidden></p>
          </div>
          <div class="modal-footer"><button type="button" class="btn-secondary-quiet" id="modal-cancel-btn">取消</button><button type="button" class="btn-secondary-quiet" id="save-writing-only">只保存</button><button type="submit" class="btn-primary-action" id="copy-writing">保存并复制材料</button></div>
        </form>
      </div>
    </div>`;
    const form = document.getElementById('writing-form');
    const output = document.getElementById('writing-output');
    const feedback = document.getElementById('writing-feedback');
    const errorEl = document.getElementById('writing-error');
    const values = () => Object.fromEntries(new FormData(form));
    const showError = error => { errorEl.hidden = false; errorEl.textContent = error.message; };
    const updatePreview = () => {
      try {
        const material = feedAdapter.prepareWritingMaterial(taskId, values());
        output.value = material.text;
        document.getElementById('writing-source-status').textContent = material.status + (material.tutorialOutline ? ' · 将准备待实操提纲' : '');
        errorEl.hidden = true; feedback.textContent = '';
        return material;
      } catch (error) { output.value = ''; showError(error); throw error; }
    };
    form.oninput = () => { try { updatePreview(); } catch {} };
    form.onchange = () => { try { updatePreview(); } catch {} };
    document.getElementById('modal-close-btn').onclick = () => this.closeModal();
    document.getElementById('modal-cancel-btn').onclick = () => this.closeModal();
    document.getElementById('modal-backdrop').onclick = event => { if (event.target.id === 'modal-backdrop') this.closeModal(); };
    document.getElementById('save-writing-only').onclick = () => {
      try { updatePreview(); feedAdapter.saveWritingBrief(taskId, values()); this.closeModal(); this.showToast('发文准备已保存，可以稍后继续。'); }
      catch (error) { showError(error); errorEl.focus(); }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      let material;
      try { material = updatePreview(); feedAdapter.saveWritingBrief(taskId, values()); }
      catch (error) { showError(error); errorEl.focus(); return; }
      const copyButton = document.getElementById('copy-writing'); copyButton.disabled = true;
      try {
        await navigator.clipboard.writeText(material.text);
        feedback.textContent = '已保存并复制。去 Muse 或其他 AI 粘贴即可；尚未自动发送。';
      } catch {
        document.getElementById('writing-preview-details')?.setAttribute('open', '');
        output.focus(); output.select();
        feedback.textContent = '发文准备已保存，但浏览器未允许复制。请手动复制已选中的材料。';
      } finally { copyButton.disabled = false; }
    };
    try { updatePreview(); } catch {}
    document.getElementById('writing-format').focus();
  }

  renderTrialModal(root) {
    const draft = this.trialDraft;
    const taskId = this.activeTrialTask;
    const field = (key, title, rows, limit, help = '') => `<div class="form-group"><label class="form-label" for="trial-${key}">${title}</label>${help ? `<p class="form-help">${help}</p>` : ''}<textarea class="form-textarea" id="trial-${key}" name="${key}" rows="${rows}" maxlength="${limit}">${this.escapeHtml(draft[key])}</textarea></div>`;
    root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="trial-dialog-title">
      <div class="modal-dialog trial-dialog">
        <div class="modal-header"><h3 class="modal-title" id="trial-dialog-title">准备试用与截图</h3><button class="modal-close-btn" id="modal-close-btn" aria-label="关闭">×</button></div>
        <form id="trial-form" class="trial-form">
          <div class="modal-body">
            <p class="trial-intro">计划已填好。先保存，亲自试过后再补结果；不会自动安装或开始操作。</p>
            ${field('goal', '这次只验证一件事', 3, 2000, '从原来的 AI 建议带入，可改成你的实际问题。')}
            <details class="trial-plan-details"><summary>操作步骤与截图清单（可修改）</summary>
              ${field('steps', '准备与操作步骤', 5, 8000, '来源是 AI 对说明的整理；保留适合你设备的步骤，每行一条。')}
              ${field('shots', '要留下的截图', 4, 3000, '这是通用拍摄提示，不代表已经生成截图；注意避开私人信息。')}
            </details>
            <div class="trial-observation">
              <div class="form-group"><label class="form-label" for="trial-outcome">我实际做到哪一步</label>
                <select class="form-textarea" id="trial-outcome" name="outcome">${Object.entries(TRIAL_OUTCOMES).map(([key,label]) => `<option value="${key}" ${draft.outcome === key ? 'selected' : ''}>${label}</option>`).join('')}</select>
              </div>
              ${field('notes', '实际看到了什么', 3, 8000, '没试过就留空；跑通或卡住时，写下结果或报错。')}
              <details class="trial-plan-details"><summary>补充截图或材料线索（选填）</summary>
                ${field('evidence_notes', '截图或材料线索', 2, 3000, '填写截图文件名、公开链接或备注。这里不上传，也不会自动读取这些文件。')}
              </details>
            </div>
            <p class="form-help">清单只保存在当前浏览器；保存后可复制或下载。试用进度是手动记录，不会把 AI 整理改成“已验证”。</p>
            <p id="trial-error" class="trial-error" role="alert" tabindex="-1" hidden></p>
          </div>
          <div class="modal-footer"><button type="button" class="btn-secondary-quiet" id="modal-cancel-btn">取消</button><button type="submit" class="btn-primary-action">保存清单</button></div>
        </form>
      </div>
    </div>`;
    document.getElementById('modal-close-btn').onclick = () => this.closeModal();
    document.getElementById('modal-cancel-btn').onclick = () => this.closeModal();
    document.getElementById('modal-backdrop').onclick = event => { if (event.target.id === 'modal-backdrop') this.closeModal(); };
    document.getElementById('trial-form').onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try { feedAdapter.saveTrialPlan(taskId, values); this.closeModal(); this.showToast('试用清单已保存；还没有开始自动操作。'); }
      catch (error) { const el = document.getElementById('trial-error'); el.hidden = false; el.textContent = error.message; el.focus(); }
    };
    document.getElementById('trial-goal').focus();
  }

  // 2. 偏好设置弹窗
  renderProfileModal(root) {
    const state = feedAdapter.getState();

    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3 class="modal-title" id="profile-dialog-title">编辑我的关注</h3>
            <button class="modal-close-btn" id="modal-close-btn" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label" for="modal-interests-input">想看的内容方向：</label>
              ${this.renderTopicChoices("modal-interests-input", state)}
              <div class="form-help">用逗号分隔关键词；留空则不限制方向。</div>
              <textarea id="modal-interests-input" class="form-textarea" rows="3">${this.escapeHtml(state.profile.interests || '')}</textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="modal-exclude-input">过滤/少看的内容：</label>
              <textarea id="modal-exclude-input" class="form-textarea" rows="2">${this.escapeHtml(state.profile.exclude || '')}</textarea>
            </div>

            <div class="transparency-callout">
              <strong>说明：</strong>${this.profileNote(state)}
            </div>

            <div id="profile-modal-error" style="display: none; margin-top: 12px; color: #b91c1c; font-size: 13px;"></div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary-quiet" id="modal-reset-profile-btn">恢复默认偏好</button>
            <button class="btn-secondary-quiet" id="modal-cancel-btn">取消</button>
            <button class="btn-primary-action" id="modal-save-profile-btn">保存偏好</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-cancel-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') this.closeModal();
    });

    this.bindTopicChoices(root);

    document.getElementById('modal-reset-profile-btn')?.addEventListener('click', () => {
      try {
        feedAdapter.resetProfile();
        this.closeModal();
        this.showToast('已恢复默认偏好');
      } catch (err) {
        this.showToast(`重置失败：${err.message}`);
      }
    });

    document.getElementById('modal-save-profile-btn')?.addEventListener('click', () => {
      const interestsInput = document.getElementById('modal-interests-input');
      const excludeInput = document.getElementById('modal-exclude-input');
      const errEl = document.getElementById('profile-modal-error');

      const interests = interestsInput ? interestsInput.value.trim() : '';
      const exclude = excludeInput ? excludeInput.value.trim() : '';

      try {
        feedAdapter.saveProfile({ interests, exclude });
        this.closeModal();
        if (state.mode === 'live') { this.feedView = 'selected'; this.currentTab = 'today'; this.render(); }
        this.showToast(state.mode === 'demo' ? this.profileNote(state) : '已按你的关注重新筛选');
      } catch (err) {
        // 保存失败：保留用户在文本框中的内容，给出错误提示
        if (errEl) {
          errEl.textContent = `偏好保存失败：${err.message}`;
          errEl.style.display = 'block';
        }
        this.showToast(`保存失败：${err.message}`);
      }
    });

    setTimeout(() => {
      document.getElementById('modal-interests-input')?.focus();
    }, 50);
  }

  // 3. 检查更新说明弹窗
  renderUpdateModal(root) {
    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3 class="modal-title" id="update-dialog-title">检查更新</h3>
            <button class="modal-close-btn" id="modal-close-btn" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <p style="font-size: 15px; color: var(--text-main); line-height: 1.6;">
              这版还没有连接真实信息源，目前展示的是示例内容。接入后，你可以在这里获取新内容。
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn-primary-action" id="modal-close-update-btn">知道了</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-close-update-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') this.closeModal();
    });

    setTimeout(() => {
      document.getElementById('modal-close-update-btn')?.focus();
    }, 50);
  }

  async refreshFeed() {
    if (this.refreshing || feedAdapter.loadStatus?.phase === 'loading') return;
    this.refreshing = true;
    this.refreshError = '';
    this.render();
    let notice = '';
    try { notice = await feedAdapter.refreshFeed(); }
    catch { this.refreshError = '暂时无法更新，保留当前内容，请稍后重试。'; }
    finally {
      this.refreshing = false;
      if (this.shouldDeferBackgroundRender()) {
        this.pendingRender = true;
        const button=document.getElementById('btn-check-update');
        if (button) {button.disabled=false;button.textContent=feedAdapter.publicPreview ? '查看更新' : '更新内容';}
      } else {
        this.render();
        document.getElementById('btn-check-update')?.focus();
      }
      if (notice) this.showToast(notice, null, null, 6000);
    }
  }

  profileNote(state) {
    return state.mode === 'demo' ? '你的阅读偏好，示例内容暂不重排。' : '在本机按关键词筛选，不调用 AI。常见方向支持中英文对应，其他文字按原词匹配；复杂要求需继续核对。';
  }

  safeUrl(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; }
    catch { return '#'; }
  }

  // 辅助格式化
  formatTime(isoStr) {
    if (!isoStr) return '时间未提供';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (_) {
      return isoStr;
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// 页面加载完成后启动应用
window.addEventListener('DOMContentLoaded', () => {
  window.__feedApp = new PersonalFeedApp();
});
