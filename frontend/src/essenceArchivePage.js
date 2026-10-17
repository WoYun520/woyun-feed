import { renderEssenceArchive, renderEssenceArchiveFailure } from './essenceArchiveView.js';

const root = document.querySelector('#essence-archive');

function hideBrokenCover(event) {
  const image = event.target;
  if (image?.tagName !== 'IMG') return;
  image.closest('figure')?.setAttribute('hidden', '');
}

async function show() {
  if (!root) return;
  const requested = new URLSearchParams(location.search).get('page');
  const page = requested && /^[1-9]\d{0,4}$/.test(requested) ? requested : (requested ? '' : '1');
  if (!page) {
    root.innerHTML = renderEssenceArchiveFailure('页码不正确。');
    return;
  }
  try {
    const response = await fetch(`/api/essence-archive?page=${page}`, {headers:{Accept:'application/json'}});
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || !Array.isArray(body.items)) {
      root.innerHTML = renderEssenceArchiveFailure(body?.message);
      return;
    }
    root.innerHTML = renderEssenceArchive(body);
    root.removeAttribute('aria-busy');
    root.addEventListener('error', hideBrokenCover, true);
  } catch {
    root.innerHTML = renderEssenceArchiveFailure();
  }
}

show();
