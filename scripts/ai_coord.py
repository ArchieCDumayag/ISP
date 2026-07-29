#!/usr/bin/env python3
"""
Multi-Codex coordination script.

Features:
- Incremental Codex identity registration: codex-1, codex-2, codex-3...
- Activity updates so Codex sessions can see what others are doing.
- File checkout/checkin locking to reduce overlapping edits.
- Adaptive waiting for locked files.
- Git status summaries for awareness.

Run from anywhere inside the Git repo when possible.
"""

import argparse
import csv
import fcntl
import fnmatch
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone


def find_project_root():
    """
    Prefer the Git repo root. Fall back to current working directory.
    """
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        root = result.stdout.strip()
        if result.returncode == 0 and root:
            return root
    except Exception:
        pass

    return os.getcwd()


PROJECT_ROOT = find_project_root()
MODULES_ROOT = os.path.join(PROJECT_ROOT, "Features", "modules")


def find_shared_state_dir():
    """
    Use one coordination state directory across Git worktrees.
    """
    env_state_dir = os.environ.get("AI_COORD_STATE_DIR")
    if env_state_dir:
        return os.path.abspath(os.path.expanduser(env_state_dir))

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=PROJECT_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        common_git_dir = result.stdout.strip()
        if result.returncode == 0 and common_git_dir:
            if not os.path.isabs(common_git_dir):
                common_git_dir = os.path.abspath(os.path.join(PROJECT_ROOT, common_git_dir))
            else:
                common_git_dir = os.path.abspath(common_git_dir)

            main_repo_root = common_git_dir
            if os.path.basename(common_git_dir) == ".git":
                main_repo_root = os.path.dirname(common_git_dir)

            return os.path.join(main_repo_root, ".ai_coord")
    except Exception:
        pass

    return os.path.join(PROJECT_ROOT, ".ai_coord")


STATE_DIR = find_shared_state_dir()
STATE_LOCK = os.path.join(STATE_DIR, "state.lock")

LOCKS_CSV = os.path.join(STATE_DIR, "locks.csv")
ACTIVITY_JSONL = os.path.join(STATE_DIR, "activity.jsonl")
AGENTS_CSV = os.path.join(STATE_DIR, "agents.csv")

LOCK_FIELDS = ["path", "agent", "task", "message", "locked_at"]
AGENT_FIELDS = ["agent", "status", "note", "registered_at", "retired_at"]


def now():
    return datetime.now(timezone.utc).isoformat()


def ensure_state_dir():
    os.makedirs(STATE_DIR, exist_ok=True)


def normalize_path(path):
    """
    Normalize file paths so locks match more reliably.

    Examples:
      ./frontend/App.jsx -> frontend/App.jsx
      /home/archiecd/ISP/public/app.js -> public/app.js
    """
    if not path:
        return ""

    path = path.strip()
    abs_path = os.path.abspath(path)

    try:
        rel = os.path.relpath(abs_path, PROJECT_ROOT)
        if not rel.startswith(".."):
            return os.path.normpath(rel)
    except Exception:
        pass

    return os.path.normpath(path).lstrip("./")


def paths_overlap(first, second):
    """Return True when two exact, parent, or child lock paths overlap."""
    first = normalize_path(first)
    second = normalize_path(second)
    if not first or not second:
        return False
    return (
        first == second
        or first.startswith(second + os.sep)
        or second.startswith(first + os.sep)
    )


def read_module_manifests():
    """Load module ownership metadata used for context-file enforcement."""
    manifests = []
    if not os.path.isdir(MODULES_ROOT):
        return manifests

    for module_name in sorted(os.listdir(MODULES_ROOT)):
        manifest_path = os.path.join(MODULES_ROOT, module_name, "module.json")
        if not os.path.isfile(manifest_path):
            continue
        try:
            with open(manifest_path, encoding="utf-8") as manifest_file:
                manifest = json.load(manifest_file)
            manifest["_manifest_path"] = normalize_path(manifest_path)
            manifests.append(manifest)
        except (OSError, ValueError) as error:
            print(f"WARNING: Could not read {normalize_path(manifest_path)}: {error}")

    return manifests


