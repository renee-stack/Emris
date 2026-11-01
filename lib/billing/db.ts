import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  subscription_status TEXT,
  trial_ends_at TEXT,
  trial_reminder_sent_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  onboarding_completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS searches_subject_created ON searches (subject_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_id TEXT,
  anonymous_id TEXT,
  properties TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_name_created ON events (name, created_at);

CREATE TABLE IF NOT EXISTS report_unlocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  geoid TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS report_user_geoid ON report_unlocks (user_id, geoid);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (user_id, kind)
);
`;

export function dbFilename(): string {
  if (process.env.EMRIS_DB_PATH) return process.env.EMRIS_DB_PATH;
  if (process.env.VERCEL) return "/tmp/emris.sqlite";
  return path.join(process.cwd(), ".data", "emris.sqlite");
}

export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch {
    // :memory: databases reject WAL on some Node builds.
  }
  db.exec("PRAGMA busy_timeout = 3000");
  db.exec(SCHEMA);
  return db;
}

let singleton: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!singleton) {
    const filename = dbFilename();
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    singleton = openDatabase(filename);
  }
  return singleton;
}
