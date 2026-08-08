CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    id GLOB 'wsp_[0-9a-f]*'
    AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'
    AND length(id) = 36
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspace_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role = 'owner'),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  is_default INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, owner_id)
);

CREATE UNIQUE INDEX idx_workspace_memberships_default_owner
  ON workspace_memberships(owner_id)
  WHERE is_default = 1;

CREATE INDEX idx_workspace_memberships_workspace_status
  ON workspace_memberships(workspace_id, status);

CREATE TABLE workspace_controls (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  ai_job_approval_mode TEXT NOT NULL CHECK (ai_job_approval_mode = 'manual'),
  max_job_credit_cost INTEGER NOT NULL CHECK (max_job_credit_cost > 0 AND max_job_credit_cost <= 1000),
  real_provider_status TEXT NOT NULL CHECK (
    real_provider_status IN ('disabled', 'review_required', 'approved')
  ),
  payment_status TEXT NOT NULL CHECK (
    payment_status IN ('disabled', 'review_required', 'approved')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE owner_invitations (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    id GLOB 'inv_[0-9a-f]*'
    AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'
    AND length(id) = 36
  ),
  login_identity_hash TEXT NOT NULL UNIQUE CHECK (
    login_identity_hash GLOB '[0-9a-f]*'
    AND login_identity_hash NOT GLOB '*[^0-9a-f]*'
    AND length(login_identity_hash) = 64
  ),
  workspace_id TEXT NOT NULL UNIQUE CHECK (
    workspace_id GLOB 'wsp_[0-9a-f]*'
    AND substr(workspace_id, 5) NOT GLOB '*[^0-9a-f]*'
    AND length(workspace_id) = 36
  ),
  role TEXT NOT NULL CHECK (role = 'owner'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'revoked')),
  initial_credit_grant INTEGER NOT NULL CHECK (
    initial_credit_grant >= 0 AND initial_credit_grant <= 1000
  ),
  max_job_credit_cost INTEGER NOT NULL CHECK (
    max_job_credit_cost > 0 AND max_job_credit_cost <= 1000
  ),
  claimed_owner_id TEXT REFERENCES owners(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK (
    (status = 'consumed' AND claimed_owner_id IS NOT NULL AND consumed_at IS NOT NULL)
    OR (status IN ('pending', 'revoked') AND claimed_owner_id IS NULL AND consumed_at IS NULL)
  )
);

CREATE INDEX idx_owner_invitations_status
  ON owner_invitations(status);
