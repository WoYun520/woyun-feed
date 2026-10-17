# 待筛选过审

进料口把 X 链接放进待筛选。下面这几句是自动过审的边界，其余细节跟在后面。

**进料都不当场过审。** 首页「贴链接」（`homepage`）和投递密钥（`delivery`）都先记 `pending`。作者在 KOSX 账号池里也不再写 `approval: "pool"`，不在进料时写入 `PUBLIC_FEED`。这不是粉丝数排序。见 [待筛选进料](pending-intake.md)。

**满 1 小时仍未人工处理，贴链接和投递都自动过审上首页。** 来源是 `homepage` 或 `delivery`、状态仍是 `pending`，并且 `submitted_at`（没有则用 `created_at`）早于现在超过 1 小时，定时任务会把它标成 `approved`，`approval` 为 `auto`，并写入 `PUBLIC_FEED`。刚好 1 小时还不算超过，继续等人。账号池作者走同一条，不会一直停到人工。这一步**不自动钉低估**。检查跑在现有的精华扫榜和公开刷新上，不另加每小时定时；行龄超过 1 小时之后，下一次这些任务才会写上首页。

`approved` 会写进公开首页使用的 `PUBLIC_FEED`。`rejected` 会从公开首页拿掉。`pending` 不会出现在首页。

已经放上首页的帖可以按时间出现在最新精华和「昨日全部」里。已经在「昨日全部」里的帖，包括仍标着旧的 `kosx_review: pool` 的，以及满 1 小时自动过审、原帖日正好是昨日的，都可以用接收码钉进低估栏。接收码把一条已经由旧的账号池规则或自动过审放上首页的链接再标成 `approved` 时，过审时间不变，`approval` 改为 `review`。没有钉选时这一栏留空。
## 最新精华怎么进队，谁耗 token

公开来源刷新仍是每天两次：UTC `0 1,13 * * *`（北京时间 09:00、21:00）。它读 GitHub、RSS、SoPilot、Hacker News 和账号池名单，不调用 X 的付费接口，也不调用模型。

最新精华进队是另一条定时：UTC `0 0,4,8,12 * * *`（北京时间 08:00、12:00、16:00、20:00）。这一轮只做四件事：

1. 读已经写在 `PUBLIC_FEED` 里的公开快照，不新开 X 时间线。
2. 只留下作者在账号池里、原帖北京日是今天或昨天、队列里还没有的帖。同一状态编号只留一条。已经 `rejected` 的不重新打开。
3. 每一轮最多新写 20 条，走和投递密钥相同的进队路径。新行停在 `pending`，账号池也不当场上首页。
4. 顺手做满 1 小时自动过审（贴链接和投递，含账号池），并把公开快照里已有的 `bookmark_count` / `like_count` 补进精华线。缺了就空着，不写成 0。
谁耗 token：Worker 这一轮的 X API 次数是 0，模型 token 是 0。名单接口 `impact.kosx.ai` 是公开的，缓存超过 1 小时才会再拉，所以最坏每轮 1 次名单 GET。Overheard 若在调用投递口之前自己扫过 X 或模型，那笔开销在它自己那边；本仓库不增加第二次扫帖。帖子若不在现有公开快照里，仍由 Overheard 用原来的投递密钥 `POST /api/dot/pending` 送来。

最坏每轮：X API 0 次，模型 0 token，名单 GET 最多 1 次，新进队最多 20 条。想再降：把 `ESSENCE_INTAKE_CAP` 调小。扫帖失败会退避，下一轮先等 6 小时，再失败等 12 小时，之后最多等 24 小时；自动过审和热度回填不跟着停。

