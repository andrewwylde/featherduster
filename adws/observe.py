#!/usr/bin/env python3
"""SSSF Observability CLI for Featherduster application-db.

Usage:
    python adws/observe.py sessions          # List recent sessions
    python adws/observe.py phases [adw_id]   # List phases for session (defaults to latest)
    python adws/observe.py tail [adw_id]     # Tail latest trace events
    python adws/observe.py procs [adw_id]    # Active processes
    python adws/observe.py status            # Overall status and UI links
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "adw_data" / "sssf.db"


def get_conn():
    if not DB_PATH.exists():
        print(f"Trace database not found at {DB_PATH}")
        sys.exit(1)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def get_latest_adw_id(conn) -> str | None:
    c = conn.cursor()
    c.execute("SELECT adw_id FROM sessions ORDER BY started_at DESC LIMIT 1")
    row = c.fetchone()
    return row[0] if row else None


def cmd_sessions():
    conn = get_conn()
    c = conn.cursor()
    c.execute(
        "SELECT adw_id, status, substr(request, 1, 50), coalesce(total_tokens, 0), coalesce(total_cost, 0.0), started_at "
        "FROM sessions ORDER BY started_at DESC LIMIT 10"
    )
    rows = c.fetchall()
    print("=" * 80)
    print(f"{'ADW ID':<10} {'STATUS':<9} {'TOKENS':<10} {'COST':<8} {'REQUEST / STARTED'}")
    print("=" * 80)
    for adw_id, status, req, tokens, cost, started_at in rows:
        desc = req if req else (started_at or "")
        print(f"{adw_id:<10} {status:<9} {tokens:<10} ${cost:<7.4f} {desc}")
    print("=" * 80)


def cmd_phases(adw_id: str | None = None):
    conn = get_conn()
    target_id = adw_id or get_latest_adw_id(conn)
    if not target_id:
        print("No sessions found.")
        return
    c = conn.cursor()
    c.execute(
        "SELECT seq, name, kind, owner, status, error, started_at, ended_at "
        "FROM phases WHERE adw_id = ? ORDER BY seq",
        (target_id,),
    )
    rows = c.fetchall()
    print(f"\nPhases for session {target_id}:")
    print("-" * 75)
    print(f"{'#':<3} {'NAME':<15} {'KIND':<8} {'OWNER':<15} {'STATUS':<9} {'ERROR'}")
    print("-" * 75)
    for seq, name, kind, owner, status, error, _, _ in rows:
        err_str = error if error else ""
        print(f"{seq:<3} {name:<15} {kind:<8} {owner:<15} {status:<9} {err_str}")
    print("-" * 75)


def cmd_tail(adw_id: str | None = None, limit: int = 25):
    conn = get_conn()
    target_id = adw_id or get_latest_adw_id(conn)
    if not target_id:
        print("No sessions found.")
        return
    c = conn.cursor()
    c.execute(
        "SELECT rowid, type, name, started_at FROM events WHERE adw_id = ? ORDER BY rowid DESC LIMIT ?",
        (target_id, limit),
    )
    rows = c.fetchall()
    print(f"\nLatest {limit} events for session {target_id}:")
    print("-" * 75)
    for rowid, etype, name, started_at in reversed(rows):
        print(f"[{rowid:>5}] {etype:<12} {name} ({started_at})")
    print("-" * 75)


def cmd_procs(adw_id: str | None = None):
    conn = get_conn()
    target_id = adw_id or get_latest_adw_id(conn)
    if not target_id:
        print("No sessions found.")
        return
    c = conn.cursor()
    c.execute(
        "SELECT kind, name, pid, command, started_at FROM processes "
        "WHERE adw_id = ? AND ended_at IS NULL ORDER BY id",
        (target_id,),
    )
    rows = c.fetchall()
    print(f"\nActive processes for session {target_id}:")
    if not rows:
        print("  (No active child processes)")
    for kind, name, pid, cmd, started_at in rows:
        print(f"  PID {pid} ({kind}/{name}): {cmd} (started {started_at})")


def cmd_status():
    print("\n=== SSSF Observability Status ===")
    print("Visualizer UI:  http://localhost:4601/")
    print("Visualizer API: http://localhost:4600/api/sessions")
    print(f"Database:       {DB_PATH}\n")
    cmd_sessions()


def cmd_tasks(filter_arg: str | None = None):
    tasks_file = Path(__file__).resolve().parent.parent / ".taskmaster" / "tasks" / "tasks.json"
    if not tasks_file.exists():
        print(f"TaskMaster file not found at {tasks_file}")
        return
    with open(tasks_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Determine tag or status filter
    tag = "master"
    status_filter = None
    if filter_arg:
        if filter_arg in data:
            tag = filter_arg
        elif filter_arg.lower() in ("pending", "done", "in-progress", "blocked", "deferred"):
            status_filter = filter_arg.lower()

    tasks = data.get(tag, {}).get("tasks", [])
    if status_filter:
        tasks = [t for t in tasks if t.get("status", "").lower() == status_filter]

    print("\n" + "=" * 80)
    print(f"TASKMASTER TASKS (tag: '{tag}'" + (f", status: '{status_filter}'" if status_filter else "") + ")")
    print("=" * 80)
    print(f"{'ID':<5} {'STATUS':<12} {'PRIORITY':<9} {'TITLE'}")
    print("-" * 80)
    for t in tasks:
        tid = f"#{t.get('id')}"
        status = t.get("status", "pending")
        prio = t.get("priority", "medium")
        title = t.get("title", "")
        print(f"{tid:<5} {status:<12} {prio:<9} {title}")
    print("=" * 80)


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "status"
    target_id = args[1] if len(args) > 1 else None

    if cmd in ("sessions", "list", "ls"):
        cmd_sessions()
    elif cmd in ("phases", "phase"):
        cmd_phases(target_id)
    elif cmd in ("tail", "events", "logs"):
        cmd_tail(target_id)
    elif cmd in ("procs", "ps"):
        cmd_procs(target_id)
    elif cmd in ("tasks", "task"):
        cmd_tasks(target_id)
    elif cmd in ("status", "obs"):
        cmd_status()
    else:
        print(f"Unknown command: {cmd}")
        print("Usage: python adws/observe.py [sessions | phases | tail | procs | tasks | status]")


if __name__ == "__main__":
    main()
