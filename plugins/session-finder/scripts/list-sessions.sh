#!/usr/bin/env bash
# Shared session-listing logic for session-finder.
#
# Scans ~/.claude/projects/*/*.jsonl (all projects, not just cwd) and prints
# one line per session, most recent first, tab-separated:
#
#   id<TAB>title<TAB>cwd<TAB>branch<TAB>relative-time
#
# Usage: list-sessions.sh ["search term"]
#
# Consumed by both plugins/session-finder/commands/session-finder.md (via
# Bash inside a Claude Code turn) and plugins/session-finder/bin/session-finder
# (a standalone script run directly in the user's terminal). Both callers
# parse this exact tab-separated format, so keep it stable.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "session-finder requires 'jq' to parse Claude Code session files, but it was not found on PATH. Install it (e.g. 'brew install jq') and try again." >&2
  exit 1
fi

search_term="${1:-}"

projects_dir="${HOME}/.claude/projects"

shopt -s nullglob
files=("${projects_dir}"/*/*.jsonl)
shopt -u nullglob

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

# Extracts {cwd, branch, ts, title, search} from a session's JSONL lines.
# - title: last "ai-title" line's .aiTitle, else the first plain-string
#   user message that isn't a synthetic/system-injected line (slash-command
#   echoes, caveats, etc.), else a placeholder.
# - cwd/branch: most recent non-null value seen in the file.
# - ts: the most recent timestamp seen in the file (ISO 8601 string).
# - search: title + all plain-string user messages, newline-joined. This is
#   deliberately narrower than "grep the whole file" -- JSONL lines also
#   carry system/tool boilerplate (e.g. embedded skill catalogs) that make
#   nearly every session match nearly every term if grepped unfiltered.
read -r -d '' jq_filter <<'JQ' || true
  [.[]] as $lines
  | ($lines | map(select(.cwd != null) | .cwd) | last) as $cwd
  | ($lines | map(select(.gitBranch != null) | .gitBranch) | last) as $branch
  | ($lines | map(.timestamp | select(. != null)) | sort | last) as $ts
  | ($lines | map(select(.type == "ai-title") | .aiTitle) | last) as $aiTitle
  | ($lines
      | map(select(.type == "user" and (.message.content | type) == "string"))
      | map(.message.content)) as $userMsgs
  | ($userMsgs
      | map(select(test("<local-command|<command-name|<command-message|<command-args|Caveat:") | not))
      | first) as $fallbackTitle
  | (($aiTitle // $fallbackTitle // "(untitled session)") | gsub("\\s+"; " ")) as $title
  | {
      cwd: $cwd,
      branch: $branch,
      ts: $ts,
      title: $title,
      search: (([$title] + $userMsgs) | join("\n"))
    }
JQ

# Parses an ISO 8601 UTC timestamp (e.g. 2026-07-20T16:51:25.607Z) into
# epoch seconds. Tries GNU date, then falls back to BSD date (macOS).
parse_epoch() {
  local clean epoch
  clean="${1%%.*}"
  epoch="$(date -u -d "${clean}Z" +%s 2>/dev/null || true)"
  if [ -z "${epoch}" ]; then
    epoch="$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "${clean}" +%s 2>/dev/null || true)"
  fi
  printf '%s' "${epoch}"
}

# Formats a diff-from-now (in epoch seconds) as a short relative time string.
format_relative() {
  local epoch="$1" now diff
  if [ -z "${epoch}" ]; then
    printf 'unknown'
    return
  fi
  now="$(date -u +%s)"
  diff=$(( now - epoch ))
  if [ "${diff}" -lt 0 ]; then
    diff=0
  fi
  if [ "${diff}" -lt 60 ]; then
    printf 'just now'
  elif [ "${diff}" -lt 3600 ]; then
    printf '%dm ago' "$(( diff / 60 ))"
  elif [ "${diff}" -lt 86400 ]; then
    printf '%dh ago' "$(( diff / 3600 ))"
  elif [ "${diff}" -lt 604800 ]; then
    printf '%dd ago' "$(( diff / 86400 ))"
  else
    printf '%dw ago' "$(( diff / 604800 ))"
  fi
}

rows=()

for f in "${files[@]}"; do
  session_id="$(basename "${f}" .jsonl)"

  info="$(jq -c -R 'try fromjson catch empty' "${f}" 2>/dev/null | jq -s -c "${jq_filter}" 2>/dev/null || true)"
  if [ -z "${info}" ]; then
    continue
  fi

  cwd="$(printf '%s' "${info}" | jq -r '.cwd // "unknown"')"
  branch="$(printf '%s' "${info}" | jq -r '.branch // "-"')"
  ts="$(printf '%s' "${info}" | jq -r '.ts // empty')"
  title="$(printf '%s' "${info}" | jq -r '.title')"
  search_text="$(printf '%s' "${info}" | jq -r '.search // ""')"

  # Match on the title or any user-message content -- not the raw file,
  # which also contains system/tool boilerplate (see comment above).
  if [ -n "${search_term}" ] && ! printf '%s' "${search_text}" | grep -qiF -- "${search_term}"; then
    continue
  fi

  epoch=""
  if [ -n "${ts}" ]; then
    epoch="$(parse_epoch "${ts}")"
  fi
  if [ -z "${epoch}" ]; then
    # Fall back to file mtime if timestamp parsing failed or was absent.
    epoch="$(stat -f '%m' "${f}" 2>/dev/null || stat -c '%Y' "${f}" 2>/dev/null || echo 0)"
  fi

  relative="$(format_relative "${epoch}")"

  rows+=("${epoch}$(printf '\t')${session_id}$(printf '\t')${title}$(printf '\t')${cwd}$(printf '\t')${branch}$(printf '\t')${relative}")
done

if [ "${#rows[@]}" -eq 0 ]; then
  exit 0
fi

printf '%s\n' "${rows[@]}" | sort -t "$(printf '\t')" -k1,1 -rn | cut -f2-
