# 待筛选进料口

公开首页的「贴链接」和 Overheard 都把一条 X 精华帖交给这个接口。服务只把它记为 `pending`，按帖子编号去重，写在私有 KV `DOT_INBOX` 的 `pending:` 前缀下。这里没有过审、拒绝或公开首页操作，也不会改写 `PUBLIC_FEED`。

**当前仓库改动还没有部署。** 下面的地址要等有人在仓库根目录执行 `npx wrangler deploy` 之后才会出现在预览 Worker `woyun-feed-preview` 上。不要把这次部署打到名为 `woyun` 的 Worker。部署前，对现网地址发 POST 不会进入这套待筛选。

## 给 Overheard 的调用

- 地址：`https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending`
- 方法：`POST`
- 鉴权：`Authorization: Bearer <投递密钥>`。这把密钥与 `POST /api/dot/inbox` 是同一把原始投递密钥，不是哈希。哈希存在 Worker secret `DOT_DELIVERY_TOKEN_HASH`。密钥只能放在这个请求头里，不要放进网址、正文或日志。
- 请求头还要带 `Content-Type: application/json`。
- 服务端调用不要带 `Origin`。如果带了，必须等于站点自己的源；其他源返回 `403`。
- 正文可以是一条：`{"url":"https://x.com/name/status/123","author_handle":"name","note":"可选"}`。`author_handle` 和 `note` 都可以省略。
- 也可以一次最多 20 条：`{"items":[{"url":"https://x.com/name/status/123","note":"可选"},{"url":"https://x.com/name/status/456"}]}`。
- `url` 必须是 `https://x.com`、`twitter.com` 或 `mobile.twitter.com` 上的 `/{账号}/status/{数字}`。服务收成 `https://x.com/{账号}/status/{数字}`，去重键是状态编号。
- `author_handle` 如果出现，必须和链接里的账号一致，忽略大小写。
- `note` 最长 400 字，单行，不能夹带密钥或密码样式的文本。
- 同一批里不能重复同一条帖子。

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending' \
  -H 'Authorization: Bearer <投递密钥>' \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"url":"https://x.com/name/status/123","note":"可选"},{"url":"https://x.com/name/status/456"}]}'
```

新链接返回 `201`。整批都已经在队列里时返回 `200`。批量正文的形状是：

```json
{"status":"pending","results":[{"id":"kosx-123","key":"x:123","url":"https://x.com/name/status/123","author_handle":"name","status":"pending","submitted_at":"2026-10-13T00:00:00.000Z","note":"可选","source":"delivery","existing":false}]}
```

单条正文则直接返回上面 `results` 里的那一个对象，不包在 `results` 里。`existing: true` 表示这条帖子已经在待筛选里；服务不改原来的提交时间、备注和状态。`status` 在这一阶段只会是 `pending`。这不表示帖子已经出现在公开首页。

队列最多 300 条。再加新链接时返回 `409`，正文是「待筛选已满，请先处理已有链接。」已在队列里的重复链接仍返回 `200`。这些记录不设过期时间，会留到后面的审核步骤处理。

`401`：投递密钥不对，或用了接收码来提交。`400` / `413` / `415`：修正链接、备注或 JSON 后再试。`503`：预览 Worker 还没配好两把密钥哈希，或存储暂时不可用；不要把这次失败说成已经进入待筛选。

## 读取队列

读取用接收码，也就是哈希存在 `DOT_REVIEW_TOKEN_HASH` 的那把原始密钥。投递密钥不能读，接收码不能提交。

```sh
curl -sS 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending' \
  -H 'Authorization: Bearer <接收码>'
```

返回 `{items, next_cursor}`，每页最多 50 条。下一批把上一页的 `next_cursor` 放在 `?cursor=`。每条含 `note` 和 `source`（`homepage` 或 `delivery`）。没有其他查询参数；不要把密钥放进网址。

## 首页贴链接

浏览器只提交 `{"url":"https://x.com/..."}`，不带 `Authorization`，也不带备注或 `items`。没有投递密钥时，备注和批量都会得到 `401`，提示「带备注或批量提交需要投递密钥。」

成功后页面仍写「已进入待筛选」；服务回答这条已经在队列里时，写「这条已在待筛选里」。服务拒绝或网络失败时，不写这两句，也不把链接只留在这个浏览器里。

浏览器不保存、不发送投递密钥或接收码。Worker 必须已经配置 `DOT_DELIVERY_TOKEN_HASH` 和 `DOT_REVIEW_TOKEN_HASH`，而且两把哈希不同。缺配置时 `/api/dot/pending` 与 `/api/dot/inbox` 一样返回 `503`，不回退到公开文件。本机 `node frontend/serve.js` 没有这条路由，贴链接在纯静态本地服务上会失败；要打到已部署的预览 Worker。

无密钥的单条提交是公开的：任何能访问该地址的客户端都可以放入一条 X 链接。它只能进入待筛选，队列有 300 条上限，不能读取备注，也不能写公开首页。
