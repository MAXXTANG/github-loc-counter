// GET /api/loc/:username
//
// 回傳該 username 在 GitHub 上所有非 fork、非 archived 公開 repo 的近似行數。
// 流程：Turnstile → KV cache → GitHub repos → GitHub /languages → bytes→lines → 寫 KV → JSON
//
// Env bindings:
//   LOC_CACHE         KV namespace
//   GITHUB_TOKEN      secret（PAT, public_repo 即可）
//   TURNSTILE_SECRET  secret（Turnstile site secret key）
//   CACHE_TTL_SECONDS var，預設 86400 (24h)

import { bytesToLines, DATA_LANGS } from "../../_bytes_per_line.js";
import { verifyTurnstile } from "../../_turnstile.js";

const UA = "github-loc-counter (https://github.com/MAXXTANG/github-loc-counter)";

export async function onRequestGet(ctx) {
  const { username } = ctx.params;
  const { env, request } = ctx;

  // ── 0a. Turnstile 驗證 ──────────────────────────────────
  // 沒過 challenge 直接擋（無論 Origin 是什麼），這是防 PAT 被洗的主防線。
  const ts = await verifyTurnstile(env, request);
  if (!ts.ok) {
    return json({ error: ts.error, codes: ts.codes }, ts.status);
  }

  // ── 0b. 輸入驗證 ──────────────────────────────────────────
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(username)) {
    return json({ error: "invalid username" }, 400);
  }

  const cacheKey = `loc:${username.toLowerCase()}`;

  // ── 1. KV cache ─────────────────────────────────────────
  // 之前有 ?force=1 後門可繞 cache，已移除以防止濫用 GitHub API 額度。
  // 開發時要清快取請用：wrangler kv:key delete --binding=LOC_CACHE loc:<user>
  if (env.LOC_CACHE) {
    const cached = await env.LOC_CACHE.get(cacheKey, { type: "json" });
    if (cached) {
      return json({ ...cached, cache: "hit" });
    }
  }

  // ── 2. 列 repos（paginate）──────────────────────────────
  let repos = [];
  let page = 1;
  const headers = ghHeaders(env);
  while (page <= 10) {  // 上限 1000 repos
    const r = await fetch(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&type=owner&sort=updated&page=${page}`,
      { headers }
    );
    if (r.status === 404) return json({ error: "user not found" }, 404);
    if (r.status === 403) return json({ error: "github api rate limit, try later" }, 503);
    if (!r.ok) return json({ error: `github api ${r.status}` }, 502);
    const list = await r.json();
    if (!Array.isArray(list) || list.length === 0) break;
    repos.push(...list);
    if (list.length < 100) break;
    page++;
  }

  // 過濾 fork / archived / disabled
  repos = repos.filter(r => !r.fork && !r.archived && !r.disabled);

  if (repos.length === 0) {
    const empty = {
      username, repo_count: 0,
      total_lines: 0, total_code_lines: 0, total_data_lines: 0,
      by_language: {}, by_repo: {},
      generated_at: new Date().toISOString(),
      method: "approximation (github languages api)",
    };
    return json({ ...empty, cache: "miss" });
  }

  // ── 3. 對每個 repo 抓 /languages，並發跑（CF 同時開 N 條 fetch）─
  const CONCURRENCY = 10;
  const byRepo = {};
  const byLanguage = {};

  let idx = 0;
  async function worker() {
    while (idx < repos.length) {
      const repo = repos[idx++];
      try {
        const r = await fetch(
          `https://api.github.com/repos/${repo.full_name}/languages`,
          { headers }
        );
        if (!r.ok) continue;
        const langs = await r.json();  // { Python: 12345, Rust: 6789 }
        const repoLines = {};
        for (const [lang, bytes] of Object.entries(langs)) {
          const lines = bytesToLines(lang, bytes);
          repoLines[lang] = lines;
          byLanguage[lang] = (byLanguage[lang] || 0) + lines;
        }
        byRepo[repo.name] = {
          lines: Object.values(repoLines).reduce((a, b) => a + b, 0),
          by_language: repoLines,
          stars: repo.stargazers_count,
        };
      } catch (e) {
        // 單一 repo 失敗忽略
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, repos.length) }, worker));

  // ── 4. 加總，分「程式碼 vs 資料/文件」─────────────────────
  let totalCode = 0, totalData = 0;
  for (const [lang, lines] of Object.entries(byLanguage)) {
    if (DATA_LANGS.has(lang)) totalData += lines;
    else totalCode += lines;
  }

  const result = {
    username,
    repo_count: repos.length,
    total_lines: totalCode + totalData,
    total_code_lines: totalCode,
    total_data_lines: totalData,
    by_language: byLanguage,
    by_repo: byRepo,
    generated_at: new Date().toISOString(),
    method: "approximation (github languages api)",
    note: "誤差 ±15%。要精確值請用 tokei + maxxtang-loc 模式。",
  };

  // ── 5. 寫 KV cache ──────────────────────────────────────
  if (env.LOC_CACHE) {
    const ttl = parseInt(env.CACHE_TTL_SECONDS || "86400", 10);
    ctx.waitUntil(
      env.LOC_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl })
    );
  }

  return json({ ...result, cache: "miss" });
}

// ── helpers ─────────────────────────────────────────────────
function ghHeaders(env) {
  const h = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": UA,
  };
  if (env.GITHUB_TOKEN) h["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

function json(body, status = 200) {
  // CORS header 由 _middleware.js 統一注入，不在這裡重複設定
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=600" : "no-store",
    },
  });
}
