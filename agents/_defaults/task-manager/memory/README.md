# Sistema de Memória Hierárquica

## Camadas

### Working Memory (Curto Prazo)
Localização: `agents/<nome>/state/`
- `current_objective.md` — foco da sessão atual
- `decisions.md` — decisões da sessão
- `completed_tasks.md` — tarefas concluídas

Limpa/resetada a cada sessão. Agente lê no init e escreve no wrapup.

### Semantic Memory (Longo Prazo — Fatos)
Localização: `agents/<nome>/memory/semantic.md`
- Preferências do usuário
- Padrões observados ao longo de sessões
- Regras aprendidas de correções

Cresce incrementalmente. Agente lê no init, atualiza no wrapup quando descobre algo novo.

### Episodic Memory (Longo Prazo — Histórico)
Localização: `agents/<nome>/memory/episodic.jsonl`
- Registro de ações significativas com contexto
- Formato JSONL: `{date, action, context, outcome, importance}`
- Campo `importance`: 1 (rotina) a 5 (crítico)

Usado para: evitar repetir erros, lembrar contexto de projetos, recall de decisões passadas.

## Busca e Recuperação

Atualmente: busca sequencial por data ou grep por keywords.
Futuro: backend vetorial (ChromaDB/Mem0) com score = similaridade + recência + importância.

## Cache Semântico

Consultas frequentes ao Notion/Calendar são cacheadas em `state/cache/` com TTL configurável.
Formato: `{query_hash}.json` com `{result, cached_at, ttl_seconds}`.