def module_matches_path(manifest, path):
    normalized = normalize_path(path).replace(os.sep, "/")
    for pattern in manifest.get("ownedPaths", []):
        normalized_pattern = str(pattern).strip().replace("\\", "/")
        if normalized_pattern and fnmatch.fnmatchcase(normalized, normalized_pattern):
            return True
    return False


def validate_module_context_files(files):
    """Require each affected module context file in a task's declared file list."""
    normalized_files = {
        normalize_path(path).replace(os.sep, "/")
        for path in (files or [])
        if path
    }
    missing = []

    for manifest in read_module_manifests():
        context_file = str(manifest.get("contextFile", "")).strip().replace("\\", "/")
        if not context_file:
            continue
        affected = sorted(
            path for path in normalized_files
            if path != context_file and module_matches_path(manifest, path)
        )
        if affected and context_file not in normalized_files:
            missing.append({
                "module": manifest.get("id") or manifest.get("displayName") or "unknown",
                "context": context_file,
                "files": affected,
            })

    return missing


def run_git(args):
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=PROJECT_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def git_summary():
    status = run_git(["status", "--short"])
    changed = run_git(["diff", "--name-only"])
    staged = run_git(["diff", "--cached", "--name-only"])

    return {
        "status": status.splitlines() if status else [],
        "changed_files": changed.splitlines() if changed else [],
        "staged_files": staged.splitlines() if staged else [],
    }


def with_state_lock(fn):
    """
    Prevent multiple Codex terminals from modifying coordination files at the same time.
    """
    ensure_state_dir()

    with open(STATE_LOCK, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)

        try:
            return fn()
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


# ---------------------------------------------------------------------
# Agents / identity registry
# ---------------------------------------------------------------------

def read_agents():
    if not os.path.exists(AGENTS_CSV):
        return []

    with open(AGENTS_CSV, newline="") as f:
        return list(csv.DictReader(f))


