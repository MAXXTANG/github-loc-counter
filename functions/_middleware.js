// 跨所有 /api/* 路徑的 middleware：
//
//   1. 只攔 /api/*，靜態頁面直接放行
//   2. CORS：白名單模式
//
// ⚠️ 過去版本在此做 per-IP KV rate limit，已移除。
//    理由：每個請求都寫 KV，免費額度 1000 writes/day，
//    被洗 1001 個不同 IP 就壞，反而給攻擊者破口。
//    濫用防護改由 Turnstile（前端 challenge + 後端驗）+
//    Cloudflare Dashboard 內建的 Rate Limiting Rules 處理。
//
// 環境變數（可選）：
//   ALLOWED_ORIGINS  逗號分隔白名單；預設只有 pages.dev 主站 + localhost

const DEFAULT_ORIGINS = [
  "https://github-loc-counter.pages.dev",
  "http://localhost:8788",
  "http://localhost:8000",
  "http://127.0.0.1:8788",
];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // ── 0. 靜態頁面直接放行 ────────────────────────────────
  if (!url.pathname.startsWith("/api/")) {
    return next();
  }

  // ── 1. CORS 判斷 ────────────────────────────────────────
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;

  const origin = request.headers.get("Origin") || "";
  // 預覽部署 *.github-loc-counter.pages.dev 也通行
  const isAllowed = allowed.includes(origin)
    || /^https:\/\/[a-z0-9-]+\.github-loc-counter\.pages\.dev$/.test(origin);

  // 拒絕：瀏覽器跨域但 Origin 不在白名單
  if (origin && !isAllowed) {
    return jsonWith({ error: "origin not allowed" }, 403, {});
  }

  // CORS headers（無 Origin = server-to-server / curl，仍會被 Turnstile 擋）
  const corsHeaders = {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type, X-Turnstile-Token",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── 2. 放行到目標 Function ───────────────────────────────
  const response = await next();

  // ── 3. 把 CORS header 注入回應 ──────────────────────────
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function jsonWith(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
