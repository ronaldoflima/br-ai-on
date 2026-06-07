# RFC 0001 — Execução multi-host stateless com claim atômico

- **Status:** 🚧 draft (rascunho de trabalho — editar à vontade)
- **Autor:** ronaldoflima
- **Data:** 2026-06-02
- **Relacionado:** PR #46 (backend pg), issue #51 (heartbeat via state.sh), [[project_pg_cutover]]

> Documento vivo. Seções marcadas com **❓Questão em aberto** são pontos a decidir
> na discussão. Decisões já tomadas estão em **✅ Decidido**.

---

## 1. Motivação

Hoje os agentes do br-ai-on rodam **só na VPS** (cron + tmux). Queremos poder
executar o **mesmo agente** também no Mac, aproveitando que o ambiente do Mac
costuma estar mais à frente (MCPs integrados, projetos clonados localmente,
skills, contexto local) — sem perder a VPS como executor quando o Mac estiver
indisponível.

Restrições do dono do projeto (✅ decididas):

1. **Sem replicar agentes.** Um agente existe uma única vez; não há "versão Mac"
   e "versão VPS".
2. **Sem amarrar agente a host** (`host: mac|vps|any` está **rejeitado** — ver §9).
   Um agente criado/usado no Mac deve poder rodar na VPS quando o Mac não estiver
   disponível, e vice-versa.
3. **Execução oportunista coordenada por claim atômico**: qualquer host elegível
   pode pegar qualquer agente; um lock no Postgres decide quem executa, sem corrida.
4. **Estado 100% no Postgres** (stateless compute). Todo dado dinâmico gerado vai
   pro PG. (Redis pode entrar no futuro para estado efêmero/baixa latência — fora
   do escopo desta primeira rodada.)

## 2. Visão / princípio norteador

**Compute stateless + estado compartilhado.** O host é fungível: contribui
*ambiente* (ferramentas, MCPs, projetos) e *capacidade de execução*, mas **nenhum
estado dinâmico vive no host**. Qualquer host reconstrói o contexto completo de um
agente lendo o PG. Dois hosts nunca executam o mesmo agente ao mesmo tempo porque
o **claim atômico** serializa a posse.

```
   ┌─────────── Postgres (fonte única de TODO estado dinâmico) ───────────┐
   │  heartbeat(+owner_host)  documents  episodic  handoffs  jobs  locks   │
   └───────▲───────────────────────────────────────────────────▲──────────┘
           │ claim atômico (CAS)                                │
   ┌───────┴────────┐                                   ┌───────┴────────┐
   │  Mac (executor)│   ambiente rico: MCPs, projetos   │ VPS (executor) │
   │  cron + tmux   │   locais, skills                  │  cron + tmux   │
   └────────────────┘                                   └────────────────┘
   compute stateless — nada de estado dinâmico no FS local de nenhum host
```

## 3. Não-objetivos (YAGNI nesta rodada)

- HA/failover totalmente automático com detecção de morte de host < segundos.
- Redis (fica para uma rodada futura; PG cobre tudo por enquanto).
- Balanceamento de carga inteligente entre hosts (qualquer host elegível serve).
- Migração de sessão em andamento entre hosts (uma sessão roda inteira num host).

## 4. Pré-requisito: tornar o estado dinâmico 100% PG (stateless)

O claim atômico só é seguro se **nenhum** estado dinâmico ficar preso no FS de um
host. Hoje ainda há pontos stateful-FS — este é o trabalho de base.

### Inventário do estado dinâmico ainda em FS local

