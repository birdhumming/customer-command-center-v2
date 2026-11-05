import type { DB } from "./db.ts";

// UUID ids, ISO timestamps, version integers on mutable records. NULL means unknown; never a fake zero.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS cc2_users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL            -- sales | engineer | delivery
);
CREATE TABLE IF NOT EXISTS cc2_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES cc2_users(id),
  technical_owner_id TEXT REFERENCES cc2_users(id),
  contact TEXT,                      -- customer day-to-day contact
  buyer TEXT,                        -- economic buyer name
  buyer_status TEXT NOT NULL DEFAULT 'not_assessed',   -- not_assessed | unknown | named
  problem TEXT,
  budget TEXT,                       -- NULL = unknown
  sales_stage TEXT NOT NULL DEFAULT 'discovery',       -- discovery | proposal | negotiation | won | lost
  delivery_status TEXT,              -- NULL until won: onboarding_pending | delivery | active | ended
  lost_reason TEXT, end_reason TEXT, ended_at TEXT,
  last_customer_contact_at TEXT,
  health TEXT NOT NULL DEFAULT 'unknown',              -- unknown | healthy | watch | at_risk (manual)
  health_reason TEXT, health_reviewed_at TEXT,
  renewal_date TEXT, expansion_note TEXT,
  current_agreement_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc2_proposals (                 -- immutable revisions of proposed scope/terms
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id), revision INTEGER NOT NULL,
  deliverables TEXT, exclusions TEXT, price_terms TEXT, dates TEXT, customer_responsibilities TEXT,
  success_metric TEXT, success_unit TEXT, success_direction TEXT, success_target REAL, success_basis TEXT,
  handling TEXT NOT NULL DEFAULT '{}',                 -- JSON: {activities:{inference:..}, external_processors:[..], external_processing, retention, retention_note, training_use}
  shared_at TEXT, validation_waived_reason TEXT,
  change_note TEXT, created_by TEXT REFERENCES cc2_users(id), created_at TEXT NOT NULL,
  UNIQUE(account_id, revision)
);
CREATE TABLE IF NOT EXISTS cc2_requirements (              -- immutable revisions of customer data restrictions
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id), revision INTEGER NOT NULL,
  restriction_status TEXT NOT NULL DEFAULT 'unknown',  -- unknown | none_stated | specified
  wording TEXT, activities TEXT NOT NULL DEFAULT '[]', -- JSON list of covered activities
  external_processing TEXT, retention TEXT, retention_note TEXT, training_use TEXT, evidence_note TEXT,
  created_by TEXT REFERENCES cc2_users(id), created_at TEXT NOT NULL,
  UNIQUE(account_id, revision)
);
CREATE TABLE IF NOT EXISTS cc2_reviews (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id),
  kind TEXT NOT NULL,                -- technical_validation | data_handling | agreement_review | delivery_plan | success_review
  question TEXT,
  proposal_id TEXT REFERENCES cc2_proposals(id), requirements_id TEXT REFERENCES cc2_requirements(id),
  reviewer_id TEXT REFERENCES cc2_users(id),
  status TEXT NOT NULL DEFAULT 'open',                 -- open | approved | conditional | blocked
  conditions TEXT NOT NULL DEFAULT '[]',               -- JSON [{text, done}]
  decision_note TEXT, decided_at TEXT,
  reopened_reason TEXT, requested_by TEXT REFERENCES cc2_users(id), requested_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cc2_agreements (                -- immutable acceptance snapshots
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id),
  proposal_id TEXT NOT NULL REFERENCES cc2_proposals(id), requirements_id TEXT REFERENCES cc2_requirements(id),
  accepted_by TEXT NOT NULL REFERENCES cc2_users(id), accepted_at TEXT NOT NULL, acceptance_evidence TEXT NOT NULL,
  supersedes_id TEXT REFERENCES cc2_agreements(id), created_at TEXT NOT NULL,
  UNIQUE(account_id, proposal_id)
);
CREATE TABLE IF NOT EXISTS cc2_handoffs (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id), agreement_id TEXT NOT NULL REFERENCES cc2_agreements(id),
  created_at TEXT NOT NULL, accepted_by TEXT REFERENCES cc2_users(id), accepted_at TEXT, acceptance_note TEXT, stale_reason TEXT,
  UNIQUE(agreement_id)
);
CREATE TABLE IF NOT EXISTS cc2_tasks (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id),
  title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'action',   -- action | milestone | review | handoff | measurement
  owner_id TEXT REFERENCES cc2_users(id), due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',                  -- open | done | cancelled
  committed INTEGER NOT NULL DEFAULT 0, required INTEGER NOT NULL DEFAULT 0,
  automation_key TEXT, subject_id TEXT, note TEXT,
  done_at TEXT, created_by TEXT REFERENCES cc2_users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_automation ON cc2_tasks(account_id, automation_key, subject_id) WHERE automation_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS cc2_meetings (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id),
  occurred_at TEXT NOT NULL, summary TEXT NOT NULL, author_id TEXT REFERENCES cc2_users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cc2_blockers (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id),
  description TEXT NOT NULL, owner_id TEXT REFERENCES cc2_users(id), opened_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT
);
CREATE TABLE IF NOT EXISTS cc2_outcomes (                  -- one success metric per engagement
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id), agreement_id TEXT REFERENCES cc2_agreements(id),
  metric TEXT NOT NULL, unit TEXT, direction TEXT NOT NULL DEFAULT 'higher',   -- higher | lower
  baseline REAL, baseline_basis TEXT, target REAL,
  latest REAL, latest_basis TEXT, measured_at TEXT,
  not_measured_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
  UNIQUE(account_id)
);
CREATE TABLE IF NOT EXISTS cc2_activity (                  -- append-only
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES cc2_accounts(id), actor_id TEXT REFERENCES cc2_users(id),
  event_type TEXT NOT NULL, at TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS tasks_acc ON cc2_tasks(account_id); CREATE INDEX IF NOT EXISTS activity_acc ON cc2_activity(account_id, at);
`;

export async function ensureSchema(d: DB) { await d.exec(SCHEMA); }
