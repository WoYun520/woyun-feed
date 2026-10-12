import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPostMedia, bindPostMediaEvents } from './src/postMediaView.js';
import { renderDailyHighlights } from './src/dailyHighlightsView.js';
import { renderPostStream } from './src/postStreamView.js';

const original = 'https://x.com/builder/status/1234567890123456789';
const photo = {url:'https://pbs.twimg.com/media/Gabc123?format=jpg&name=small',kind:'photo',source_url:original};
const poster = {url:'https://pbs.twimg.com/amplify_video_thumb/1234567890123456789/img/Abc123.jpg',kind:'video_poster',source_url:original};
const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const app = () => ({escapeHtml:escape,safeUrl:value=>value,boardGroup:'all',formatTime:value=>value});
const post = (id = 'post-one', extra = {}) => ({id,title:'视频字幕工具配置教程',
  summary:'可以提取视频音频并转录生成字幕文件。\n第一步安装字幕工具，第二步导出字幕文件。\n安装指令：\nnpx skills add builder/subtitle-tool',
  source_refs:['sopilot-ai'],link_kind:'post',original_url:original,canonical_url:original,
  published_at:'2026-10-08T01:00:00Z',captured_at:'2026-10-08T02:00:00Z',content_status:'excerpt_only',verification_status:'not_tested',...extra});
const state = items => ({allItems:items,sources:[{id:'sopilot-ai',name:'SoPilot · AI',kind:'aggregator',group:'posts',
  link_kind:'post',status:'ok',last_success_at:'2026-10-08T02:00:00Z'}],profile:{},hiddenItemIds:new Set(),savedItemIds:new Set(),
  archivedItemIds:new Set(),topics:[],refresh:{new_item_ids:[]}});

test('supplied first images have literal source labels and privacy-conscious static image attributes', () => {
  for (const [post_image,label] of [[photo,'来源附图 · 未核对原帖'],[poster,'视频封面 · 未播放']]) {
    const item = post('safe-id',{post_image}), before = structuredClone(item);
    const html = renderPostMedia(app(),item,{variant:'highlight'});
    assert.match(html,/class="post-media post-media-highlight"/);
    assert.equal([...html.matchAll(/<img\b/g)].length,1);
    assert.ok(html.includes(label));
    assert.match(html,/loading="lazy" decoding="async" referrerpolicy="no-referrer"/);
    assert.match(html,/aria-haspopup="dialog"/);
    assert.doesNotMatch(html,/<video\b|<iframe\b|onerror=|已核对|已播放|已读取图片/);
    assert.deepEqual(item,before);
  }
});

test('arbitrary URL fields, missing evidence and images of another post never generate cover markup', () => {
  for (const post_image of [undefined,photo.url,{url:photo.url,kind:'photo'},
    {...photo,url:'javascript:alert(1)'},{...photo,url:'https://example.com/image.jpg'},
    {...photo,source_url:'https://x.com/builder/status/999'},{...photo,kind:'video'}]) {
    assert.equal(renderPostMedia(app(),post('unsafe',{post_image,image_url:photo.url,thumbnail_url:poster.url})), '');
  }
  assert.equal(renderPostMedia(app(),post('repository',{original_url:'https://github.com/builder/tool',post_image:photo})), '');
});

test('image button metadata and titles remain escaped without inline event handlers', () => {
  const html = renderPostMedia(app(),post('id" unsafe',{title:'<script>bad</script>',post_image:photo}));
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html,/format=jpg&amp;name=small/);
  assert.doesNotMatch(html,/<script>|onclick=|onerror=/);
});

test('both selected cards and the merged post list keep their text and actions with or without media', () => {
  const item = post('one',{post_image:photo}), input = state([item]), before = structuredClone(input);
  const highlights = renderDailyHighlights(app(),input,{now:Date.parse('2026-10-08T03:00:00Z')});
  const stream = renderPostStream(app(),input);
  assert.match(highlights,/post-media-highlight/); assert.match(stream,/post-media-stream/);
  for (const html of [highlights,stream]) {
    assert.match(html,/data-material-start="try" data-item-id="one"/);
    assert.match(html,/data-material-start="write" data-item-id="one"/);
    assert.match(html,/data-action="toggle-save" data-item-id="one"/);
  }
  assert.deepEqual(input,before);
  const noMedia = state([post('one',{post_image:{...photo,url:'https://example.com/not-source.jpg'}})]);
  for (const html of [renderDailyHighlights(app(),noMedia,{now:Date.parse('2026-10-08T03:00:00Z')}),renderPostStream(app(),noMedia)]) {
    assert.doesNotMatch(html,/<img\b/); assert.match(html,/data-material-start="try"/);
  }
});