def write_agents(rows):
    ensure_state_dir()

    with open(AGENTS_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=AGENT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def agent_number(agent_name):
    if not agent_name.startswith("codex-"):
        return 0

    try:
        return int(agent_name.split("-", 1)[1])
    except Exception:
        return 0


def next_agent_name(rows):
    max_number = 0

    for row in rows:
        max_number = max(max_number, agent_number(row.get("agent", "")))

    return f"codex-{max_number + 1}"


def is_agent_active(agent_name):
    rows = read_agents()

    for row in rows:
        if row.get("agent") == agent_name and row.get("status") == "active":
            return True

    return False


def require_active_agent(agent_name):
    if is_agent_active(agent_name):
        return True

    print("UNKNOWN OR INACTIVE AGENT")
    print(f"Agent: {agent_name}")
    print()
    print("Register this Codex first:")
    print('python3 scripts/ai_coord.py register "describe this Codex session"')
    return False


# ---------------------------------------------------------------------
# Locks
# ---------------------------------------------------------------------

def read_locks():
    if not os.path.exists(LOCKS_CSV):
        return []

    with open(LOCKS_CSV, newline="") as f:
        return list(csv.DictReader(f))


def write_locks(rows):
    ensure_state_dir()

    with open(LOCKS_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=LOCK_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


# ---------------------------------------------------------------------
# Activity feed
# ---------------------------------------------------------------------

def write_activity(event):
    ensure_state_dir()
    event["time"] = now()

    with open(ACTIVITY_JSONL, "a") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def read_activity(limit=20):
    if not os.path.exists(ACTIVITY_JSONL):
        return []

    with open(ACTIVITY_JSONL, "r") as f:
        lines = f.readlines()[-limit:]

    events = []

    for line in lines:
        try:
            events.append(json.loads(line))
        except Exception:
            pass

    return events


def log_event(event_type, agent, task, message, files=None):
    write_activity({
        "type": event_type,
        "agent": agent,
        "task": task,
        "message": message,
        "files": files or [],
        "git_summary": git_summary(),
    })


# ---------------------------------------------------------------------
# Printing helpers
# ---------------------------------------------------------------------

def print_agents(rows):
    if not rows:
        print("No Codex agents registered yet.")
        return

    print("Registered Codex agents:")

    for row in rows:
        print(
            f"- {row.get('agent')} | {row.get('status')} | "
            f"{row.get('note')} | registered: {row.get('registered_at')} | "
            f"retired: {row.get('retired_at')}"
        )


def print_locks(rows):
    if not rows:
        print("No active file locks.")
        return

    print("Active file locks:")

    for row in rows:
        print(
            f"- {row.get('path')} | {row.get('agent')} | "
            f"{row.get('task')} | {row.get('message')} | {row.get('locked_at')}"
        )


def print_activity(events):
    if not events:
        print("No AI activity yet.")
        return

    print("Recent AI activity:")

    for event in events:
        print("=" * 80)
        print(f"Time:  {event.get('time')}")
        print(f"Agent: {event.get('agent')}")
        print(f"Type:  {event.get('type')}")
        print(f"Task:  {event.get('task', '')}")

        if event.get("message"):
            print(f"Note:  {event.get('message')}")

        files = event.get("files") or []
        if files:
            print("Files:")
            for file in files:
                print(f"  - {file}")

        git_data = event.get("git_summary") or {}
        changed_files = git_data.get("changed_files") or []
        staged_files = git_data.get("staged_files") or []

        if changed_files:
            print("Git changed files at time of update:")
            for file in changed_files:
                print(f"  - {file}")

        if staged_files:
            print("Git staged files at time of update:")
            for file in staged_files:
                print(f"  - {file}")


# ---------------------------------------------------------------------
# Commands: status / recent / locks / agents
# ---------------------------------------------------------------------

def cmd_status(args):
    def action():
        print(f"Project root: {PROJECT_ROOT}")
        print()

        print("Git status:")
        print("-" * 80)
        status = run_git(["status", "--short"])
        print(status if status else "Working tree clean.")

        print()
        print_agents(read_agents())

        print()
        print_locks(read_locks())

        print()
        print_activity(read_activity(args.limit))

        return 0

    return with_state_lock(action)


def cmd_recent(args):
    def action():
        print_activity(read_activity(args.limit))
        return 0

    return with_state_lock(action)


def cmd_locks(args):
    def action():
        print_locks(read_locks())
        return 0

    return with_state_lock(action)


def cmd_agents(args):
    def action():
        print_agents(read_agents())
        return 0

    return with_state_lock(action)


def cmd_modules(args):
    manifests = read_module_manifests()
    if not manifests:
        print("No module manifests found under Features/modules.")
        return 1

    print("Project modules:")
    for manifest in manifests:
        print(
            f"- {manifest.get('id')} | {manifest.get('displayName')} | "
            f"context: {manifest.get('contextFile')}"
        )
    return 0


def cmd_check_context(args):
    missing = validate_module_context_files(args.files)
    if not missing:
        print("MODULE CONTEXT CHECK PASSED")
        return 0

    print("MODULE CONTEXT UPDATE REQUIRED")
    for item in missing:
        print(f"- Module: {item['module']}")
        print(f"  Add to --files: {item['context']}")
        print("  Affected files:")
        for path in item["files"]:
            print(f"    - {path}")
    return 2


# ---------------------------------------------------------------------
# Commands: identity
# ---------------------------------------------------------------------

def cmd_register(args):
    def action():
        rows = read_agents()
        agent = next_agent_name(rows)

        rows.append({
            "agent": agent,
            "status": "active",
            "note": args.note,
            "registered_at": now(),
            "retired_at": "",
        })

        write_agents(rows)

        log_event(
            "REGISTER",
            agent,
            "identity",
            f"Registered new Codex identity: {agent}. Note: {args.note}",
            [],
        )

        print("REGISTERED")
        print(f"Agent: {agent}")
        print()
        print("Use this identity for all future commands in this Codex terminal.")
        return 0

    return with_state_lock(action)


def cmd_retire(args):
    def action():
        if not require_active_agent(args.agent):
            return 1

        rows = read_agents()
        found = False

        for row in rows:
            if row.get("agent") == args.agent:
                found = True
                row["status"] = "retired"
                row["retired_at"] = now()

        if not found:
            print("AGENT NOT FOUND")
            print(f"Agent: {args.agent}")
            return 1

        active_locks = [
            row for row in read_locks()
            if row.get("agent") == args.agent
        ]

        write_agents(rows)

        log_event(
            "RETIRE",
            args.agent,
            "identity",
            f"Retired Codex identity: {args.agent}",
            [],
        )

        print("RETIRED")
        print(f"Agent: {args.agent}")
        print("This identity will not be reused for new Codex sessions.")

        if active_locks:
            print()
            print("WARNING: This agent still has active file locks:")
            for lock in active_locks:
                print(f"- {lock.get('path')} | {lock.get('task')}")

            print()
            print("Recommended cleanup:")
            print(f'python3 scripts/ai_coord.py unlock-task {args.agent} "<task-name>"')
            print("or use force-unlock for specific files if this was intentional.")

        return 0

    return with_state_lock(action)


# ---------------------------------------------------------------------
# Commands: activity updates
# ---------------------------------------------------------------------

def cmd_start(args):
    def action():
        if not require_active_agent(args.agent):
            return 1

        log_event("START", args.agent, args.task, args.message, args.files)

        print(f"START logged for {args.agent}: {args.task}")
        return 0

    return with_state_lock(action)


def cmd_update(args):
    def action():
        if not require_active_agent(args.agent):
            return 1

        log_event("UPDATE", args.agent, args.task, args.message, args.files)

        print(f"UPDATE logged for {args.agent}: {args.task}")
        return 0

    return with_state_lock(action)


def cmd_done(args):
    def action():
        if not require_active_agent(args.agent):
            return 1

        missing_context = validate_module_context_files(args.files)
        if missing_context:
            print("MODULE CONTEXT UPDATE REQUIRED")
            print("Update each Module_context.md and include it in --files before marking done.")
            for item in missing_context:
                print(f"- {item['module']}: {item['context']}")
            return 2

        log_event("DONE", args.agent, args.task, args.message, args.files)

        print(f"DONE logged for {args.agent}: {args.task}")

        remaining_locks = [
            row for row in read_locks()
            if row.get("agent") == args.agent and row.get("task") == args.task
        ]

        if remaining_locks:
            print()
            print("WARNING: This task still has active locks:")
            for row in remaining_locks:
                print(f"- {row.get('path')}")

            print()
            print("Release them with:")
            print(f'python3 scripts/ai_coord.py unlock-task {args.agent} "{args.task}"')

        return 0

    return with_state_lock(action)


# ---------------------------------------------------------------------
# Commands: lock / unlock
# ---------------------------------------------------------------------

def cmd_lock(args):
    path = normalize_path(args.path)

    def action():
        if not require_active_agent(args.agent):
            return 1

        rows = read_locks()

        for row in rows:
            existing_path = normalize_path(row.get("path", ""))

            if paths_overlap(existing_path, path):
                if row.get("agent") == args.agent:
                    print("ALREADY COVERED BY YOUR LOCK")
                    print(f"Requested: {path}")
                    print(f"Existing:  {row.get('path')}")
                    print(f"Agent: {args.agent}")
                    print(f"Task:  {row.get('task')}")
                    return 0

                print("LOCKED BY ANOTHER AGENT")
                print(f"Requested: {path}")
                print(f"Locked:    {row.get('path')}")
                print(f"Agent:  {row.get('agent')}")
                print(f"Task:   {row.get('task')}")
                print(f"Reason: {row.get('message')}")
                print(f"Since:  {row.get('locked_at')}")
                return 2

        rows.append({
            "path": path,
            "agent": args.agent,
            "task": args.task,
            "message": args.message,
            "locked_at": now(),
        })

        write_locks(rows)

        log_event(
            "LOCK",
            args.agent,
            args.task,
            f"Checked out {path}: {args.message}",
            [path],
        )

        print("CHECKED OUT")
        print(f"File:  {path}")
        print(f"Agent: {args.agent}")
        print(f"Task:  {args.task}")
        return 0

    return with_state_lock(action)


def cmd_unlock(args):
    path = normalize_path(args.path)

    def action():
        if not require_active_agent(args.agent):
            return 1

        rows = read_locks()
        kept = []
        removed = []

        for row in rows:
            same_file = normalize_path(row.get("path", "")) == path
            same_agent = row.get("agent") == args.agent

            if same_file and same_agent:
                removed.append(row)
            else:
                kept.append(row)

        if not removed:
            print("NO MATCHING LOCK FOUND")
            print(f"File:  {path}")
            print(f"Agent: {args.agent}")
            return 1

        write_locks(kept)

        for row in removed:
            log_event(
                "UNLOCK",
                args.agent,
                row.get("task", ""),
                f"Checked in {path}",
                [path],
            )

        print("CHECKED IN")
        print(f"File:  {path}")
        print(f"Agent: {args.agent}")
        return 0

    return with_state_lock(action)


def cmd_unlock_task(args):
    def action():
        if not require_active_agent(args.agent):
            return 1

        rows = read_locks()
        kept = []
        removed = []

        for row in rows:
            if row.get("agent") == args.agent and row.get("task") == args.task:
                removed.append(row)
            else:
                kept.append(row)

        if not removed:
            print("NO LOCKS FOUND FOR TASK")
            print(f"Agent: {args.agent}")
            print(f"Task:  {args.task}")
            return 1

        write_locks(kept)

        files = [row.get("path") for row in removed]

        log_event(
            "UNLOCK_TASK",
            args.agent,
            args.task,
            "Checked in all files for task",
            files,
        )

        print(f"CHECKED IN {len(files)} FILE(S)")
        for file in files:
            print(f"- {file}")

        return 0

    return with_state_lock(action)


def cmd_force_unlock(args):
    """
    Recovery command.

    This does not require an active agent because it may be needed when a Codex
    session crashed or was retired while still holding locks.
    """
    path = normalize_path(args.path)

    def action():
        rows = read_locks()
        kept = []
        removed = []

        for row in rows:
            if normalize_path(row.get("path", "")) == path:
                removed.append(row)
            else:
                kept.append(row)

        if not removed:
            print("NO LOCK FOUND")
            print(f"File: {path}")
            return 1

        write_locks(kept)

        log_event(
            "FORCE_UNLOCK",
            args.agent,
            "manual-recovery",
            f"Force unlocked {path}",
            [path],
        )

        print("FORCE UNLOCKED")
        print(f"File: {path}")
        print(f"By:   {args.agent}")

        if removed:
            print("Previous lock owner(s):")
            for row in removed:
                print(f"- {row.get('agent')} | {row.get('task')} | {row.get('message')}")

        return 0

    return with_state_lock(action)


# ---------------------------------------------------------------------
# Command: wait-lock
# ---------------------------------------------------------------------

def try_lock_once(path, agent, task, message, from_wait=False):
    rows = read_locks()

    for row in rows:
        existing_path = normalize_path(row.get("path", ""))

        if paths_overlap(existing_path, path):
            if row.get("agent") == agent:
                print("ALREADY COVERED BY YOUR LOCK")
                print(f"Requested: {path}")
                print(f"Existing:  {row.get('path')}")
                print(f"Agent: {agent}")
                print(f"Task:  {row.get('task')}")
                return 0

            print("STILL LOCKED")
            print(f"File:   {row.get('path')}")
            print(f"Agent:  {row.get('agent')}")
            print(f"Task:   {row.get('task')}")
            print(f"Reason: {row.get('message')}")
            print(f"Since:  {row.get('locked_at')}")
            return 2

    rows.append({
        "path": path,
        "agent": agent,
        "task": task,
        "message": message,
        "locked_at": now(),
    })

    write_locks(rows)

    event_message = (
        f"Wait completed. Checked out {path}: {message}"
        if from_wait
        else f"Checked out {path}: {message}"
    )

    log_event("LOCK", agent, task, event_message, [path])

    print("CHECKED OUT")
    print(f"File:  {path}")
    print(f"Agent: {agent}")
    print(f"Task:  {task}")
    return 0


def cmd_wait_lock(args):
    path = normalize_path(args.path)

    print(f"Waiting for file to become available: {path}")
    print(f"Agent: {args.agent}")
    print(f"Task:  {args.task}")
    print(f"Check interval: {args.interval} seconds")
    print(f"Timeout: {'none' if args.timeout == 0 else str(args.timeout) + ' seconds'}")
    print()

    waited = 0
    waiting_event_logged = False

    while True:
        def action():
            if not require_active_agent(args.agent):
                return 1

            nonlocal waiting_event_logged

            if not waiting_event_logged:
                log_event(
                    "WAITING",
                    args.agent,
                    args.task,
                    f"Waiting for {path}: {args.message}",
                    [path],
                )
                waiting_event_logged = True

            return try_lock_once(
                path=path,
                agent=args.agent,
                task=args.task,
                message=args.message,
                from_wait=True,
            )

        result = with_state_lock(action)

        if result == 0:
            return 0

        if result == 1:
            return 1

        waited += args.interval

        if args.timeout > 0 and waited >= args.timeout:
            def timeout_action():
                log_event(
                    "WAIT_TIMEOUT",
                    args.agent,
                    args.task,
                    f"Timed out waiting for {path} after {waited} seconds.",
                    [path],
                )
                return 0

            with_state_lock(timeout_action)

            print("TIMEOUT")
            print(f"Could not check out {path} after {waited} seconds.")
            return 2

        time.sleep(args.interval)
        print()


# ---------------------------------------------------------------------
# Main CLI
# ---------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Multi-Codex coordination: identity + activity updates + file checkout/checkin."
    )

    sub = parser.add_subparsers(dest="command")

    # Status / viewing commands
    p = sub.add_parser("status", help="Show Git status, registered agents, active locks, and recent activity.")
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("recent", help="Show recent AI activity.")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_recent)

    p = sub.add_parser("locks", help="Show active file locks.")
    p.set_defaults(func=cmd_locks)

    p = sub.add_parser("agents", help="Show registered Codex agents.")
    p.set_defaults(func=cmd_agents)

    p = sub.add_parser("modules", help="Show module ownership manifests and context files.")
    p.set_defaults(func=cmd_modules)

    p = sub.add_parser("check-context", help="Verify that affected module context files are included.")
    p.add_argument("--files", nargs="+", required=True)
    p.set_defaults(func=cmd_check_context)

    # Identity commands
    p = sub.add_parser("register", help="Register a new Codex session and receive the next incremental identity.")
    p.add_argument("note")
    p.set_defaults(func=cmd_register)

    p = sub.add_parser("retire", help="Retire an active Codex identity. Retired names are not reused.")
    p.add_argument("agent")
    p.set_defaults(func=cmd_retire)

    # Activity commands
    p = sub.add_parser("start", help="Announce the start of a task.")
    p.add_argument("agent")
    p.add_argument("task")
    p.add_argument("message")
    p.add_argument("--files", nargs="*")
    p.set_defaults(func=cmd_start)

    p = sub.add_parser("update", help="Post a progress update.")
    p.add_argument("agent")
    p.add_argument("task")
    p.add_argument("message")
    p.add_argument("--files", nargs="*")
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("done", help="Announce task completion.")
    p.add_argument("agent")
    p.add_argument("task")
    p.add_argument("message")
    p.add_argument("--files", nargs="*")
    p.set_defaults(func=cmd_done)

    # Locking commands
    p = sub.add_parser("lock", help="Check out / lock a file before editing.")
    p.add_argument("path")
    p.add_argument("agent")
    p.add_argument("task")
    p.add_argument("message")
    p.set_defaults(func=cmd_lock)

    p = sub.add_parser("unlock", help="Check in / unlock a file after editing.")
    p.add_argument("path")
    p.add_argument("agent")
    p.set_defaults(func=cmd_unlock)

    p = sub.add_parser("unlock-task", help="Check in / unlock all files held by an agent for a task.")
    p.add_argument("agent")
    p.add_argument("task")
    p.set_defaults(func=cmd_unlock_task)

    p = sub.add_parser("wait-lock", help="Wait until a file becomes available, then automatically lock it.")
    p.add_argument("path")
    p.add_argument("agent")
    p.add_argument("task")
    p.add_argument("message")
    p.add_argument("--interval", type=int, default=30)
    p.add_argument("--timeout", type=int, default=0)
    p.set_defaults(func=cmd_wait_lock)

    p = sub.add_parser("force-unlock", help="Recovery command to forcibly unlock a file.")
    p.add_argument("path")
    p.add_argument("agent")
    p.set_defaults(func=cmd_force_unlock)

    args = parser.parse_args()

    if not hasattr(args, "func"):
        parser.print_help()
        return 1

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
