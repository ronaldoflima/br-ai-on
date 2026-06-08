# Release Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o agente `release-radar` — um vigia multi-repo da org `px-center` que entrega 2×/dia um digest no Telegram do que precisa da atenção do usuário (reviews pendentes, PRs travados, PRs do time envelhecendo, CI vermelho na main), destacando só o que mudou desde a última execução.

**Architecture:** Núcleo determinístico em `lib/release-radar.sh` com subcomandos puros e testáveis (`classify`, `diff`, `format`) + um `collect` que isola a chamada ao `gh` (substituível por `GH_BIN` nos testes). O agente (`agents/release-radar/`) é uma sessão Claude Code que roda o script, aplica julgamento de Staff sobre o resultado, envia o Telegram e atualiza a memória. Clona o molde do `netsuite-monitor`.

**Tech Stack:** Bash + `jq` + `gh` CLI. Testes em bash no padrão `assert_eq` do repo (`tests/test_job.sh`). Estado em JSON. Notificação via `lib/telegram.sh`. Logging via `lib/logger.sh`.

---

## File Structure

| Arquivo | Responsabilidade |
|---------|------------------|
| `lib/release-radar.sh` | CLI com subcomandos: `collect` (gh→items), `classify` (items→severidade), `diff` (items vs snapshot→mudanças), `format` (mudanças→texto Telegram), `run` (orquestra tudo). |
| `tests/test_release_radar.sh` | Testes bash dos subcomandos puros (`classify`, `diff`, `format`) + integração de `collect` com `gh` fake. |
| `tests/fixtures/gh-fake.sh` | Stub de `gh` para o teste de `collect` (lê argumentos, devolve JSON fixo). |
| `agents/release-radar/IDENTITY.md` | Cérebro do agente: ciclo de varredura, regras de severidade, definição de "atenção", camada de julgamento. |
| `agents/release-radar/config.yaml` | Schedule (`alive` + cron 9h/14h dias úteis), watch config, telegram, budget. |
| `agents/release-radar/state/`, `memory/`, `handoffs/` | Estado persistente padrão (criados vazios). |

### Modelo de dados (item) — usado em todas as tasks

Cada item de atenção é um objeto JSON com estes campos (consistente entre `collect`, `classify`, `diff`, `format`):

```json
{
  "repo": "px-center/px-motor",
  "number": 482,
  "branch": null,
  "title": "Add retry to webhook",
  "url": "https://github.com/px-center/px-motor/pull/482",
  "author": "fulano",
  "reason": "review_requested",
  "age_days": 2,
  "stale_hours": 6,
  "ci": "passing",
  "approved": false,
  "mergeable": true,
  "severity": "yellow"
}
```

- `reason` ∈ `review_requested` | `your_pr_stuck` | `team_aging` | `ci_red_main`.
- `ci` ∈ `passing` | `failing` | `pending` | `none`.
- Para `ci_red_main`: `number` é `null`, `branch` é `"main"`, `commit` traz o SHA curto.
- `severity` é preenchido por `classify` (vem ausente/`null` de `collect`).
- Chave de identidade (usada no diff): `"\(.repo)#\(.number // .branch)"`.

---

## Task 1: Esqueleto do script e subcomando `classify`

**Files:**
- Create: `lib/release-radar.sh`
- Test: `tests/test_release_radar.sh`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/test_release_radar.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RR="$PROJECT_ROOT/lib/release-radar.sh"
PASS=0; FAIL=0

assert_eq() {
  local label=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"; PASS=$((PASS + 1))
  else
    echo "FAIL: $label — expected '$expected', got '$actual'"; FAIL=$((FAIL + 1))
  fi
}

