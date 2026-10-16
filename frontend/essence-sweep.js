// Three-hour 「最新精华」sweep. It reads the public snapshot and the queue.
// It does not call api.x.com, a paid X client, or a model. New posts that are
// not already in that snapshot still arrive through POST /api/dot/pending
// with the existing delivery key.
import { autoApproveStalePending, canonicalPendingPost, enqueueDeliveryPosts, listApprovedKosxRecords, listKosxRecords, publishApprovedFeed, readPublicFeedSnapshot } from '../dot-pending-service.js';
import { originalPostInstant } from './kosx-public-posts.js';
import { coverExcerpt } from './src/homeShowcaseView.js';
import { REVIEW_TEXT_MAX, isReviewSignalCopy, stripIntakePipelineCopy } from './src/reviewQueue.js';
import { loadKosxPoolHandles } from './kosx-pool-cache.js';
import { KOSX_POOL_SOURCE } from './kosx-pool.js';
import {
  ESSENCE_INTAKE_CAP, ESSENCE_SWEEP_BUDGET, ESSENCE_SWEEP_STATE_KEY,
  backoffActive, fillMissingCounts, inRecentBeijingDays, sweepWaitMs,
} from './essence-schedule.js';

const X_API = /(?:^|\.)(?:api\.x\.com|api\.twitter\.com)$/i;

function clockMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  if (typeof now === 'string' && Number.isFinite(Date.parse(now))) return Date.parse(now);
  return Date.now();
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function selectSweepIntake(items, {handles, queuedKeys, now = Date.now(), cap = ESSENCE_INTAKE_CAP} = {}) {
  const pool = handles instanceof Set ? handles : new Set(Array.isArray(handles) ? handles : []);
  const queued = queuedKeys instanceof Set ? queuedKeys : new Set(Array.isArray(queuedKeys) ? queuedKeys : []);
  const limit = Number.isSafeInteger(cap) && cap > 0 ? cap : ESSENCE_INTAKE_CAP;
  const seen = new Set();
  const chosen = [];
  const rows = Array.isArray(items) ? items : [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const post = canonicalPendingPost(item.original_url || item.canonical_url || item.url || '');
    if (!post || seen.has(post.key) || queued.has(post.key)) continue;
    const named = typeof item.author_handle === 'string' ? item.author_handle : '';
    if (named && named.toLowerCase() !== post.author_handle.toLowerCase()) continue;
    if (!pool.has(post.author_handle.toLowerCase())) continue;
    const instant = originalPostInstant({...item, url:post.url, key:post.key});
    if (!inRecentBeijingDays(instant, now)) continue;
    seen.add(post.key);
    const next = {...post, note:''};
    const summary = coverExcerpt(stripIntakePipelineCopy(typeof item.summary === 'string' ? item.summary : ''));
    if (summary && !isReviewSignalCopy(summary)) next.text = summary.slice(0, REVIEW_TEXT_MAX);
    const title = stripIntakePipelineCopy(typeof item.title === 'string' ? item.title : '');
    if (title && title !== summary && !isReviewSignalCopy(title) && !/的精华帖$/u.test(title)) next.note = title.slice(0, 400);
    if (typeof item.published_at === 'string' && Number.isFinite(Date.parse(item.published_at))) next.published_at = new Date(item.published_at).toISOString();
    else if (instant) next.published_at = instant;
    const bookmark = fillMissingCounts({}, item);
    if (bookmark.changed) {
      if (Object.hasOwn(bookmark.record, 'bookmark_count')) next.bookmark_count = bookmark.record.bookmark_count;
      if (Object.hasOwn(bookmark.record, 'like_count')) next.like_count = bookmark.record.like_count;
    }
    chosen.push({post:next, instant:Date.parse(next.published_at || instant || '') || 0});
  }
  chosen.sort((left, right) => right.instant - left.instant || (left.post.key < right.post.key ? -1 : left.post.key > right.post.key ? 1 : 0));
  return chosen.slice(0, limit).map(row => row.post);
}

function donorMap(items) {
  const map = new Map();
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    try {
      const post = canonicalPendingPost(item?.original_url || item?.canonical_url || item?.url || '');
      if (!post) continue;
      const filled = fillMissingCounts(map.get(post.key) || {}, item);
      map.set(post.key, filled.record || {});
    } catch { /* One bad public row does not stop the backfill. */ }
  }
  return map;
}

function heatDrift(feed, records) {
  const items = Array.isArray(feed?.items) ? feed.items : [];
  for (const record of records) {
    if (!record || record.status !== 'approved') continue;
    const donors = fillMissingCounts({}, record);
    if (!donors.changed) continue;
    const item = items.find(entry => canonicalPendingPost(entry?.original_url || entry?.canonical_url || '')?.key === record.key);
    if (!item) continue;
    const missing = fillMissingCounts(item, record);
    if (missing.changed) return true;
  }
  return false;
}

