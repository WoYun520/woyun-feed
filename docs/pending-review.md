# 待筛选过审

进料口把 X 链接放进待筛选。账号池成员由投递密钥送来、且不会进入「昨日最被低估」的精华帖，会在进料时直接放上首页，见 [待筛选进料](pending-intake.md)。其余链接仍用**接收码**把队列里的一条标成 `approved` 或 `rejected`。`approved` 会写进公开首页使用的 `PUBLIC_FEED`。`rejected` 会从公开首页拿掉。`pending` 不会出现在首页。

**昨日最被低估 = 必人工审。** 会进入这一栏的链接不能由账号池自动过审。账号池自动放上首页的帖可以按时间出现在最新封面和「昨日全部」里。已经在「昨日全部」里的帖，包括仍标着 `kosx_review: pool` 的，可以用接收码直接钉进这一栏。接收码把一条已经由账号池放上首页的链接再标成 `approved` 时，过审时间不变，`approval` 改为 `review`；钉选不要求先做这一步。没有钉选时这一栏留空。

**当前仓库改动还没有部署。** 不要执行 `npx wrangler deploy`，也不要部署名为 `woyun` 的 Worker。下面的地址要等有人发布预览 Worker `woyun-feed-preview` 之后才能用。

## 放上公开首页

接收码是哈希存在 `DOT_REVIEW_TOKEN_HASH` 的那把原始密钥，和 `GET /api/dot/pending` 相同。投递密钥不能过审。

链接必须已经在待筛选里。这个接口不会新建队列记录。

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending/decision' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","status":"approved"}'
```

`200` 且 `"published": true` 表示这条已经写进 `PUBLIC_FEED`，公开首页的最新封面可以读到它。`existing: true` 表示它本来就是这个过审状态，过审时间不变。重复调用可以补上一次没写成功的首页记录。

过审时可以多带两个可选字段：

- `review_type`：把类型改成 `文章`、`教程指南`、`避坑`、`短帖`、`产品安利` 之一。
- `underrated_candidate`：`true` 时在这条过审记录上记下「低估栏候选」，并带 `underrated_candidate_at`。这只是记号。它不会调用 `POST /api/dot/pending` 以外的接口，也不会写昨日低估钉选。之后仍要用接收码单独调用 [昨日低估上传](underrated-upload.md) 的 `POST /api/dot/underrated` 才会钉上。`false` 会清掉记号。不带这个字段时，已有记号保持原样。`rejected` 不能带 `true`。

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending/decision' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","status":"approved","underrated_candidate":true,"review_type":"教程指南"}'
```

公开预览的「待筛选」页在连上接收码后会列出待过审链接。卡片不显示热度、Article 卡或「文章卡·收藏…·收藏偏低但类型优先」这类依据说明；类型仍可在过审前改。建议先看文章，再看教程指南、避坑，短帖和产品安利靠后。点「过审上首页」时可勾选「进低估栏候选」。勾选只写下上面的记号。没有接收码时，这一栏不显示队列，也不能过审。

## 本机过审

公开预览没有免接收码的过审地址。「待过审」在浏览器里仍然要粘贴接收码。本机另有一页，接收码只留在这台电脑上，不交给浏览器。

1. 把接收码写成一行，放进仓库里的 `.local/dot-review-token`。这个目录已被忽略，不要提交。也可以在启动前设置环境变量 `DOT_REVIEW_TOKEN`。不要把接收码写进网址。
2. 双击「打开过审.command」。它和「打开 Levi flow.command」启动同一个本机服务，并打开过审页。已经开着信息流时，直接打开 `http://127.0.0.1:3000/review-admin`。端口以启动时打印的为准。
3. 也可以先双击「打开 Levi flow.command」，或在仓库里运行 `cd frontend && node serve.js`，再打开上面的地址。

这一页只由本机 `frontend/serve.js` 提供，只监听 `127.0.0.1`。它用本机保存的接收码去调用预览 Worker 上原有的 `GET /api/dot/pending` 和 `POST /api/dot/pending/decision`。公开预览没有 `/review-admin`，也没有不带接收码的过审接口。不要为了这一页执行 `npx wrangler deploy`。

接收码读取 `GET /api/dot/pending` 时，每条在原有字段外还会带上已保存的 `review_type`、`bookmark_count`、`like_count`、`has_article`、`cover_url`、`text`。有候选记号时带 `underrated_candidate: true` 和 `underrated_candidate_at`。旧记录没有这些字段时，页面会按备注粗分，热度和 Article 卡显示为未知。