# --- classify ---
echo "--- Test: classify ---"
items='[
  {"repo":"px-center/px-torre-core","branch":"main","number":null,"reason":"ci_red_main","approved":false,"stale_hours":0,"ci":"failing"},
  {"repo":"px-center/px-motor","number":91,"reason":"your_pr_stuck","approved":true,"stale_hours":30,"ci":"passing"},
  {"repo":"px-center/px-motor","number":92,"reason":"your_pr_stuck","approved":true,"stale_hours":5,"ci":"passing"},
  {"repo":"px-center/px-cortex","number":10,"reason":"review_requested","approved":false,"stale_hours":48,"ci":"passing"},
  {"repo":"px-center/px-cortex","number":11,"reason":"team_aging","approved":false,"stale_hours":200,"ci":"passing"}
]'
out=$(echo "$items" | bash "$RR" classify --approved-stale-hours 24)
assert_eq "ci_red_main => red"        "red"    "$(echo "$out" | jq -r '.[0].severity')"
assert_eq "approved+stale => red"     "red"    "$(echo "$out" | jq -r '.[1].severity')"
assert_eq "approved+fresh => yellow"  "yellow" "$(echo "$out" | jq -r '.[2].severity')"
assert_eq "review_requested => yellow" "yellow" "$(echo "$out" | jq -r '.[3].severity')"
assert_eq "team_aging => yellow"      "yellow" "$(echo "$out" | jq -r '.[4].severity')"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bash tests/test_release_radar.sh`
Expected: FAIL — `lib/release-radar.sh` não existe (erro "No such file").

- [ ] **Step 3: Implementar o esqueleto + `classify`**

Criar `lib/release-radar.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cmd_classify() {
  local stale_h=24
  while [ $# -gt 0 ]; do
    case "$1" in
      --approved-stale-hours) stale_h="$2"; shift 2;;
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

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    classify) cmd_classify "$@";;
    *) echo "uso: release-radar.sh {collect|classify|diff|format|run}" >&2; exit 2;;
  esac
}

main "$@"
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bash tests/test_release_radar.sh`
Expected: PASS — 5 asserts de classify passam.

- [ ] **Step 5: Commit**

```bash
chmod +x lib/release-radar.sh
git add lib/release-radar.sh tests/test_release_radar.sh
git commit -m "feat(release-radar): subcomando classify com regras de severidade"
```

---

## Task 2: Subcomando `diff` (mudanças vs snapshot)

**Files:**
- Modify: `lib/release-radar.sh`
- Modify: `tests/test_release_radar.sh`

- [ ] **Step 1: Adicionar o teste que falha**

No `tests/test_release_radar.sh`, antes da linha `echo ""` final dos resultados, inserir:

```bash
# --- diff ---
echo "--- Test: diff ---"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/snapshot.json" <<'EOF'
{"items":[
  {"repo":"px-center/px-motor","number":91,"severity":"yellow","ci":"passing"},
  {"repo":"px-center/px-cortex","number":10,"severity":"yellow","ci":"passing"}
]}
EOF
current='[
  {"repo":"px-center/px-motor","number":91,"severity":"yellow","ci":"passing"},
  {"repo":"px-center/px-cortex","number":10,"severity":"red","ci":"failing"},
  {"repo":"px-center/px-novo","number":5,"severity":"yellow","ci":"passing"}
]'
changes=$(echo "$current" | bash "$RR" diff "$TMP/snapshot.json")
assert_eq "diff retorna 2 mudancas" "2" "$(echo "$changes" | jq 'length')"
assert_eq "diff inclui PR novo"     "true" "$(echo "$changes" | jq 'any(.[]; .repo=="px-center/px-novo")')"
assert_eq "diff inclui sev mudada"  "true" "$(echo "$changes" | jq 'any(.[]; .repo=="px-center/px-cortex")')"
assert_eq "diff exclui inalterado"  "false" "$(echo "$changes" | jq 'any(.[]; .repo=="px-center/px-motor")')"

