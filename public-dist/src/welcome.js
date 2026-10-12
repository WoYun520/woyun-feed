const keyFor = mode => `personal-feed:${mode === 'demo' ? 'demo' : 'live'}:welcome:v1`;

export function needsWelcome(storage, state) {
  if (state.topics?.length || state.savedItems?.length || state.archivedItems?.length || state.followups?.length) return false;
  try { return storage.getItem(keyFor(state.mode)) !== 'done'; } catch { return true; }
}

export function rememberWelcome(storage, mode) {
  try { storage.setItem(keyFor(mode), 'done'); return true; } catch { return false; }
}

export function renderWelcome() {
  return `<details class="welcome-card welcome-compact"><summary>第一次来？挑材料 → 补想法 → 带给 AI <span>展开说明</span></summary><section aria-labelledby="welcome-heading">
    <div class="welcome-heading"><div><p class="welcome-eyebrow">从一条有用的材料开始</p><h2 id="welcome-heading">留下有用的，做出自己的。</h2></div><button class="btn-quiet welcome-dismiss" id="welcome-dismiss" aria-label="收起首次使用引导">收起</button></div>
    <p class="form-help">你决定什么值得留下，再把原材料、个人判断和下一步放在一起，交给常用 AI 接着做。</p>
    <ol class="welcome-steps"><li><span>1</span><div><h3>看原文，自己挑</h3><p>首页点标题读原文，觉得有用就收藏。采集来的材料到“待筛选”检查，再点“选入精选”。</p></div></li><li><span>2</span><div><h3>放进主题，补判断</h3><p>点“放进主题”，写一句为什么留下它，再补上你想做什么、下一步做什么。</p></div></li><li><span>3</span><div><h3>带给常用 AI</h3><p>在主题点“带走这份材料”，检查后复制，到自己的 AI 里粘贴并发送。</p></div></li></ol>
    <div class="welcome-bottom"><p>精选由你选；选入不等于已实测。收藏和主题保存在当前浏览器。</p><div class="topic-actions"><button class="btn-secondary-quiet" id="welcome-example">看完整示例</button><button class="btn-primary-action" id="welcome-start">先挑一条材料</button></div></div>
  </section></details>`;
}

export function renderGuide(app, root) {
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="guide-title"><div class="modal-dialog guide-dialog">
    <div class="modal-header"><h2 class="modal-title" id="guide-title">从好材料，到自己的下一步</h2><button class="modal-close-btn" id="modal-close-btn" aria-label="关闭使用说明">×</button></div>
    <div class="modal-body guide-body"><p class="guide-lead">比如你想试一个视频转笔记工具，再写成新手教程。</p>
      <ol class="guide-steps"><li><h3>1. 发现值得看的材料</h3><p>从“今日”或“实用教程”点标题读原文，觉得有用就收藏。站外链接可以用“添加材料”收进来。</p></li><li><h3>2. 采集来的材料，先由你挑</h3><p>已有 Dot 或 feedgrab 素材时，在“待筛选”导入文件；接收箱连通且对方实际投递后，也能收到材料。搜索、类型与收藏门槛要点“应用筛选”才生效；勾选后点“选入精选”。互动数只是参考，不代表内容已核验。</p></li><li><h3>3. 放进主题，留下自己的判断</h3><p>在“我的精选”或“收藏与跟进”点“放进主题”。到“主题工作台”点“编辑想法与进度”，写为什么值得试、还缺什么、接下来做什么。结果等实际做过再填。收藏里也可“补摘录与想法”，想查清的问题可“继续查一查”。</p></li><li><h3>4. 带去你熟悉的 AI</h3><p>在主题点“带走这份材料”，检查来源、摘录和自己的想法后，点“复制给 AI”或导出文件。到自己的 AI 里粘贴并发送，接下来的任务在那里完成。</p></li></ol>
      <p class="form-help">首页有“我想试试”或“做成选题”的卡片，也可直接“保存并开始”；起步建议只是建议，体验和结果仍由你记录。</p>
      <section class="guide-example" aria-labelledby="guide-example-title"><h3 id="guide-example-title">最后带走的内容，像这样</h3><p class="form-help">下面只是填写示例，没有保存、抓取或实测这些内容。</p><dl><dt>我想做什么</dt><dd>给第一次整理视频的人写一篇视频转笔记教程。</dd><dt>留下的材料</dt><dd>工具的公开说明链接，以及我手动摘下的几句话。</dd><dt>我自己的想法</dt><dd>先展示笔记能用来做什么，再讲操作步骤。</dd><dt>还缺什么</dt><dd>实际截图、费用与字幕限制；没查过的先留空。</dd><dt>请 AI 接着做</dt><dd>先列文章提纲。没有试过的功能，别写成我的实测经历。</dd></dl></section>
      <p class="guide-boundary">收藏和主题保存在当前浏览器；换设备或清理数据前，记得“备份与恢复”。Dot、feedgrab 需要另行配置采集与投递，本站不会自动替你抓取 X。添加链接不会自动读完原文，选入精选不会自动公开，复制不会自动发送。不要放入密码、密钥或私人材料。</p>
    </div><div class="modal-footer guide-footer"><button class="btn-secondary-quiet" id="guide-add">我已有链接，直接添加</button><button class="btn-primary-action" id="guide-start">先挑一条材料</button></div>
  </div></div>`;
  document.getElementById('modal-close-btn').onclick = () => app.closeModal();
  document.getElementById('modal-backdrop').onclick = event => { if (event.target.id === 'modal-backdrop') app.closeModal(); };
  document.getElementById('guide-start').onclick = () => { app.closeModal(); app.dismissWelcome(); app.feedView='sources'; app.switchTab('today'); document.querySelector('.page-headline')?.focus(); };
  document.getElementById('guide-add').onclick = () => { app.closeModal(); app.dismissWelcome(); app.addFromGuide(); };
  document.getElementById('modal-close-btn').focus();
}
