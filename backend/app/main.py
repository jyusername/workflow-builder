from __future__ import annotations 

import json
import sqlite3
import sys
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import runner_helpers
from app.api.projects import register_project_routes
from app.api.runs import register_run_routes
from app.core.database import get_connection, with_db_retry
from app.services.schedule_service import (
    advance_schedule_after_run,
    default_schedule,
    normalize_schedule,
    now_iso,
    now_utc,
    parse_iso_datetime,
    persist_schedule,
    schedule_from_row,
)

app = FastAPI(title="Workflow Builder API", version="0.1.0")
SCHEDULER_STOP = threading.Event()
SCHEDULER_THREAD: threading.Thread | None = None
SEED_PROJECTS_PATH = BASE_DIR / "seed_projects.json"

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def default_workflow() -> dict[str, Any]:
    return {
        "nodes": [],
        "edges": [],
        "settings": {"run_mode": "manual", "notes": "Add scripts to start building the flow."},
    }


def load_seed_projects() -> list[dict[str, Any]]:
    if not SEED_PROJECTS_PATH.exists():
        return []
    payload = json.loads(SEED_PROJECTS_PATH.read_text(encoding="utf-8"))
    projects = payload.get("projects", [])
    if not isinstance(projects, list):
        raise ValueError(f"Invalid projects list in {SEED_PROJECTS_PATH}")
    return projects


def init_db() -> None:
    runner_helpers.init_runner_tables()
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                workflow_json TEXT NOT NULL,
                schedule_enabled INTEGER NOT NULL DEFAULT 0,
                schedule_interval_minutes INTEGER,
                schedule_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(projects)").fetchall()}
        if "schedule_json" not in columns:
            connection.execute("ALTER TABLE projects ADD COLUMN schedule_json TEXT NOT NULL DEFAULT '{}' ")
        count = connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        if count == 0:
            seed_projects = load_seed_projects()
            if seed_projects:
                for project in seed_projects:
                    timestamp = now_iso()
                    connection.execute(
                        """
                        INSERT INTO projects (
                            id, name, description, workflow_json, schedule_enabled,
                            schedule_interval_minutes, schedule_json, created_at, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            project.get("id"),
                            project["name"],
                            project.get("description", ""),
                            json.dumps(project.get("workflow", default_workflow())),
                            int(project.get("schedule_enabled", 0)),
                            project.get("schedule_interval_minutes"),
                            json.dumps(project.get("schedule", default_schedule())),
                            project.get("created_at", timestamp),
                            project.get("updated_at", timestamp),
                        ),
                    )
            else:
                timestamp = now_iso()
                connection.execute(
                    """
                    INSERT INTO projects (
                        name, description, workflow_json, schedule_enabled,
                        schedule_interval_minutes, schedule_json, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "Sample Script Workflow",
                        "Starter project for editing and running connected Python scripts.",
                        json.dumps(default_workflow()),
                        0,
                        None,
                        json.dumps(default_schedule()),
                        timestamp,
                        timestamp,
                    ),
                )


def model_to_dict(model: Any) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    global SCHEDULER_THREAD
    SCHEDULER_STOP.clear()
    if SCHEDULER_THREAD is None or not SCHEDULER_THREAD.is_alive():
        SCHEDULER_THREAD = threading.Thread(target=scheduler_loop, daemon=True)
        SCHEDULER_THREAD.start()


def row_to_project(row: sqlite3.Row) -> dict[str, Any]:
    schedule = schedule_from_row(row)
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "workflow": json.loads(row["workflow_json"]),
        "schedule": schedule,
        "schedule_enabled": bool(schedule.get("enabled")),
        "schedule_interval_minutes": schedule.get("every_minutes") if schedule.get("type") == "interval" else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def fetch_project(project_id: int) -> dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return row_to_project(row)


def start_project_run(project_id: int) -> dict[str, Any]:
    fetch_project(project_id)
    try:
        return runner_helpers.queue_project_run(project_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def trigger_scheduled_project(project_id: int) -> None:
    project = fetch_project(project_id)
    schedule = project.get("schedule") or default_schedule()
    if not schedule.get("enabled") or not schedule.get("next_run_at"):
        return

    due_at = parse_iso_datetime(schedule.get("next_run_at"))
    if due_at is None or due_at > now_utc():
        return

    if runner_helpers.has_active_project_run(project_id):
        return

    next_schedule = advance_schedule_after_run(schedule, reference=now_utc())
    persist_schedule(project_id, next_schedule)
    start_project_run(project_id)


def scheduler_loop() -> None:
    while not SCHEDULER_STOP.is_set():
        try:
            with get_connection() as connection:
                rows = connection.execute("SELECT id FROM projects ORDER BY updated_at DESC").fetchall()
            for row in rows:
                try:
                    trigger_scheduled_project(row["id"])
                except Exception:
                    continue
        except Exception:
            pass
        finally:
            SCHEDULER_STOP.wait(1)


ROUTE_DEPS = {
    "init_db": init_db,
    "get_connection": get_connection,
    "row_to_project": row_to_project,
    "default_workflow": default_workflow,
    "model_to_dict": model_to_dict,
    "normalize_schedule": normalize_schedule,
    "now_iso": now_iso,
    "with_db_retry": with_db_retry,
    "fetch_project": fetch_project,
    "runner_helpers": runner_helpers,
    "start_project_run": start_project_run,
}

register_project_routes(app, ROUTE_DEPS)
register_run_routes(app, ROUTE_DEPS)
