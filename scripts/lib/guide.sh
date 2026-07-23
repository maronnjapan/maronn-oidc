# Shared interactive-guide helpers for the sample launch / deploy scripts.
# Source this file; do not execute it directly.
#
# Design rules for every script that sources this:
# - Zero arguments must "just work": anything that can be derived or defaulted
#   is derived or defaulted, and the user is only prompted when a value truly
#   cannot be determined automatically (account logins, secrets, ...).
# - Every prompt explains what is being asked for and why, and offers a
#   sensible default so pressing Enter is almost always the right answer.
# - When stdin is not a TTY (CI etc.), prompts are never shown: confirmations
#   fall back to their default, and required inputs fail fast with a message
#   that names the flag/env var to pass instead.

guide_info() { printf 'ℹ %s\n' "$*"; }
guide_ok()   { printf '✔ %s\n' "$*"; }
guide_warn() { printf '⚠ %s\n' "$*"; }
guide_err()  { printf '✗ %s\n' "$*" >&2; }

guide_step() {
  printf '\n━━ %s\n' "$*"
}

guide_is_tty() {
  [ -t 0 ]
}

# guide_confirm <質問> [default:y|n]
# Returns 0 for yes, 1 for no. Non-TTY: returns the default silently.
guide_confirm() {
  local question="$1"
  local default="${2:-y}"
  local suffix="[Y/n]"
  if [ "${default}" = "n" ]; then
    suffix="[y/N]"
  fi
  if ! guide_is_tty; then
    [ "${default}" = "y" ]
    return $?
  fi
  local answer
  while true; do
    printf '? %s %s ' "${question}" "${suffix}" >&2
    IFS= read -r answer || answer=""
    answer="$(printf '%s' "${answer}" | tr '[:upper:]' '[:lower:]')"
    case "${answer}" in
      "") [ "${default}" = "y" ]; return $? ;;
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) guide_warn "y か n で答えてください。" ;;
    esac
  done
}

# guide_ask <変数名> <質問> [default]
# Prompts and stores the answer in the named variable. Empty input takes the
# default. Non-TTY: uses the default, or fails when no default exists.
guide_ask() {
  local varname="$1"
  local question="$2"
  local default="${3:-}"
  local answer
  if ! guide_is_tty; then
    if [ -n "${default}" ]; then
      printf -v "${varname}" '%s' "${default}"
      return 0
    fi
    guide_err "対話できない環境（TTYなし）で「${question}」の入力が必要になりました。ヘルプ（--help）記載のフラグまたは環境変数で値を渡してください。"
    return 1
  fi
  if [ -n "${default}" ]; then
    printf '? %s\n  (Enterでデフォルト: %s): ' "${question}" "${default}" >&2
  else
    printf '? %s: ' "${question}" >&2
  fi
  IFS= read -r answer || answer=""
  if [ -z "${answer}" ]; then
    answer="${default}"
  fi
  if [ -z "${answer}" ]; then
    guide_err "値が入力されませんでした。"
    return 1
  fi
  printf -v "${varname}" '%s' "${answer}"
}

# guide_ask_secret <変数名> <質問>
# Like guide_ask but hides input and never has a default.
guide_ask_secret() {
  local varname="$1"
  local question="$2"
  local answer
  if ! guide_is_tty; then
    guide_err "対話できない環境（TTYなし）で「${question}」の入力が必要になりました。"
    return 1
  fi
  printf '? %s（入力は表示されません）: ' "${question}" >&2
  IFS= read -rs answer || answer=""
  printf '\n' >&2
  if [ -z "${answer}" ]; then
    guide_err "値が入力されませんでした。"
    return 1
  fi
  printf -v "${varname}" '%s' "${answer}"
}

# guide_run <cmd...>
# Prints the command before running it so the user can re-run it by hand.
guide_run() {
  guide_info "実行: $*"
  "$@"
}

# guide_require_pnpm — corepack 経由での pnpm 有効化まで面倒を見る。
guide_require_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    guide_warn "pnpm が見つかりませんが、corepack があります。"
    if guide_confirm "corepack enable を実行して pnpm を有効化しますか？" y; then
      guide_run corepack enable
      if command -v pnpm >/dev/null 2>&1; then
        guide_ok "pnpm を有効化しました。"
        return 0
      fi
    fi
  fi
  guide_err "pnpm が見つかりません。Node.js 22 以降で 'corepack enable' を実行するか、https://pnpm.io/installation を参照してインストールしてください。"
  return 1
}

# guide_require_node_version <major> <minor>
guide_require_node_version() {
  local want_major="$1"
  local want_minor="$2"
  if ! command -v node >/dev/null 2>&1; then
    guide_err "node が見つかりません。Node.js ${want_major}.${want_minor} 以降をインストールしてください: https://nodejs.org/"
    return 1
  fi
  local version major minor
  version="$(node --version)"
  version="${version#v}"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  if [ "${major}" -lt "${want_major}" ] || { [ "${major}" -eq "${want_major}" ] && [ "${minor}" -lt "${want_minor}" ]; }; then
    guide_err "Node.js v${version} は古すぎます。node:sqlite を使うサンプルのため v${want_major}.${want_minor} 以降が必要です。"
    return 1
  fi
  return 0
}

# guide_ensure_workspace_deps <repo-root>
# Runs pnpm install only when the workspace has not been installed yet, so
# repeat launches stay fast while a fresh clone still works with one command.
guide_ensure_workspace_deps() {
  local root_dir="$1"
  if [ -d "${root_dir}/node_modules" ]; then
    return 0
  fi
  guide_step "依存関係をインストールします（初回のみ）"
  (cd "${root_dir}" && guide_run pnpm install)
}