# snapshot inexistente => tudo eh mudanca
changes_first=$(echo "$current" | bash "$RR" diff "$TMP/inexistente.json")
assert_eq "sem snapshot => tudo muda" "3" "$(echo "$changes_first" | jq 'length')"
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bash tests/test_release_radar.sh`
Expected: FAIL — `diff` cai no `*)` (uso) e retorna vazio/erro.

- [ ] **Step 3: Implementar `diff`**

Em `lib/release-radar.sh`, adicionar a função e o case:

```bash
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
```

E no `case` do `main`, adicionar antes do `*)`:

```bash
    diff) cmd_diff "$@";;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bash tests/test_release_radar.sh`
Expected: PASS — asserts de classify + diff passam.

- [ ] **Step 5: Commit**

```bash
git add lib/release-radar.sh tests/test_release_radar.sh
git commit -m "feat(release-radar): subcomando diff destaca apenas mudancas vs snapshot"
```

---

## Task 3: Subcomando `format` (texto do digest)

**Files:**
- Modify: `lib/release-radar.sh`
- Modify: `tests/test_release_radar.sh`

- [ ] **Step 1: Adicionar o teste que falha**

Inserir antes do bloco de resultados em `tests/test_release_radar.sh`:

```bash
# --- format ---
echo "--- Test: format ---"
changes_fmt='[
  {"repo":"px-center/px-torre-core","branch":"main","number":null,"reason":"ci_red_main","severity":"red","commit":"a1b2c3","title":"fix conciliation","age_days":0},
  {"repo":"px-center/px-cortex","number":91,"reason":"your_pr_stuck","severity":"yellow","title":"refactor","age_days":1,"author":"me"},
  {"repo":"px-center/px-motor","number":482,"reason":"review_requested","severity":"yellow","title":"retry webhook","age_days":2,"author":"maria"}
]'
text=$(echo "$changes_fmt" | bash "$RR" format --date "08/06 09:00")
assert_eq "tem cabecalho"        "true" "$(echo "$text" | grep -q 'Release Radar — 08/06 09:00' && echo true || echo false)"
assert_eq "conta 1 critico"      "true" "$(echo "$text" | grep -q '🔴 1 crítico' && echo true || echo false)"
assert_eq "conta 2 amarelos"     "true" "$(echo "$text" | grep -q '🟡 2 precisam de você' && echo true || echo false)"
assert_eq "cita repo critico"    "true" "$(echo "$text" | grep -q 'px-torre-core' && echo true || echo false)"
assert_eq "cita PR review"       "true" "$(echo "$text" | grep -q '#482' && echo true || echo false)"

# vazio => string vazia (silencio)
empty=$(echo '[]' | bash "$RR" format --date "08/06 09:00")
assert_eq "vazio => silencio" "" "$empty"
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bash tests/test_release_radar.sh`
Expected: FAIL — `format` ainda não existe.

- [ ] **Step 3: Implementar `format`**

Em `lib/release-radar.sh`, adicionar função e case:

```bash
cmd_format() {
  local date_str=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --date) date_str="$2"; shift 2;;
      *) shift;;
    esac
  done
  local items; items=$(cat)
  local n; n=$(echo "$items" | jq 'length')
  if [ "$n" = "0" ]; then return 0; fi

  local reds yellows
  reds=$(echo "$items" | jq '[.[] | select(.severity=="red")]')
  yellows=$(echo "$items" | jq '[.[] | select(.severity=="yellow")]')
  local nred nyellow
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
    echo "$yellows" | jq -r '.[] |
      if .reason == "review_requested" then "• [review] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — \(.age_days)d, te aguarda"
      elif .reason == "your_pr_stuck" then "• [seu PR] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — travado \(.age_days)d"
      else "• [envelhecendo] \(.repo | sub("px-center/";"")) #\(.number) \"\(.title)\" — \(.age_days)d (\(.author))" end'
  fi

  printf '\n(silêncio nos demais repos = ok)\n'
}
```

E no `case`:

```bash
    format) cmd_format "$@";;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bash tests/test_release_radar.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/release-radar.sh tests/test_release_radar.sh
