from __future__ import annotations

import contextlib
import io
import json
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from app.core.database import WORKSPACES_DIR, get_connection, is_database_locked, with_db_retry

ACTIVE_RUN_STATUSES = {"queued", "running", "stopping"}
RUN_HISTORY_PER_DATE_LIMIT = 10
RUN_HISTORY_LIST_LIMIT = 500
RUN_HISTORY_TIMEZONE = timezone(timedelta(hours=8))
SCANNED_ACTIVITY_PATTERN = re.compile(r"scan|candidate|accepted|processed|routed|destination|upload|success|matched", re.I)
SKIPPED_ACTIVITY_PATTERN = re.compile(r"skip|reject|excluded|invalid|failed|unknown|unmatched|unmapped", re.I)
RUNNER_HEARTBEAT_ACTIVE_SECONDS = 15


class WorkflowStopped(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_json_object(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        value = json.loads(raw)
        if isinstance(value, dict):
            return value
    return {}


def init_runner_tables() -> None:
    WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                stop_requested INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                result_json TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS run_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                node_id TEXT,
                node_label TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS run_node_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                node_id TEXT NOT NULL,
                node_label TEXT,
                status TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                stdout TEXT,
                error TEXT,
                result_json TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS runner_heartbeat (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL,
                last_heartbeat TEXT NOT NULL
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_runs_project_created ON runs(project_id, created_at DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_runs_project_status_created ON runs(project_id, status, created_at DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_run_logs_run_id_id ON run_logs(run_id, id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_run_node_results_run_node ON run_node_results(run_id, node_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_run_node_results_run_label ON run_node_results(run_id, node_label)")


def get_project_workspace(project_id: int) -> Path:
    path = WORKSPACES_DIR / f"project_{project_id}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_workspace_path(project_id: int, relative_path: str | Path) -> Path:
    root = get_project_workspace(project_id).resolve()
    target = (root / Path(str(relative_path))).resolve()
    if not _is_relative_to(target, root):
        raise ValueError("Path traversal outside the project workspace is blocked")
    return target


def resolve_local_path(path: str | Path) -> Path:
    return Path(str(path)).expanduser().resolve()


def resolve_input_path(project_id: int, path: str | Path, source_type: str = "workspace") -> Path:
    if source_type == "workspace":
        candidate = Path(str(path))
        if candidate.is_absolute():
            return resolve_local_path(candidate)
        return resolve_workspace_path(project_id, candidate)
    if source_type == "local_path":
        return resolve_local_path(path)
    if source_type in {"url", "cloud"}:
        raise ValueError(f"{source_type} sources are not implemented yet")
    raise ValueError(f"Unsupported source type: {source_type}")


def row_to_run(row: sqlite3.Row, *, include_result: bool = True) -> dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "status": row["status"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "stop_requested": bool(row["stop_requested"]),
        "error": row["error"],
        "result": json.loads(row["result_json"]) if include_result and row["result_json"] else None,
    }


def run_history_date(created_at: str | None) -> str:
    if not created_at:
        return "unknown"
    try:
        return datetime.fromisoformat(created_at).astimezone(RUN_HISTORY_TIMEZONE).date().isoformat()
    except ValueError:
        return created_at[:10]


def queue_project_run(project_id: int) -> dict[str, Any]:
    init_runner_tables()
    timestamp = now_iso()
    with get_connection() as connection:
        active = connection.execute(
            """
            SELECT id FROM runs
            WHERE project_id = ? AND status IN ('queued', 'running', 'stopping')
            ORDER BY created_at DESC LIMIT 1
            """,
            (project_id,),
        ).fetchone()
        if active is not None:
            raise RuntimeError("Workflow already has an active queued or running job")
        cursor = connection.execute(
            """
            INSERT INTO runs (project_id, status, created_at, stop_requested)
            VALUES (?, 'queued', ?, 0)
            """,
            (project_id, timestamp),
        )
        run_id = cursor.lastrowid
        connection.execute(
            """
            INSERT INTO run_logs (run_id, created_at, level, message)
            VALUES (?, ?, 'info', 'Run queued')
            """,
            (run_id, timestamp),
        )
    return fetch_run(run_id)


def fetch_run(run_id: int) -> dict[str, Any] | None:
    init_runner_tables()
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    return row_to_run(row) if row else None


def fetch_latest_project_run(project_id: int) -> dict[str, Any] | None:
    init_runner_tables()
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
    return row_to_run(row) if row else None


def list_project_runs(
    project_id: int,
    limit: int = RUN_HISTORY_LIST_LIMIT,
    *,
    include_result: bool = True,
) -> list[dict[str, Any]]:
    init_runner_tables()
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
            (project_id, limit),
        ).fetchall()
    return [row_to_run(row, include_result=include_result) for row in rows]


def prune_project_run_history(project_id: int, per_date_limit: int = RUN_HISTORY_PER_DATE_LIMIT) -> int:
    """Keep all run rows for analytics, but trim heavy details after the newest runs per local date."""
    init_runner_tables()
    if per_date_limit < 1:
        return 0

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, created_at
            FROM runs
            WHERE project_id = ?
              AND status NOT IN ('queued', 'running', 'stopping')
            ORDER BY created_at DESC, id DESC
            """,
            (project_id,),
        ).fetchall()

        date_counts: dict[str, int] = {}
        prune_detail_ids: list[int] = []
        for row in rows:
            run_date = run_history_date(row["created_at"])
            date_counts[run_date] = date_counts.get(run_date, 0) + 1
            if date_counts[run_date] > per_date_limit:
                prune_detail_ids.append(row["id"])

        if not prune_detail_ids:
            return 0

        placeholders = ",".join("?" for _ in prune_detail_ids)
        connection.execute(f"DELETE FROM run_logs WHERE run_id IN ({placeholders})", prune_detail_ids)
        connection.execute(f"DELETE FROM run_node_results WHERE run_id IN ({placeholders})", prune_detail_ids)
        connection.execute(
            f"UPDATE runs SET result_json = NULL WHERE id IN ({placeholders})",
            prune_detail_ids,
        )
        return len(prune_detail_ids)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _run_duration_seconds(row: sqlite3.Row) -> float | None:
    started = _parse_datetime(row["started_at"]) or _parse_datetime(row["created_at"])
    finished = _parse_datetime(row["finished_at"])
    if not started or not finished:
        return None
    seconds = (finished - started).total_seconds()
    return seconds if seconds >= 0 else None


def _dashboard_day_label(created_at: str | None) -> str:
    parsed = _parse_datetime(created_at)
    if not parsed:
        return "Unknown date"
    local_date = parsed.astimezone(RUN_HISTORY_TIMEZONE)
    return local_date.strftime("%b %d").replace(" 0", " ")


def _collect_arrays(value: Any, pattern: re.Pattern[str], key: str = "") -> list[Any]:
    if not isinstance(value, (dict, list)):
        return []
    if isinstance(value, list):
        return value if pattern.search(key) else []
    collected: list[Any] = []
    for child_key, child_value in value.items():
        collected.extend(_collect_arrays(child_value, pattern, child_key))
    return collected


def _count_file_activity(result: Any) -> dict[str, int]:
    if not isinstance(result, dict):
        return {"scanned": 0, "skipped": 0}
    node_results = result.get("results") if isinstance(result.get("results"), list) else []
    scanned = 0
    skipped = 0
    for node in node_results:
        payload = node.get("result") if isinstance(node, dict) else None
        if not isinstance(payload, dict):
            continue
        summary_rows = []
        for key in ("skipped_extension_summary", "unknown_extension_summary"):
            if isinstance(payload.get(key), list):
                summary_rows.extend(payload[key])
        skipped += sum(int(item.get("count") or 0) for item in summary_rows if isinstance(item, dict))
        scanned += len(_collect_arrays(payload, SCANNED_ACTIVITY_PATTERN))
        skipped += len(_collect_arrays(payload, SKIPPED_ACTIVITY_PATTERN))
    return {"scanned": scanned, "skipped": skipped}


def _count_file_activity_from_summary(summary: Any) -> dict[str, int] | None:
    if not isinstance(summary, dict):
        return None
    raw = summary.get("raw") if isinstance(summary.get("raw"), dict) else {}
    if raw:
        scanned = raw.get("total_scanned") or raw.get("total_candidates") or raw.get("total_files")
        skipped = raw.get("total_skipped") or raw.get("total_not_processed") or 0
        try:
            return {"scanned": int(scanned or 0), "skipped": int(skipped or 0)}
        except (TypeError, ValueError):
            return {"scanned": 0, "skipped": 0}

    metrics = summary.get("metrics") if isinstance(summary.get("metrics"), list) else []
    values: dict[str, int] = {}
    for metric in metrics:
        if not isinstance(metric, dict):
            continue
        label = str(metric.get("label") or "").strip().lower()
        try:
            values[label] = int(metric.get("value") or 0)
        except (TypeError, ValueError):
            values[label] = 0
    if values:
        return {
            "scanned": values.get("total scanned") or values.get("total candidates") or values.get("total files") or 0,
            "skipped": values.get("total skipped") or values.get("total not processed") or 0,
        }

    return None


def get_project_run_analytics(project_id: int, limit: int = 5000) -> dict[str, Any]:
    init_runner_tables()
    today_key = datetime.now(RUN_HISTORY_TIMEZONE).date().isoformat()
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                runs.id,
                runs.project_id,
                runs.status,
                runs.created_at,
                runs.started_at,
                runs.finished_at,
                final_node.result_json AS final_summary_json
            FROM runs
            LEFT JOIN run_node_results AS final_node
              ON final_node.run_id = runs.id
             AND final_node.node_label = 'Final Summary'
            WHERE runs.project_id = ?
              AND runs.finished_at IS NOT NULL
            ORDER BY runs.created_at DESC
            LIMIT ?
            """,
            (project_id, limit),
        ).fetchall()

    completed_count = 0
    today_count = 0
    status_counts = {"success": 0, "error": 0, "stopped": 0}
    today_status_counts = {"success": 0, "error": 0, "stopped": 0}
    runtime_total = 0.0
    runtime_count = 0
    slowest_run: dict[str, Any] | None = None
    day_groups: dict[str, dict[str, Any]] = {}
    total_file_activity = {"scanned": 0, "skipped": 0}

    for row in rows:
        completed_count += 1
        status = row["status"]
        if status in status_counts:
            status_counts[status] += 1
        day_key = run_history_date(row["created_at"])
        is_today = day_key == today_key
        if is_today:
            today_count += 1
            if status in today_status_counts:
                today_status_counts[status] += 1

        if day_key not in day_groups:
            day_groups[day_key] = {
                "key": day_key,
                "label": _dashboard_day_label(row["created_at"]),
                "run_count": 0,
                "runtime_count": 0,
                "runtime_total": 0.0,
                "scanned": 0,
                "skipped": 0,
            }
        group = day_groups[day_key]
        group["run_count"] += 1

        duration = _run_duration_seconds(row)
        if status == "success" and duration is not None:
            runtime_total += duration
            runtime_count += 1
            group["runtime_total"] += duration
            group["runtime_count"] += 1
            if slowest_run is None or duration > slowest_run["duration_seconds"]:
                slowest_run = {
                    "id": row["id"],
                    "created_at": row["created_at"],
                    "duration_seconds": duration,
                }

        final_summary = json.loads(row["final_summary_json"]) if row["final_summary_json"] else None
        activity = _count_file_activity_from_summary(final_summary)
        if activity is None:
            activity = {"scanned": 0, "skipped": 0}
        group["scanned"] += activity["scanned"]
        group["skipped"] += activity["skipped"]
        total_file_activity["scanned"] += activity["scanned"]
        total_file_activity["skipped"] += activity["skipped"]

    ordered_groups = list(reversed(list(day_groups.values())))
    for group in ordered_groups:
        group["average_runtime_seconds"] = (
            group["runtime_total"] / group["runtime_count"] if group["runtime_count"] else 0
        )
        del group["runtime_total"]
        del group["runtime_count"]

    busiest_day = max(ordered_groups, key=lambda item: item["run_count"], default=None)
    active_file_days = sum(1 for item in ordered_groups if item["scanned"] or item["skipped"]) or 1

    return {
        "active_file_days": active_file_days,
        "average_success_runtime_seconds": runtime_total / runtime_count if runtime_count else 0,
        "busiest_day": busiest_day,
        "completed_runs_count": completed_count,
        "day_groups": ordered_groups,
        "slowest_success_run": slowest_run,
        "status_counts": status_counts,
        "today_runs_count": today_count,
        "today_status_counts": today_status_counts,
        "total_file_activity": total_file_activity,
    }


def has_active_project_run(project_id: int) -> bool:
    init_runner_tables()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id FROM runs
            WHERE project_id = ? AND status IN ('queued', 'running', 'stopping')
            LIMIT 1
            """,
            (project_id,),
        ).fetchone()
    return row is not None


def fetch_run_logs(run_id: int) -> list[dict[str, Any]]:
    init_runner_tables()
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM run_logs WHERE run_id = ? ORDER BY id ASC",
            (run_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def row_to_node_result(row: sqlite3.Row) -> dict[str, Any]:
    result = json.loads(row["result_json"]) if row["result_json"] else None
    return {
        "id": row["id"],
        "run_id": row["run_id"],
        "node_id": row["node_id"],
        "node_label": row["node_label"],
        "label": row["node_label"],
        "status": row["status"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "stdout": row["stdout"] or "",
        "error": row["error"],
        "result": _enrich_result_from_artifacts(result),
    }


def compact_node_result_for_run(node_result: dict[str, Any]) -> dict[str, Any]:
    return {
        "node_id": node_result.get("node_id"),
        "label": node_result.get("label"),
        "status": node_result.get("status"),
        "error": node_result.get("error"),
        "started_at": node_result.get("started_at"),
        "finished_at": node_result.get("finished_at"),
    }


def fetch_run_snapshot(run_id: int, after_log_id: int = 0) -> dict[str, Any] | None:
    run = fetch_run(run_id)
    if run is None:
        return None
    init_runner_tables()
    with get_connection() as connection:
        logs = connection.execute(
            "SELECT * FROM run_logs WHERE run_id = ? AND id > ? ORDER BY id ASC",
            (run_id, after_log_id),
        ).fetchall()
        node_rows = connection.execute(
            "SELECT * FROM run_node_results WHERE run_id = ? ORDER BY id ASC",
            (run_id,),
        ).fetchall()
    return {
        "run": run,
        "logs": [dict(row) for row in logs],
        "nodes": [row_to_node_result(row) for row in node_rows],
    }


def _safe_read_json_file(path_value: Any) -> Any:
    if not path_value:
        return None
    try:
        path = Path(str(path_value)).expanduser().resolve()
        if not path.exists() or not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _artifact_file_name(value: Any) -> str:
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return "unknown file"
    for key in ("file_name", "filename", "name", "path", "source_path", "local_path", "gcs_path", "file_path"):
        if value.get(key):
            return str(value[key])
    return "unknown file"


def _artifact_extension(value: Any) -> str:
    if isinstance(value, dict) and value.get("extension"):
        return str(value["extension"]).lower()
    suffix = Path(_artifact_file_name(value)).suffix.lower()
    return suffix or "no extension"


def _artifact_reason(value: Any, fallback: str) -> str:
    if not isinstance(value, dict):
        return fallback
    for key in ("reason", "skip_reason", "unknown_reason", "error", "message", "category", "status_reason"):
        if value.get(key):
            return str(value[key])
    return fallback


def _summarize_file_artifact(items: Any, fallback_reason: str) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    groups: dict[str, dict[str, Any]] = {}
    for item in items:
        extension = _artifact_extension(item)
        reason = _artifact_reason(item, fallback_reason)
        group_key = f"{reason}|{extension}"
        if group_key not in groups:
            groups[group_key] = {
                "reason": reason,
                "extension": extension,
                "count": 0,
                "example": _artifact_file_name(item),
            }
        groups[group_key]["count"] += 1
    return list(groups.values())


def _enrich_result_from_artifacts(result: Any) -> Any:
    if not isinstance(result, dict):
        return result
    enriched = dict(result)
    artifact_source = result.get("raw") if isinstance(result.get("raw"), dict) else result
    skipped_items = _safe_read_json_file(artifact_source.get("skipped_file"))
    unknown_items = _safe_read_json_file(artifact_source.get("unknown_file") or artifact_source.get("unknown_files_file"))
    if isinstance(skipped_items, list):
        target = enriched["raw"] if isinstance(enriched.get("raw"), dict) else enriched
        target["skipped_extension_summary"] = _summarize_file_artifact(skipped_items, "Skipped by configured rules")
    if isinstance(unknown_items, list):
        target = enriched["raw"] if isinstance(enriched.get("raw"), dict) else enriched
        target["unknown_extension_summary"] = _summarize_file_artifact(unknown_items, "Could not match configured rules or reference data")
    return enriched


def fetch_run_nodes(run_id: int) -> list[dict[str, Any]]:
    init_runner_tables()
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM run_node_results WHERE run_id = ? ORDER BY id ASC",
            (run_id,),
        ).fetchall()
    return [row_to_node_result(row) for row in rows]


def request_run_stop(run_id: int) -> dict[str, Any] | None:
    init_runner_tables()
    prune_project_id: int | None = None
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            return None
        status = row["status"]
        if status == "queued":
            connection.execute(
                """
                UPDATE runs
                SET stop_requested = 1, status = 'stopped', finished_at = ?, result_json = ?
                WHERE id = ?
                """,
                (
                    now_iso(),
                    json.dumps(
                        {
                            "project_id": row["project_id"],
                            "run_id": run_id,
                            "status": "stopped",
                            "ran_at": now_iso(),
                            "results": [],
                        }
                    ),
                    run_id,
                ),
            )
            connection.execute(
                """
                INSERT INTO run_logs (run_id, created_at, level, message)
                VALUES (?, ?, 'warning', 'Queued run stopped before runner picked it up')
                """,
                (run_id, now_iso()),
            )
            prune_project_id = row["project_id"]
        elif status == "running":
            status = "stopping"
            connection.execute(
                "UPDATE runs SET stop_requested = 1, status = ? WHERE id = ?",
                (status, run_id),
            )
    if prune_project_id is not None:
        prune_project_run_history(prune_project_id)
    return fetch_run(run_id)


def cancel_active_project_run(project_id: int, reason: str = "Run cleared because the runner service is offline") -> dict[str, Any]:
    init_runner_tables()
    latest_run = fetch_latest_project_run(project_id)
    if latest_run is None or latest_run["status"] not in ACTIVE_RUN_STATUSES:
        return {"status": "idle", "project_id": project_id}

    run_id = latest_run["id"]
    timestamp = now_iso()
    result_payload = {
        "project_id": project_id,
        "run_id": run_id,
        "status": "stopped",
        "ran_at": timestamp,
        "results": [],
    }
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE runs
            SET stop_requested = 1, status = 'stopped', finished_at = ?, error = ?, result_json = ?
            WHERE id = ?
            """,
            (timestamp, reason, json.dumps(result_payload), run_id),
        )
        connection.execute(
            """
            INSERT INTO run_logs (run_id, created_at, level, message)
            VALUES (?, ?, 'warning', ?)
            """,
            (run_id, timestamp, reason),
        )
    prune_project_run_history(project_id)
    return fetch_run(run_id) or result_payload


def write_runner_heartbeat(status: str = "active") -> None:
    for attempt in range(5):
        try:
            with get_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO runner_heartbeat (id, status, last_heartbeat)
                    VALUES (1, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET status = excluded.status, last_heartbeat = excluded.last_heartbeat
                    """,
                    (status, now_iso()),
                )
            return
        except sqlite3.OperationalError as exc:
            if not is_database_locked(exc):
                raise
            if attempt == 4:
                return
            time.sleep(0.2 * (attempt + 1))


def get_runner_status() -> dict[str, Any]:
    init_runner_tables()
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM runner_heartbeat WHERE id = 1").fetchone()
        active_run_count = connection.execute(
            "SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued', 'running', 'stopping')"
        ).fetchone()["count"]
    if row is None:
        return {
            "status": "unknown",
            "active": False,
            "active_run_count": active_run_count,
            "heartbeat_active": False,
            "last_heartbeat": None,
        }
    heartbeat = datetime.fromisoformat(row["last_heartbeat"]).astimezone(timezone.utc)
    is_stopped = row["status"] == "stopped"
    heartbeat_active = (
        not is_stopped
        and (datetime.now(timezone.utc) - heartbeat).total_seconds() < RUNNER_HEARTBEAT_ACTIVE_SECONDS
    )
    status = row["status"] if heartbeat_active else "offline"
    return {
        "status": status,
        "active": heartbeat_active,
        "active_run_count": active_run_count,
        "heartbeat_active": heartbeat_active,
        "last_heartbeat": row["last_heartbeat"],
    }


@contextlib.contextmanager
def node_execution_heartbeat(interval_seconds: float = 5.0):
    stop_event = threading.Event()

    def pulse() -> None:
        write_runner_heartbeat("active")
        while not stop_event.wait(interval_seconds):
            write_runner_heartbeat("active")

    thread = threading.Thread(target=pulse, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop_event.set()
        thread.join(timeout=1)
        write_runner_heartbeat("active")


def ordered_nodes(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])
    node_by_id = {node["id"]: node for node in nodes}
    incoming = {node["id"]: 0 for node in nodes}
    outgoing: dict[str, list[str]] = {node["id"]: [] for node in nodes}

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source not in node_by_id or target not in node_by_id:
            raise ValueError("Workflow has an edge with an unknown node")
        incoming[target] += 1
        outgoing[source].append(target)

    queue = [node_id for node_id, count in incoming.items() if count == 0]
    result: list[dict[str, Any]] = []
    while queue:
        node_id = queue.pop(0)
        result.append(node_by_id[node_id])
        for target in outgoing[node_id]:
            incoming[target] -= 1
            if incoming[target] == 0:
                queue.append(target)

    if len(result) != len(nodes):
        raise ValueError("Workflow contains a cycle")
    return result


def upstream_node_ids(workflow: dict[str, Any]) -> dict[str, set[str]]:
    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])
    node_ids = {node["id"] for node in nodes}
    direct_parents: dict[str, set[str]] = {node["id"]: set() for node in nodes}
    upstream: dict[str, set[str]] = {node["id"]: set() for node in nodes}

    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source in node_ids and target in node_ids:
            direct_parents[target].add(source)

    for node in ordered_nodes(workflow):
        node_id = node["id"]
        for parent_id in direct_parents[node_id]:
            upstream[node_id].add(parent_id)
            upstream[node_id].update(upstream[parent_id])

    return upstream


def context_for_node(node_id: str, upstream: dict[str, set[str]], completed: dict[str, dict[str, Any]]) -> dict[str, Any]:
    context: dict[str, Any] = {}
    for upstream_id in upstream.get(node_id, set()):
        entry = completed.get(upstream_id)
        if not entry:
            continue
        context[upstream_id] = entry
        label = entry.get("label")
        if label:
            context[label] = entry
    return context


def add_run_log(
    run_id: int,
    message: str,
    *,
    level: str = "info",
    node_id: str | None = None,
    node_label: str | None = None,
) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO run_logs (run_id, created_at, level, message, node_id, node_label)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (run_id, now_iso(), level, message, node_id, node_label),
        )


def _safe_log_value(key: str, value: Any) -> str:
    if any(part in key.lower() for part in ("credential", "password", "secret", "token", "key")):
        return "set, hidden" if value else "not set"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value[:12]) or "none"
    if isinstance(value, dict):
        return f"{len(value)} fields"
    if value in (None, ""):
        return "not set"
    text = str(value)
    return text if len(text) <= 160 else f"{text[:157]}..."


def _add_config_summary_log(run_id: int, node_id: str, node_label: str, config: dict[str, Any]) -> None:
    if not config:
        add_run_log(run_id, "Settings used: no custom settings configured", node_id=node_id, node_label=node_label)
        return
    summary = ", ".join(
        f"{key}: {_safe_log_value(key, value)}"
        for key, value in list(config.items())[:14]
    )
    add_run_log(run_id, f"Settings used: {summary}", node_id=node_id, node_label=node_label)


def _add_input_summary_log(
    run_id: int,
    node_id: str,
    node_label: str,
    node_context: dict[str, dict[str, Any]],
) -> None:
    if not node_context:
        add_run_log(run_id, "Inputs: this node has no upstream script inputs", node_id=node_id, node_label=node_label)
        return
    labels = [entry.get("label") or entry.get("id") for entry in node_context.values()]
    add_run_log(
        run_id,
        f"Inputs: received outputs from {', '.join(str(label) for label in labels if label)}",
        node_id=node_id,
        node_label=node_label,
    )


def _count_result_items(value: Any) -> str | None:
    if isinstance(value, list):
        return f"{len(value)} item{'s' if len(value) != 1 else ''}"
    if isinstance(value, dict):
        count_parts: list[str] = []
        for key, item in value.items():
            if isinstance(item, list):
                count_parts.append(f"{key}: {len(item)}")
        return ", ".join(count_parts[:8]) if count_parts else f"{len(value)} fields"
    return None


def _friendly_result_label(value: str) -> str:
    return value.replace("_", " ").replace(".", " ").title()


def _is_result_metadata_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_").replace(" ", "_")
    return normalized in {
        "id",
        "run_id",
        "node_id",
        "node_label",
        "label",
        "status",
        "started_at",
        "finished_at",
        "created_at",
        "updated_at",
        "project_id",
        "schema_version",
    }


def _collect_result_metrics(value: Any, path: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    hidden_keys = {"filename_date", "content_date", "content_digit_candidates", "branch_text_candidates"}
    if path and (path[-1] in hidden_keys or _is_result_metadata_key(path[-1])):
        return []
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [{"label": _friendly_result_label(".".join(path) or "value"), "value": value}]
    if isinstance(value, list):
        return [{"label": _friendly_result_label(".".join(path) or "items"), "value": len(value)}]
    if not isinstance(value, dict):
        return []

    metrics: list[dict[str, Any]] = []
    for key, item in value.items():
        if key in hidden_keys or _is_result_metadata_key(key):
            continue
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            metrics.append({"label": _friendly_result_label(key), "value": item})
        elif isinstance(item, list):
            metrics.append({"label": _friendly_result_label(key), "value": len(item)})
        elif isinstance(item, dict):
            metrics.extend(_collect_result_metrics(item, (*path, key)))
        if len(metrics) >= 12:
            break
    return metrics[:12]


def _example_item(label: str, count: int, example: str, reason: str | None = None) -> dict[str, Any]:
    return {
        "count": count,
        "items": [example] if example else [],
        "label": label,
        "reason": reason,
    }


def _build_node_result_contract(
    node_label: str,
    status: str,
    config: dict[str, Any],
    result: Any,
    error: str | None,
) -> dict[str, Any]:
    metrics = _collect_result_metrics(result)
    examples: list[dict[str, Any]] = []
    warnings: list[str] = []
    errors = [error] if error else []

    if isinstance(result, dict):
        valid_extensions = {str(item).lower() for item in config.get("valid_extensions", []) if item}
        if valid_extensions:
            extension_groups: dict[str, dict[str, Any]] = {}
            for item in _file_like_arrays(result):
                extension = _file_extension(_file_name(item))
                if extension in valid_extensions:
                    continue
                if extension not in extension_groups:
                    extension_groups[extension] = {"count": 0, "example": _file_name(item)}
                extension_groups[extension]["count"] += 1
            for extension, details in extension_groups.items():
                label = f"Not scanned {extension}"
                examples.append(_example_item(label, details["count"], details["example"], "Extension is not allowed"))
                warnings.append(f"{details['count']} {extension} file(s) were not scanned because the extension is not allowed.")

        skipped_items = _result_arrays(result, lambda key: any(word in key.lower() for word in ("skip", "reject", "excluded", "invalid")))
        unknown_items = _result_arrays(result, lambda key: any(word in key.lower() for word in ("unknown", "unmatched", "unmapped")))
        success_items = _result_arrays(result, lambda key: any(word in key.lower() for word in ("upload", "success", "accepted", "processed", "matched", "path")))

        for item in _group_examples_by_reason(skipped_items, "Skipped by configured rules"):
            label = f"Skipped {item['extension']}"
            examples.append(_example_item(label, item["count"], item["example"], item["reason"]))
        for item in _group_examples_by_reason(unknown_items, "Could not match configured rules or reference data"):
            label = f"Unknown {item['extension']}"
            examples.append(_example_item(label, item["count"], item["example"], item["reason"]))
        for item in _group_examples_by_extension(success_items, "Matched configured rules"):
            label = f"Successful {item['extension']}"
            examples.append(_example_item(label, item["count"], item["example"], item["reason"]))

    result_summary = _count_result_items(result)
    if error:
        summary = f"{node_label} failed: {error}"
    elif result_summary:
        summary = result_summary
    elif result is None:
        summary = "No result returned"
    else:
        summary = "Result recorded"

    return {
        "schema_version": 1,
        "summary": summary,
        "metrics": metrics,
        "examples": examples[:12],
        "warnings": warnings[:12],
        "errors": errors,
        "raw": result,
    }


def _file_name(value: Any) -> str:
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return "unknown file"
    for key in ("file_name", "filename", "name", "path", "source_path", "local_path", "gcs_path"):
        if value.get(key):
            return str(value[key])
    return "unknown file"


def _is_file_like(value: Any) -> bool:
    if isinstance(value, str):
        return bool(Path(value).suffix)
    if not isinstance(value, dict):
        return False
    return any(value.get(key) for key in ("file_name", "filename", "name", "path", "source_path", "local_path", "gcs_path"))


def _file_extension(file_name: str) -> str:
    suffix = Path(file_name).suffix.lower()
    return suffix or "no extension"


def _reason(value: Any, fallback: str) -> str:
    if not isinstance(value, dict):
        return fallback
    for key in ("reason", "skip_reason", "unknown_reason", "error", "message", "category", "status_reason"):
        if value.get(key):
            return str(value[key])
    return fallback


def _result_arrays(value: Any, predicate: Callable[[str], bool], path: tuple[str, ...] = ()) -> list[Any]:
    hidden_keys = {"filename_date", "content_date", "content_digit_candidates", "branch_text_candidates"}
    if not isinstance(value, dict):
        return []
    results: list[Any] = []
    for key, item in value.items():
        if key in hidden_keys:
            continue
        if isinstance(item, list) and predicate(key):
            results.extend(item)
        elif isinstance(item, dict):
            results.extend(_result_arrays(item, predicate, (*path, key)))
    return results


def _file_like_arrays(value: Any) -> list[Any]:
    hidden_keys = {"filename_date", "content_date", "content_digit_candidates", "branch_text_candidates"}
    if not isinstance(value, dict):
        return []
    results: list[Any] = []
    for key, item in value.items():
        if key in hidden_keys:
            continue
        if isinstance(item, list):
            results.extend(candidate for candidate in item if _is_file_like(candidate))
        elif isinstance(item, dict):
            results.extend(_file_like_arrays(item))
    return results


def _group_examples_by_reason(items: list[Any], fallback_reason: str) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for item in items:
        reason = _reason(item, fallback_reason)
        extension = _file_extension(_file_name(item))
        group_key = f"{reason}|{extension}"
        if group_key not in groups:
            groups[group_key] = {"reason": reason, "extension": extension, "count": 0, "example": _file_name(item)}
        groups[group_key]["count"] += 1
    return list(groups.values())


def _group_examples_by_extension(items: list[Any], fallback_reason: str) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for item in items:
        extension = _file_extension(_file_name(item))
        if extension not in groups:
            groups[extension] = {
                "reason": _reason(item, fallback_reason),
                "extension": extension,
                "count": 0,
                "example": _file_name(item),
                "item": item,
            }
        groups[extension]["count"] += 1
    return list(groups.values())


def _add_file_diagnostic_logs(
    run_id: int,
    node_id: str,
    node_label: str,
    config: dict[str, Any],
    result: Any,
) -> None:
    if not isinstance(result, dict):
        return

    skipped_items = _result_arrays(result, lambda key: any(word in key.lower() for word in ("skip", "reject", "excluded", "invalid")))
    unknown_items = _result_arrays(result, lambda key: any(word in key.lower() for word in ("unknown", "unmatched", "unmapped")))
    success_items = _result_arrays(result, lambda key: any(word in key.lower() for word in ("upload", "success", "accepted", "processed", "matched", "path")))

    valid_extensions = {str(item).lower() for item in config.get("valid_extensions", []) if item}
    if valid_extensions:
        extension_groups: dict[str, dict[str, Any]] = {}
        for item in _file_like_arrays(result):
            extension = _file_extension(_file_name(item))
            if extension in valid_extensions:
                continue
            if extension not in extension_groups:
                extension_groups[extension] = {"count": 0, "example": _file_name(item)}
            extension_groups[extension]["count"] += 1
        for extension, details in extension_groups.items():
            add_run_log(
                run_id,
                f"Extension not scanned: {extension} ({details['count']} file(s)). Example: {details['example']}",
                level="warning",
                node_id=node_id,
                node_label=node_label,
            )

    for item in _group_examples_by_reason(skipped_items, "Skipped by configured rules"):
        add_run_log(
            run_id,
            f"Skipped files: {item['reason']} ({item['extension']}, {item['count']} file(s)). Example: {item['example']}",
            level="warning",
            node_id=node_id,
            node_label=node_label,
        )

    for item in _group_examples_by_reason(unknown_items, "Could not match configured rules or reference data"):
        add_run_log(
            run_id,
            f"Unknown files: {item['reason']} ({item['extension']}, {item['count']} file(s)). Example: {item['example']}",
            level="warning",
            node_id=node_id,
            node_label=node_label,
        )

    for group in _group_examples_by_extension(success_items, "Matched configured rules"):
        item = group.get("item")
        if not isinstance(item, dict):
            continue
        reasons = []
        for label, keys in (
            ("bank", ("bank", "bank_name")),
            ("branch", ("branch", "branch_name")),
            ("rule", ("rule", "matched_rule")),
            ("reference", ("reference", "reference_match")),
            ("path", ("destination_path", "gcs_path", "path")),
        ):
            value = next((item.get(key) for key in keys if item.get(key)), None)
            if value:
                reasons.append(f"{label} matched {value}" if label != "path" else f"path {value}")
        reason_text = "; ".join(reasons) if reasons else group["reason"]
        add_run_log(
            run_id,
            f"Successful pathing: {group['extension']} ({group['count']} file(s)). Example: {group['example']} - {reason_text}",
            node_id=node_id,
            node_label=node_label,
        )


def _add_node_specific_logs(
    run_id: int,
    node_id: str,
    node_label: str,
    config: dict[str, Any],
    result: Any,
) -> None:
    label = node_label.lower()
    if label == "validate environment":
        source_type = config.get("source_type", "local_path")
        add_run_log(run_id, f"Validation source type: {source_type}", node_id=node_id, node_label=node_label)
        required_keys = (
            ["cloud_bucket", "cloud_prefix", "cloud_credentials_ref"]
            if source_type == "cloud"
            else ["source_dir", "credentials_file", "nonbdo_matrix", "bdo_matrix"]
        )
        missing = [key for key in required_keys if not config.get(key)]
        if missing:
            add_run_log(
                run_id,
                f"Missing or blank settings: {', '.join(missing)}",
                level="warning",
                node_id=node_id,
                node_label=node_label,
            )
        else:
            add_run_log(run_id, "Required source settings are present", node_id=node_id, node_label=node_label)

    if label == "scan candidate files":
        extensions = config.get("valid_extensions") or []
        skipped_names = config.get("skip_name_contains") or []
        add_run_log(
            run_id,
            f"Scanner rules: allowed extensions {extensions or 'none'}, skip names containing {skipped_names or 'none'}",
            node_id=node_id,
            node_label=node_label,
        )

    if label in {"build destination paths", "build gcs destination", "deliver files", "upload to gcs"}:
        target = config.get("local_output_dir") if config.get("upload_target") == "local" else config.get("bucket_name")
        target = target or "not set"
        dry_run = "enabled" if config.get("dry_run", True) else "disabled"
        add_run_log(
            run_id,
            f"Destination target: {target}, dry run {dry_run}",
            node_id=node_id,
            node_label=node_label,
        )

    result_summary = _count_result_items(result)
    if result_summary:
        add_run_log(run_id, f"Result summary: {result_summary}", node_id=node_id, node_label=node_label)
    _add_file_diagnostic_logs(run_id, node_id, node_label, config, result)


def _add_failure_reason_log(
    run_id: int,
    node_id: str,
    node_label: str,
    error: str | None,
) -> None:
    if error:
        add_run_log(run_id, f"Failure reason: {error}", level="error", node_id=node_id, node_label=node_label)


def is_stop_requested(run_id: int) -> bool:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT stop_requested FROM runs WHERE id = ?",
            (run_id,),
        ).fetchone()
    return bool(row and row["stop_requested"])


def claim_next_queued_run() -> int | None:
    init_runner_tables()
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        run_id = row["id"]
        cursor = connection.execute(
            "UPDATE runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'",
            (now_iso(), run_id),
        )
        changed = cursor.rowcount
    return run_id if changed else None


def _load_run_project(run_id: int) -> tuple[dict[str, Any], dict[str, Any]]:
    with get_connection() as connection:
        run = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if run is None:
            raise ValueError("Run not found")
        project = connection.execute(
            "SELECT * FROM projects WHERE id = ?",
            (run["project_id"],),
        ).fetchone()
        if project is None:
            raise ValueError("Project not found")
    return row_to_run(run), {
        "id": project["id"],
        "name": project["name"],
        "workflow": json.loads(project["workflow_json"]),
    }


def _save_node_result(run_id: int, node_result: dict[str, Any]) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO run_node_results (
                run_id, node_id, node_label, status, started_at, finished_at,
                stdout, error, result_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                node_result["node_id"],
                node_result["label"],
                node_result["status"],
                node_result["started_at"],
                node_result["finished_at"],
                node_result["stdout"],
                node_result["error"],
                json.dumps(node_result["result"]),
            ),
        )


def execute_run(run_id: int) -> dict[str, Any]:
    run, project = _load_run_project(run_id)
    project_id = project["id"]
    workflow = project["workflow"]
    upstream = upstream_node_ids(workflow)
    workspace = get_project_workspace(project_id)
    completed: dict[str, dict[str, Any]] = {}
    node_results: list[dict[str, Any]] = []

    add_run_log(run_id, f"Runner started project {project['name']}")
    final_status = "success"
    final_error = None

    try:
        for node in ordered_nodes(workflow):
            node_id = node["id"]
            node_label = node.get("label", node_id)
            if is_stop_requested(run_id):
                final_status = "stopped"
                add_run_log(run_id, "Stop requested before next node", level="warning")
                break

            add_run_log(run_id, f"Starting node {node_label}", node_id=node_id, node_label=node_label)
            output = io.StringIO()
            node_context = context_for_node(node_id, upstream, completed)
            started_at = now_iso()
            status = "success"
            error = None
            node_config = node.get("config", {})
            if not isinstance(node_config, dict):
                node_config = {}
            _add_config_summary_log(run_id, node_id, node_label, node_config)
            _add_input_summary_log(run_id, node_id, node_label, node_context)

            def node_log(message: str, level: str = "info") -> None:
                add_run_log(
                    run_id,
                    str(message),
                    level=level,
                    node_id=node_id,
                    node_label=node_label,
                )

            def stop_if_requested() -> None:
                if is_stop_requested(run_id):
                    raise WorkflowStopped("Workflow stopped by user")

            local_scope: dict[str, Any] = {
                "config": node_config,
                "context": node_context,
                "inputs": node_context,
                "result": None,
                "workspace_dir": workspace,
                "resolve_workspace_path": lambda relative_path: resolve_workspace_path(project_id, relative_path),
                "resolve_input_path": lambda path, source_type="workspace": resolve_input_path(
                    project_id,
                    path,
                    source_type,
                ),
                "log": node_log,
                "stop_if_requested": stop_if_requested,
            }

            with contextlib.redirect_stdout(output):
                try:
                    stop_if_requested()
                    with node_execution_heartbeat():
                        exec(node.get("script", ""), {"__builtins__": __builtins__}, local_scope)
                    stop_if_requested()
                except WorkflowStopped as exc:
                    status = "stopped"
                    error = str(exc)
                    final_status = "stopped"
                except Exception as exc:  # noqa: BLE001 - script errors belong in run results.
                    status = "error"
                    error = str(exc)
                    final_status = "error"
                    final_error = str(exc)

            result = local_scope.get("result")
            _add_node_specific_logs(run_id, node_id, node_label, node_config, result)
            _add_failure_reason_log(run_id, node_id, node_label, error)
            result_contract = _build_node_result_contract(node_label, status, node_config, result, error)
            node_result = {
                "node_id": node_id,
                "label": node_label,
                "status": status,
                "result": result_contract,
                "stdout": output.getvalue(),
                "error": error,
                "started_at": started_at,
                "finished_at": now_iso(),
            }
            completed[node_id] = {
                "id": node_id,
                "label": node_label,
                "result": result,
                "stdout": output.getvalue(),
                "status": status,
                "error": error,
            }
            node_results.append(node_result)
            _save_node_result(run_id, node_result)
            add_run_log(
                run_id,
                f"Node {node_label} {status}",
                level="error" if status == "error" else "info",
                node_id=node_id,
                node_label=node_label,
            )

            if status in {"error", "stopped"}:
                break
    except Exception as exc:  # noqa: BLE001 - keep runner alive after a bad run.
        final_status = "error"
        final_error = str(exc)
        add_run_log(run_id, str(exc), level="error")

    if final_status == "success" and is_stop_requested(run_id):
        final_status = "stopped"

    result_payload = {
        "project_id": project_id,
        "run_id": run_id,
        "status": final_status,
        "ran_at": now_iso(),
        "results": [compact_node_result_for_run(node_result) for node_result in node_results],
    }
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE runs
            SET status = ?, finished_at = ?, error = ?, result_json = ?
            WHERE id = ?
            """,
            (final_status, now_iso(), final_error, json.dumps(result_payload), run_id),
        )
    add_run_log(run_id, f"Run finished: {final_status}", level="error" if final_status == "error" else "info")
    prune_project_run_history(project_id)
    return result_payload


def runner_loop(sleep_seconds: float = 3.0, should_stop: Callable[[], bool] | None = None) -> None:
    init_runner_tables()
    while not (should_stop and should_stop()):
        write_runner_heartbeat("active")
        run_id = claim_next_queued_run()
        if run_id is None:
            time.sleep(sleep_seconds)
            continue
        try:
            execute_run(run_id)
        except Exception as exc:  # noqa: BLE001 - the runner should continue after failures.
            add_run_log(run_id, f"Runner failed: {exc}", level="error")
            project_id: int | None = None
            with get_connection() as connection:
                row = connection.execute("SELECT project_id FROM runs WHERE id = ?", (run_id,)).fetchone()
                project_id = row["project_id"] if row else None
                connection.execute(
                    """
                    UPDATE runs
                    SET status = 'error', finished_at = ?, error = ?
                    WHERE id = ?
                    """,
                    (now_iso(), str(exc), run_id),
                )
            if project_id is not None:
                prune_project_run_history(project_id)
