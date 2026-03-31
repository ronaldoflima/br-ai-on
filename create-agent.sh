#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

prompt() { printf "${YELLOW}▸ %s${NC} " "$1"; }
success() { printf "${GREEN}✔ %s${NC}\n" "$1"; }
header() { printf "\n${BOLD}%s${NC}\n\n" "$1"; }

header "🦅 HawkAI — Criar Novo Agente"

echo "Este wizard vai te guiar na criacao de um novo agente."
echo "Cada passo explica o que esta sendo configurado."
echo ""

# Nome
echo "O nome do agente e usado como identificador interno (pasta, logs, handoffs)."
echo "Use apenas letras minusculas, numeros e hifens."
while true; do
    prompt "Nome do agente (ex: financeiro, health-tracker):"
    read -r agent_name
    if [[ "$agent_name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
        break
    fi
    echo "Nome invalido. Use apenas letras minusculas, numeros e hifens."
done

if [[ -d "agents/$agent_name" ]]; then
    echo "Erro: agente '$agent_name' ja existe em agents/$agent_name"
    exit 1
fi

echo ""

# Display name
echo "O display name e o nome amigavel que aparece em mensagens e notificacoes."
prompt "Display name (ex: FinanceBot, HealthTracker):"
read -r display_name

echo ""

# Domain
echo "O dominio define a area de responsabilidade do agente."
prompt "Dominio (ex: Financas, Saude, Produtividade):"
read -r domain

echo ""

# Schedule mode
echo "O modo de schedule define quando o agente e executado:"
echo "  ${BOLD}alive${NC}         — Roda automaticamente em intervalos regulares (ex: a cada 30min)"
echo "  ${BOLD}handoff-only${NC}  — So acorda quando recebe handoff ou nota no inbox"
echo "  ${BOLD}disabled${NC}      — Nunca e iniciado automaticamente"
echo ""
while true; do
    prompt "Modo de schedule (alive/handoff-only/disabled) [handoff-only]:"
    read -r schedule_mode
    schedule_mode="${schedule_mode:-handoff-only}"
    if [[ "$schedule_mode" =~ ^(alive|handoff-only|disabled)$ ]]; then
        break
    fi
    echo "Opcao invalida."
done

interval=""
if [[ "$schedule_mode" == "alive" ]]; then
    echo ""
    echo "O intervalo define a frequencia de execucao automatica."
    prompt "Intervalo (ex: 15m, 30m, 1h, 2h) [30m]:"
    read -r interval
    interval="${interval:-30m}"
fi

echo ""

# Model
echo "O modelo de IA usado pelo agente."
prompt "Modelo [claude-sonnet-4-6]:"
read -r model
model="${model:-claude-sonnet-4-6}"

echo ""

# Personality
echo "Descreva brevemente a personalidade do agente."
echo "Isso sera usado para gerar o IDENTITY.md."
prompt "Personalidade (ex: Direto e analitico, focado em dados):"
read -r personality

echo ""

# Priority
priority=5
if [[ "$schedule_mode" == "alive" ]]; then
    prompt "Prioridade (1=mais alta, 10=mais baixa) [5]:"
    read -r priority_input
    priority="${priority_input:-5}"
fi

header "Criando estrutura do agente '$agent_name'..."

base="agents/$agent_name"
mkdir -p "$base/state" "$base/memory" "$base/handoffs/inbox" "$base/handoffs/archive"

cat > "$base/IDENTITY.md" << EOF
# IDENTITY — $display_name

## Identidade

Nome: $display_name
Papel: Agente especializado
Dominio: $domain

## Personalidade

- $personality
- Sempre ler estado persistente + memoria semantica antes de agir
- Registrar decisoes com rationale

## Estilo de Comunicacao

- Mensagens curtas e acionaveis
- Usa listas e bullet points
- Evita formalidade desnecessaria

## Regras de Comportamento

1. Sempre ler estado persistente + memoria semantica antes de agir
2. Registrar decisoes em decisions.md COM rationale
3. Manter current_objective.md atualizado com o foco da sessao
4. Nao executar acoes destrutivas sem aprovacao explicita
5. Registrar acoes significativas no episodic memory (importance 1-5)
6. Atualizar semantic memory quando descobrir preferencias ou padroes novos

## Escopo de Atuacao

- $domain
EOF

interval_line=""
if [[ -n "$interval" ]]; then
    interval_line="  interval: \"$interval\""
else
    interval_line="  interval: \"30m\""
fi

cat > "$base/config.yaml" << EOF
name: $agent_name
display_name: $display_name
domain: $domain
version: "0.1.0"
model: $model
fallback_model: claude-haiku-4-5

schedule:
  mode: $schedule_mode
$interval_line
  priority: $priority
  run_alone: false

budget:
  max_tokens_per_session: 50000
  max_sessions_per_day: 10

integrations:
  telegram:
    enabled: false
  notion:
    enabled: false
  obsidian:
    enabled: false
    inbox: "agents/inbox"
    identity: "$display_name"
EOF

cat > "$base/state/current_objective.md" << EOF
# Objetivo Atual

Nenhum objetivo definido. Aguardando primeira sessao.
EOF

cat > "$base/state/decisions.md" << EOF
# Decisoes

EOF

cat > "$base/memory/semantic.md" << EOF
# Memoria Semantica — $display_name

EOF

success "Diretorio: $base/"
success "IDENTITY.md"
success "config.yaml"
success "state/current_objective.md"
success "state/decisions.md"
success "memory/semantic.md"
success "handoffs/inbox/"
success "handoffs/archive/"

header "Agente '$display_name' criado com sucesso!"

echo "Proximo passo: edite $base/IDENTITY.md para refinar a personalidade."
echo "Para iniciar: use /agent-init com o agente '$agent_name'."
