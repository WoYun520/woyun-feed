import { normalizePostImage } from './postMedia.js';

const boundRoots = new WeakSet();
const dialogs = new WeakMap();
const mediaLabel = image => image.kind === 'video_poster' ? '视频封面 · 未播放' : '来源附图 · 未核对原帖';

// A supplied image is separate source material, never an inferred cover or
// evidence that the complete post or video has been read.
export function renderPostMedia(app, item, {originalUrl = item?.original_url || item?.canonical_url, variant = 'stream'} = {}) {
  const image = normalizePostImage(item?.post_image, originalUrl);
  if (!image) return '';
  const e = value => app.escapeHtml(value), label = mediaLabel(image);
  const title = typeof item?.title === 'string' ? item.title : '来源材料';
  const style = variant === 'highlight' ? 'highlight' : 'stream';
  return `<figure class="post-media post-media-${style}" data-post-media>
    <button type="button" class="post-media-open" data-post-media-open data-post-media-key="${e(`${style}:${item.id}`)}" data-post-media-url="${e(image.url)}" data-post-media-kind="${e(image.kind)}" data-post-media-source="${e(image.source_url)}" data-post-media-original="${e(originalUrl)}" aria-label="${e(`放大${image.kind === 'video_poster' ? '视频封面' : '来源附图'}：${title}`)}" aria-haspopup="dialog">
      <img src="${e(image.url)}" alt="${e(label)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-post-media-thumb>
    </button><figcaption><span>${e(label)}</span><span aria-hidden="true">点击放大 ↗</span></figcaption>
  </figure>`;
}

function hideFailedThumbnail(image) {
  if (image?.matches?.('[data-post-media-thumb]')) image.closest('[data-post-media]')?.setAttribute('hidden', '');
}

function returnFocus(document, state) {
  const trigger = state.trigger?.isConnected ? state.trigger
    : [...document.querySelectorAll('[data-post-media-open]')].find(button => button.dataset.postMediaKey === state.key);
  if (trigger && !trigger.closest('[data-post-media]')?.hasAttribute('hidden')) trigger.focus();
  state.trigger = null;
}

function mediaDialog(document) {
  if (dialogs.has(document)) return dialogs.get(document);
  const dialog = document.createElement('dialog');
  dialog.className = 'post-media-dialog';
  dialog.setAttribute('aria-label', '放大来源图片');
  const header = document.createElement('div');
  header.className = 'post-media-dialog-header';
  const label = document.createElement('p');
  label.className = 'post-media-dialog-label';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'post-media-dialog-close';
  close.setAttribute('aria-label', '关闭图片');
  close.textContent = '关闭 ×';
  const image = document.createElement('img');
  image.className = 'post-media-dialog-image';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  const failure = document.createElement('p');
  failure.className = 'post-media-dialog-error';
  failure.setAttribute('role', 'status');
  failure.hidden = true;
  failure.textContent = '图片未能加载，请打开原帖查看。';
  const original = document.createElement('a');
  original.className = 'post-media-dialog-original';
  original.target = '_blank';
  original.rel = 'noopener noreferrer';
  original.textContent = '打开原帖 ↗';
  header.append(label, close);
  dialog.append(header, image, failure, original);
  const state = {dialog, label, image, failure, original, close, trigger:null, key:''};
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {event.preventDefault(); dialog.close();});
  dialog.addEventListener('close', () => {
    dialog.remove();
    image.removeAttribute('src');
    returnFocus(document, state);
  });
  image.addEventListener('error', () => {
    if (!dialog.open) return;
    image.hidden = true;
    failure.hidden = false;
  });
  dialogs.set(document, state);
  return state;
}

function openPostMedia(button) {
  const originalUrl = button.dataset.postMediaOriginal;
  const image = normalizePostImage({url:button.dataset.postMediaUrl, kind:button.dataset.postMediaKind,
    source_url:button.dataset.postMediaSource}, originalUrl);
  if (!image || button.closest('[data-post-media]')?.hasAttribute('hidden')) return;
  const document = button.ownerDocument, state = mediaDialog(document);
  if (typeof state.dialog.showModal !== 'function' || state.dialog.open) return;
  state.trigger = button;
  state.key = button.dataset.postMediaKey;
  state.label.textContent = mediaLabel(image);
  state.image.alt = mediaLabel(image);
  state.image.hidden = false;
  state.failure.hidden = true;
  state.original.href = image.source_url;
  document.body.append(state.dialog);
  state.image.src = image.url;
  state.dialog.showModal();
  state.close.focus();
}

// Delegate from a persistent root so refreshed cards need no per-image
// handlers. Also catch failures that happened before the render binder ran.
export function bindPostMediaEvents(root = document) {
  root.querySelectorAll('[data-post-media-thumb]').forEach(image => {
    if (image.complete && image.naturalWidth === 0) hideFailedThumbnail(image);
  });
  if (boundRoots.has(root)) return;
  boundRoots.add(root);
  root.addEventListener('error', event => hideFailedThumbnail(event.target), true);
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-post-media-open]');
    if (button && root.contains(button)) openPostMedia(button);
  });
}
