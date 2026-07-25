CREATE INDEX IF NOT EXISTS idx_jobs_owner_created_at ON jobs(owner_id, created_at);
