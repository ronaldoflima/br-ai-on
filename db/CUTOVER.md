# Cutover: arquivos → Postgres

Procedimento passo-a-passo para mover o estado dos agentes de arquivos
(`agents/<nome>/state/...`) para Postgres no schema `braion`.

## Visão geral em fases

| Fase | Escopo | Reversibilidade |
|------|--------|-----------------|
| A | Postgres rodando isolado, schema aplicado, **nada do br-ai-on usa ainda** | trivial: `docker compose down` |
| B | Libs refatorados em produção (backend ainda `file`) + migração espelha estado pro PG | trivial: `git revert` (arquivos intactos) |
| C | `BRAION_STATE_BACKEND=pg` ativo na VPS — PG vira fonte da verdade | médio: voltar variável + perder writes pós-cutover (sem script reverso ainda) |

## Pré-requisitos

- Docker compose + acesso SSH `vps-gateway` funcionando (host alias no `~/.ssh/config`)
- `autossh` no Mac (`brew install autossh`)
- `psql` no Mac e na VPS

## Fase A — Postgres na VPS (estado atual após merge deste PR: **PROVISIONADO**)

Já executado:
```bash
# Senha gerada e gravada (chmod 600)
PWD_VAL=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
echo "BRAION_PG_PASSWORD=$PWD_VAL" >> .env

mkdir -p db/data
docker compose -f docker-compose.pg-braion.yml up -d
docker compose -f docker-compose.pg-braion.yml exec -T pg-braion psql -U braion -d braion < db/schema.sql

# Sanity (verificado: 10 tabelas, healthy, bind 127.0.0.1:5432)
docker compose -f docker-compose.pg-braion.yml exec pg-braion psql -U braion -d braion -c "\dt braion.*"
```

Pra refazer do zero (ex.: novo ambiente):
```bash
docker compose -f docker-compose.pg-braion.yml down -v   # apaga volume
docker compose -f docker-compose.pg-braion.yml up -d
docker compose -f docker-compose.pg-braion.yml exec -T pg-braion psql -U braion -d braion < db/schema.sql
```

## Fase B — Deploy dos libs refatorados + migração inicial

Inclui dois passos:

### B.1 Deploy do código

`git pull` na VPS (após este PR mergear). Mudança crítica: todos os libs em
`lib/` que antes liam arquivos diretamente passam a sourcear `lib/state.sh`. Com
`BRAION_STATE_BACKEND` ausente (default `file`), o comportamento é **idêntico ao
anterior** — mesmas paths, mesmos formatos. Validado via E2E síntetico + smoke
test (`scripts/state_smoke_test.sh both` passa 9 asserts em cada backend).

Antes de merge, o seguinte deve ser rodado **na VPS** para validar produção:
```bash
cd ~/br-ai-on && bash scripts/state_smoke_test.sh file
```

### B.2 Migração inicial dos arquivos para o PG (espelhamento)

Com a Fase A já ativa e os libs novos no lugar:
```bash
set -a; source ~/br-ai-on/.env; set +a   # carrega BRAION_PG_PASSWORD
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=braion PGDATABASE=braion
export PGPASSWORD="$BRAION_PG_PASSWORD"

# Dry-run primeiro — só conta o que migraria
python3 scripts/migrate_fs_to_pg.py --dry-run

# Real (idempotente — pode rodar múltiplas vezes)
python3 scripts/migrate_fs_to_pg.py

# Validação: roda smoke contra o PG já populado
bash scripts/state_smoke_test.sh pg
```

A partir daqui o PG é um espelho do FS. Como `BRAION_STATE_BACKEND` ainda não foi
setado, **nada lê do PG ainda** — é puro shadow write durante o cutover.

## Fase C — Cutover

### C.1 Piloto

Escolha um agente de ciclo curto (ex.: `bugsnag`). Edite o crontab para exportar
`BRAION_STATE_BACKEND=pg` antes de chamar `agent-cron.sh` apenas para esse
agente. Rode um ciclo completo, compare:
```sql
SELECT * FROM braion.heartbeat WHERE agent_name='bugsnag';
SELECT * FROM braion.agent_documents WHERE agent_name='bugsnag' ORDER BY updated_at DESC LIMIT 5;
```
contra os arquivos correspondentes — devem refletir o mesmo estado.

### C.2 Cutover total na VPS

Após 1–2 dias estável no piloto:
```bash
echo "BRAION_STATE_BACKEND=pg" >> ~/br-ai-on/.env
# Próximo ciclo do cron pega o .env automaticamente
```

A camada `file` continua disponível como fallback: para reverter, basta remover
ou trocar `BRAION_STATE_BACKEND` no `.env`. Os arquivos não são deletados pelo
script de migração.

### C.3 Setup do Mac (cliente)

```bash
BRAION_PG_PASSWORD="$(ssh vps-gateway 'grep BRAION_PG_PASSWORD ~/br-ai-on/.env | cut -d= -f2')" \
  bash scripts/setup_pg_tunnel.sh install
bash scripts/setup_pg_tunnel.sh start
bash scripts/setup_pg_tunnel.sh status

# Teste
PGSERVICE=braion psql -c "SELECT count(*) FROM braion.agents;"

# Habilita pg no Mac (ex.: no .env do projeto)
echo "BRAION_STATE_BACKEND=pg" >> ~/br-ai-on/.env
```

## Cleanup dos arquivos (semanas depois)

Após 1+ semana sem incidente, em PR separado:
- `git rm -r agents/*/state agents/*/memory agents/*/handoffs agents/shared/jobs agents/shared/*.json`
- Manter `agents/*/IDENTITY.md` e `agents/*/config.yaml` (definição, não estado)

## Rollback

A qualquer momento (após Fase B e antes de cleanup):
```bash
# Tira do PG, volta pra FS
sed -i '/^BRAION_STATE_BACKEND=/d' ~/br-ai-on/.env
# Estado em arquivos ainda intacto (migração nunca apaga)
```

Se houver escritas no PG após o cutover (Fase C+) e precisar voltar para FS,
um script `migrate_pg_to_fs.py` é necessário — não escrito ainda; abriria janela
curta de inconsistência. Por isso a recomendação de só remover arquivos depois
de semanas estáveis no PG.
