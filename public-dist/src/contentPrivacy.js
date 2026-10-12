// Shared by restorable backups and public previews. A suspected credential is
// excluded; this conservative rule is not comprehensive privacy detection.
export const hasCredentialText = value => typeof value === 'string'
  && /-----BEGIN .*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|\bBearer\s+[A-Za-z0-9_.-]{25,}|(?:密码|password|api[_ -]?key|token)\s*[:=：]\s*[^\s,;，；]{12,}/i.test(value);

export function containsCredentialText(value) {
  if (typeof value === 'string') return hasCredentialText(value);
  if (Array.isArray(value)) return value.some(containsCredentialText);
  return value && typeof value === 'object' ? Object.values(value).some(containsCredentialText) : false;
}
