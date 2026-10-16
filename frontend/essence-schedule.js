// Cadence and throttle for 「最新精华」intake.
// The Worker does not call the X API or a model. Overheard may spend tokens
// before it POSTs with the existing delivery key; this schedule does not add
// another paid scan. See docs/pending-review.md.
import { REVIEW_COUNT_MAX } from './src/reviewQueue.js';
import { addCalendarDays, beijingDateKey } from './src/homeShowcase.js';

export const PUBLIC_REFRESH_CRON = '0 1,13 * * *';
// 00:00, 04:00, 08:00, 12:00 UTC = 08:00, 12:00, 16:00, 20:00 Asia/Shanghai.
export const ESSENCE_SWEEP_CRON = '0 0,4,8,12 * * *';
export const ESSENCE_SWEEP_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const PENDING_AUTO_APPROVE_MS = 3 * 60 * 60 * 1000;
export const ESSENCE_INTAKE_WINDOW_DAYS = 2;
export const ESSENCE_INTAKE_CAP = 20;
export const ESSENCE_SWEEP_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
export const ESSENCE_SWEEP_STATE_KEY = 'essence_sweep:v1';

// Worst case for one essence sweep. Roster is the free impact.kosx.ai member
// list, and only when its cache is older than one hour. Lower ESSENCE_INTAKE_CAP
// to write fewer queue rows. A failed sweep waits 6h, then 12h, then 24h.
export const ESSENCE_SWEEP_BUDGET = Object.freeze({
  x_api: 0,
  llm_tokens: 0,
  roster_gets: 1,
  queue_writes: ESSENCE_INTAKE_CAP,
});

function clockMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  if (typeof now === 'string') return Date.parse(now);
  return Date.now();
}

export function pendingAgeMs(record, now = Date.now()) {
  const instant = record?.submitted_at || record?.created_at;
  const then = Date.parse(typeof instant === 'string' ? instant : '');
  const clock = clockMs(now);
  if (!Number.isFinite(then) || !Number.isFinite(clock)) return null;
  return clock - then;
}

// Homepage paste stays manual. Delivery rows, including ones held because they
// would enter yesterday's underrated shelf, auto-approve strictly after 3 hours.
// Equal to 3 hours is still waiting. This does not pin the underrated shelf.
export function shouldAutoApprove(record, now = Date.now()) {
  if (!record || record.status !== 'pending' || record.source !== 'delivery') return false;
  const age = pendingAgeMs(record, now);
  return age !== null && age > PENDING_AUTO_APPROVE_MS;
}

export function inRecentBeijingDays(instant, now = Date.now(), days = ESSENCE_INTAKE_WINDOW_DAYS) {
  const posted = Date.parse(typeof instant === 'string' ? instant : '');
  const clock = clockMs(now);
  if (!Number.isFinite(posted) || !Number.isFinite(clock) || !Number.isInteger(days) || days < 1) return false;
  const postDay = beijingDateKey(posted);
  const today = beijingDateKey(clock);
  if (!postDay || !today) return false;
  for (let index = 0; index < days; index += 1) {
    if (postDay === addCalendarDays(today, -index)) return true;
  }
  return false;
}

export function sweepWaitMs(failures) {
  const count = Number.isSafeInteger(failures) && failures > 0 ? failures : 0;
  if (!count) return 0;
  const shift = Math.min(count, 3);
  return Math.min(ESSENCE_SWEEP_INTERVAL_MS * (2 ** shift), ESSENCE_SWEEP_BACKOFF_MAX_MS);
}

export function backoffActive(state, now = Date.now()) {
  const failures = state?.failures;
  if (!Number.isSafeInteger(failures) || failures < 1) return false;
  const then = Date.parse(state?.last_failure_at || '');
  const clock = clockMs(now);
  if (!Number.isFinite(then) || !Number.isFinite(clock) || clock < then) return false;
  return clock - then < sweepWaitMs(failures);
}

export function validHeatCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= REVIEW_COUNT_MAX ? value : null;
}

// Fill bookmark_count / like_count only when the target does not already have
// a usable number. Zero stays. Missing, null, and junk donors are ignored.
// The function does not throw.
export function fillMissingCounts(target, donor) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return {record:target ?? null, changed:false};
  let changed = false;
  const record = {...target};
  for (const field of ['bookmark_count', 'like_count']) {
    if (validHeatCount(record[field]) !== null) continue;
    const value = donor && typeof donor === 'object' ? validHeatCount(donor[field]) : null;
    if (value === null) continue;
    record[field] = value;
    changed = true;
  }
  return {record, changed};
}
