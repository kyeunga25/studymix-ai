CREATE INDEX idx_credit_ledger_owner_instant
  ON credit_ledger(owner_id, julianday(created_at) DESC, created_at DESC);