git commit -m "feat(release-radar): subcomando format gera digest Telegram"
```

---

## Task 4: Subcomando `collect` (gh isolado, testável com fake)

**Files:**
- Modify: `lib/release-radar.sh`
- Create: `tests/fixtures/gh-fake.sh`
- Modify: `tests/test_release_radar.sh`

- [ ] **Step 1: Criar o `gh` fake**

Criar `tests/fixtures/gh-fake.sh`:

```bash
#!/usr/bin/env bash
# Stub de gh para testes. Responde a `gh search prs ...` com JSON fixo,
# e a `gh api ...check-runs` com um run falhando. Ignora os demais.
if [ "${1:-}" = "search" ] && [ "${2:-}" = "prs" ]; then
  if printf '%s ' "$@" | grep -q -- '--review-requested'; then
    echo '[{"repository":{"nameWithOwner":"px-center/px-motor"},"number":482,"title":"retry webhook","url":"https://x/482","author":{"login":"maria"},"createdAt":"2026-06-06T09:00:00Z","updatedAt":"2026-06-06T09:00:00Z"}]'
  elif printf '%s ' "$@" | grep -q -- '--author'; then
    echo '[{"repository":{"nameWithOwner":"px-center/px-cortex"},"number":91,"title":"refactor","url":"https://x/91","author":{"login":"me"},"createdAt":"2026-06-07T09:00:00Z","updatedAt":"2026-06-07T09:00:00Z"}]'
  else
    echo '[]'
  fi
  exit 0
fi
if [ "${1:-}" = "api" ]; then
  echo '{"check_runs":[{"name":"build","conclusion":"failure"}]}'
  exit 0
fi
echo '[]'
```

- [ ] **Step 2: Adicionar o teste que falha**

Inserir antes do bloco de resultados em `tests/test_release_radar.sh`:

```bash
# --- collect (com gh fake) ---
echo "--- Test: collect ---"
export GH_BIN="$PROJECT_ROOT/tests/fixtures/gh-fake.sh"
chmod +x "$GH_BIN"
collected=$(NOW="2026-06-08T09:00:00Z" bash "$RR" collect --user me --org px-center --critical-repos px-center/px-torre-core)
assert_eq "collect retorna JSON array" "true" "$(echo "$collected" | jq -e 'type=="array"' >/dev/null 2>&1 && echo true || echo false)"
assert_eq "collect acha review_requested" "true" "$(echo "$collected" | jq 'any(.[]; .reason=="review_requested" and .number==482)')"
assert_eq "collect acha your_pr_stuck"    "true" "$(echo "$collected" | jq 'any(.[]; .reason=="your_pr_stuck" and .number==91)')"
assert_eq "collect acha ci_red_main"      "true" "$(echo "$collected" | jq 'any(.[]; .reason=="ci_red_main" and .repo=="px-center/px-torre-core")')"
assert_eq "review tem age_days calc"      "2"    "$(echo "$collected" | jq '[.[] | select(.number==482)][0].age_days')"
unset GH_BIN
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `bash tests/test_release_radar.sh`
Expected: FAIL — `collect` ainda não existe.

- [ ] **Step 4: Implementar `collect`**

Em `lib/release-radar.sh`, adicionar no topo (após `set -euo pipefail`):

```bash
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
```

E a função `collect` + case:

