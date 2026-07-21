from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from app.core.database import get_connection, with_db_retry


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def default_schedule() -> dict[str, Any]:
    return {
        "enabled": False,
        "type": "once",
        "date": "",
        "time": "",
        "days_of_week": [],
        "utc_offset_minutes": 0,
        "timezone_label": "UTC",
        "next_run_at": None,
        "last_run_at": None,
    }


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


def parse_hhmm(raw: str) -> tuple[int, int]:
    try:
        parsed = datetime.strptime(raw, "%H:%M")
        return parsed.hour, parsed.minute
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Schedule time must use HH:MM format") from exc


def parse_yyyy_mm_dd(raw: str) -> tuple[int, int, int]:
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d")
        return parsed.year, parsed.month, parsed.day
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Schedule date must use YYYY-MM-DD format") from exc


def parse_iso_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    value = datetime.fromisoformat(raw)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def local_to_utc(year: int, month: int, day: int, hour: int, minute: int, offset_minutes: int) -> datetime:
    local_dt = datetime(year, month, day, hour, minute)
    return (local_dt - timedelta(minutes=offset_minutes)).replace(tzinfo=timezone.utc)


def compute_next_run_at(schedule: dict[str, Any], reference: datetime | None = None) -> str | None:
    if not schedule.get("enabled"):
        return None

    reference = reference or now_utc()
    schedule_type = schedule.get("type", "once")
    offset_minutes = int(schedule.get("utc_offset_minutes") or 0)

    if schedule_type in {"once", "later"}:
        date_value = schedule.get("date")
        time_value = schedule.get("time")
        if not date_value or not time_value:
            raise HTTPException(status_code=400, detail="Scheduled runs require a date and time")
        year, month, day = parse_yyyy_mm_dd(date_value)
        hour, minute = parse_hhmm(time_value)
        candidate = local_to_utc(year, month, day, hour, minute, offset_minutes)
        if candidate <= reference:
            raise HTTPException(status_code=400, detail="Scheduled run must be set in the future")
        return candidate.isoformat()

    if schedule_type == "weekly":
        days = sorted({int(day) for day in schedule.get("days_of_week") or [] if 0 <= int(day) <= 6})
        if not days:
            raise HTTPException(status_code=400, detail="Weekly schedules need at least one day")
        time_value = schedule.get("time")
        if not time_value:
            raise HTTPException(status_code=400, detail="Weekly schedules require a time")
        hour, minute = parse_hhmm(time_value)
        local_reference = reference + timedelta(minutes=offset_minutes)
        for day_offset in range(0, 8):
            candidate_local = (local_reference + timedelta(days=day_offset)).replace(
                hour=hour,
                minute=minute,
                second=0,
                microsecond=0,
            )
            # UI stores days as Sunday=0 ... Saturday=6; Python weekday is Monday=0 ... Sunday=6.
            ui_weekday = (candidate_local.weekday() + 1) % 7
            if ui_weekday in days and candidate_local > local_reference:
                candidate_utc = candidate_local - timedelta(minutes=offset_minutes)
                return candidate_utc.isoformat()
        raise HTTPException(status_code=400, detail="Weekly schedule could not compute a next run")

    if schedule_type == "interval":
        every_minutes = int(schedule.get("every_minutes") or 0)
        if every_minutes < 1:
            raise HTTPException(status_code=400, detail="Interval schedules need a minute value")
        return (reference + timedelta(minutes=every_minutes)).isoformat()

    raise HTTPException(status_code=400, detail="Unsupported schedule type")


def normalize_schedule(schedule: dict[str, Any] | None, *, reference: datetime | None = None) -> dict[str, Any]:
    normalized = default_schedule()
    if schedule:
        normalized.update(schedule)
    normalized["enabled"] = bool(normalized.get("enabled"))
    normalized["type"] = normalized.get("type") or "once"
    if normalized["type"] == "later":
        normalized["type"] = "once"
    normalized["utc_offset_minutes"] = int(normalized.get("utc_offset_minutes") or 0)
    submitted_days = normalized.get("days_of_week") or []
    normalized["days_of_week"] = []
    for day in submitted_days:
        if isinstance(day, int) and 0 <= day <= 6:
            normalized["days_of_week"].append(day)
        elif str(day).isdigit():
            value = int(day)
            if 0 <= value <= 6:
                normalized["days_of_week"].append(value)
    if normalized["enabled"]:
        normalized["next_run_at"] = compute_next_run_at(normalized, reference=reference)
    else:
        normalized["next_run_at"] = None
    return normalized


def schedule_from_row(row: sqlite3.Row) -> dict[str, Any]:
    if "schedule_json" in row.keys():
        schedule = default_schedule()
        schedule.update(parse_json_object(row["schedule_json"]))
        schedule["enabled"] = bool(schedule.get("enabled"))
        schedule["type"] = schedule.get("type") or "once"
        schedule["utc_offset_minutes"] = int(schedule.get("utc_offset_minutes") or 0)
        schedule["days_of_week"] = [
            int(day)
            for day in (schedule.get("days_of_week") or [])
            if str(day).isdigit() and 0 <= int(day) <= 6
        ]
        schedule["every_minutes"] = schedule.get("every_minutes")
        return schedule
    if row["schedule_enabled"]:
        return normalize_schedule(
            {
                "enabled": True,
                "type": "interval",
                "every_minutes": row["schedule_interval_minutes"] or 1,
                "timezone_label": "UTC",
                "utc_offset_minutes": 0,
                "next_run_at": None,
                "last_run_at": None,
            }
        )
    return default_schedule()


def persist_schedule(project_id: int, schedule: dict[str, Any]) -> None:
    def write_schedule() -> None:
        with get_connection() as connection:
            connection.execute(
                """
                UPDATE projects
                SET schedule_json = ?, schedule_enabled = ?, schedule_interval_minutes = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    json.dumps(schedule),
                    int(bool(schedule.get("enabled"))),
                    schedule.get("every_minutes") if schedule.get("type") == "interval" else None,
                    now_iso(),
                    project_id,
                ),
            )

    with_db_retry(write_schedule)


def advance_schedule_after_run(schedule: dict[str, Any], reference: datetime | None = None) -> dict[str, Any]:
    next_schedule = dict(schedule)
    next_schedule["last_run_at"] = now_iso()
    schedule_type = next_schedule.get("type", "once")
    if schedule_type in {"once", "later"}:
        next_schedule["enabled"] = False
        next_schedule["next_run_at"] = None
        return next_schedule
    next_schedule["next_run_at"] = compute_next_run_at(next_schedule, reference=reference or now_utc())
    return next_schedule
