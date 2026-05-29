// Cloudflare Turnstile 驗證 helper
//
// 前端用 widget 拿到 token，放進 `X-Turnstile-Token` header 送過來。
// 後端用 secret + token + remote IP 打 siteverify API 驗證。
//
// 環境變數：
//   TURNSTILE_SECRET  Turnstile site 的 secret key（用 wrangler secret 設）
//
// 如果 TURNSTILE_SECRET 沒設（dev 模式），自動跳過 — 上線前要確認設好。

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(env, request) {
  if (!env.TURNSTILE_SECRET) {
    // 未設定 secret：dev 模式，放行但 console 警告
    console.warn("[turnstile] TURNSTILE_SECRET not set — skipping verification");
    return { ok: true, skipped: true };
  }

  const token = request.headers.get("X-Turnstile-Token");
  if (!token) {
    return { ok: false, status: 401, error: "missing turnstile token" };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const params = new URLSearchParams();
  params.set("secret", env.TURNSTILE_SECRET);
  params.set("response", token);
  if (ip) params.set("remoteip", ip);

  let data;
  try {
    const r = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    data = await r.json();
  } catch (e) {
    return { ok: false, status: 503, error: "turnstile siteverify unreachable" };
  }

  if (!data.success) {
    return {
      ok: false,
      status: 403,
      error: "turnstile verification failed",
      codes: data["error-codes"] || [],
    };
  }

  return { ok: true, hostname: data.hostname };
}
