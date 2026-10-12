// Optional third-party media preview. A picture never verifies its post's claims.
export function canonicalImagePost(value) {
  if (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;
    const match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})\/?$/.exec(url.pathname);
    return match ? `https://x.com/${match[1].toLowerCase()}/status/${match[2]}` : null;
  } catch { return null; }
}

export function normalizePostImage(value, originalUrl) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['photo', 'video_poster'].includes(value.kind)
    || typeof value.url !== 'string' || value.url.length > 1500
    || /[\u0000-\u0020\u007f]/.test(value.url)) return null;
  const post = canonicalImagePost(originalUrl), source = canonicalImagePost(value.source_url);
  if (!post || source !== post) return null;
  try {
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || url.port
      || url.username || url.password || url.hash) return null;
    const photo = /^\/media\/[A-Za-z0-9_-]+(?:\.(?:jpg|jpeg|png|webp))?$/.test(url.pathname);
    const poster = /^\/amplify_video_thumb\/\d{5,25}\/img\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(url.pathname);
    if (value.kind === 'photo' ? !photo : !poster) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== new Set(keys).size || keys.some(key => !['format', 'name'].includes(key))
      || url.searchParams.has('format') && !/^(?:jpg|jpeg|png|webp)$/.test(url.searchParams.get('format'))
      || url.searchParams.has('name') && !/^(?:orig|large|medium|small|thumb|\d{1,4}x\d{1,4})$/.test(url.searchParams.get('name'))
      || photo && !/\.(?:jpg|jpeg|png|webp)$/.test(url.pathname) && !url.searchParams.has('format')) return null;
    return {url: url.href, kind: value.kind, source_url: post};
  } catch { return null; }
}