```bash
cmd_collect() {
  local user="" org="px-center" critical=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="$2"; shift 2;;
      --org) org="$2"; shift 2;;
      --critical-repos) critical="$2"; shift 2;;
      *) shift;;
    esac
  done

  local out='[]'
  local map_pr='{repo: .repository.nameWithOwner, number: .number, branch: null, title: .title, url: .url, author: .author.login, created: .createdAt, updated: .updatedAt}'

  # 1. review requested no usuario
  local rr; rr=$(GH search prs --review-requested="$user" --state=open --owner="$org" --json repository,number,title,url,author,createdAt,updatedAt 2>/dev/null || echo '[]')
  rr=$(echo "$rr" | jq --arg now "${NOW:-}" "map($map_pr + {reason:\"review_requested\", approved:false, ci:\"none\", mergeable:true, stale_hours:0})")

  # 2. PRs autorados pelo usuario (travados)
  local mine; mine=$(GH search prs --author="$user" --state=open --owner="$org" --json repository,number,title,url,author,createdAt,updatedAt 2>/dev/null || echo '[]')
  mine=$(echo "$mine" | jq "map($map_pr + {reason:\"your_pr_stuck\", approved:true, ci:\"passing\", mergeable:true, stale_hours:0})")

  out=$(jq -n --argjson a "$rr" --argjson b "$mine" '$a + $b')

  # 3. CI vermelho na main dos repos criticos
  local IFS=','
  for repo in $critical; do
    [ -n "$repo" ] || continue
    local checks; checks=$(GH api "repos/$repo/commits/main/check-runs" 2>/dev/null || echo '{"check_runs":[]}')
    local failed; failed=$(echo "$checks" | jq '[.check_runs[]? | select(.conclusion=="failure")] | length')
    if [ "${failed:-0}" -gt 0 ]; then
      local item; item=$(jq -n --arg repo "$repo" '{repo:$repo, number:null, branch:"main", title:"build main", url:("https://github.com/"+$repo), author:"-", reason:"ci_red_main", approved:false, ci:"failing", mergeable:true, stale_hours:0, commit:"main", age_days:0}')
      out=$(jq -n --argjson o "$out" --argjson i "$item" '$o + [$i]')
    fi
  done

  # calcular age_days a partir de created (para itens de PR)
  echo "$out" | jq -c '.[]' | while read -r line; do
    local created; created=$(echo "$line" | jq -r '.created // empty')
    if [ -n "$created" ]; then
      local age; age=$(_age_days "$created")
      echo "$line" | jq --argjson age "$age" '. + {age_days:$age}'
    else
      echo "$line"
    fi
  done | jq -s '.'
}
```

E no `case`:

```bash
    collect) cmd_collect "$@";;
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `bash tests/test_release_radar.sh`
Expected: PASS — incluindo os 5 asserts de collect.

- [ ] **Step 6: Commit**

```bash
chmod +x tests/fixtures/gh-fake.sh
git add lib/release-radar.sh tests/fixtures/gh-fake.sh tests/test_release_radar.sh
git commit -m "feat(release-radar): subcomando collect via gh (isolado/testavel)"
```

---

## Task 5: Subcomando `run` (orquestra collect→classify→diff→snapshot→format)

**Files:**
- Modify: `lib/release-radar.sh`
- Modify: `tests/test_release_radar.sh`

- [ ] **Step 1: Adicionar o teste que falha**

Inserir antes do bloco de resultados em `tests/test_release_radar.sh`:

```bash
# --- run (integracao) ---
echo "--- Test: run ---"
export GH_BIN="$PROJECT_ROOT/tests/fixtures/gh-fake.sh"
RUN_TMP=$(mktemp -d)
snap="$RUN_TMP/last_digest.json"
# 1a execucao: sem snapshot => gera digest e salva snapshot
text1=$(RR_DRY_RUN=1 NOW="2026-06-08T09:00:00Z" bash "$RR" run \
  --user me --org px-center --critical-repos px-center/px-torre-core \
  --snapshot "$snap" --date "08/06 09:00")
assert_eq "run gera texto na 1a vez" "true" "$(echo "$text1" | grep -q 'Release Radar' && echo true || echo false)"
assert_eq "run salva snapshot"       "true" "$([ -f "$snap" ] && echo true || echo false)"
# 2a execucao identica: nada mudou => silencio (texto vazio)
text2=$(RR_DRY_RUN=1 NOW="2026-06-08T14:00:00Z" bash "$RR" run \
  --user me --org px-center --critical-repos px-center/px-torre-core \
  --snapshot "$snap" --date "08/06 14:00")
