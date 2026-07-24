CREATE TABLE owners (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('authenticated', 'development')),
  auth_issuer TEXT NOT NULL,
  auth_subject_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (auth_issuer, auth_subject_hash)
);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  declared_content_type TEXT NOT NULL,
  size_bytes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'deleted')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE RESTRICT,
  preset_id TEXT NOT NULL,
  preset_version INTEGER NOT NULL CHECK (preset_version > 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'created',
      'validating',
      'queued',
      'generating',
      'processing_output',
      'completed',
      'failed',
      'expired',
      'cancelled'
    )
  ),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  workflow_instance_id TEXT,
  candidate_count INTEGER NOT NULL CHECK (candidate_count = 2),
  provider TEXT NOT NULL CHECK (provider IN ('mock', 'fal', 'self-hosted')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  UNIQUE (owner_id, idempotency_key)
);

CREATE TABLE provider_requests (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  candidate_index INTEGER NOT NULL CHECK (candidate_index IN (0, 1)),
  provider TEXT NOT NULL CHECK (provider IN ('mock', 'fal', 'self-hosted')),
  provider_request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'completed', 'failed')),
  seed INTEGER,
  submitted_at TEXT,
  completed_at TEXT,
  cost_estimate_usd REAL,
  error_code TEXT,
  UNIQUE (job_id, candidate_index)
);

CREATE TABLE outputs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  candidate_index INTEGER NOT NULL CHECK (candidate_index IN (0, 1)),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT,
  size_bytes INTEGER,
  duration_seconds REAL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'expired', 'deleted')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE (job_id, candidate_index)
);

CREATE TABLE rights_declarations (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  declaration_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_uploads_owner ON uploads(owner_id);
CREATE INDEX idx_uploads_expiry ON uploads(expires_at);
CREATE INDEX idx_jobs_owner ON jobs(owner_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_expiry ON jobs(expires_at);
CREATE INDEX idx_provider_requests_job ON provider_requests(job_id);
CREATE UNIQUE INDEX idx_provider_requests_provider_id
  ON provider_requests(provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE INDEX idx_outputs_job ON outputs(job_id);
CREATE INDEX idx_outputs_expiry ON outputs(expires_at);
CREATE INDEX idx_rights_declarations_owner ON rights_declarations(owner_id);
CREATE INDEX idx_usage_events_owner_created ON usage_events(owner_id, created_at);
