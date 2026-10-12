import { PRACTICAL_ITEMS } from './practicalMaterials.js';
import { PRACTICAL_HISTORY } from './practicalHistory.js';

// A maintenance reminder, not a factual expiry date or a software test.
export const MATERIAL_REVIEW_INTERVAL_DAYS = 30;
const stamp = value => typeof value==='string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const matches=(item,entry)=>item?.id===entry.id && item.original_url===(entry.original_url || entry.url)
  && item.title===entry.title && item.summary===entry.summary
  && item.captured_at===entry.captured_at && item.evidence_ref===entry.evidence_ref
  && item.verification_status===entry.verification_status
  && JSON.stringify(item.source_refs)===JSON.stringify(entry.source_refs)
  && JSON.stringify(item.evidence_refs)===JSON.stringify(entry.evidence_refs)
  && JSON.stringify(item.source_links)===JSON.stringify(entry.source_links);
export function materialReview(item,now=new Date().toISOString()) {
  const current=PRACTICAL_ITEMS.find(entry=>entry.id===item?.id);
  const exact=current && matches(item,current) ? current : PRACTICAL_HISTORY.find(entry=>matches(item,entry));
  if (!exact || !Number.isFinite(stamp(now)) || stamp(exact.captured_at)>stamp(now)) return null;
  const historical=exact!==current;
  return {scope:'official_documentation',verification:'not_tested',reviewed_at:exact.captured_at,
    next_review_at:new Date(stamp(exact.captured_at)+MATERIAL_REVIEW_INTERVAL_DAYS*86400000).toISOString(),
    due:stamp(now)>=stamp(exact.captured_at)+MATERIAL_REVIEW_INTERVAL_DAYS*86400000,
    historical,changed:historical && !!current && (item.title!==current.title || item.summary!==current.summary),
    current_reviewed_at:current?.captured_at || null,
    official_url:current?.original_url || item.original_url};
}
export function materialReviewLabel(item,now=new Date().toISOString()) {
  const review=materialReview(item,now);if(!review) return '';
  const date=review.reviewed_at.slice(0,10).replaceAll('-','/');
  if(review.changed) return `保存的旧版说明 · ${date} 核对 · ${review.due ? '说明待复核；' : ''}站内说明有补充，原内容保留`;
  if(review.due) return `说明待复核 · 上次 ${date} 核对 · 不表示工具已失效`;
  return `${review.historical ? '保存时的说明' : '官方说明'}核对于 ${date} · 尚未实测`;
}
export function renderMaterialReview(app,item) {
  const label=materialReviewLabel(item);return label ? `<p class="material-review form-help">${app.escapeHtml(label)}</p>` : '';
}