每天两次的公开源刷新也会顺手做热度回填和满 1 小时自动过审，但不会为了进队去扫 X。
预览地址是熟人软启动：`https://woyun-feed-preview.hhzovo66.workers.dev/`。把改动推进 Git 不会自动部署。发布只打 Worker `woyun-feed-preview`。不要部署名为 `woyun` 的 Worker。线上是否已经包含某次提交，以最近一次预览部署为准。定时见 [ops-cron.md](ops-cron.md)。

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
- `underrated_candidate`：`true` 表示这次过审要进低估。过审通过并写入 `PUBLIC_FEED` 之后，服务立刻按 [昨日低估上传](underrated-upload.md) 的同一套规则钉选。原帖北京日必须是当前「昨日全部」，或「昨日全部」的前一个自然日。对得上就钉上，回答里 `pinned` 为 `true`。对不上就只留在公开首页，`pinned` 为 `false`，`pin_code` 为 `not_yesterday`，不会写钉选。`false` 会清掉记号，也不会钉。不带这个字段时，已有记号保持原样，也不会新钉。`rejected` 不能带 `true`。满 1 小时的自动过审不带这个字段，所以不会自动钉。

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending/decision' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","status":"approved","underrated_candidate":true,"review_type":"教程指南"}'
```

公开首页不再提供「待过审」或「待筛选」入口。顶栏没有这条链接，`#review` 和 `?review=1` 也不会打开过审。公开页面不要求、也不提示在浏览器里连接接收码来过审。过审只在本机 `/review-admin`。

本机过审页列出北京时间（Asia/Shanghai）今天或昨天提交进队的 `pending`，用来处理贴链接和扫入队列。时间优先用 `submitted_at`，没有再用 `created_at`。原帖的 `published_at` 和 X 状态编号不决定这一页显示谁，所以今天贴进来的旧帖也会出现。前天及更早进队的链接不出现在本机过审列表里。队列记录仍保留。更早的链接只要还在队列里，直接调用上面的过审接口仍可以标成 `approved` 或 `rejected`。

卡片不显示热度、Article 卡或「文章卡·收藏…·收藏偏低但类型优先」这类依据说明；类型仍可在过审前改。建议先看文章，再看教程指南、避坑，短帖和产品安利靠后。点「过审上首页」时可勾选「进低估」。勾上之后，原帖日是当前「昨日全部」或它的前一个自然日就会钉进昨日低估栏；更早就只上首页。

## 本机过审

公开预览没有过审页。接收码只留在这台电脑上，不交给浏览器。

1. 把接收码写成一行，放进仓库里的 `.local/dot-review-token`。这个目录已被忽略，不要提交。也可以在启动前设置环境变量 `DOT_REVIEW_TOKEN`。不要把接收码写进网址。
2. 双击「打开过审.command」。它和「打开 Levi flow.command」启动同一个本机服务，并打开过审页。已经开着信息流时，直接打开 `http://127.0.0.1:3000/review-admin`。端口以启动时打印的为准。没有打开页面时，终端窗口会停住，留下原文，例如「端口被占用」。看完后按任意键才会关闭。
3. 也可以先双击「打开 Levi flow.command」，或在仓库里运行 `cd frontend && node serve.js`，再打开上面的地址。「打开 Levi flow.command」仍按原来的方式启动。

本机过审页打开时拉取一次待过审，之后约每 30 秒自动再拉一次。页面切到后台时跳过这一轮；正在点「过审上首页」或「略过」时也跳过，避免把正在进行的操作冲掉。页面上有「刷新」，可以马上再拉一次。

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

