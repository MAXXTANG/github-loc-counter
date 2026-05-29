# github-loc-counter

輸入任意 GitHub username，**近似**計算他在 GitHub 上累積寫了多少行程式碼。

**線上：** https://github-loc-counter.pages.dev

## 怎麼運作

```
使用者輸入 username
        │
        ▼
GET /api/loc/:username        (Cloudflare Pages Function)
        │
        ├─ 查 KV cache (key: loc:{username}, TTL 24h)
        │     ↓ hit  → 回傳快取（~10ms）
        │     ↓ miss
        ├─ GitHub API:
        │   1. GET /users/:user/repos  (列所有 owner、非 fork、非 archived)
        │   2. 對每個 repo: GET /repos/:owner/:repo/languages
        │      回傳 {Python: 12345, Rust: 6789} (bytes per language)
        ├─ bytes ÷ avg_bytes_per_line[lang] = 近似 lines
        ├─ 寫 KV cache
        └─ 回傳 JSON
        │
        ▼
前端 Chart.js 渲染
```

## 為什麼是「近似」

精確計算要 clone 所有 repo + 跑 tokei，在 serverless 5 秒 timeout 內做不到。
GitHub `/languages` API 回傳的是 **bytes per language**，秒回。

我們用一張查表把 bytes 換算成行數，例如：
- Python：30 bytes/line
- JavaScript：28
- Go：25
- HTML：50
- JSON：45（其實是資料不是程式碼）

誤差大約 ±15%，足以看大略規模。**想要精確值請看 [maxxtang-loc](https://github.com/MAXXTANG/maxxtang-loc) 的快照模式。**

## 為什麼分成兩個 repo

| 模式 | 適合 | 架構 | 精度 |
|---|---|---|---|
| [maxxtang-loc](https://github.com/MAXXTANG/maxxtang-loc) | 自己每月看歷史曲線 | GitHub Action 月度跑 tokei | 精確 |
| github-loc-counter（本 repo） | 任何人即時查任意帳號 | CF Pages + /languages API | 近似 |

兩套架構（離線批次 vs 線上即時）混在一個 repo 會把 code 弄亂。

## 部署

### 1. Fork / clone 本 repo

### 2. Cloudflare 建 KV namespace
```bash
npm install -g wrangler
wrangler login
wrangler kv:namespace create LOC_CACHE
# 把回傳的 id 填到 wrangler.toml
```

### 3. 設 GitHub PAT secret（提升 API 額度到 5000/hr）
```bash
# 在 GitHub Settings → Developer settings → Personal access tokens
# 建一個只有 public_repo 權限的 fine-grained token
wrangler pages secret put GITHUB_TOKEN
```

### 4. 部署
```bash
wrangler pages deploy public --project-name=github-loc-counter
```

或在 Cloudflare Dashboard → Pages → 連 GitHub repo → 自動部署。

## 免費額度

| 資源 | 額度 | 你會爆嗎 |
|---|---|---|
| CF Pages Functions | 100,000 req/day | 不會 |
| CF KV 讀 | 100,000/day | 不會（cache 24h） |
| CF KV 寫 | 1,000/day | 不會（同 user 一天最多寫 1 次） |
| GitHub API | 5,000/hr per token | 注意：熱門用戶 1 次查詢可能用 50+ req（一個 repo 一次 languages call） |

## 安全機制

| 機制 | 實作 | 防什麼 |
|---|---|---|
| **Cloudflare Turnstile** | 前端 widget + 後端 siteverify | IP 輪替攻擊：每次查詢都要過 challenge，VPN 池也擋 |
| **CF Rate Limiting Rules** | Dashboard → Security → WAF → Rate limiting rules（30 req/min/IP） | 第二層保險，不吃 KV 額度 |
| CORS 白名單 | `_middleware.js`，只允許 pages.dev 主站 + 預覽部署 + localhost | 瀏覽器跨域濫用 |
| 輸入驗證 | username 走 GitHub 官方 regex | 路徑注入、KV key 注入 |
| SSRF | fetch URL 寫死 `api.github.com` | 透過 user input 跳轉 |
| 無 cache 後門 | 移除 `?force=1` 參數 | 繞 cache 重複打 GitHub |
| PAT scope | 只給 `public_repo`（fine-grained PAT 推薦） | 即使 token 外洩傷害有限 |
| 輪替提醒 | PAT 90 天到期 + 行事曆 | 減少 token 長期外洩風險 |

### 已知設計取捨

| 不做 | 理由 |
|---|---|
| ~~Per-IP KV rate limit~~ | 每個請求都寫 KV、免費額度 1000 writes/day，被洗 1001 個不同 IP 就壞，反成攻擊破口。改用 Turnstile + CF 內建 rate limiting |
| ~~封鎖無 Origin 請求~~ | Turnstile token 是必填 header，server-to-server 沒過 challenge 自然擋掉，不用再判 Origin |

### Turnstile 設定（部署必做）

1. https://dash.cloudflare.com → Turnstile → Add site
2. Domain：你的 pages.dev 網域（含預覽 wildcard 可選）
3. Widget mode：**Managed**（自動切換難度）
4. 拿到 **Site key**（公開，貼進 `public/index.html` 的 `data-sitekey`）
5. 拿到 **Secret key**（不公開，跑 `wrangler pages secret put TURNSTILE_SECRET`）

### CF Rate Limiting Rules（部署後加）

Dashboard → 你的 zone → Security → WAF → Rate limiting rules → Create
- Field：URI path → contains → `/api/loc/`
- Counting characteristic：IP
- Threshold：30 req in 60s → action：Block 10 min

## 開發

```bash
# 本地預覽（含 Functions）
wrangler pages dev public
# 開 http://localhost:8788
```

## 授權

MIT
