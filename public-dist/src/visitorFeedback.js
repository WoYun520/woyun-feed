const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

export function renderVisitorFeedback({open = false, text = '', contact = '', message = '', error = '', busy = false} = {}) {
  const disabled = busy ? ' disabled' : '';
  const hidden = open ? '' : ' hidden';
  const status = error
    ? `<p class="lift-feedback-status" id="home-feedback-status" role="alert" tabindex="-1">${escape(error)}</p>`
    : `<p class="lift-feedback-status" id="home-feedback-status" role="status" tabindex="-1">${escape(message)}</p>`;
  return `<button type="button" class="lift-feedback" id="home-feedback" aria-expanded="${open ? 'true' : 'false'}" aria-controls="home-feedback-panel">意见反馈</button><form id="home-feedback-panel" class="lift-feedback-panel" aria-label="意见反馈"${hidden}><label for="home-feedback-text">想说的</label><textarea id="home-feedback-text" name="text" maxlength="1000" required${disabled}>${escape(text)}</textarea><label for="home-feedback-contact">怎么联系你，可不填</label><input id="home-feedback-contact" name="contact" type="text" maxlength="80" autocomplete="off" value="${escape(contact)}"${disabled}><button type="submit" class="lift-feedback-send"${disabled}>发送</button>${status}</form>`;
}

export async function submitVisitorFeedback({text, contact} = {}, fetchImpl = globalThis.fetch) {
  const bodyText = typeof text === 'string' ? text.trim() : '';
  const bodyContact = typeof contact === 'string' ? contact.trim() : '';
  if (!bodyText) throw Error('请写下想说的话。');
  let response;
  try {
    response = await fetchImpl('/api/visitor-feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify(bodyContact ? {text: bodyText, contact: bodyContact} : {text: bodyText}),
    });
  } catch {
    throw Error('没有发出去，请稍后再试。');
  }
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok || typeof body?.id !== 'string') {
    const message = typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : '';
    throw Error(message && message.length <= 80 ? message : '没有发出去，请稍后再试。');
  }
  return {id: body.id, created_at: typeof body.created_at === 'string' ? body.created_at : ''};
}
