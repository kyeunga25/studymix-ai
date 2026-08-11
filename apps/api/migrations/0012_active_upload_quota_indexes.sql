CREATE INDEX idx_uploads_owner_pending_active
  ON uploads(owner_id, expires_at)
  WHERE status = 'pending';

CREATE INDEX idx_uploads_owner_confirmed_active
  ON uploads(owner_id)
  WHERE status = 'confirmed';
