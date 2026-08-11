CREATE INDEX idx_jobs_owner_active
  ON jobs(owner_id)
  WHERE status IN ('created', 'validating', 'queued', 'generating', 'processing_output');
