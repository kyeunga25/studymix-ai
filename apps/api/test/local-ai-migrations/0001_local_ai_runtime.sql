CREATE TABLE IF NOT EXISTS local_ai_sources (
  upload_id TEXT PRIMARY KEY NOT NULL REFERENCES uploads(id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  fixture_id TEXT NOT NULL CHECK (fixture_id = 'deterministic-tone-v1'),
  scenario TEXT NOT NULL CHECK (
    scenario IN ('success', 'terminal-failure', 'timeout-recovery')
  ),
  duration_seconds REAL NOT NULL CHECK (duration_seconds > 0),
  content_type TEXT NOT NULL CHECK (content_type = 'audio/wav'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, request_key)
);

CREATE TABLE IF NOT EXISTS local_ai_job_policies (
  job_id TEXT PRIMARY KEY NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  source_upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE RESTRICT,
  scenario TEXT NOT NULL CHECK (
    scenario IN ('success', 'terminal-failure', 'timeout-recovery')
  ),
  source_duration_seconds REAL NOT NULL CHECK (source_duration_seconds > 0),
  source_content_type TEXT NOT NULL CHECK (source_content_type = 'audio/wav'),
  source_size_bytes INTEGER NOT NULL CHECK (source_size_bytes > 0),
  quality_tier TEXT NOT NULL CHECK (quality_tier = 'synthetic-preview'),
  candidate_count INTEGER NOT NULL CHECK (candidate_count = 2),
  max_attempts_per_candidate INTEGER NOT NULL CHECK (max_attempts_per_candidate > 0),
  max_concurrent_candidates INTEGER NOT NULL CHECK (
    max_concurrent_candidates > 0 AND max_concurrent_candidates <= 2
  ),
  max_cost_units INTEGER NOT NULL CHECK (max_cost_units > 0),
  max_input_duration_seconds REAL NOT NULL CHECK (max_input_duration_seconds > 0),
  max_output_duration_seconds REAL NOT NULL CHECK (max_output_duration_seconds > 0),
  max_output_bytes INTEGER NOT NULL CHECK (max_output_bytes > 0),
  retention_seconds INTEGER NOT NULL CHECK (retention_seconds > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_ai_job_policies_owner
  ON local_ai_job_policies(owner_id, job_id);

CREATE TABLE IF NOT EXISTS local_ai_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  candidate_index INTEGER NOT NULL CHECK (candidate_index IN (0, 1)),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL CHECK (
    status IN ('submitted', 'polling', 'completed', 'failed', 'cancelled')
  ),
  estimated_cost_units INTEGER NOT NULL CHECK (estimated_cost_units >= 0),
  actual_cost_units INTEGER CHECK (actual_cost_units >= 0),
  last_poll_attempt INTEGER NOT NULL DEFAULT 0 CHECK (last_poll_attempt >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, job_id, candidate_index, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_local_ai_attempts_owner_job
  ON local_ai_attempts(owner_id, job_id);