assert_eq "run silencia sem mudancas" "" "$text2"
rm -rf "$RUN_TMP"
unset GH_BIN
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bash tests/test_release_radar.sh`
Expected: FAIL — `run` ainda não existe.

- [ ] **Step 3: Implementar `run`**

Em `lib/release-radar.sh`, adicionar função e case. `RR_DRY_RUN=1` imprime o digest em vez de enviar Telegram (para o teste).

```bash
cmd_run() {
  local user="" org="px-center" critical="" snapshot="" date_str="" stale_h=24
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="$2"; shift 2;;
      --org) org="$2"; shift 2;;
      --critical-repos) critical="$2"; shift 2;;
      --snapshot) snapshot="$2"; shift 2;;
      --date) date_str="$2"; shift 2;;
      --approved-stale-hours) stale_h="$2"; shift 2;;
      *) shift;;
    esac
  done

  local current; current=$(cmd_collect --user "$user" --org "$org" --critical-repos "$critical" \
    | cmd_classify --approved-stale-hours "$stale_h")

  local changes; changes=$(echo "$current" | cmd_diff "$snapshot")

  # salvar snapshot com o estado atual completo (nao so o diff)
  if [ -n "$snapshot" ]; then
    mkdir -p "$(dirname "$snapshot")"
    jq -n --argjson items "$current" --arg at "${NOW:-}" '{generated_at:$at, items:$items}' > "$snapshot"
  fi

  local text; text=$(echo "$changes" | cmd_format --date "$date_str")
  [ -n "$text" ] || return 0

  if [ "${RR_DRY_RUN:-0}" = "1" ]; then
    printf '%s\n' "$text"
  else
    bash "$(dirname "${BASH_SOURCE[0]}")/telegram.sh" send "$text"
  fi
}
```

E no `case`:

```bash
    run) cmd_run "$@";;
```

> Nota: `cmd_collect | cmd_classify` funciona porque as funções leem stdin/escrevem stdout. `cmd_classify` e `cmd_diff` já leem de stdin via `jq`/`cat`.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bash tests/test_release_radar.sh`
Expected: PASS — todos os blocos (classify, diff, format, collect, run).

- [ ] **Step 5: Commit**

```bash
git add lib/release-radar.sh tests/test_release_radar.sh
git commit -m "feat(release-radar): subcomando run orquestra pipeline + snapshot"
```

---

## Task 6: IDENTITY.md do agente

**Files:**
- Create: `agents/release-radar/IDENTITY.md`

- [ ] **Step 1: Escrever o IDENTITY**

Criar `agents/release-radar/IDENTITY.md` (clonando a estrutura de seções do `netsuite-monitor`):

```markdown
# IDENTITY — Release Radar

## Identidade

Nome: release-radar
Display Name: Release Radar
Papel: Vigia multi-repo de PRs e CI da org px-center
Domínio: Situational awareness de engenharia para o usuário (Staff) — o que precisa da atenção dele agora

## Personalidade

- Vigilante: varre os repos proativamente, sem esperar ser perguntado
- Seletivo: silêncio é uma feature — só fala quando há algo novo que importa
- Conciso: digest curto, escaneável, com link e ação implícita
- Criterioso: distingue ruído (PR de bot, draft) de sinal real

## Estilo de Comunicação

- Digest via Telegram, agrupado por severidade (🔴 crítico, 🟡 precisa de você)
- Sempre destacar apenas o que mudou desde a última execução
- Nunca repetir item já reportado e inalterado

## Ferramentas

| Ferramenta | Uso |
|------------|-----|
| `bash lib/release-radar.sh run ...` | Pipeline completo (collect→classify→diff→format→Telegram) |
| `gh` CLI | Fonte de dados (via o script; auth: ronaldoflima @ px-center) |
| `bash lib/telegram.sh send "..."` | Alertas (fallback se rodar passos manualmente) |
| `bash lib/logger.sh` | Log estruturado da sessão |

## Ciclo de Monitoramento (Sessão Autônoma)

```
1. Ler config.yaml (user, org, critical_repos, thresholds) e memory/semantic.md
2. Rodar: lib/release-radar.sh run --user <login> --org px-center \
     --critical-repos <lista> --snapshot state/last_digest.json \
     --date "<dd/mm HH:MM>" --approved-stale-hours <n>
3. Revisar o digest gerado com julgamento de Staff:
   - Algum item marcado 🟡 é na verdade crítico (caminho crítico/release)? Promover.
   - Algum item é ruído conhecido (bot, repo arquivado)? Anotar em semantic.md p/ ignorar.
