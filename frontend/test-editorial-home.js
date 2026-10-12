import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editorialFeaturedItems,renderEditorialFeatured,renderEditorialRecommendations,renderEditorialHome} from './src/editorialHome.js';
import {renderSourceBoard} from './src/sourceBoard.js';
import {dotMaterialItem} from './src/dotCandidates.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const app=()=>({escapeHtml:escape,safeUrl:value=>{
  try {const url=new URL(value);return ['http:','https:'].includes(url.protocol) ? url.href : '#';} catch {return '#';}
},formatTime:value=>value,sourceLimits:{},sourcePreferences:{hidden_source_ids:[]},boardGroup:'all'});
const batch=JSON.parse(readFileSync(new URL('../outputs/dot-review-20261009/dot-x-materials.json',import.meta.url),'utf8'));
const actual=dotMaterialItem(batch.items[0],batch);
const state=(items=[])=>({allItems:[],sources:[],dotFeaturedItems:items,hiddenItemIds:new Set(),topics:[],profile:{interests:'',exclude:''}});

test('editorial cover derives only the supplied human-featured shelf and never promotes pending candidates',()=>{
  const input=state();input.dotCandidates=[{id:actual.id,status:'pending',item:actual}];input.allItems=[actual];
  const before=structuredClone(input),html=renderEditorialHome(app(),input);
  assert.doesNotMatch(html,/data-editorial-feature=|我选的精选/);
  assert.match(html,/editorial-recommendations-leading/);assert.match(html,/来源初筛 · 少而有用/);
  assert.deepEqual(input,before);
});

test('existing public source text renders as the lead without rewriting evidence or invented imagery',()=>{
  const input=state([actual]),before=structuredClone(input),html=renderEditorialHome(app(),input);
  assert.match(html,/我选的精选/);assert.match(html,/手动选入 · 保留原始采集内容 · 尚未实测/);
  assert.ok(html.includes(`data-editorial-feature="${actual.id}"`));
  assert.ok(html.includes(escape(actual.title)));assert.ok(html.includes(escape(actual.summary)));
  assert.ok(html.includes(escape(actual.original_url)));assert.ok(html.includes(escape(actual.recommendation_reason)));
  assert.match(html,/采集者推荐理由/);assert.match(html,/尚待核对/);
  assert.doesNotMatch(html,/<img|本站验证通过/);assert.match(html,/不代表内容或热度已经核验/);
  assert.equal(input.dotFeaturedItems[0].verification_status,'not_verified');assert.deepEqual(input,before);
});

test('hidden aliases cannot reappear on the editorial cover and a hidden shelf remains recoverable',()=>{
  const input=state([{...actual,alias_ids:['hidden-old']}]);input.hiddenItemIds.add('hidden-old');
  assert.deepEqual(editorialFeaturedItems(input),[]);
  const html=renderEditorialHome(app(),input);
  assert.doesNotMatch(html,/data-editorial-feature=/);assert.match(html,/精选目前都已隐藏/);assert.match(html,/管理精选/);
});

test('editorial preview retains full escaped source text, valid item actions and the reader own note',()=>{
  const item={...actual,title:'标题 <script>bad</script>',summary:'采集全文 <img src=x onerror=bad>\n'+actual.summary.repeat(5),
    recommendation_reason:'理由 <svg/onload=bad>',my_angle:'建议 <script>bad</script>',unknowns:['未知 <img>'],original_url:'javascript:alert(1)',bookmark_count:null};
  const input=state([item]);input.savedItemNotes={[item.id]:{note:'我的判断 <b>需要亲试</b>'}};
  input.topics=[{materials:[{item:{id:item.id}}]}];
  const view=app();view.openExcerptDetails=new Set(['editorial:'+item.id]);
  const html=renderEditorialHome(view,input);
  assert.ok(html.includes(escape(item.summary)));assert.ok(html.includes(escape(input.savedItemNotes[item.id].note)));
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(html,/<script|<img|href="javascript:/);
  assert.match(html,/href="#"/);assert.match(html,/我的想法/);assert.match(html,/已在主题/);
  assert.ok(html.includes(`data-action="topic-save" data-item-id="${item.id}"`));
  assert.ok(html.includes(`data-excerpt-details="editorial:${item.id}" open`));
  assert.doesNotMatch(html,/收藏记录/);
});

test('at most three visible articles use independent actions while the full shelf remains reachable',()=>{
  const items=Array.from({length:5},(_,index)=>({...actual,id:`sample-${index}`,bookmark_count:index===0 ? 0 : null}));
  const input=state(items),html=renderEditorialHome(app(),input);
  assert.equal([...html.matchAll(/data-editorial-feature=/g)].length,3);
  assert.match(html,/查看全部 5 条精选/);assert.match(html,/收藏记录 0/);
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(editorialFeaturedItems(input).map(item=>item.id),items.slice(0,3).map(item=>item.id));
});

test('independent human-featured cover precedes source filters while rule recommendations stay below them',()=>{
  const input=state([actual]),view=app(),before=structuredClone(input);
  assert.equal(renderEditorialHome(view,input),renderEditorialFeatured(view,input)+renderEditorialRecommendations(view,input));
  const html=renderSourceBoard(view,input),featured=html.indexOf(`data-editorial-feature="${actual.id}"`),toolbar=html.indexOf('class="board-toolbar"');
  assert.ok(featured>html.indexOf('id="feed-search"'));
  assert.ok(featured<toolbar);assert.ok(html.indexOf('id="daily-highlights"')>toolbar);
  assert.equal([...html.matchAll(/data-editorial-feature=/g)].length,1);
  view.feedSearchQuery='定时';const searched=renderSourceBoard(view,input);
  assert.match(searched,/id="editorial-featured-surface"><\/div>/);
  assert.doesNotMatch(searched,/data-editorial-feature=|我选的精选/);
  assert.match(searched,/feed-search-results/);assert.deepEqual(input,before);
});
