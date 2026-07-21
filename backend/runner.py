from __future__ import annotations

import signal
import threading

from runner_helpers import runner_loop, write_runner_heartbeat


stop_event = threading.Event()


def handle_stop(signum, frame) -> None:  # noqa: ANN001 - signal handlers receive dynamic args.
    stop_event.set()


if __name__ == "__main__":
    signal.signal(signal.SIGINT, handle_stop)
    signal.signal(signal.SIGTERM, handle_stop)
    print("Workflow runner started. Press Ctrl+C to stop.")
    try:
        runner_loop(should_stop=stop_event.is_set)
    finally:
        write_runner_heartbeat("stopped")
        print("Workflow runner stopped.")
