CREATE TABLE owner_entitlements (
  owner_id TEXT PRIMARY KEY NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  plan_code TEXT NOT NULL CHECK (plan_code = 'private-beta'),
  status TEXT NOT NULL CHECK (
    status IN ('trialing', 'active', 'past_due', 'grace', 'uncollectible', 'cancelled')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('grant', 'reserve', 'settle', 'release')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reference_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (
    (event_type = 'grant' AND job_id IS NULL)
    OR (event_type IN ('reserve', 'settle', 'release') AND job_id IS NOT NULL)
  ),
  UNIQUE (owner_id, reference_key)
);

CREATE INDEX idx_credit_ledger_owner_created
  ON credit_ledger(owner_id, created_at);
CREATE INDEX idx_credit_ledger_owner_job
  ON credit_ledger(owner_id, job_id);

CREATE VIEW credit_balances AS
SELECT
  owner_id,
  COALESCE(SUM(
    CASE event_type
      WHEN 'grant' THEN quantity
      WHEN 'reserve' THEN -quantity
      WHEN 'release' THEN quantity
      ELSE 0
    END
  ), 0) AS available_credits,
  COALESCE(SUM(
    CASE event_type
      WHEN 'reserve' THEN quantity
      WHEN 'settle' THEN -quantity
      WHEN 'release' THEN -quantity
      ELSE 0
    END
  ), 0) AS reserved_credits,
  COALESCE(SUM(CASE WHEN event_type = 'settle' THEN quantity ELSE 0 END), 0)
    AS settled_credits
FROM credit_ledger
GROUP BY owner_id;