async function readSweepState(env) {
  try {
    const raw = await env?.DOT_INBOX?.get?.(ESSENCE_SWEEP_STATE_KEY);
    if (typeof raw !== 'string' || !raw) return null;
    const parsed = JSON.parse(raw);
    return plain(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSweepState(env, state) {
  try {
    await env.DOT_INBOX.put(ESSENCE_SWEEP_STATE_KEY, JSON.stringify({
      failures:Number.isSafeInteger(state.failures) && state.failures > 0 ? state.failures : 0,
      last_failure_at:typeof state.last_failure_at === 'string' ? state.last_failure_at : null,
      last_success_at:typeof state.last_success_at === 'string' ? state.last_success_at : null,
      last_attempt_at:state.last_attempt_at,
    }));
  } catch { /* The next cron still runs. A missed marker only skips the backoff. */ }
}

async function intakeFromPublicSnapshot(env, options) {
  const now = clockMs(options.now);
  let roster_gets = 0;
  const baseFetch = options.fetchImpl || env?.kosxPoolFetch || globalThis.fetch;
  const fetchImpl = async (url, init) => {
    let host = '';
    try { host = new URL(String(url)).hostname; } catch { host = ''; }
    if (X_API.test(host)) throw Error('x api disabled');
    if (String(url).startsWith(KOSX_POOL_SOURCE)) roster_gets += 1;
    return baseFetch(url, init);
  };
  const handles = await loadKosxPoolHandles(env, {fetchImpl, now});
  const feed = await readPublicFeedSnapshot(env);
  const queued = new Set((await listKosxRecords(env)).map(record => record.key));
  const posts = selectSweepIntake(feed.items, {handles, queuedKeys:queued, now, cap:ESSENCE_INTAKE_CAP});
  const saved = await enqueueDeliveryPosts(env, posts, {handles});
  return {created:saved.created.length, held:saved.held.length, full:saved.full === true, roster_gets, x_api:0};
}

export async function backfillEssenceHeat(env, {publish = true, extraItems = []} = {}) {
  const empty = {updated:0, republished:false};
  let feed = null;
  try { feed = await readPublicFeedSnapshot(env); }
  catch { return empty; }
  if (!feed || !Array.isArray(feed.items)) return empty;
  const donors = donorMap([...(Array.isArray(extraItems) ? extraItems : []), ...feed.items]);
  let records;
  try { records = await listApprovedKosxRecords(env); }
  catch { return empty; }
  let updated = 0;
  for (const record of records) {
    try {
      const filled = fillMissingCounts(record, donors.get(record.key));
      if (!filled.changed || !filled.record) continue;
      await env.DOT_INBOX.put(`pending:${record.key}`, JSON.stringify(filled.record), {
        metadata:{id:record.id, key:record.key, status:record.status, submitted_at:record.submitted_at, ...(record.reviewed_at ? {reviewed_at:record.reviewed_at} : {}), ...(record.approval ? {approval:record.approval} : {})},
      });
      updated += 1;
    } catch { /* Keep going. An empty or odd field must not abort the sweep. */ }
  }
  let fresh = records;
  if (updated) {
    try { fresh = await listApprovedKosxRecords(env); }
    catch { fresh = records; }
  }
  const drift = heatDrift(feed, fresh);
  if (publish && (updated || drift)) {
    try {
      await publishApprovedFeed(env);
      return {updated, republished:true};
    } catch {
      return {updated, republished:false};
    }
  }
  return {updated, republished:false};
}

export async function runEssenceSweep(env, options = {}) {
  const now = clockMs(options.now);
  const iso = new Date(now).toISOString();
  const report = {x_api:ESSENCE_SWEEP_BUDGET.x_api, llm_tokens:ESSENCE_SWEEP_BUDGET.llm_tokens, roster_gets:0, enqueued:0, auto_approved:0, heat_updated:0, scan_skipped:false, scan_failed:false};
  const state = await readSweepState(env);
  let changed = false;
  if (backoffActive(state, now)) {
    report.scan_skipped = true;
  } else {
    try {
      const intake = await intakeFromPublicSnapshot(env, {...options, now});
      report.enqueued = intake.created;
      report.roster_gets = intake.roster_gets;
      report.x_api = intake.x_api;
      if (intake.created) changed = true;
      await writeSweepState(env, {failures:0, last_failure_at:null, last_success_at:iso, last_attempt_at:iso});
    } catch {
      const failures = (Number.isSafeInteger(state?.failures) ? state.failures : 0) + 1;
      await writeSweepState(env, {failures, last_failure_at:iso, last_success_at:state?.last_success_at || null, last_attempt_at:iso});
      report.scan_failed = true;
      console.warn(JSON.stringify({event:'essence-sweep-failed', failures, retry_in_ms:sweepWaitMs(failures)}));
    }
  }
  try {
    const auto = await autoApproveStalePending(env, {now, publish:false});
    report.auto_approved = auto.approved.length;
    if (auto.approved.length) changed = true;
  } catch { console.warn(JSON.stringify({event:'essence-auto-approve-failed'})); }
  try {
    const heat = await backfillEssenceHeat(env, {publish:false, extraItems:options.extraItems});
    report.heat_updated = heat.updated;
    if (heat.updated) changed = true;
  } catch { console.warn(JSON.stringify({event:'essence-heat-backfill-failed'})); }
  if (changed) {
    try { await publishApprovedFeed(env); }
    catch { console.warn(JSON.stringify({event:'essence-sweep-publish-failed'})); }
  }
  return report;
}