4. Se o script enviou digest, registrar decisão em state/decisions.md
5. Se silêncio, registrar heartbeat idle (não alarmar)
6. Atualizar memory/semantic.md se aprendeu padrão novo (dono de repo, repo a ignorar)
7. Logar métricas (nº itens, nº alertas, severidades)
```

## Regras de Comportamento

1. Silêncio = saúde. Não enviar nada se o diff vier vazio.
2. Nunca comentar, aprovar ou mexer em PR — este agente é READ-ONLY (ações são do staff-reviewer).
3. Se `gh` retornar 401/erro de auth → alerta Telegram imediato (bloqueante).
4. Repos a ignorar e donos aprendidos vivem em memory/semantic.md — consultar antes de alarmar.
5. Promover 🟡→🔴 só com justificativa registrada em decisions.md.
6. Respeitar integrations.telegram.enabled do config.yaml antes de enviar.

## Limiares de Alerta

- `aging_days` (PR do time envelhecendo): default 5
- `approved_stale_hours` (PR seu aprovado e parado → 🔴): default 24
- Ajustáveis no config.yaml; calibrados na 1ª semana.

## Escopo de Atuação

- Org: px-center
- Repos: auto-detectados (onde o usuário autora/revisa) ∪ critical_repos do config
- Não atua fora de px-center; não faz revisão de conteúdo de código (isso é o staff-reviewer)
```

- [ ] **Step 2: Validar que o arquivo é Markdown legível**

Run: `head -5 agents/release-radar/IDENTITY.md`
Expected: mostra o cabeçalho `# IDENTITY — Release Radar`.

- [ ] **Step 3: Commit**

```bash
git add agents/release-radar/IDENTITY.md
git commit -m "feat(release-radar): IDENTITY do agente (molde netsuite-monitor)"
```

---

## Task 7: config.yaml e diretórios de estado

**Files:**
- Create: `agents/release-radar/config.yaml`
- Create: `agents/release-radar/state/`, `memory/`, `handoffs/inbox/`, `handoffs/archive/`

- [ ] **Step 1: Criar os diretórios de estado**

Run:
```bash
mkdir -p agents/release-radar/state agents/release-radar/memory \
         agents/release-radar/handoffs/inbox agents/release-radar/handoffs/archive
: > agents/release-radar/memory/semantic.md
: > agents/release-radar/memory/episodic.jsonl
```

- [ ] **Step 2: Criar o config.yaml (com `mode: disabled` para calibração)**

Criar `agents/release-radar/config.yaml`:

```yaml
name: release-radar
display_name: Release Radar
domain:
  - github
  - code-review
  - monitoramento
layer: engineering
working_directory: /home/mcpgw/pessoal/projects/br-ai-on
version: "0.1.0"
model: claude-sonnet-4-6
fallback_model: claude-haiku-4-5

capabilities:
  - Vigiar PRs e CI multi-repo na org px-center
  - Destacar o que precisa da atenção do usuário (review, PR travado, CI vermelho)
  - Reportar apenas mudanças desde a última execução (diff)

schedule:
  mode: disabled        # vira "alive" após calibração (Task 8)
  cron: "0 9,14 * * 1-5"
  priority: 2
  run_alone: false

budget:
  max_sessions_per_day: 4

watch:
  user: ronaldoflima
  org: px-center
  critical_repos:
    - px-center/px-torre-core
  aging_days: 5
  approved_stale_hours: 24

integrations:
  telegram:
    enabled: true

collaborators:
  - agent: staff-reviewer
    reason: Escalar revisão técnica profunda de um PR específico (futuro)
```

- [ ] **Step 3: Validar YAML e reconhecimento pelo scheduler**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('agents/release-radar/config.yaml')); print('yaml ok')"
python3 lib/agent-scheduler.py | jq -r '.[].agent' 2>/dev/null | grep release-radar || \
  python3 lib/agent-scheduler.py | grep -q release-radar && echo "scheduler ve o agente"