过审链接使用来源「KOSX 过审」。标题优先用进料时的备注；没有备注时用作者账号。摘要只用进料时的摘录；没有摘录时用备注。都没有就留空，不写流程说明。首页若碰到旧的流程说明，不当成摘录，卡片只留标题和来源时间。公开条目会带上进料时已有的 `bookmark_count`、`like_count`、`review_type`、`has_article`、`cover_url`。「七日精选」读的就是这条公开 `bookmark_count`，并要求类型是文章或教程指南。最新封面、昨日全部和七日精选用同一张卡片。类型是文章或教程指南，或带有 X Article 卡且不是短帖、产品安利、避坑时，卡片显示 `cover_url`。没有这个地址时不写「无来源附图」，也不另做假图或类型色条。有摘录时把前一两行放大成金句，并显示作者；没有摘录时只留标题和来源时间。卡片不显示收藏数。摘录已经完整出现在卡片上时，不再展开「摘录与时间依据」；展开时只放更长的原文摘录，不写热度缺失或未核对原帖的套话。收藏数仍留在公开条目上，给「七日精选」用。短帖、产品安利和避坑不显示这张封面。图片打不开时回到这张无图卡。进料时没有收藏数的，之后用投递密钥补上；已经过审的公开条目会一起改。定时刷新若在别的公开条目上看到同一条帖的 `bookmark_count` 或 `like_count`，也会补进精华线；字段空着、是 null，或不是非负整数时保持空着，不写成 0。已经写下的收藏数、点赞数、类型、Article 卡、摘录和封面地址不会被后一次替换。`published_at` 优先用进料的 `published_at`，其次 `created_at`。都没有时，从 X 状态编号的 snowflake 推算（Twitter 纪元 `1288834974657`，毫秒为 `(id >> 22) + 纪元`）。不是 X 状态编号的不编造时间，这时才退回过审时间。`source_item_time` 和 `captured_at` 仍是过审时间。接收码过审和满 1 小时自动过审走同一套写入，不按粉丝数把谁排到前面。新进料不再写账号池当场过审。

「昨日全部」只列已经放上公开首页的精华帖，原帖北京日期是昨日。信息流里没有走上这条精华线的帖不进入。昨日最被低估显示人工钉选、并且原帖日是当前「昨日全部」或它的前一个自然日的帖，不按来源热度、榜位或发布时间补。已经在对应那一天精华线上的帖，包括早先账号池当场放过的和满 1 小时自动过审的，钉上之后也会显示。没有对上的钉选时这一栏留空。

每天的公开快照重建之后，仍会按队列里的 `approved` 记录把这些链接接回 `PUBLIC_FEED`。只停在 `pending` 的链接不会被接回去。

已经写进 `PUBLIC_FEED`、`published_at` 仍等于过审时间的旧记录，要等一次重新发布才会分开。下一次公开快照会按队列重写：队列里没有原帖时间时，用 snowflake 填 `published_at`。想马上改，或 snowflake 不等于进料里的真实时间：用投递密钥再送同一条已过审链接，并带上 `published_at` 或 `created_at`。服务会改队列记录，并覆盖公开首页上这条的 `published_at`。公开条目没有 `bookmark_count` 时，「七日精选」不会按收藏数收下它。用投递密钥再送同一条未略过的链接，带上队列里还没有的 `bookmark_count`、`like_count`、`review_type`、`has_article`、`cover_url` 或 `text`。服务只补空缺，不覆盖已经保存的值，并重写这条公开条目。已经写下的封面地址不会被后一次替换。已经略过的不改，也不补封面。接收码对这条再提交一次 `approved` 也会按当前队列重写公开条目；这次若重建记录，会保留已经保存的原帖时间和信号。过审时间、`source_item_time` 和 `captured_at` 不变。预览 Worker 发布之前，现网旧行不会自己改。不要把这次发布打到名为 `woyun` 的 Worker。

队列上限仍是 300 条，过审和略过的记录也算在里面。

过审只让链接进入公开首页。要出现在「昨日最被低估精华帖」里，原帖北京日必须是当前「昨日全部」或它的前一个自然日，并且这条帖还在对应那一天的精华线上。本机过审勾选「进低估」时，过审通过后会直接钉；也可以用同一把接收码单独调用 [昨日低估上传](underrated-upload.md)。再早的日期不能新钉，也不会出现在这一栏。投递密钥不能钉选。旧行 `kosx_review` 为 `pool`、以及满 1 小时自动过审且原帖日落在这两天里的帖，同样可以钉。首页排序不读 `underrated_candidate` 这个记号，只读钉选。

「最新精华」只放原帖北京日落在整理日往前 3 个自然日（含整理日）里的精华线帖。更老的过审帖不占这一栏。卧云精选不限日期，收藏和类型达标仍可进入。七日精选继续用它自己的 7 日窗和收藏门槛。本机过审列表仍按提交日的今天和昨天，不按这 3 天。
