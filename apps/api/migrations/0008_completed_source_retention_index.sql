CREATE INDEX idx_jobs_completed_source_cutoff
  ON jobs(status, completed_at, upload_id)
  WHERE status = 'completed';
