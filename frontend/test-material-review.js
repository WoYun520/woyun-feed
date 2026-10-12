import test from 'node:test';
import assert from 'node:assert/strict';
import {PRACTICAL_ITEMS,practicalMaterialKind} from './src/practicalMaterials.js';
import {PRACTICAL_HISTORY} from './src/practicalHistory.js';
import {materialReview,materialReviewLabel} from './src/materialReview.js';
const now='2026-10-03T05:00:00Z';
test('all eight current descriptions have document scope, no software or user acceptance claim',()=>{
 for(const item of PRACTICAL_ITEMS) {const before=structuredClone(item),review=materialReview(item,now);assert.equal(review.scope,'official_documentation');assert.equal(review.verification,'not_tested');assert.equal(review.due,false);assert.equal(review.historical,false);assert.match(materialReviewLabel(item,now),/尚未实测/);assert.deepEqual(item,before);}
});
test('30 day reminder is not a software expiry and does not rewrite saved descriptions',()=>{
 const item=structuredClone(PRACTICAL_ITEMS[0]),before=structuredClone(item);assert.equal(materialReview(item,'2026-11-02T04:18:50Z').due,false);assert.equal(materialReview(item,'2026-11-02T04:18:51Z').due,true);assert.match(materialReviewLabel(item,'2026-11-03T00:00:00Z'),/不表示工具已失效/);assert.deepEqual(item,before);
});
test('exact historic descriptions keep provenance; changed summaries get a current conditions reminder',()=>{
 for(const old of PRACTICAL_HISTORY){const item={...old,original_url:old.url},r=materialReview(item,now);assert.ok(practicalMaterialKind(item));assert.equal(r.historical,true);assert.equal(r.reviewed_at,old.captured_at);}
 const old=PRACTICAL_HISTORY.find(i=>i.id===PRACTICAL_ITEMS[0].id);assert.equal(materialReview({...old,original_url:old.url},now).changed,true);
 assert.match(materialReviewLabel({...old,original_url:old.url},'2026-12-03T00:00:00Z'),/说明待复核.*站内说明有补充/);
 assert.doesNotMatch(materialReviewLabel({...old,original_url:old.url},now),/官网条件有补充/);
});
test('modified, invented or future evidence never obtains a checked badge',()=>{
 const item=PRACTICAL_ITEMS[0];for(const delta of [{title:'伪造标题'},{summary:'实测通过'},{captured_at:'2027-01-01T00:00:00Z'},{evidence_ref:'user-confirmed'},{original_url:'https://example.org'}])assert.equal(materialReview({...item,...delta},now),null);
 assert.equal(materialReview(item,'invalid'),null);assert.equal(materialReview(item,'2026-10-01T00:00:00Z'),null);
});
test('prices remain scoped or unknown and license correction is reflected without replacing historical copy',()=>{
 assert.match(PRACTICAL_ITEMS.find(i=>i.title.startsWith('Buzz')).summary,/价格未知/);
 const flame=PRACTICAL_ITEMS.find(i=>i.title.startsWith('Flameshot'));assert.match(flame.summary,/GPLv3\+/);assert.match(PRACTICAL_HISTORY.find(i=>i.id===flame.id).summary,/GPLv3/);
});

test('changed official evidence cannot retain document review labels',()=>{
 const original=PRACTICAL_ITEMS[0];
 for(const change of ['url','reference','verification','time','source']){
  const item=structuredClone(original);
  if(change==='url')item.source_links[0].url='https://example.org/changed-evidence';
  if(change==='reference')item.evidence_refs[0]='invented-reference';
  if(change==='verification')item.verification_status='verified';
  if(change==='time')item.source_links[0].captured_at='2026-10-03T05:00:00Z';
  if(change==='source')item.source_refs=['user-added'];
  assert.equal(materialReview(item,now),null);assert.equal(materialReviewLabel(item,now),'');
 }
});