| # | Estado | Hoje | Gap | Alvo |
|---|--------|------|-----|------|
| 1 | Heartbeat | ✅ via `state_heartbeat_*` (PG) | resolvido (#51) | — |
| 2 | Docs de estado (`current_objective`, `decisions`, `completed_tasks`, `semantic`) | **WRITE**: commands instruem o LLM a editar `.md` no FS direto. **READ**: já via `state_doc_get` (PG) | **split-brain ativo**: writes pós-cutover vão pro FS e não são lidos de volta no pg | commands escrevem via `state_doc_set`/`append` |
| 3 | Memória episódica | escrita via `lib/memory.sh` (→ `state_episodic_append`?); **leitura** `tail episodic.jsonl` do FS (`agent-cron.sh:269`) | leitura ignora o PG | ler via `state_episodic_*` |
| 4 | Handoffs (ciclo inbox→in_progress→archive) | arquivos `.md` movidos no FS; descoberta por `for f in inbox/HO-*.md` | trabalho não cruza hosts; estado por máquina | descoberta e ciclo via `state_handoff_*` (PG) |
| 5 | Locks de concorrência | `/tmp/agents-workflow/*.lock` (`lib/lock.sh`, `check_concurrency.sh`, `job.sh`) | local; não coordena cross-host | lock no PG (advisory/lease) |
| 6 | Idle markers | `IDLE_DIR` no FS local | local | PG (ou Redis futuro) |
| 7 | Jobs | `state_job_*` existe; confirmar se o cron lê do PG | a verificar | via `state_job_*` (PG) |
| 8 | Subsistema evaluator/optimizer | `agents/{evaluator,optimizer}/state` no FS (`lib/evaluate.sh`, `lib/optimize.sh`) | estado FS próprio | avaliar — possível YAGNI nesta rodada |

> **Fronteira estado vs ambiente:** `IDENTITY.md`, `config.yaml`, prompts dos
> commands e skills vêm do **git** — idênticos em todo host, versionados, **não são
> estado dinâmico**. Podem (e devem) continuar em FS. O "stateless" se refere só ao
> dado *gerado em runtime*.

### Evidência do split-brain de docs (investigado 2026-06-02)

Confirmado **ativo** no backend pg. Mecanismo: commands mandam o LLM escrever
`.md` no FS; `build_agent_system_prompt` lê via `state_doc_get` (PG) — os dois só
se encontram numa migração manual.

- 13 docs de estado escritos no FS após o cutover; 8 deles **após** a re-migração
  de recuperação de hoje (11:30) → diverge de novo em horas.
- Prova viva `bugsnag/decisions.md`: FS tem `## 2026-06-02 11:19 UTC — Ciclo 88`
  (745 linhas); PG para em `09:02` (67.788 bytes). A próxima sessão do bugsnag não
  leria o Ciclo 88.
- **Consequência:** a memória de estado (objetivo/decisões/tarefas) fica congelada
  no ponto da última migração — vazamento contínuo de memória, não evento único.

**❓Complicação descoberta — flat vs diário.** `task-manager` tem 3 linhas de
`decisions` no PG (doc_dates distintos) vs 1 arquivo flat no FS. A unificação do
write precisa decidir o mapeamento canônico (flat por agente? rotação diária?) —
ver `_state_file_doc_path` (state.sh) que já bifurca por presença de `doc_date`.

## 5. Arquitetura proposta: claim atômico oportunista

Substituir a guarda local `session_running` (tmux, por-host) por um **claim no PG**.
Reaproveita a tabela `heartbeat` (que o #51 já colocou no PG): adiciona-se a coluna
`owner_host` e trata-se `status='processing' + last_ping recente` como um **lease**.

Antes de spawnar um agente, o cron executa um **compare-and-swap atômico**:

```sql
UPDATE braion.heartbeat
   SET status = 'processing', owner_host = :host, last_ping = now()
 WHERE agent_name = :agent
   AND (status <> 'processing' OR last_ping < now() - :lease_ttl)
RETURNING agent_name;
```

- Retornou linha → **este host ganhou** o claim; pode spawnar a sessão.
- Vazio → outro host já detém o lease → **pula**.

É atômico no banco, então **não há janela TOCTOU**. Enquanto a sessão roda, o
`last_ping` é renovado (o próprio heartbeat já faz isso), mantendo o lease vivo.
Ao terminar, `status` vira `idle`/`awaiting_review` e o lease é liberado.

## 6. Mudanças de schema (esboço)

```sql
ALTER TABLE braion.heartbeat ADD COLUMN owner_host TEXT;  -- qual host detém o lease
-- locks distribuídos (item 5 do inventário):
CREATE TABLE braion.locks (
  resource    TEXT PRIMARY KEY,
  owner_host  TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
```

## 7. Invariantes / garantias

- **I1.** Um agente está em execução em no máximo um host por vez (garantido pelo CAS).
- **I2.** Qualquer host reconstrói 100% do contexto de um agente a partir do PG.
- **I3.** Morte de host não corrompe estado; no pior caso deixa um lease a expirar (§8).

## 8. Questões em aberto

- **❓Q1 — Recuperação de lease sob falha de host.** Se o host que detém o claim
  morre (Mac fecha a tampa, rede cai) no meio de uma sessão, o `last_ping` para de
  renovar e o lease expira após `lease_ttl`. Aí outro host pode reassumir. **Qual
  `lease_ttl`?** (curto = reassume rápido mas arrisca dupla execução se foi só lentidão;
  longo = seguro mas agente fica "preso" mais tempo). E o que fazer com a **sessão
  tmux órfã** + trabalho parcial no host morto quando ele voltar?

- **❓Q2 — Ambiente ausente.** Sem host-affinity, um host pode ganhar o claim de um
  agente cujo ambiente ele não tem (ex.: projeto local que só existe no Mac). Opções:
  (a) aceitar falha graciosa (agente detecta e devolve o claim); (b) **capability
  requirements** — o agente declara o que precisa (`requires: [project:torre-core]`)
  e um host só faz claim se satisfaz (não é pin a host — qualquer host que tenha a
  capability serve). Qual caminho?

- **❓Q3 — Ordem das fases.** Stateless (§4) é pré-requisito do claim útil. Fazer o
  inventário inteiro antes do claim, ou fatiar (ex.: docs + handoffs primeiro, locks
  depois)?

- **❓Q4 — Descoberta de trabalho.** Hoje o gatilho é arquivo no inbox + Obsidian
  inbox local. Com handoffs no PG, como o cron de cada host descobre trabalho novo —
  poll na tabela `handoffs`? E o Obsidian inbox (que é local a cada host)?

- **❓Q5 — Identidade do host.** Como cada host se identifica (`owner_host`)?
  `hostname`? Variável `BRAION_HOST` no `.env`? Importa para diagnóstico e para o
  dashboard mostrar onde cada agente roda.

## 9. Alternativas consideradas

- **Host-affinity (`host: mac|vps|any`) — REJEITADA.** Daria coordenação sem locks
  (conjuntos disjuntos), mas viola a restrição nº2: amarra o agente a um host e
  impede rodar na VPS quando o Mac cai. Mantida aqui só como registro do porquê não.
- **Lock via `pg_advisory_lock` de sessão — descartado.** Advisory lock de sessão é
  liberado quando a conexão psql fecha; o cron abre/fecha conexão por chamada, então
  não sobrevive à sessão tmux longa. Lease em tabela (CAS) é mais adequado.

## 10. Fases incrementais (proposta — sujeita a Q3)

| Fase | Entrega |
|------|---------|
| 0 | Fechar split-brains de estado (docs, episódica, leitura) → estado 100% PG |
| 1 | Handoffs e jobs via PG (descoberta + ciclo de vida) |
| 2 | Claim atômico (CAS no heartbeat + `owner_host`) substituindo `session_running` |
| 3 | Locks distribuídos no PG (substituir `/tmp/agents-workflow`) |
| 4 | (futuro) Redis para efêmeros; capability requirements (Q2) |
