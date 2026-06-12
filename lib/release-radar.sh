#!/usr/bin/env bash
set -euo pipefail

GH() { "${GH_BIN:-gh}" "$@"; }

# dias inteiros entre uma data ISO e NOW (default: agora)
_age_days() {
  local iso="$1"
  local now="${NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  local t0 t1
  t0=$(date -u -d "$iso" +%s 2>/dev/null || echo 0)
  t1=$(date -u -d "$now" +%s 2>/dev/null || echo 0)
  echo $(( (t1 - t0) / 86400 ))
}

# horas inteiras entre uma data ISO e NOW
_age_hours() {
  local iso="$1"
  local now="${NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  local t0 t1
  t0=$(date -u -d "$iso" +%s 2>/dev/null || echo 0)
  t1=$(date -u -d "$now" +%s 2>/dev/null || echo 0)
  echo $(( (t1 - t0) / 3600 ))
}

# Deriva estado de CI a partir do statusCheckRollup JSON (array)
# Imprime: failing | pending | passing | none
_ci_state() {
  local rollup="$1"
  echo "$rollup" | jq -r '
    if (. == null or length == 0) then "none"
    elif any(.[]; .conclusion == "FAILURE" or .state == "FAILURE" or .state == "ERROR") then "failing"
    elif any(.[]; .state == "PENDING" or .conclusion == null) then "pending"
    else "passing"
    end
  '
}

cmd_classify() {
  local stale_h=24
  while [ $# -gt 0 ]; do
    case "$1" in
      --approved-stale-hours)
        stale_h="${2:?--approved-stale-hours requer um valor}"
        [[ "$stale_h" =~ ^[0-9]+$ ]] || { echo "valor invalido para --approved-stale-hours: $stale_h" >&2; exit 2; }
        shift 2;;
      *) shift;;
    esac
  done
  jq --argjson stale_h "$stale_h" '
    map(. + {severity: (
      if .reason == "ci_red_main" then "red"
      elif (.reason == "your_pr_stuck" and .approved and (.stale_hours >= $stale_h)) then "red"
      elif .reason == "review_requested" then "yellow"
      elif .reason == "your_pr_stuck" then "yellow"
      elif .reason == "team_aging" then "yellow"
      else "green" end
    )})'
}

cmd_diff() {
  local snapshot="${1:-}"
  local prev='[]'
  if [ -n "$snapshot" ] && [ -f "$snapshot" ]; then
    prev=$(jq '.items // []' "$snapshot")
  fi
  jq --argjson prev "$prev" '
    ($prev | map({key: "\(.repo)#\(.number // .branch)", value: .}) | from_entries) as $pmap
    | map(. + {_key: "\(.repo)#\(.number // .branch)"})
    | map(select(
        ($pmap[._key] == null)
        or ($pmap[._key].severity != .severity)
        or ($pmap[._key].ci != .ci)
      ))
    | map(del(._key))'
}

cmd_format() {
  local date_str="" backlog_days=60
  while [ $# -gt 0 ]; do
    case "$1" in
      --date) date_str="${2:-}"; shift 2;;
      --backlog-days) backlog_days="${2:-60}"; shift 2;;
      *) shift;;
    esac
  done
  local items; items=$(cat)
  local n; n=$(echo "$items" | jq 'length')
  if [ "$n" = "0" ]; then return 0; fi

  local reds yellows nred nyellow
  reds=$(echo "$items" | jq '[.[] | select(.severity=="red")]')
  yellows=$(echo "$items" | jq '[.[] | select(.severity=="yellow")]')
  nred=$(echo "$reds" | jq 'length')
  nyellow=$(echo "$yellows" | jq 'length')

  printf '📡 Release Radar — %s\n' "$date_str"

  if [ "$nred" -gt 0 ]; then
    printf '\n🔴 %s crítico\n' "$nred"
    echo "$reds" | jq -r '.[] |
      if .reason == "ci_red_main"
      then "• \(.repo | sub("px-center/";"")): CI vermelho na main (\(.commit) \"\(.title)\")"
      else "• \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — aprovado e parado" end'
  fi

  if [ "$nyellow" -gt 0 ]; then
    printf '\n🟡 %s precisam de você\n' "$nyellow"
    local backlog_count; backlog_count=$(echo "$yellows" | jq --argjson bd "$backlog_days" '[.[] | select(.reason=="review_requested" and .age_days > $bd)] | length')
    echo "$yellows" | jq -r --argjson bd "$backlog_days" '.[] |
      if .reason == "review_requested" and .age_days > $bd then empty
      elif .reason == "review_requested" then "• [review] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — \(.age_days)d, te aguarda"
      elif .reason == "your_pr_stuck" then "• [seu PR] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — travado \(.age_days)d"
      else "• [envelhecendo] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — \(.age_days)d (\(.author))" end'
    if [ "$backlog_count" -gt 0 ]; then
      printf '• +%s reviews antigos (>%sd) no backlog\n' "$backlog_count" "$backlog_days"
    fi
  fi

  printf '\n(silêncio nos demais repos = ok)\n'
}

