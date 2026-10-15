// Shared parse for the public 万粉计划 roster.
// Follower counts, display names, and every other member field are dropped.
export const KOSX_POOL_SOURCE = 'https://impact.kosx.ai/api/members';
export const KOSX_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

export function handlesFromRoster(body) {
  if (!body || !Array.isArray(body.members) || !body.members.length) throw Error('impact roster 没有 members 数组。');
  const handles = [];
  for (const member of body.members) {
    const handle = typeof member?.handle === 'string' ? member.handle : '';
    if (!KOSX_HANDLE_PATTERN.test(handle)) throw Error(`impact roster 含有不能用作 X 账号的 handle：${handle}`);
    handles.push(handle.toLowerCase());
  }
  const unique = [...new Set(handles)].sort();
  if (unique.length !== handles.length) throw Error('impact roster 有重复 handle。');
  return unique;
}
