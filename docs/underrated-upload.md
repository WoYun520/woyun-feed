# 昨日最被低估精华帖 · 上传

首页「昨日最被低估精华帖」只显示人工钉选、并且这条钉选落在「昨日全部」里的帖，最多 2 条。没有对上的钉选时这一栏留空，不按来源热度、榜位或发布时间补。

「昨日全部」是公开首页精华线上、原帖日期为昨日（北京时间）的帖。精华线是过审写入公开首页的帖（`origin` 为 `kosx_approved`，或来源只有 `sopilot-kosx`），包括账号池自动放上首页的帖。抽奖等已被质量规则收起的帖不在里面。信息流里没有走上这条线的带日期帖不进入「昨日全部」。整理日优先用公开快照的 `generated_at`，没有这份时间时用当前北京时间。「昨日」是整理日的前一个自然日。

**当前仓库改动还没有部署。** 不要执行 `npx wrangler deploy`，也不要部署名为 `woyun` 的 Worker。下面的地址要等有人发布预览 Worker `woyun-feed-preview` 之后才能用。

## 谁可以钉

接收码是哈希存在 `DOT_REVIEW_TOKEN_HASH` 的那把原始密钥，和 [待筛选过审](pending-review.md) 相同。投递密钥不能钉选，也不能撤下，也不能读取钉选列表。没有单独的上传密钥。

Levi 先同意，Overheard 再用接收码调用。钉选不会顺便把一条待筛选链接标成 `approved`，也不会改写公开快照里的正文。新钉选必须已经在当前 `PUBLIC_FEED` 里，而且原帖日期（北京时间）必须等于当前「昨日全部」。还没过审的，先按 [待筛选过审](pending-review.md) 放上首页，再钉。别的日期上的公开帖、还没进公开首页的帖，都不能新钉。

公开帖上的 `kosx_review` 为 `pool` 时，表示候选池自动过审。这种帖只要已经在当前公开首页、并且原帖日期是「昨日全部」，就可以钉进低估栏。首页也按同一条昨日精华线显示它。别的日期、还没进公开首页的帖，仍然不能新钉。

已经钉上的链接，重复 `POST` 仍返回原来的钉选（`existing: true`），不因为日期变了而改写。撤下也不重新检查是不是昨日。`GET` 列出库里全部钉选，包括原帖日期已经不是昨日的，方便核对后再撤。

## 钉上

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/underrated' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","note":"Levi 已看过"}'
```

`note` 可以不写。备注只留在接收码才能读到的列表里，不会出现在公开首页。`reviewer` 由服务写成 `"review"`，表示这是接收码钉的，请求里不要自己填。

多条按数组顺序追加，先钉的排在前面：

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/underrated' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://x.com/name/status/123","https://x.com/name/status/456"]}'
```

正文只能是下面两种之一：

- `{"url":"<X 链接>","note":"<可选备注>"}`
- `{"urls":["<X 链接>", "..."],"note":"<可选，这一批新钉选共用>"}`

单条成功时直接返回这条钉选，`201` 表示新钉上，`200` 且 `"existing": true` 表示本来就钉着。重复钉选不改时间、备注和顺序。批量时返回下面这个形状；只要有一条是新的，状态码就是 `201`，全部本来就钉着则是 `200`。

```json
{"status":"pinned","results":[{"url":"https://x.com/name/status/123","status":"pinned","existing":false}]}
```

`results` 里每一条的字段与单条相同。

```json
{
  "id": "公开帖的 id",
  "key": "x:123",
  "url": "https://x.com/name/status/123",
  "author_handle": "name",
  "day": "2026-10-13",
  "pinned_at": "2026-10-14T06:00:00.000Z",
  "note": "Levi 已看过",
  "reviewer": "review",
  "status": "pinned",
  "existing": false
}
```

`day` 取这条公开帖自己的时间（优先原帖发布时间），换成北京时间的日期。钉选和首页用同一套钟：公开快照有 `generated_at` 时用它算整理日，否则用当前北京时间。「昨日」是整理日的前一个自然日。`day` 不是这个「昨日」时，新的 `POST` 返回 `not_yesterday`，不会写入钉选。被折叠的帖（例如抽奖）不会因为钉选重新出现。

首页最多显示 2 条。钉选库最多留 8 条，多出来的要先撤下。库里有 3 条都属于昨日、并且都在「昨日全部」里时，只显示先钉的 2 条。只有 1 条对得上时，就只显示那 1 条，不用别的帖补满。对不上「昨日全部」的钉选不显示。

`POST /api/dot/underrated` 的门槛：已经在当前公开首页，原帖北京日期是昨日。`kosx_review` 为 `pool` 不再单独拒绝。首页显示比这个更严，只画出落在「昨日全部」里的钉选。

## 查看

```sh
curl -sS 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/underrated' \
  -H 'Authorization: Bearer <接收码>'
```

```json
{
  "items": [],
  "limit": 2,
  "store_limit": 8
}
```

`items` 是钉选顺序，含 `note` 和 `reviewer`。这个 GET 不是公开接口。

## 撤下

用 `DELETE`，或用 `POST` 带 `"status":"unpinned"`。不要用投递密钥。

```sh
curl -sS -X DELETE 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/underrated' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123"}'
```

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/underrated' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","status":"unpinned"}'
```

批量撤下把 `url` 换成 `urls` 数组。某一条不在钉选里时，整批不改，返回 `404`，`error` 为 `not_pinned`。

撤下成功时单条直接返回原钉选，`"status":"unpinned"`。批量返回 `{"status":"unpinned","results":[...]}`。

## 会碰到的错误

| HTTP | error | 含义 |
| --- | --- | --- |
| 401 | not_authorized | 没带接收码、接收码不对，或误用了投递密钥 |
| 404 | not_public | 这条还不在当前公开首页。钉选不会顺便批准 |
| 404 | not_pinned | 要撤下的链接不在钉选里 |
| 409 | not_yesterday | 原帖日期不是当前「昨日全部」（北京时间）。钉选只接受已经在昨日全部里的帖 |
| 409 | pin_full | 钉选库已有 8 条 |
| 400 | undated | 公开帖没有可判断「昨日」的时间 |
| 400 | invalid_url / invalid_body / invalid_note | 链接、正文形状或备注不对。备注里不要放密钥 |
| 503 | underrated_unavailable | 预览 Worker 还没配好两把不同的密钥哈希，或存储暂时不可用 |

服务端调用不要带 `Origin`。接收码只放在 `Authorization: Bearer` 头里，不要写进网址、仓库或备注。