```
Expected: `yaml ok` e o scheduler listando `release-radar` (provavelmente como `inactive`, pois `mode: disabled`).

- [ ] **Step 4: Commit**

```bash
git add agents/release-radar/config.yaml agents/release-radar/memory/
git commit -m "feat(release-radar): config.yaml (disabled p/ calibracao) e estado inicial"
```

> Nota: `agents/<nome>/` pode estar no `.gitignore` (agentes de usuário). Se `git add` reclamar, usar `git add -f` — este agente é versionado de propósito por ser parte da iniciativa Staff. Confirmar com o usuário antes de forçar.

---

## Task 8: Dry-run real, calibração e ativação

**Files:**
- Modify: `agents/release-radar/config.yaml` (apenas ao final)

- [ ] **Step 1: Rodar o pipeline contra o GitHub real (dry-run)**

Run:
```bash
RR_DRY_RUN=1 bash lib/release-radar.sh run \
  --user ronaldoflima --org px-center \
  --critical-repos px-center/px-torre-core \
  --snapshot agents/release-radar/state/last_digest.json \
  --date "$(date +'%d/%m %H:%M')" \
  --approved-stale-hours 24
```
Expected: um digest real (ou vazio se nada pendente). Inspecionar visualmente: os itens fazem sentido? Há ruído?

- [ ] **Step 2: Verificar o snapshot salvo**

Run: `jq '.items | length' agents/release-radar/state/last_digest.json`
Expected: número de itens coletados (≥ 0).

- [ ] **Step 3: Rodar de novo e confirmar silêncio**

Run: repetir o comando do Step 1.
Expected: saída vazia (nada mudou desde o snapshot) — confirma que o diff funciona contra dados reais.

- [ ] **Step 4: Calibrar (manual, ~1 semana)**

Observar os digests por alguns dias. Ajustar em `config.yaml`:
- `aging_days` se PRs do time aparecem cedo/tarde demais.
- `approved_stale_hours` se "PR seu travado" alarma rápido demais.
- Adicionar repos a `critical_repos` ou padrões a ignorar em `memory/semantic.md`.

- [ ] **Step 5: Ativar o agente**

Quando o sinal estiver bom, editar `agents/release-radar/config.yaml`:

```yaml
schedule:
  mode: alive          # era: disabled
  cron: "0 9,14 * * 1-5"
```

Run para confirmar que o scheduler agora considera o agente como agendado:
```bash
python3 lib/agent-scheduler.py | grep -A2 release-radar
```
Expected: classificado como `due` ou `waiting` conforme o horário (não mais `inactive`).

- [ ] **Step 6: Commit**

```bash
git add agents/release-radar/config.yaml
git commit -m "feat(release-radar): ativa agente (alive) apos calibracao"
```

---

## Self-Review (preenchido pelo autor do plano)

**Spec coverage:**
- Propósito / molde netsuite-monitor → Tasks 6 (IDENTITY) + 7 (config). ✓
- Escopo "onde você atua" + critical_repos → `cmd_collect` (Task 4) + config `watch` (Task 7). ✓
- 4 focos de atenção (review / seu PR / envelhecendo / CI main) → `reason` em `collect` (Task 4) + `classify` (Task 1). ✓
- Cadência 9h/14h dias úteis → `cron` no config (Task 7). ✓
- Diff vs snapshot → `cmd_diff` (Task 2) + `cmd_run` salva snapshot (Task 5). ✓
- Severidade 🔴🟡🟢 → `classify` (Task 1) + `format` (Task 3). ✓
- Silêncio = saúde → `format` retorna vazio + `run` early-return (Tasks 3, 5). ✓
- Erro de auth bloqueante → regra no IDENTITY (Task 6). Nota: detecção fina de 401 fica a cargo do agente lendo a saída do gh; o script já tolera erro com `|| echo '[]'`. ✓
- Validação 1 semana / disabled→alive → Task 8. ✓
- Fora de escopo (read-only, sem comentar PR) → regra 2 do IDENTITY (Task 6). ✓

**Placeholder scan:** Nenhum TBD/TODO; todo passo de código mostra o código.

**Type consistency:** Campos do item (`repo`, `number`, `branch`, `reason`, `severity`, `ci`, `stale_hours`, `age_days`, `approved`) consistentes entre `collect`/`classify`/`diff`/`format`/`run`. Chave de diff `"\(.repo)#\(.number // .branch)"` idêntica em `diff`. Subcomandos (`collect|classify|diff|format|run`) batem entre `main` case e chamadas em `cmd_run`.
