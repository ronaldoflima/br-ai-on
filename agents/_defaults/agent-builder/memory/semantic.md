# Memoria Semantica

## Convenções do Ecossistema
- `lib/` — scripts de infraestrutura do projeto (handoff, logger, cron, etc.). Não colocar ferramentas de agentes aqui.
- `agents/shared/lib/` — scripts e ferramentas criadas para uso dos agentes
- `agents/shared/data/` — arquivos de dados gerados/consumidos por agentes (exports, JSONs, relatórios). Nunca usar /tmp/ para dados compartilhados.

## Padrão de Coordenação entre Agentes
- Para coordenação assíncrona sem locks: usar campo no heartbeat.json como fonte de verdade compartilhada (somente o agente dono escreve, outros apenas leem)
- Exemplo aplicado: Hunter escreve `active_protections` no heartbeat; Guardian lê antes de agir sobre um ativo
