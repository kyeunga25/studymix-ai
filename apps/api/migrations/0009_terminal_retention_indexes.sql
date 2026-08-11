CREATE INDEX idx_jobs_completed_expiry_cutoff
  ON jobs(status, expires_at)
  WHERE status = 'completed';

CREATE INDEX idx_jobs_failed_completed_cutoff
  ON jobs(status, completed_at)
  WHERE status IN ('failed', 'cancelled');