cmd_collect() {
  local user="" org="px-center" critical="" aging_days=5
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="${2:-}"; shift 2;;
      --org) org="${2:-}"; shift 2;;
      --critical-repos) critical="${2:-}"; shift 2;;
      --aging-days) aging_days="${2:-5}"; shift 2;;
      *) shift;;
    esac
  done

  local out='[]'
  # track which (repo,number) pairs we've already collected to avoid duplicates in team_aging
  local seen_keys='[]'

  # review-requested PRs
  local rr_raw
  rr_raw=$(GH search prs --review-requested="$user" --state=open --owner="$org" --json repository,number,title,url,author,createdAt,updatedAt 2>/dev/null || echo '[]')

  while IFS= read -r pr_basic; do
    [ -n "$pr_basic" ] || continue
    local number repo_name
    number=$(echo "$pr_basic" | jq -r '.number')
    repo_name=$(echo "$pr_basic" | jq -r '.repository.nameWithOwner')

    local detail
    detail=$(GH pr view "$number" --repo "$repo_name" \
      --json number,title,url,author,createdAt,updatedAt,isDraft,reviewDecision,mergeable,statusCheckRollup \
      2>/dev/null) || {
      echo "WARN: gh pr view $number ($repo_name) falhou — usando default" >&2
      detail='{"isDraft":false,"reviewDecision":null,"mergeable":"MERGEABLE","statusCheckRollup":[]}'
    }

    local is_draft
    is_draft=$(echo "$detail" | jq -r '.isDraft // false')
    [ "$is_draft" = "true" ] && continue

    local rollup ci
    rollup=$(echo "$detail" | jq '.statusCheckRollup // []')
    ci=$(_ci_state "$rollup")

    local created age_days mergeable_raw mergeable
    created=$(echo "$detail" | jq -r '.createdAt // empty')
    age_days=0
    [ -n "$created" ] && age_days=$(_age_days "$created")
    mergeable_raw=$(echo "$detail" | jq -r '.mergeable // "MERGEABLE"')
    mergeable=true
    [ "$mergeable_raw" = "CONFLICTING" ] && mergeable=false

    local item
    item=$(echo "$detail" | jq \
      --arg repo "$repo_name" \
      --arg ci "$ci" \
      --argjson mergeable "$mergeable" \
      --argjson age_days "$age_days" \
      '{
        repo: $repo,
        number: .number,
        branch: null,
        title: .title,
        url: .url,
        author: .author.login,
        created: .createdAt,
        updated: .updatedAt,
        reason: "review_requested",
        approved: false,
        ci: $ci,
        mergeable: $mergeable,
        stale_hours: 0,
        age_days: $age_days
      }')

    out=$(jq -n --argjson o "$out" --argjson i "$item" '$o + [$i]')
    seen_keys=$(jq -n --argjson k "$seen_keys" --arg key "${repo_name}#${number}" '$k + [$key]')
  done < <(echo "$rr_raw" | jq -c '.[]')

  # author PRs (your_pr_stuck) — only actionable ones
  local mine_raw
  mine_raw=$(GH search prs --author="$user" --state=open --owner="$org" --json repository,number,title,url,author,createdAt,updatedAt 2>/dev/null || echo '[]')

  while IFS= read -r pr_basic; do
    [ -n "$pr_basic" ] || continue
    local number repo_name
    number=$(echo "$pr_basic" | jq -r '.number')
    repo_name=$(echo "$pr_basic" | jq -r '.repository.nameWithOwner')

    local detail
    detail=$(GH pr view "$number" --repo "$repo_name" \
      --json number,title,url,author,createdAt,updatedAt,isDraft,reviewDecision,mergeable,statusCheckRollup \
      2>/dev/null) || {
      echo "WARN: gh pr view $number ($repo_name) falhou — usando default" >&2
      detail='{"isDraft":false,"reviewDecision":null,"mergeable":"MERGEABLE","statusCheckRollup":[]}'
    }

    local is_draft
    is_draft=$(echo "$detail" | jq -r '.isDraft // false')
    [ "$is_draft" = "true" ] && continue

    local rollup ci
    rollup=$(echo "$detail" | jq '.statusCheckRollup // []')
    ci=$(_ci_state "$rollup")

    local review_decision approved
    review_decision=$(echo "$detail" | jq -r '.reviewDecision // ""')
    approved=false
    [ "$review_decision" = "APPROVED" ] && approved=true

    local mergeable_raw mergeable conflict
    mergeable_raw=$(echo "$detail" | jq -r '.mergeable // "MERGEABLE"')
    mergeable=true
    conflict=false
    if [ "$mergeable_raw" = "CONFLICTING" ]; then
      mergeable=false
      conflict=true
    fi

    # Only emit if actionable: approved OR ci failing OR conflict
    local is_actionable=false
    [ "$approved" = "true" ] && is_actionable=true
    [ "$ci" = "failing" ] && is_actionable=true
    [ "$conflict" = "true" ] && is_actionable=true
    [ "$is_actionable" = "false" ] && continue

    local created updated age_days stale_hours
    created=$(echo "$detail" | jq -r '.createdAt // empty')
    updated=$(echo "$detail" | jq -r '.updatedAt // empty')
    age_days=0
    [ -n "$created" ] && age_days=$(_age_days "$created")
    stale_hours=0
    if [ "$approved" = "true" ] && [ -n "$updated" ]; then
      stale_hours=$(_age_hours "$updated")
    fi

    local item
    item=$(echo "$detail" | jq \
      --arg repo "$repo_name" \
      --arg ci "$ci" \
      --argjson approved "$approved" \
      --argjson mergeable "$mergeable" \
      --argjson stale_hours "$stale_hours" \
      --argjson age_days "$age_days" \
      '{
        repo: $repo,
        number: .number,
        branch: null,
        title: .title,
        url: .url,
        author: .author.login,
        created: .createdAt,
        updated: .updatedAt,
        reason: "your_pr_stuck",
        approved: $approved,
        ci: $ci,
        mergeable: $mergeable,
        stale_hours: $stale_hours,
        age_days: $age_days
      }')

    out=$(jq -n --argjson o "$out" --argjson i "$item" '$o + [$i]')
    seen_keys=$(jq -n --argjson k "$seen_keys" --arg key "${repo_name}#${number}" '$k + [$key]')
  done < <(echo "$mine_raw" | jq -c '.[]')

  # ci_red_main per critical repo
  local IFS=','
  local repo
  for repo in $critical; do
    [ -n "$repo" ] || continue
    local checks failed
    checks=$(GH api "repos/$repo/commits/main/check-runs" 2>/dev/null || echo '{"check_runs":[]}')
    failed=$(echo "$checks" | jq '[.check_runs[]? | select(.conclusion=="failure")] | length')
    if [ "${failed:-0}" -gt 0 ]; then
      local item
      item=$(jq -n --arg repo "$repo" '{repo:$repo, number:null, branch:"main", title:"build main", url:("https://github.com/"+$repo), author:"-", reason:"ci_red_main", approved:false, ci:"failing", mergeable:true, stale_hours:0, commit:"main", age_days:0}')
      out=$(jq -n --argjson o "$out" --argjson i "$item" '$o + [$i]')
    fi
  done

  # team_aging: PRs from others in critical repos that are old and not already seen
  for repo in $critical; do
    [ -n "$repo" ] || continue
    local prs_raw
    prs_raw=$(GH pr list --repo "$repo" --state open --json number,title,url,author,createdAt,isDraft 2>/dev/null || echo '[]')

    while IFS= read -r pr; do
      [ -n "$pr" ] || continue

      local is_draft author_login number
      is_draft=$(echo "$pr" | jq -r '.isDraft // false')
      [ "$is_draft" = "true" ] && continue

      author_login=$(echo "$pr" | jq -r '.author.login // ""')
      [ "$author_login" = "$user" ] && continue

      number=$(echo "$pr" | jq -r '.number')
      local key="${repo}#${number}"

      # skip if already in seen_keys
      local already_seen
      already_seen=$(echo "$seen_keys" | jq --arg k "$key" 'any(.[]; . == $k)')
      [ "$already_seen" = "true" ] && continue

      local created age_days
      created=$(echo "$pr" | jq -r '.createdAt // empty')
      age_days=0
      [ -n "$created" ] && age_days=$(_age_days "$created")

      [ "$age_days" -le "$aging_days" ] && continue

      local item
      item=$(echo "$pr" | jq \
        --arg repo "$repo" \
        --argjson age_days "$age_days" \
        '{
          repo: $repo,
          number: .number,
          branch: null,
          title: .title,
          url: .url,
          author: .author.login,
          reason: "team_aging",
          approved: false,
          ci: "none",
          mergeable: true,
          stale_hours: 0,
          age_days: $age_days
        }')

      out=$(jq -n --argjson o "$out" --argjson i "$item" '$o + [$i]')
    done < <(echo "$prs_raw" | jq -c '.[]')
  done
  local IFS=$' \t\n'

  echo "$out"
}

