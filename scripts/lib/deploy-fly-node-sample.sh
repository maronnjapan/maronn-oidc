#!/usr/bin/env bash
# Shared Fly.io deploy routine for the single-process Node.js samples
# (express / fastify) that persist state to a local node:sqlite file.
#
# This is verification tooling for maintainers of this repository: it spins
# up a sample OP on real infrastructure so the sqlite-on-a-volume storage
# backend can be checked against an actual HTTP/TLS deployment. It is not a
# production deployment guide for library users — samples/* exist for
# internal verification of CLI-generated code (see CLAUDE.md).
#
# Per-sample wrapper scripts (samples/<name>/scripts/deploy-fly.sh) set
# SAMPLE_DIR / SAMPLE_PACKAGE / RUNTIME_DEP_NAME / RUNTIME_DEP_VERSION and
# exec this script with the user's CLI arguments.
set -euo pipefail

: "${SAMPLE_DIR:?SAMPLE_DIR must be set by the caller (e.g. samples/express)}"
: "${SAMPLE_PACKAGE:?SAMPLE_PACKAGE must be set by the caller (e.g. @maronn-oidc/sample-express)}"
: "${RUNTIME_DEP_NAME:?RUNTIME_DEP_NAME must be set by the caller (e.g. express)}"
: "${RUNTIME_DEP_VERSION:?RUNTIME_DEP_VERSION must be set by the caller (e.g. ^5.2.1)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

APP_NAME=""
REGION="nrt"
ORG="personal"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --app-name) APP_NAME="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --org) ORG="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      cat <<EOF
Usage: deploy-fly.sh --app-name <globally-unique-name> [--region <region>] [--org <org>] [--dry-run]

Provisions (or reuses) a Fly.io app + persistent volume for this sample and
deploys it, so the node:sqlite storage backend can be verified against a
real deployment. --app-name must be globally unique across all Fly accounts.
EOF
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "${APP_NAME}" ]; then
  echo "Error: --app-name is required (Fly app names are globally unique; pick something like maronn-oidc-express-yourname)" >&2
  exit 1
fi

ISSUER="https://${APP_NAME}.fly.dev"
VOLUME_NAME="oidc_data"

info() { printf 'ℹ %s\n' "$*"; }
ok()   { printf '✔ %s\n' "$*"; }
err()  { printf '✗ %s\n' "$*" >&2; }

run() {
  info "実行コマンド: $*"
  if [ "${DRY_RUN}" = "1" ]; then
    return 0
  fi
  "$@"
}

if ! command -v fly >/dev/null 2>&1 && ! command -v flyctl >/dev/null 2>&1; then
  err "flyctl が見つかりません。https://fly.io/docs/flyctl/install/ を参照してインストールしてください。"
  exit 1
fi
FLY_BIN="$(command -v fly || command -v flyctl)"

if [ "${DRY_RUN}" != "1" ]; then
  if ! "${FLY_BIN}" auth whoami >/dev/null 2>&1; then
    err "flyctl が未認証です。先に 'fly auth login' を実行してから再実行してください。"
    exit 1
  fi
fi
ok "flyctl の認証状態を確認しました。"

info "アプリ ${APP_NAME} の存在を確認します。"
app_exists=0
if [ "${DRY_RUN}" != "1" ] && "${FLY_BIN}" status --app "${APP_NAME}" >/dev/null 2>&1; then
  app_exists=1
fi
if [ "${app_exists}" = "1" ]; then
  ok "アプリ ${APP_NAME} は既に存在するため再利用します。"
else
  run "${FLY_BIN}" apps create "${APP_NAME}" --org "${ORG}"
fi

info "Volume ${VOLUME_NAME} の存在を確認します。"
volume_exists=0
if [ "${DRY_RUN}" != "1" ] && "${FLY_BIN}" volumes list --app "${APP_NAME}" --json 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const v=JSON.parse(d);process.exit(v.some(x=>x.Name==='${VOLUME_NAME}')?0:1)}catch{process.exit(1)}})"; then
  volume_exists=1
fi
if [ "${volume_exists}" = "1" ]; then
  ok "Volume ${VOLUME_NAME} は既に存在するため再利用します。"
else
  run "${FLY_BIN}" volumes create "${VOLUME_NAME}" --app "${APP_NAME}" --region "${REGION}" --size 1 --yes
fi

info "リポジトリルートを Docker ビルドコンテキストとしてデプロイします（Dockerfile は ${SAMPLE_DIR}/Dockerfile）。"
info "issuer は ${ISSUER} を使用します（Fly のデフォルトホスト名から決定的に導出）。"
run "${FLY_BIN}" deploy \
  --app "${APP_NAME}" \
  --config "${SAMPLE_DIR}/fly.toml" \
  --dockerfile "${SAMPLE_DIR}/Dockerfile" \
  --build-context "${ROOT_DIR}" \
  --region "${REGION}" \
  --env "HOST=0.0.0.0" \
  --env "ISSUER=${ISSUER}" \
  --remote-only \
  --yes

if [ "${DRY_RUN}" = "1" ]; then
  ok "--dry-run のため、実際の Fly API 呼び出しは行いませんでした。"
  exit 0
fi

info "Discovery エンドポイントで issuer の一致を確認します。"
discovery="$(curl -sf "${ISSUER}/.well-known/openid-configuration" || true)"
if [ -z "${discovery}" ]; then
  err "Discovery エンドポイントへの疎通確認に失敗しました: ${ISSUER}/.well-known/openid-configuration"
  exit 1
fi
if ! printf '%s' "${discovery}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const m=JSON.parse(d);process.exit(m.issuer==='${ISSUER}'?0:1)})"; then
  err "Discovery の issuer が ${ISSUER} と一致しません。"
  exit 1
fi
ok "デプロイが完了しました: ${ISSUER}"
info "後片付けする場合: fly apps destroy ${APP_NAME} --yes"