从首页撤回：

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending/decision' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","status":"rejected"}'
```

这时 `"published": false`。正文里的 `status` 只能是 `approved` 或 `rejected`。

`404`：这条链接还没进待筛选，先按 [待筛选进料](pending-intake.md) POST。`401`：接收码不对，或误用了投递密钥。服务端调用不要带 `Origin`。

## 首页上看到什么

过审链接使用来源「KOSX 过审」。标题优先用进料时的备注；没有备注时用作者账号。摘要只用进料时的摘录；没有摘录时用备注。都没有就留空，不写流程说明。首页若碰到旧的流程说明，不当成摘录，卡片只留标题和来源时间。公开条目会带上进料时已有的 `bookmark_count`、`like_count`、`review_type`、`has_article`、`cover_url`。「七日精选」读的就是这条公开 `bookmark_count`，并要求类型是文章或教程指南。最新封面、昨日全部和七日精选用同一张卡片。类型是文章或教程指南，或带有 X Article 卡且不是短帖、产品安利、避坑时，卡片显示 `cover_url`。没有这个地址时不写「无来源附图」，也不另做假图或类型色条。有摘录时把前一两行放大成金句，并显示作者；没有摘录时只留标题和来源时间。卡片不显示收藏数。摘录已经完整出现在卡片上时，不再展开「摘录与时间依据」；展开时只放更长的原文摘录，不写热度缺失或未核对原帖的套话。收藏数仍留在公开条目上，给「七日精选」用。短帖、产品安利和避坑不显示这张封面。图片打不开时回到这张无图卡。进料时没有收藏数的，之后用投递密钥补上；已经过审的公开条目会一起改。已经写下的收藏数、点赞数、类型、Article 卡、摘录和封面地址不会被后一次替换。`published_at` 优先用进料的 `published_at`，其次 `created_at`。都没有时，从 X 状态编号的 snowflake 推算（Twitter 纪元 `1288834974657`，毫秒为 `(id >> 22) + 纪元`）。不是 X 状态编号的不编造时间，这时才退回过审时间。`source_item_time` 和 `captured_at` 仍是过审时间。账号池自动过审和接收码过审走同一套写入，不按粉丝数把谁排到前面。

「昨日全部」只列已经放上公开首页的精华帖，原帖北京日期是昨日。信息流里没有走上这条精华线的帖不进入。昨日最被低估只显示人工从「昨日全部」钉选的帖，不按来源热度、榜位或发布时间补。已经在这一日精华线上的账号池自动过审帖，钉上之后也会显示。没有对上的钉选时这一栏留空。

每天的公开快照重建之后，仍会按队列里的 `approved` 记录把这些链接接回 `PUBLIC_FEED`。只停在 `pending` 的链接不会被接回去。

已经写进 `PUBLIC_FEED`、`published_at` 仍等于过审时间的旧记录，要等一次重新发布才会分开。下一次公开快照会按队列重写：队列里没有原帖时间时，用 snowflake 填 `published_at`。想马上改，或 snowflake 不等于进料里的真实时间：用投递密钥再送同一条已过审链接，并带上 `published_at` 或 `created_at`。服务会改队列记录，并覆盖公开首页上这条的 `published_at`。公开条目没有 `bookmark_count` 时，「七日精选」不会按收藏数收下它。用投递密钥再送同一条未略过的链接，带上队列里还没有的 `bookmark_count`、`like_count`、`review_type`、`has_article`、`cover_url` 或 `text`。服务只补空缺，不覆盖已经保存的值，并重写这条公开条目。已经写下的封面地址不会被后一次替换。已经略过的不改，也不补封面。接收码对这条再提交一次 `approved` 也会按当前队列重写公开条目；这次若重建记录，会保留已经保存的原帖时间和信号。过审时间、`source_item_time` 和 `captured_at` 不变。预览 Worker 发布之前，现网旧行不会自己改。不要把这次发布打到名为 `woyun` 的 Worker。

队列上限仍是 300 条，过审和略过的记录也算在里面。

过审只让链接进入公开首页。要放进「昨日最被低估精华帖」，这条还必须已经在「昨日全部」里（公开首页上、原帖北京日期为昨日），Levi 再用同一把接收码单独钉选，见 [昨日低估上传](underrated-upload.md)。别的日期不能新钉。投递密钥不能钉选。`kosx_review` 为 `pool` 且已经在「昨日全部」里的帖同样可以钉。`underrated_candidate` 不是钉选，首页排序也不读它。
