"""Load the single repo-root .env (the web app reads the same file via web/.env.local)."""
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"


def load_env() -> bool:
    """Load .env into os.environ without overriding variables already set. True if the file exists."""
    return load_dotenv(ENV_FILE, override=False)


load_env()
