"""Validate place configs against places/_schema.py.

    python -m pipeline.validate              # everything under places/
    python -m pipeline.validate places/il    # a folder or single files

Exit 1 on any error (printed as `file: field.path: message`). TODOs pass but are listed.
"""
from __future__ import annotations

import sys
from pathlib import Path

from places._schema import PLACES_DIR, REPO_ROOT, check_tree


def _rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(p)


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv] or [PLACES_DIR]
    missing = [t for t in targets if not t.exists()]
    if missing:
        print(f"no such path: {', '.join(map(str, missing))}", file=sys.stderr)
        return 2
    reports = check_tree(targets)
    if not reports:
        print("no place configs found", file=sys.stderr)
        return 1

    errors = [(r, e) for r in reports for e in r.errors]
    todos = [(r, t) for r in reports for t in r.todos]

    for r, e in errors:
        print(f"ERROR {_rel(r.path)}: {e}")
    if todos:
        print(f"\n{len(todos)} TODO(s) still open:")
        for r, t in todos:
            print(f"  TODO {_rel(r.path)}: {t.split(': ', 1)[0]}: {t.split(': ', 1)[1]}")

    ok = len(reports) - len({r.path for r, _ in errors})
    print(f"\n{len(reports)} file(s) checked: {ok} ok, {len(reports) - ok} with errors, {len(todos)} TODO(s).")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
