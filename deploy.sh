#!/usr/bin/env bash
# deploy.sh — github-loc-counter 一鍵部署
#
# 用法：
#   cd ~/Documents/Claude/Projects/設計工作室/github-loc-counter
#   bash deploy.sh
#
# 會自動：建 GitHub repo + push、建 KV、更新 wrangler.toml、建 Pages
# project、首次部署、設 GITHUB_TOKEN secret、重新部署。
#
# 需要你手動的事：
#   1. 開啟 https://github.com/settings/tokens?type=beta 建一個 fine-grained PAT
#      (Repository access = Public Repositories read-only)
#   2. 把 PAT 貼進腳本提示框

set -euo pipefail
cd "$(dirname "$0")"

# === colors ============================================
B='\033[1m'; R='\033[31m'; G='\033[32m'; Y='\033[33m'; C='\033[36m'; N='\033[0m'
err()  { echo -e "${R}❌ $*${N}" >&2; exit 1; }
ok()   { echo -e "${G}✓${N}  $*"; }
info() { echo -e "${C}→${N}  $*"; }
step() { echo; echo -e "${B}━━━ $* ━━━${N}"; }

# === 0. 工具檢查 =======================================
step "0/8  檢查工具"
missing=()
for c in gh wrangler jq git node; do
  if command -v $c >/dev/null 2>&1; then
    ok "$c"
  else
    missing+=("$c")
    echo -e "${R}✗${N}  $c"
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo
  err "缺少工具，請先跑：
   brew install gh jq node
   npm install -g wrangler"
fi

# === 1. 認證檢查 =======================================
step "1/8  認證檢查"
if ! gh auth status >/dev/null 2>&1; then
  info "GitHub 未登入，開始登入..."
  gh auth login -p https -h github.com -w
fi
GH_USER=$(gh api user --jq .login)
ok "GitHub: $GH_USER"

if ! wrangler whoami >/dev/null 2>&1; then
  info "Cloudflare 未登入，開瀏覽器..."
  wrangler login
