CREATE INDEX idx_jobs_upload_id ON jobs(upload_id);

CREATE INDEX idx_uploads_pending_created_id
  ON uploads(created_at, id)
  WHERE status = 'pending';

CREATE INDEX idx_uploads_stored_expires_id
  ON uploads(expires_at, id)
  WHERE status IN ('confirmed', 'expired');
