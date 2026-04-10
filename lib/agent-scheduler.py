#!/usr/bin/env python3
"""
agent-scheduler.py — Determina quais agentes devem ser iniciados pelo cron.

Uso:
  python3 lib/agent-scheduler.py
      → JSON com agentes due/waiting/inactive/budget_blocked

  python3 lib/agent-scheduler.py --mark-ran agent1 agent2 ...
      → Atualiza schedule_state.json e incrementa contadores de budget

Modos de schedule (config.yaml → schedule.mode):
  alive        — cron inicia o agente quando intervalo expira
  handoff-only — agente só acorda via handoff ou inbox (default)
  disabled     — agente nunca é iniciado automaticamente
"""

import json
import os
import sys
import glob
from datetime import datetime, timezone, timedelta

try:
    import yaml
except ImportError:
    print(json.dumps({"error": "pyyaml não instalado — pip install pyyaml"}))
    sys.exit(1)

BRAION_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEDULE_STATE_FILE = os.path.join(BRAION_BASE, "agents", "shared", "schedule_state.json")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

VALID_MODES = {"alive", "handoff-only", "disabled"}


def parse_interval(interval_str):
    s = str(interval_str).strip()
    if s.endswith("s"):
        return int(s[:-1])
    if s.endswith("m"):
        return int(s[:-1]) * 60
    if s.endswith("h"):
        return int(s[:-1]) * 3600
    if s.endswith("d"):
        return int(s[:-1]) * 86400
    return int(s)


def read_schedule_state():
    if not os.path.exists(SCHEDULE_STATE_FILE):
        return {}
    with open(SCHEDULE_STATE_FILE) as f:
        return json.load(f)


def write_schedule_state(state):
    with open(SCHEDULE_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
        f.write("\n")


def read_budget_count(agent_name, today_str):
    path = f"/tmp/agent-{agent_name}-sessions-{today_str}.count"
    if not os.path.exists(path):
        return 0, path
    try:
        with open(path) as f:
            return int(f.read().strip() or "0"), path
    except (ValueError, OSError):
        return 0, path


def increment_budget_count(agent_name, today_str):
    count, path = read_budget_count(agent_name, today_str)
    with open(path, "w") as f:
        f.write(str(count + 1))


def load_configs():
    pattern = os.path.join(BRAION_BASE, "agents", "*", "config.yaml")
    configs = []
    for path in sorted(glob.glob(pattern)):
        with open(path) as f:
            try:
                cfg = yaml.safe_load(f)
                if cfg and isinstance(cfg, dict):
                    configs.append(cfg)
            except yaml.YAMLError:
                pass
    return configs


def resolve_mode(sched):
    mode = sched.get("mode")
    if mode and mode in VALID_MODES:
        return mode
    if sched.get("enabled") is True:
        return "alive"
    if sched.get("enabled") is False:
        return "handoff-only"
    return "handoff-only"


def compute_schedule(configs, schedule_state, now):
    today_str = now.strftime("%Y-%m-%d")

    due = []
    waiting = []
    inactive = []
    budget_blocked = []

    for cfg in configs:
        name = cfg.get("name", "")
        sched = cfg.get("schedule", {})
        mode = resolve_mode(sched)

        if mode == "disabled":
            inactive.append({
                "name": name,
                "domain": cfg.get("domain", ""),
                "mode": "disabled",
                "reason": "disabled",
            })
            continue

        if mode == "handoff-only":
            inactive.append({
                "name": name,
                "domain": cfg.get("domain", ""),
                "mode": "handoff-only",
                "reason": "handoff-only",
            })
            continue

        interval_str = sched.get("interval", "1h")
        interval_s = parse_interval(interval_str)
        priority = sched.get("priority", 99)
        run_alone = sched.get("run_alone", False)
        directory = cfg.get("directory", BRAION_BASE)

        last_run_str = schedule_state.get(name, "1970-01-01T00:00:00Z")
        try:
            last_run = datetime.fromisoformat(last_run_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            last_run = EPOCH

        elapsed_s = int((now - last_run).total_seconds())
        next_run = last_run + timedelta(seconds=interval_s)
        remaining_s = max(0, interval_s - elapsed_s)

        budget_cfg = cfg.get("budget", {})
        max_sessions = budget_cfg.get("max_sessions_per_day", 999)
        used_today, count_file = read_budget_count(name, today_str)
        budget_info = {
            "max_sessions_per_day": max_sessions,
            "used_today": used_today,
            "remaining": max(0, max_sessions - used_today),
            "count_file": count_file,
        }

        obsidian_cfg = cfg.get("integrations", {}).get("obsidian", {})
        obsidian_info = None
        if obsidian_cfg.get("enabled"):
            obsidian_info = {
                "inbox": obsidian_cfg.get("inbox", "agents/inbox"),
                "identity": obsidian_cfg.get("identity", f"🤖 {name}"),
            }

        model = cfg.get("model", "claude-sonnet-4-6")
        fallback_model = cfg.get("fallback_model", "claude-haiku-4-5")

        permission_mode = cfg.get("permission_mode", "acceptEdits")

        base_entry = {
            "name": name,
            "domain": cfg.get("domain", ""),
            "mode": "alive",
            "priority": priority,
            "run_alone": run_alone,
            "interval": interval_str,
            "interval_s": interval_s,
            "last_run": last_run_str,
            "next_run": next_run.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "directory": directory,
            "model": model,
            "fallback_model": fallback_model,
            "command": cfg.get("command", ""),
            "permission_mode": permission_mode,
            "budget": budget_info,
        }
        if obsidian_info:
            base_entry["obsidian"] = obsidian_info

        is_due = elapsed_s >= interval_s

        if is_due:
            if used_today >= max_sessions:
                budget_blocked.append({**base_entry, "elapsed_s": elapsed_s})
            else:
                due.append({**base_entry, "elapsed_s": elapsed_s})
        else:
            waiting.append({**base_entry, "remaining_s": remaining_s})

    due.sort(key=lambda x: x["priority"])
    waiting.sort(key=lambda x: x["remaining_s"])

    return due, waiting, inactive, budget_blocked


def cmd_status():
    now = datetime.now(timezone.utc)
    configs = load_configs()
    schedule_state = read_schedule_state()

    due, waiting, inactive, budget_blocked = compute_schedule(configs, schedule_state, now)

    total = len(due) + len(waiting) + len(inactive) + len(budget_blocked)
    result = {
        "now_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "summary": {
            "total": total,
            "due": len(due),
            "waiting": len(waiting),
            "inactive": len(inactive),
            "budget_blocked": len(budget_blocked),
        },
        "due": due,
        "waiting": waiting,
        "inactive": inactive,
        "budget_blocked": budget_blocked,
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))


def cmd_mark_ran(agent_names):
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    now_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    state = read_schedule_state()
    updated = []
    errors = []

    for name in agent_names:
        config_path = os.path.join(BRAION_BASE, "agents", name, "config.yaml")
        if not os.path.exists(config_path):
            errors.append(f"config não encontrado para: {name}")
            continue
        state[name] = now_str
        increment_budget_count(name, today_str)
        updated.append(name)

    write_schedule_state(state)
    print(json.dumps({"updated": updated, "errors": errors, "timestamp": now_str}, indent=2))


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--mark-ran":
        agents = args[1:]
        if not agents:
            print(json.dumps({"error": "--mark-ran requer ao menos um nome de agente"}))
            sys.exit(1)
        cmd_mark_ran(agents)
    else:
        cmd_status()
