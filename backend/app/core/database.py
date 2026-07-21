from __future__ import annotations

import random
import sqlite3
import time
from pathlib import Path
from typing import Any, Callable


BASE_DIR = Path(__file__).resolve().parents[2]
DB_PATH = BASE_DIR / "workflow_builder.db"
WORKSPACES_DIR = BASE_DIR / "workspaces"
SQLITE_TIMEOUT_SECONDS = 30
SQLITE_BUSY_TIMEOUT_MS = SQLITE_TIMEOUT_SECONDS * 1000


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=SQLITE_TIMEOUT_SECONDS)
    connection.row_factory = sqlite3.Row
    connection.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    return connection


def is_database_locked(exc: sqlite3.OperationalError) -> bool:
    message = str(exc).lower()
    return "database is locked" in message or "database is busy" in message


def with_db_retry(operation: Callable[[], Any], *, attempts: int = 5, base_delay: float = 0.08) -> Any:
    for attempt in range(attempts):
        try:
            return operation()
        except sqlite3.OperationalError as exc:
            if not is_database_locked(exc) or attempt == attempts - 1:
                raise
            time.sleep(base_delay * (2**attempt) + random.uniform(0, base_delay))
    return None
