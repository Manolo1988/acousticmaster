#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from webapp.server import optimize  # noqa: E402


def emit_event(event: dict) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        stream = "--stream" in sys.argv[1:]
        result = optimize(payload, emit_event if stream else None)
        if stream:
            emit_event({"type": "result", "result": result})
        else:
            sys.stdout.write(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001
        if "--stream" in sys.argv[1:]:
            emit_event({"type": "error", "error": str(exc)})
        else:
            sys.stdout.write(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