test('merged aliases can supply their exact post image while distinct originals never borrow it', () => {
  const input = state([post('long',{summary:post().summary + '\n更新后的来源摘录更长。'}),
    post('short',{summary:'安装字幕工具的配置教程。',post_image:photo}),
    post('other',{original_url:'https://x.com/builder/status/999',canonical_url:'https://x.com/builder/status/999',
      summary:'安装字幕工具的配置教程。',post_image:{...photo,source_url:original}})]);
  const before = structuredClone(input), html = renderPostStream(app(),input);
  assert.equal([...html.matchAll(/<img\b/g)].length,1);
  assert.match(html,/data-post-media-key="stream:long"/);
  assert.doesNotMatch(html,/data-post-media-key="stream:other"/);
  assert.deepEqual(input,before);
});

class Element {
  constructor(tag,document) {
    this.tagName=tag;this.ownerDocument=document;this.dataset={};this.attributes=new Map();this.listeners=new Map();
    this.children=[];this.isConnected=false;this.hidden=false;this.open=false;
  }
  setAttribute(name,value) {this.attributes.set(name,value);}
  removeAttribute(name) {this.attributes.delete(name);}
  hasAttribute(name) {return this.attributes.has(name);}
  append(...children) {for(const child of children){child.parent=this;child.isConnected=true;this.children.push(child);}}
  remove() {this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  addEventListener(name,handler) {if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(handler);}
  fire(name,event={}) {for(const handler of this.listeners.get(name)||[])handler({target:this,...event});}
  focus() {this.ownerDocument.activeElement=this;}
  showModal() {this.open=true;}
  close() {this.open=false;this.fire('close');}
  matches(selector) {return selector==='[data-post-media-thumb]' && this.hasAttribute('data-post-media-thumb');}
  closest(selector) {return selector==='[data-post-media]' ? this.figure : selector==='[data-post-media-open]' ? this.button : null;}
}

function documentFixture() {
  const document = {listeners:new Map(),buttons:[],thumbs:[],activeElement:null,
    createElement(tag){return new Element(tag,this);},
    querySelectorAll(selector){return selector==='[data-post-media-thumb]'?this.thumbs:selector==='[data-post-media-open]'?this.buttons:[];},
    addEventListener:Element.prototype.addEventListener,fire:Element.prototype.fire,
    contains(element){return element.isConnected;}};
  document.body=new Element('body',document);
  const figure=new Element('figure',document),button=new Element('button',document),thumbnail=new Element('img',document);
  button.dataset={postMediaKey:'stream:one',postMediaUrl:photo.url,postMediaKind:photo.kind,postMediaSource:photo.source_url,postMediaOriginal:original};
  button.figure=figure;button.button=button;thumbnail.figure=figure;thumbnail.button=button;
  thumbnail.setAttribute('data-post-media-thumb','');thumbnail.complete=false;
  figure.append(button);button.append(thumbnail);document.body.append(figure);
  document.buttons=[button];document.thumbs=[thumbnail];
  return {document,figure,button,thumbnail};
}

test('delegated loading failures remove only the image and binding stays idempotent across renders', () => {
  const {document,figure,thumbnail}=documentFixture();
  bindPostMediaEvents(document);bindPostMediaEvents(document);
  assert.equal(document.listeners.get('click').length,1);assert.equal(document.listeners.get('error').length,1);
  document.fire('error',{target:thumbnail});assert.equal(figure.hasAttribute('hidden'),true);
  const cached=documentFixture();cached.thumbnail.complete=true;cached.thumbnail.naturalWidth=0;
  bindPostMediaEvents(cached.document);assert.equal(cached.figure.hasAttribute('hidden'),true);
});

test('image dialogs close by button or Escape and return focus even after the source card is refreshed', () => {
  const {document,button}=documentFixture();bindPostMediaEvents(document);
  document.fire('click',{target:button});
  const dialog=document.body.children.find(element=>element.tagName==='dialog'),[header,image,failure,originalLink]=dialog.children;
  const close=header.children[1];
  assert.equal(dialog.open,true);assert.equal(document.activeElement,close);assert.equal(originalLink.href,original);
  assert.equal(image.referrerPolicy,'no-referrer');assert.equal(image.decoding,'async');
  image.fire('error');assert.equal(image.hidden,true);assert.equal(failure.hidden,false);
  close.fire('click');assert.equal(dialog.open,false);assert.equal(document.activeElement,button);
  document.fire('click',{target:button});assert.equal(dialog.open,true);
  const refreshed=new Element('button',document);refreshed.dataset={...button.dataset};refreshed.isConnected=true;refreshed.figure=button.figure;
  button.isConnected=false;document.buttons=[refreshed];
  let prevented=false;dialog.fire('cancel',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(document.activeElement,refreshed);assert.equal(dialog.isConnected,false);
});

test('a changed image button is validated again before any dialog opens', () => {
  const {document,button}=documentFixture();bindPostMediaEvents(document);
  button.dataset.postMediaUrl='https://example.com/untrusted.jpg';document.fire('click',{target:button});
  assert.equal(document.body.children.some(element=>element.tagName==='dialog'),false);
});
