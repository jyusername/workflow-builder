from __future__ import annotations

import json
from typing import Any

from app.models.schemas import ProjectCreate, ProjectUpdate


def register_project_routes(app: Any, deps: dict[str, Any]) -> None:
    init_db = deps["init_db"]
    get_connection = deps["get_connection"]
    row_to_project = deps["row_to_project"]
    default_workflow = deps["default_workflow"]
    model_to_dict = deps["model_to_dict"]
    normalize_schedule = deps["normalize_schedule"]
    now_iso = deps["now_iso"]
    with_db_retry = deps["with_db_retry"]
    fetch_project = deps["fetch_project"]
    runner_helpers = deps["runner_helpers"]

    @app.get("/")
    def root() -> dict[str, str]:
        return {"message": "Workflow Builder API running"}

    @app.get("/api/projects")
    def list_projects() -> list[dict[str, Any]]:
        init_db()
        with get_connection() as connection:
            rows = connection.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
        return [row_to_project(row) for row in rows]

    @app.post("/api/projects", status_code=201)
    def create_project(payload: ProjectCreate) -> dict[str, Any]:
        workflow = model_to_dict(payload.workflow) if payload.workflow else default_workflow()
        schedule_source = payload.schedule if payload.schedule is not None else {
            "enabled": payload.schedule_enabled,
            "type": "interval" if payload.schedule_enabled and payload.schedule_interval_minutes else "once",
            "every_minutes": payload.schedule_interval_minutes,
        }
        schedule = normalize_schedule(schedule_source)
        timestamp = now_iso()

        def write_project() -> int:
            with get_connection() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO projects (
                        name, description, workflow_json, schedule_enabled,
                        schedule_interval_minutes, schedule_json, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        payload.name,
                        payload.description,
                        json.dumps(workflow),
                        int(bool(schedule.get("enabled"))),
                        schedule.get("every_minutes") if schedule.get("type") == "interval" else None,
                        json.dumps(schedule),
                        timestamp,
                        timestamp,
                    ),
                )
                return cursor.lastrowid

        project_id = with_db_retry(write_project)
        runner_helpers.get_project_workspace(project_id)
        return fetch_project(project_id)

    @app.get("/api/projects/{project_id}")
    def get_project(project_id: int) -> dict[str, Any]:
        init_db()
        return fetch_project(project_id)

    @app.put("/api/projects/{project_id}")
    def update_project(project_id: int, payload: ProjectUpdate) -> dict[str, Any]:
        existing = fetch_project(project_id)
        schedule_source = payload.schedule if payload.schedule is not None else existing.get("schedule")
        if schedule_source is None:
            schedule_source = {
                "enabled": payload.schedule_enabled,
                "type": "interval" if payload.schedule_interval_minutes else "once",
                "every_minutes": payload.schedule_interval_minutes,
            }
        schedule = normalize_schedule(schedule_source)

        def write_project() -> None:
            with get_connection() as connection:
                connection.execute(
                    """
                    UPDATE projects
                    SET name = ?, description = ?, workflow_json = ?, schedule_enabled = ?,
                        schedule_interval_minutes = ?, schedule_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        payload.name,
                        payload.description,
                        json.dumps(model_to_dict(payload.workflow)),
                        int(bool(schedule.get("enabled"))),
                        schedule.get("every_minutes") if schedule.get("type") == "interval" else None,
                        json.dumps(schedule),
                        now_iso(),
                        project_id,
                    ),
                )

        with_db_retry(write_project)
        return fetch_project(project_id)

    @app.delete("/api/projects/{project_id}", status_code=204)
    def delete_project(project_id: int) -> None:
        fetch_project(project_id)

        def delete_project_row() -> None:
            with get_connection() as connection:
                connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))

        with_db_retry(delete_project_row)
