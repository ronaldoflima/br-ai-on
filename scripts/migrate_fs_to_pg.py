#!/usr/bin/env python3
"""
migrate_fs_to_pg.py — Migra estado em arquivos para Postgres (schema `braion`).

Idempotente: usa ON CONFLICT DO UPDATE. Pode rodar várias vezes sem efeitos
colaterais. Não apaga arquivos — apenas espelha para o PG.

Pré-requisitos:
  - psql disponível no PATH
  - Conexão configurada via PGHOST/PGUSER/PGPASSWORD/PGDATABASE ou PGSERVICE
  - Schema aplicado (db/schema.sql)

Uso:
  python3 scripts/migrate_fs_to_pg.py [--dry-run] [--root <BR.AI.ON path>]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DOC_TYPES_DAILY = {"current_objective", "decisions", "completed_tasks"}
DOC_TYPES_FLAT_STATE = {"notebooklm_sources", "last_commit"}


def psql(sql: str, dry: bool = False) -> str:
    if dry:
        print(f"-- DRY: {sql[:120].replace(chr(10),' ')}...")
        return ""
    cmd = ["psql", "--no-psqlrc", "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"PSQL ERR: {r.stderr.strip()}", file=sys.stderr)
        print(f"  sql:    {sql[:200]}", file=sys.stderr)
        raise SystemExit(2)
    return r.stdout.strip()


def quote(s: str) -> str:
    return s.replace("'", "''")


def dollar(s: str, tag: str = "X") -> str:
    # Choose a tag not appearing in s
    t = tag
    while f"${t}$" in s:
        t = t + "x"
    return f"${t}${s}${t}$"


def upsert_agent(name: str, dry: bool) -> None:
    psql(f"INSERT INTO braion.agents(name) VALUES('{quote(name)}') ON CONFLICT DO NOTHING;", dry)


def migrate_heartbeat(agent: str, agent_dir: Path, dry: bool) -> int:
    f = agent_dir / "state" / "heartbeat.json"
    if not f.exists():
        return 0
    data = json.loads(f.read_text())
    j = dollar(json.dumps(data), "HB")
    psql(f"""
        WITH input AS (SELECT {j}::jsonb AS j)
        INSERT INTO braion.heartbeat(agent_name, last_ping, status, waiting_since, active_protections, extra)
        SELECT '{quote(agent)}',
               COALESCE((j->>'last_ping')::timestamptz, now()),
               COALESCE(j->>'status','idle'),
               NULLIF(j->>'waiting_since','')::timestamptz,
               COALESCE(j->'active_protections','[]'::jsonb),
               (j - 'last_ping' - 'status' - 'waiting_since' - 'active_protections' - 'agent')
        FROM input
        ON CONFLICT (agent_name) DO UPDATE SET
          last_ping=EXCLUDED.last_ping, status=EXCLUDED.status,
          waiting_since=EXCLUDED.waiting_since,
          active_protections=EXCLUDED.active_protections, extra=EXCLUDED.extra;
    """, dry)
    return 1


def migrate_doc(agent: str, doc_type: str, doc_date: str | None, content: str, dry: bool) -> None:
    date_sql = f"'{doc_date}'" if doc_date else "NULL"
    body = dollar(content, "DOC")
    psql(f"""
        INSERT INTO braion.agent_documents(agent_name, doc_type, doc_date, content)
        VALUES('{quote(agent)}','{doc_type}',{date_sql}, {body})
        ON CONFLICT (agent_name, doc_type, doc_date) DO UPDATE SET content=EXCLUDED.content, updated_at=now();
    """, dry)


def migrate_documents(agent: str, agent_dir: Path, dry: bool) -> int:
    n = 0
    state_dir = agent_dir / "state"
    if not state_dir.exists():
        return 0
    # Daily-rotated subdirs
    for t in DOC_TYPES_DAILY:
        sub = state_dir / t
        if sub.is_dir():
            for f in sorted(sub.glob("*.md")):
                date = f.stem  # YYYY-MM-DD
                migrate_doc(agent, t, date, f.read_text(), dry)
                n += 1
        # Flat fallback (older agents)
        flat = state_dir / f"{t}.md"
        if flat.exists():
            migrate_doc(agent, t, None, flat.read_text(), dry)
            n += 1
    # Other flat state docs
    for t in DOC_TYPES_FLAT_STATE:
        flat = state_dir / f"{t}.md"
        if flat.exists():
            migrate_doc(agent, t, None, flat.read_text(), dry)
            n += 1
    # Semantic memory
    sem = agent_dir / "memory" / "semantic.md"
    if sem.exists():
        migrate_doc(agent, "semantic_memory", None, sem.read_text(), dry)
        n += 1
    return n


def migrate_episodic(agent: str, agent_dir: Path, dry: bool) -> int:
    f = agent_dir / "memory" / "episodic.jsonl"
    if not f.exists():
        return 0
    n = 0
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        j = dollar(line, "EP")
        psql(f"""
            WITH input AS (SELECT {j}::jsonb AS j)
            INSERT INTO braion.episodic_memory(agent_name, ts, date, action, context, outcome, importance, payload)
            SELECT '{quote(agent)}',
                   COALESCE((j->>'timestamp')::timestamptz, now()),
                   COALESCE((j->>'date')::date, current_date),
                   j->>'action', j->>'context', j->>'outcome',
                   NULLIF(j->>'importance','')::int,
                   (j - 'timestamp' - 'date' - 'action' - 'context' - 'outcome' - 'importance')
            FROM input
            WHERE NOT EXISTS (
              SELECT 1 FROM braion.episodic_memory
              WHERE agent_name='{quote(agent)}'
                AND ts = COALESCE((j->>'timestamp')::timestamptz, now())
                AND action = j->>'action'
            );
        """, dry)
        n += 1
    return n


def migrate_cache(agent: str, agent_dir: Path, dry: bool) -> int:
    cache_dir = agent_dir / "state" / "cache"
    if not cache_dir.exists():
        return 0
    n = 0
    for f in cache_dir.glob("*.json"):
        key = f.stem
        try:
            data = json.loads(f.read_text())
        except json.JSONDecodeError:
            continue
        value = data.get("result", data)
        ttl = data.get("ttl_seconds", 300)
        cached_at = data.get("cached_at", 0)
        # expires_at = cached_at + ttl
        expires = f"to_timestamp({cached_at + ttl})" if cached_at else "now() + interval '5 minutes'"
        v = dollar(json.dumps(value), "CV")
        psql(f"""
            INSERT INTO braion.cache_kv(agent_name, key, value, expires_at)
            VALUES('{quote(agent)}','{quote(key)}',{v}::jsonb,{expires})
            ON CONFLICT (agent_name, key) DO UPDATE SET value=EXCLUDED.value, expires_at=EXCLUDED.expires_at;
        """, dry)
        n += 1
    return n


HANDOFF_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)
FIELD_RE = re.compile(r"^(\w+):\s*(.*)$", re.MULTILINE)


def parse_handoff(path: Path) -> tuple[dict, str] | None:
    txt = path.read_text()
    m = HANDOFF_FRONTMATTER_RE.match(txt)
    if not m:
        return None
    fm_block, body = m.group(1), m.group(2).lstrip("\n")
    fields = {}
    for fm in FIELD_RE.finditer(fm_block):
        fields[fm.group(1)] = fm.group(2).strip()
    return fields, body


def migrate_handoffs(agent: str, agent_dir: Path, dry: bool) -> tuple[int, int]:
    handoffs_dir = agent_dir / "handoffs"
    if not handoffs_dir.exists():
        return (0, 0)
    n_ho = 0
    n_art = 0
    for status_dir, status in (("inbox", "pending"), ("in_progress", "in_progress"), ("archive", "archived")):
        d = handoffs_dir / status_dir
        if not d.exists():
            continue
        for f in sorted(d.glob("HO-*.md")):
            parsed = parse_handoff(f)
            if not parsed:
                continue
            fm, body = parsed
            ho_id = fm.get("id", f.stem.split("_")[0])
            from_a = fm.get("from", "")
            to_a = fm.get("to", agent)
            created = fm.get("created", "")
            expects = fm.get("expects", "")
            reply_to = fm.get("reply_to", "")
            thread_id = fm.get("thread_id", "")
            job_id = fm.get("job_id", "")

            reply_sql = "NULL" if not reply_to or reply_to == "null" else f"'{quote(reply_to)}'"
            thread_sql = "NULL" if not thread_id else f"'{quote(thread_id)}'"
            job_sql = "NULL" if not job_id else f"'{quote(job_id)}'"
            created_sql = f"'{quote(created)}'::timestamptz" if created else "now()"
            archived_sql = "now()" if status == "archived" else "NULL"
            body_dol = dollar(body, "BO")

            psql(f"""
                INSERT INTO braion.handoffs(id, from_agent, to_agent, created_at, status, expects, reply_to, thread_id, job_id, body, archived_at)
                VALUES('{quote(ho_id)}','{quote(from_a)}','{quote(to_a)}',{created_sql},'{status}','{quote(expects)}',{reply_sql},{thread_sql},{job_sql},{body_dol},{archived_sql})
                ON CONFLICT (id) DO UPDATE SET
                  status=EXCLUDED.status, expects=EXCLUDED.expects,
                  body=EXCLUDED.body, archived_at=EXCLUDED.archived_at;
            """, dry)
            n_ho += 1

            # Artefatos
            art_dir = handoffs_dir / "artifacts" / ho_id
            if art_dir.is_dir():
                for af in art_dir.iterdir():
                    if af.is_file():
                        try:
                            content = af.read_text()
                        except UnicodeDecodeError:
                            continue
                        c_dol = dollar(content, "AR")
                        psql(f"""
                            INSERT INTO braion.handoff_artifacts(handoff_id, name, content)
                            VALUES('{quote(ho_id)}','{quote(af.name)}',{c_dol})
                            ON CONFLICT (handoff_id, name) DO UPDATE SET content=EXCLUDED.content;
                        """, dry)
                        n_art += 1
    return (n_ho, n_art)


def migrate_jobs(agents_dir: Path, dry: bool) -> int:
    jobs_dir = agents_dir / "shared" / "jobs"
    if not jobs_dir.exists():
        return 0
    n = 0
    for archived, sub in ((False, jobs_dir), (True, jobs_dir / "archive")):
        if not sub.exists():
            continue
        for f in sub.glob("JOB-*.json"):
            try:
                d = json.loads(f.read_text())
            except json.JSONDecodeError:
                continue
            archived_sql = "now()" if archived else "NULL"
            expected = dollar(json.dumps(d.get("expected", [])), "EX")
            completed = dollar(json.dumps(d.get("completed", [])), "CO")
            failed = dollar(json.dumps(d.get("failed", [])), "FL")
            desc = dollar(d.get("description", ""), "DE")
            psql(f"""
                INSERT INTO braion.jobs(id, thread_id, description, created_by, created_at, status, expected, completed, failed, result_summary, archived_at)
                VALUES('{quote(d.get("id",""))}',
                       {('NULL' if not d.get('thread_id') else "'" + quote(d['thread_id']) + "'")},
                       {desc}, '{quote(d.get("created_by",""))}',
                       '{quote(d.get("created","1970-01-01T00:00:00Z"))}'::timestamptz,
                       '{quote(d.get("status","pending"))}',
                       {expected}::jsonb, {completed}::jsonb, {failed}::jsonb,
                       {('NULL' if d.get('result_summary') is None else dollar(d['result_summary'], 'RS'))},
                       {archived_sql})
                ON CONFLICT (id) DO UPDATE SET
                  status=EXCLUDED.status, completed=EXCLUDED.completed, failed=EXCLUDED.failed,
                  result_summary=EXCLUDED.result_summary, archived_at=EXCLUDED.archived_at;
            """, dry)
            n += 1
    return n


def migrate_shared_kv(agents_dir: Path, dry: bool) -> int:
    shared = agents_dir / "shared"
    if not shared.exists():
        return 0
    n = 0
    for f in shared.glob("*.json"):
        if f.parent.name != "shared":
            continue
        key = f.stem
        try:
            v = json.loads(f.read_text())
        except json.JSONDecodeError:
            continue
        val = dollar(json.dumps(v), "SV")
        psql(f"""
            INSERT INTO braion.shared_kv(key, value) VALUES('{quote(key)}',{val}::jsonb)
            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
        """, dry)
        n += 1
    return n


def migrate_logs(logs_dir: Path, dry: bool) -> int:
    if not logs_dir.exists():
        return 0
    n = 0
    for f in sorted(logs_dir.glob("*.jsonl")):
        # filename pattern: <agent>_<date>.jsonl
        stem = f.stem
        if "_" not in stem:
            continue
        agent, _ = stem.rsplit("_", 1)
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                _ = json.loads(line)
            except json.JSONDecodeError:
                continue
            j = dollar(line, "LG")
            psql(f"""
                WITH input AS (SELECT {j}::jsonb AS j)
                INSERT INTO braion.logs(ts, agent_name, action, message, prompt_version, status, metadata)
                SELECT COALESCE((j->>'timestamp')::timestamptz, now()),
                       '{quote(agent)}', j->>'action', j->>'message', j->>'prompt_version', j->>'status',
                       COALESCE(j->'metadata','{{}}'::jsonb)
                FROM input
                WHERE NOT EXISTS (
                  SELECT 1 FROM braion.logs
                  WHERE agent_name='{quote(agent)}'
                    AND ts = COALESCE((j->>'timestamp')::timestamptz, now())
                    AND action = j->>'action'
                    AND message = j->>'message'
                );
            """, dry)
            n += 1
    return n


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--root", default=str(Path(__file__).resolve().parent.parent),
                   help="Raiz do projeto br-ai-on (padrão: pai do scripts/).")
    args = p.parse_args()

    root = Path(args.root)
    agents_dir = root / "agents"
    logs_dir = root / "logs"

    if not agents_dir.exists():
        print(f"agents/ não encontrado em {root}", file=sys.stderr)
        sys.exit(1)

    totals = {"agents": 0, "heartbeats": 0, "docs": 0, "episodic": 0, "cache": 0,
              "handoffs": 0, "artifacts": 0, "jobs": 0, "shared_kv": 0, "logs": 0}

    for entry in sorted(agents_dir.iterdir()):
        if entry.name in {"shared", "forwarded", "_defaults"}:
            continue
        if not (entry / "config.yaml").exists():
            continue
        agent = entry.name
        upsert_agent(agent, args.dry_run)
        totals["agents"] += 1
        totals["heartbeats"] += migrate_heartbeat(agent, entry, args.dry_run)
        totals["docs"] += migrate_documents(agent, entry, args.dry_run)
        totals["episodic"] += migrate_episodic(agent, entry, args.dry_run)
        totals["cache"] += migrate_cache(agent, entry, args.dry_run)
        ho, art = migrate_handoffs(agent, entry, args.dry_run)
        totals["handoffs"] += ho
        totals["artifacts"] += art

    totals["jobs"] += migrate_jobs(agents_dir, args.dry_run)
    totals["shared_kv"] += migrate_shared_kv(agents_dir, args.dry_run)
    totals["logs"] += migrate_logs(logs_dir, args.dry_run)

    print(json.dumps({"dry_run": args.dry_run, "root": str(root), "totals": totals}, indent=2))


if __name__ == "__main__":
    main()
