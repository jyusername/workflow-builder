from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Query, Response


def register_run_routes(app: Any, deps: dict[str, Any]) -> None:
    fetch_project = deps["fetch_project"]
    runner_helpers = deps["runner_helpers"]
    start_project_run = deps["start_project_run"]

    @app.post("/projects/{project_id}/runs", status_code=201)
    @app.post("/api/projects/{project_id}/runs", status_code=201)
    def create_project_run(project_id: int) -> dict[str, Any]:
        fetch_project(project_id)
        try:
            return runner_helpers.queue_project_run(project_id)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/projects/{project_id}/runs")
    @app.get("/api/projects/{project_id}/runs")
    def list_runs_for_project(
        project_id: int,
        limit: int = Query(default=runner_helpers.RUN_HISTORY_LIST_LIMIT, ge=1, le=5000),
        include_result: bool = False,
    ) -> list[dict[str, Any]]:
        fetch_project(project_id)
        return runner_helpers.list_project_runs(project_id, limit=limit, include_result=include_result)

    @app.get("/projects/{project_id}/analytics")
    @app.get("/api/projects/{project_id}/analytics")
    def get_project_analytics(project_id: int) -> dict[str, Any]:
        fetch_project(project_id)
        return runner_helpers.get_project_run_analytics(project_id)

    @app.get("/runs/{run_id}")
    @app.get("/api/runs/{run_id}")
    def get_run(run_id: int) -> dict[str, Any]:
        run = runner_helpers.fetch_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run

    @app.get("/runs/{run_id}/logs")
    @app.get("/api/runs/{run_id}/logs")
    def get_run_logs(run_id: int) -> list[dict[str, Any]]:
        if runner_helpers.fetch_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return runner_helpers.fetch_run_logs(run_id)

    @app.get("/runs/{run_id}/nodes")
    @app.get("/api/runs/{run_id}/nodes")
    def get_run_nodes(run_id: int) -> list[dict[str, Any]]:
        if runner_helpers.fetch_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return runner_helpers.fetch_run_nodes(run_id)

    @app.get("/runs/{run_id}/snapshot")
    @app.get("/api/runs/{run_id}/snapshot")
    def get_run_snapshot(run_id: int, after_log_id: int = Query(default=0, ge=0)) -> dict[str, Any]:
        snapshot = runner_helpers.fetch_run_snapshot(run_id, after_log_id=after_log_id)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return snapshot

    @app.post("/runs/{run_id}/stop")
    @app.post("/api/runs/{run_id}/stop")
    def stop_run(run_id: int) -> dict[str, Any]:
        run = runner_helpers.request_run_stop(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run

    @app.get("/runner/status")
    @app.get("/api/runner/status")
    def get_runner_status(response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "no-store"
        return runner_helpers.get_runner_status()

    @app.post("/api/projects/{project_id}/stop")
    def stop_project(project_id: int) -> dict[str, Any]:
        fetch_project(project_id)
        latest_run = runner_helpers.fetch_latest_project_run(project_id)
        if latest_run and latest_run["status"] in runner_helpers.ACTIVE_RUN_STATUSES:
            stopped = runner_helpers.request_run_stop(latest_run["id"])
            return stopped or {"status": "idle"}
        return {"status": "idle"}

    @app.post("/api/projects/{project_id}/runs/cancel-active")
    def cancel_active_project_run(project_id: int) -> dict[str, Any]:
        fetch_project(project_id)
        return runner_helpers.cancel_active_project_run(project_id)

    @app.post("/api/projects/{project_id}/run/start")
    def start_project_run_endpoint(project_id: int) -> dict[str, Any]:
        return start_project_run(project_id)

    @app.get("/api/projects/{project_id}/run/status")
    def get_project_run_status(project_id: int) -> dict[str, Any]:
        fetch_project(project_id)
        latest_run = runner_helpers.fetch_latest_project_run(project_id)
        if latest_run:
            nodes = runner_helpers.fetch_run_nodes(latest_run["id"])
            result = latest_run["result"] or {
                "project_id": project_id,
                "run_id": latest_run["id"],
                "status": latest_run["status"],
                "results": nodes,
            }
            return {
                "project_id": project_id,
                "run_id": latest_run["id"],
                "status": latest_run["status"],
                "started_at": latest_run["started_at"],
                "finished_at": latest_run["finished_at"],
                "result": result,
            }
        return {
            "project_id": project_id,
            "status": "idle",
            "started_at": None,
            "finished_at": None,
            "result": None,
        }
