# SSSF recipes for Featherduster application-db

set dotenv-load
set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

# ── Observability & Monitoring ──────────────────────────────────────────────

# Open the trace UI in browser (running at http://localhost:4601 with API on :4600)
obs:
    Start-Process http://localhost:4601

# Observability overview and status
status:
    python adws/observe.py status

# The last 10 runs
sessions:
    python adws/observe.py sessions

# Phase status in sequence: just phases [adw_id]
phases *ARGS:
    python adws/observe.py phases {{ARGS}}

# The live event tail: just tail [adw_id]
tail *ARGS:
    python adws/observe.py tail {{ARGS}}

# What a run has alive right now: just procs [adw_id]
procs *ARGS:
    python adws/observe.py procs {{ARGS}}

# ── Workflows ───────────────────────────────────────────────────────────────

# Run with explicit delivery outcomes: just task <id> <contract.json>
task ID CONTRACT:
    uv run adws/adw_plan_build_verify_fd.py --task-id {{ID}} --delivery-contract "{{CONTRACT}}"

# Run with custom prompt or file: just run requests/task.md --delivery-contract requests/outcomes.json
run *ARGS:
    uv run adws/adw_plan_build_verify_fd.py {{ARGS}}

# List TaskMaster tasks: just tasks [pending | done | proposals]
tasks *ARGS:
    python adws/observe.py tasks {{ARGS}}
