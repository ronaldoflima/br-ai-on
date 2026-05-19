"""
lib/state.py — Camada de abstração de estado dos agentes (versão Python).

Espelha lib/state.sh: dispatcher entre backends ``file`` (default) e ``pg``,
selecionado via ``BRAION_STATE_BACKEND``. Cobre o subconjunto usado pelo
``agent-scheduler.py`` e outros scripts Python.

Interface estável:
    state.shared_kv_get(key) -> dict | list | None
    state.shared_kv_set(key, value)
    state.heartbeat_get(agent) -> dict
    state.heartbeat_set(agent, value: dict)
    state.episodic_append(agent, entry: dict)
    state.log_write(agent, entry: dict)
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = Path(os.environ.get("BRAION_AGENTS_DIR", PROJECT_ROOT / "agents"))
LOGS_DIR = Path(os.environ.get("BRAION_LOGS_DIR", PROJECT_ROOT / "logs"))


def _backend() -> str:
    return os.environ.get("BRAION_STATE_BACKEND", "file")


def _not_impl(op: str) -> None:
    raise NotImplementedError(f"state.py: backend pg ainda não implementado para {op}")


# ---------------------------------------------------------------------------
# Backend: file
# ---------------------------------------------------------------------------

def _file_shared_kv_get(key: str) -> Any:
    f = AGENTS_DIR / "shared" / f"{key}.json"
    if not f.exists():
        return None
    with f.open() as fp:
        return json.load(fp)


def _file_shared_kv_set(key: str, value: Any) -> None:
    f = AGENTS_DIR / "shared" / f"{key}.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    with f.open("w") as fp:
        json.dump(value, fp, indent=2)
        fp.write("\n")


def _file_heartbeat_get(agent: str) -> dict:
    f = AGENTS_DIR / agent / "state" / "heartbeat.json"
    if not f.exists():
        return {}
    with f.open() as fp:
        return json.load(fp)


def _file_heartbeat_set(agent: str, value: dict) -> None:
    f = AGENTS_DIR / agent / "state" / "heartbeat.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    with f.open("w") as fp:
        json.dump(value, fp)


def _file_episodic_append(agent: str, entry: dict) -> None:
    f = AGENTS_DIR / agent / "memory" / "episodic.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    with f.open("a") as fp:
        fp.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _file_log_write(agent: str, entry: dict) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    f = LOGS_DIR / f"{agent}_{date_str}.jsonl"
    with f.open("a") as fp:
        fp.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Backend: pg (via psql subprocess — sem dependência de psycopg)
# ---------------------------------------------------------------------------

import subprocess


def _pg_psql(sql: str) -> str:
    """Executa SQL e devolve stdout limpo. Conexão via env vars do libpq (PGHOST etc) ou PGSERVICE."""
    cmd = ["psql", "--no-psqlrc", "-qAtX", "-v", "ON_ERROR_STOP=1",
           "-c", "SET search_path TO braion;", "-c", sql]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def _pg_ensure_agent(agent: str) -> None:
    _pg_psql(f"INSERT INTO braion.agents(name) VALUES('{agent}') ON CONFLICT DO NOTHING;")


def _pg_shared_kv_get(key: str) -> Any:
    out = _pg_psql(f"SELECT value::text FROM braion.shared_kv WHERE key='{key}';")
    return json.loads(out) if out else None


def _pg_shared_kv_set(key: str, value: Any) -> None:
    val_json = json.dumps(value)
    sql = (f"INSERT INTO braion.shared_kv(key,value) VALUES('{key}', $JSON${val_json}$JSON$::jsonb) "
           f"ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();")
    _pg_psql(sql)


def _pg_heartbeat_get(agent: str) -> dict:
    _pg_ensure_agent(agent)
    out = _pg_psql(f"""
        SELECT jsonb_build_object(
          'last_ping', to_char(last_ping AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'agent', agent_name, 'status', status,
          'waiting_since', CASE WHEN waiting_since IS NULL THEN NULL
                                ELSE to_char(waiting_since AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
          'active_protections', active_protections
        ) || extra
        FROM braion.heartbeat WHERE agent_name='{agent}';""")
    return json.loads(out) if out else {}


def _pg_heartbeat_set(agent: str, value: dict) -> None:
    _pg_ensure_agent(agent)
    val_json = json.dumps(value)
    sql = f"""
        WITH input AS (SELECT $JSON${val_json}$JSON$::jsonb AS j)
        INSERT INTO braion.heartbeat(agent_name, last_ping, status, waiting_since, active_protections, extra)
        SELECT '{agent}',
               COALESCE((j->>'last_ping')::timestamptz, now()),
               COALESCE(j->>'status','idle'),
               NULLIF(j->>'waiting_since','')::timestamptz,
               COALESCE(j->'active_protections','[]'::jsonb),
               (j - 'last_ping' - 'status' - 'waiting_since' - 'active_protections' - 'agent')
        FROM input
        ON CONFLICT (agent_name) DO UPDATE SET
          last_ping=EXCLUDED.last_ping, status=EXCLUDED.status,
          waiting_since=EXCLUDED.waiting_since,
          active_protections=EXCLUDED.active_protections, extra=EXCLUDED.extra;"""
    _pg_psql(sql)


def _pg_episodic_append(agent: str, entry: dict) -> None:
    _pg_ensure_agent(agent)
    val_json = json.dumps(entry, ensure_ascii=False)
    sql = f"""
        WITH input AS (SELECT $JSON${val_json}$JSON$::jsonb AS j)
        INSERT INTO braion.episodic_memory(agent_name, ts, date, action, context, outcome, importance, payload)
        SELECT '{agent}',
               COALESCE((j->>'timestamp')::timestamptz, now()),
               COALESCE((j->>'date')::date, current_date),
               j->>'action', j->>'context', j->>'outcome',
               NULLIF(j->>'importance','')::int,
               (j - 'timestamp' - 'date' - 'action' - 'context' - 'outcome' - 'importance')
        FROM input;"""
    _pg_psql(sql)


def _pg_log_write(agent: str, entry: dict) -> None:
    val_json = json.dumps(entry, ensure_ascii=False)
    sql = f"""
        WITH input AS (SELECT $JSON${val_json}$JSON$::jsonb AS j)
        INSERT INTO braion.logs(ts, agent_name, action, message, prompt_version, status, metadata)
        SELECT COALESCE((j->>'timestamp')::timestamptz, now()),
               '{agent}', j->>'action', j->>'message', j->>'prompt_version', j->>'status',
               COALESCE(j->'metadata','{{}}'::jsonb)
        FROM input;"""
    _pg_psql(sql)


# ---------------------------------------------------------------------------
# Public dispatchers
# ---------------------------------------------------------------------------

def _dispatch(op: str):
    backend = _backend()
    try:
        return globals()[f"_{backend}_{op}"]
    except KeyError as e:
        raise RuntimeError(f"state.py: backend desconhecido '{backend}'") from e


def shared_kv_get(key: str) -> Any:           return _dispatch("shared_kv_get")(key)
def shared_kv_set(key: str, value: Any) -> None: _dispatch("shared_kv_set")(key, value)
def heartbeat_get(agent: str) -> dict:        return _dispatch("heartbeat_get")(agent)
def heartbeat_set(agent: str, value: dict) -> None: _dispatch("heartbeat_set")(agent, value)
def episodic_append(agent: str, entry: dict) -> None: _dispatch("episodic_append")(agent, entry)
def log_write(agent: str, entry: dict) -> None: _dispatch("log_write")(agent, entry)
