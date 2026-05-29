// 跨所有 /api/* 路徑的 middleware：
//   1. Per-IP rate limit（KV 計數，1 分鐘窗口）
//   2. CORS：只允許自家網域 + localhost
//
// 環境變數（可選，在 wrangler.toml 或 CF Dashboard 設）：
//   ALLOWED_ORIGINS  逗號分隔的白名單，預設只有 pages.dev 主站 + localhost
//   RATE_LIMIT_MAX   每窗口允許次數，預設 5
//   RATE_LIMIT_WINDOW 窗口秒數，預設 60

const DEFAULT_ORIGINS = [
  "https://github-loc-counter.pages.dev",
  "http://localhost:8788",
  "http://localhost:8000",
  "http://127.0.0.1:8788",
];

export async function onRequest(context) {
  const { request, env, next } = context;

  // ── 0. 解析設定 ──────────────────────────────────────────
  const allowed = (env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS);
  const RL_MAX = parseInt(env.RATE_LIMIT_MAX || "5", 10);
  const RL_WIN = parseInt(env.RATE_LIMIT_WINDOW || "60", 10);

  // ── 1. CORS 判斷 ────────────────────────────────────────
  const origin = request.headers.get("Origin") || "";
  // 預覽部署 *.{project}.pages.dev 也通行
  const isAllowed = allowed.includes(origin)
    || /^https:\/\/[a-z0-9-]+\.github-loc-counter\.pages\.dev$/.test(origin);
  // 直接打 API（沒 Origin header，例如 curl）也放行讀取
  const corsOrigin = isAllowed ? origin : (origin ? allowed[0] : "*");

  const corsHeaders = {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 瀏覽器跨域 + Origin 不在白名單 → 拒絕（curl 等沒 Origin 的還能用）
  if (origin && !isAllowed) {
    return jsonWith({ error: "origin not allowed" }, 403, corsHeaders);
  }

  // ── 2. Per-IP rate limit ────────────────────────────────
  // 用 KV 做簡單計數器。trade-off：每個請求多 1 read + 1 write，
  // 1k writes/day 免費額度下，單 IP 持續打也要 1000 分鐘才會耗盡，
  // 配合 GitHub PAT 5000/hr 上限是雙保險。
  if (env.LOC_CACHE) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rlKey = `rl:${ip}`;
    const current = parseInt((await env.LOC_CACHE.get(rlKey)) || "0", 10);
    if (current >= RL_MAX) {
      return jsonWith(
        { error: `rate limit exceeded: max ${RL_MAX} requests per ${RL_WIN}s` },
        429,
        { ...corsHeaders, "retry-after": String(RL_WIN) }
      );
    }
    // fire-and-forget 寫回，TTL 自動過期
    context.waitUntil(
      env.LOC_CACHE.put(rlKey, String(current + 1), { expirationTtl: RL_WIN })
    );
  }

  // ── 3. 放行到目標 Function ───────────────────────────────
  const response = await next();

  // ── 4. 把 CORS header 注入回應 ──────────────────────────
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