fi
CF_USER=$(wrangler whoami 2>&1 | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' | head -1 || echo "登入中")
ok "Cloudflare: $CF_USER"

# === 2. GitHub PAT =====================================
step "2/8  GitHub PAT"
if [[ -n "${PAT:-}" ]]; then
  ok "PAT 從環境變數讀取 (${#PAT} chars)"
else
  echo "需要一個 PAT (Fine-grained 或 Classic 都行，只讀 public_repo)"
  echo
  read -s -p "$(echo -e ${B}貼上 PAT：${N} )" PAT
  echo
fi
[[ -z "${PAT:-}" || ! "$PAT" =~ ^(github_pat_|ghp_) ]] && err "PAT 格式不對 (要 github_pat_ 或 ghp_ 開頭)"
ok "PAT 已收到 (${#PAT} chars)"

# === 3. 建 GitHub repo + push =========================
step "3/8  GitHub repo"
if [[ ! -d .git ]]; then
  git init -b main >/dev/null
  git add .
  git commit -m "init: phase 2 — public service" >/dev/null
  ok "git 已初始化"
fi
if gh repo view "$GH_USER/github-loc-counter" >/dev/null 2>&1; then
  ok "repo 已存在，跳過建立"
  git remote get-url origin >/dev/null 2>&1 || \
    git remote add origin "https://github.com/$GH_USER/github-loc-counter.git"
  git push -u origin main 2>&1 | tail -3 || true
else
  gh repo create github-loc-counter --public --source=. --push --description "輸入任意 GitHub username，近似計算累積寫了多少行程式碼"
  ok "repo 已建立並 push"
fi

# === 4. 建 KV namespace ===============================
step "4/8  KV namespace"
# 可從環境變數 KV_ID 直接帶入，跳過所有偵測
if [[ -n "${KV_ID:-}" ]]; then
  ok "KV ID (from env): $KV_ID"
else
  # 先 list 看 LOC_CACHE 是否已存在（兼容 wrangler 3.x / 4.x 輸出）
  KV_LIST_RAW=$(wrangler kv namespace list 2>&1 || true)
  # 用通用 regex 抓 32 字元 hex ID（KV namespace 格式）
  # 抓 "LOC_CACHE" 附近的 id
  KV_ID=$(echo "$KV_LIST_RAW" | grep -B2 -A2 'LOC_CACHE' | grep -oE '[a-f0-9]{32}' | head -1 || true)

  if [[ -z "$KV_ID" ]]; then
    info "LOC_CACHE 不存在，建立中..."
    KV_CREATE_RAW=$(wrangler kv namespace create LOC_CACHE 2>&1 || true)
    KV_ID=$(echo "$KV_CREATE_RAW" | grep -oE '[a-f0-9]{32}' | head -1 || true)
  fi

  [[ -z "$KV_ID" ]] && err "拿不到 KV ID。手動執行 'wrangler kv namespace list' 看輸出，把 id 填到 wrangler.toml 後再跑：KV_ID=<id> PAT='\$PAT' bash deploy.sh"
  ok "KV ID: $KV_ID"
fi

# === 5. 更新 wrangler.toml + push ====================
step "5/8  寫入 wrangler.toml"
if grep -q "PASTE_YOUR_KV_NAMESPACE_ID_HERE" wrangler.toml; then
  sed -i.bak "s|PASTE_YOUR_KV_NAMESPACE_ID_HERE|$KV_ID|" wrangler.toml
  rm -f wrangler.toml.bak
  git add wrangler.toml
  git commit -m "config: set KV namespace id" >/dev/null
  git push 2>&1 | tail -2
  ok "wrangler.toml 已更新並推送"
else
  # 確認現有 ID 跟剛拿的一致；不一致就覆蓋
  CURRENT_ID=$(grep -oE 'id = "[a-f0-9]+"' wrangler.toml | head -1 | sed 's/id = "\(.*\)"/\1/')
  if [[ "$CURRENT_ID" != "$KV_ID" ]]; then
    sed -i.bak "s|id = \"$CURRENT_ID\"|id = \"$KV_ID\"|" wrangler.toml
    rm -f wrangler.toml.bak
    git add wrangler.toml
    git commit -m "config: update KV namespace id" >/dev/null 2>&1 || true
    git push 2>&1 | tail -2 || true
  fi
  ok "wrangler.toml 已有 KV ID"
fi

# === 6. 建 Pages project + 首次部署 ==================
step "6/8  建 Pages project + 首次部署"
if ! wrangler pages project list 2>/dev/null | grep -q github-loc-counter; then
  wrangler pages project create github-loc-counter \
    --production-branch=main 2>&1 | tail -3
  ok "Pages project 已建立"
else
  ok "Pages project 已存在"
fi

info "上傳 public/ 並部署..."
wrangler pages deploy public \
  --project-name=github-loc-counter \
  --branch=main \
  --commit-dirty=true 2>&1 | tail -5

# === 7. 設 GITHUB_TOKEN secret =======================
step "7/8  寫入 GITHUB_TOKEN secret"
printf '%s' "$PAT" | wrangler pages secret put GITHUB_TOKEN \
  --project-name=github-loc-counter 2>&1 | tail -3
ok "Secret 已寫入"

# === 8. 重新部署套用 secret ==========================
step "8/8  再部署一次套用 secret"
wrangler pages deploy public \
  --project-name=github-loc-counter \
  --branch=main \
  --commit-dirty=true 2>&1 | tail -3

# === 完工 ==============================================
echo
echo -e "${G}${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${G}${B}🎉 部署完成${N}"
echo -e "${G}${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo
echo -e "${B}網站：${N}https://github-loc-counter.pages.dev"
echo -e "${B}API：${N} https://github-loc-counter.pages.dev/api/loc/$GH_USER"
echo -e "${B}Dashboard：${N}https://dash.cloudflare.com → Workers & Pages → github-loc-counter"
echo
info "等 30 秒讓部署生效，然後跑這個測試："
echo "    curl -s https://github-loc-counter.pages.dev/api/loc/$GH_USER | jq ."
echo
if command -v open >/dev/null 2>&1; then
  read -p "$(echo -e ${C}按 Enter 開啟網站，或 Ctrl+C 跳過...${N})" _
  open "https://github-loc-counter.pages.dev"
fi
