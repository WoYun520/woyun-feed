# feedgrab 素材进入待筛选区

现在可以走通：**公开 X 链接 → feedgrab 读取主帖 → 私有接收箱 → 信息站自动接收、去重 → 用户选入精选**。

在已经连接接收箱的浏览器中，打开「待筛选」就能看到新材料；无需再选 JSON 文件。每条可以「打开原帖」「选入精选」或「暂不收录」。选入仅代表你想留下，不等于帖子已经实测，也不会自动公开。

## 本次真实试跑（2026-10-10）

- 在 X 的公开搜索页面发现 30 条近一周候选。排除 10 条跑题或以收益宣传为主的内容，20 条进入采集。
- feedgrab 对 20 条链接各发出一次匿名请求，20 条成功，0 条失败；接口均提供了点赞、收藏和浏览量整数。这些是第三方接口的观察，不能当成官方核验。
- 20 条素材真实投递成功，HTTP 201；独立读回 HTTP 200，正文与提交内容一致。
- 网站按帖子编号去重，新增 18 条；另 2 条已在公开来源中。原先待筛选 4 条变为 22 条，8 条个人精选保持不变。
- 原始接口响应、feedgrab 规范结果、完整主帖文字、搜索页面发现依据分别保留。没有用摘要覆盖原始材料。

本次的链接发现使用已登录的 X 公开搜索页面；**没有跑通 feedgrab 的站内关键词搜索，也没有开启定时监控**。采集脚本只负责给定链接的读取。未展开完整线程、观看视频、读取图片、打开外链或安装作者推荐的工具。作者的效果与收入说法仍待核对。

## 本机工具

采集程序：`scripts/feedgrab-x-collect.py`。接入程序：`scripts/feedgrab-inbox-deliver.mjs`。

程序使用项目外的独立 Python 环境，官方 feedgrab 源码固定为 `0.26.2`、提交 `04291bafbb65bb78f729c46da0a5ac8ebbfae4a6`。仅调用匿名 FxTwitter 读取层，不读取 X 登录凭据、浏览器会话或 `.env`，不启用浏览器兜底，不下载媒体。每次最多 30 条、30 次请求，每条完整响应限时 15 秒。缺失的热度保留 `null`，不使用默认 0 或搜索页面数字冒充接口观察。

输入为本机 JSON 数组，每项包含 `url`、`published_at`、`text`、`metric_display`、`discovered_at`、`discovery_source_url`。首次真实输入和输出位于 `outputs/feedgrab-x-trial-20261010`。采集输出目录必须为空，避免覆盖之前的证据。

```bash
"/Users/a1-6/Library/Application Support/WoYun Feed/feedgrab/venv/bin/python" scripts/feedgrab-x-collect.py \
  --input 输入文件.json --output-dir 新的采集输出目录

node scripts/feedgrab-inbox-deliver.mjs 新的采集输出目录/candidate-envelope.json
```

第二个程序使用已经存在的本机私有投递配置；密钥不进入素材、聊天、源码、截图或公开构建。POST 成功后先保存回执，再针对同一批号有限重试读取；读回暂不可见时记录「已收到，读回待确认」，不重新采集或伪称投递失败。

接入程序只能投递和核对收件批次，不能精选、发布、删除资料或修改站点权限。Dot 自身仍缺少已确认可用的安全凭据入口，不能把这次 feedgrab 试跑说成 Dot 已接通。

## 当前保存边界

云端投递箱从收到起保留 30 天；浏览器接收后的待筛选、精选和略过记录保存在该浏览器。它们不自动成为公开站点的资料，不与其他设备同步；重要材料仍需备份。

本次证据：`collection/manifest.json`、`collection/intake-validation.json`、`collection/delivery-verification.json`、`deployment-verification.json`、`browser-verification.json`。原始证据位于 `collection/evidence/`。