cmd_run() {
  local user="" org="px-center" critical="" snapshot="" date_str="" stale_h=24 backlog_days=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="${2:-}"; shift 2;;
      --org) org="${2:-}"; shift 2;;
      --critical-repos) critical="${2:-}"; shift 2;;
      --snapshot) snapshot="${2:-}"; shift 2;;
      --date) date_str="${2:-}"; shift 2;;
      --approved-stale-hours) stale_h="${2:-}"; shift 2;;
      --backlog-days) backlog_days="${2:-}"; shift 2;;
      *) shift;;
    esac
  done

  local current
  current=$(cmd_collect --user "$user" --org "$org" --critical-repos "$critical" \
    | cmd_classify --approved-stale-hours "$stale_h")

  local changes
  changes=$(echo "$current" | cmd_diff "$snapshot")

  local fmt_args=("--date" "$date_str")
  [ -n "$backlog_days" ] && fmt_args+=("--backlog-days" "$backlog_days")

  local text
  text=$(echo "$changes" | cmd_format "${fmt_args[@]}")

  if [ -n "$snapshot" ]; then
    mkdir -p "$(dirname "$snapshot")"
    if [ -z "$text" ] || [ "${RR_DRY_RUN:-0}" = "1" ]; then
      jq -n --argjson items "$current" --arg at "${NOW:-}" '{generated_at:$at, items:$items}' > "$snapshot"
    fi
  fi

  [ -n "$text" ] || return 0

  if [ "${RR_DRY_RUN:-0}" = "1" ]; then
    printf '%s\n' "$text"
  else
    bash "$(dirname "${BASH_SOURCE[0]}")/telegram.sh" send "$text" \
      && { [ -n "$snapshot" ] && jq -n --argjson items "$current" --arg at "${NOW:-}" '{generated_at:$at, items:$items}' > "$snapshot"; }
  fi
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    collect) cmd_collect "$@";;
    classify) cmd_classify "$@";;
    diff) cmd_diff "$@";;
    format) cmd_format "$@";;
    run) cmd_run "$@";;
    *) echo "uso: release-radar.sh {collect|classify|diff|format|run}" >&2; exit 2;;
  esac
}

main "$@"
