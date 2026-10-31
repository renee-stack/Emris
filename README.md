# Emris

Market intelligence for multifamily developers: scores census tracts on the "path of progress" (multifamily permits, permit momentum, nearby infrastructure), shows 50 years of building history (Wayback), and sells area and property reports.

v2 works for any US place from configuration. Code never names a place; places live in `places/<state>/*.yaml`.

| Folder | What |
| --- | --- |
| `docs/` | `PLAN.md` (7-day plan) and `contract.md` (configs, records, API; read first) |
| `places/` | Place configs + `_schema.py` |
| `pipeline/` | `connectors/` (one per source type), `core/` (shared steps), `custom/` (rare hooks) |
| `db/migrations/` | Postgres + PostGIS schema |
| `web/` | Next.js app and API routes |
| `tests/fixtures/` | Sample source rows per place |
| `legacy/` | Hackathon build (v1 scripts, data, contract), for reference |

## Setup

One `.env` at the repo root (never committed). `web/.env.local` is a symlink to it:

```bash
ln -s ../.env web/.env.local
```

Pipeline (Python 3.12):

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.validate
```

Web app:

```bash
cd web && npm install && npm run dev
```

CI (`.github/workflows/guardrails.yml`) runs `scripts/check_place_names.sh` and `python -m pipeline.validate`.
