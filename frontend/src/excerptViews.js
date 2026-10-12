export function renderManualExcerpt(app,excerpt) {
  if (!excerpt?.text) return '';
  const e=value=>app.escapeHtml(value || '');
  const long=excerpt.text.length>240;
  return `<section class="manual-excerpt" aria-label="正文关键摘录"><p class="manual-excerpt-label">正文关键摘录 · 手动粘贴，未核对原文</p><blockquote>${e(long ? excerpt.text.slice(0,240)+'…' : excerpt.text)}</blockquote>${long ? `<details><summary>展开完整摘录</summary><blockquote>${e(excerpt.text)}</blockquote></details>` : ''}<p class="form-help"><a href="${e(app.safeUrl(excerpt.url))}" target="_blank" rel="noopener noreferrer">查看摘录来源 ↗</a> · 记录于 ${e(app.formatTime(excerpt.recorded_at))}</p></section>`;
}

export function renderExcerptField(app,text,sourceUrl) {
  const e=value=>app.escapeHtml(value || '');
  return `<div class="form-group"><label class="form-label" for="topic-excerpt">正文关键摘录（选填）</label><textarea class="form-textarea" id="topic-excerpt" name="excerpt" rows="4" maxlength="4000" placeholder="读完原文后，粘贴有用的几句，比如安装条件、使用步骤或限制。最多 4000 字。">${e(text)}</textarea><p class="form-help">${sourceUrl ? `来源：<a href="${e(app.safeUrl(sourceUrl))}" target="_blank" rel="noopener noreferrer">打开这条材料的原链接 ↗</a>。` : '保存后关联上方链接。'}手动粘贴不会自动核对原文；请把自己的判断写在下方，不要粘贴密码或私人资料。</p></div>`;
}
