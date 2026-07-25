CREATE TABLE legal_acceptances (
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  document_id TEXT NOT NULL CHECK (
    document_id IN ('terms-of-use', 'acceptable-use', 'ai-output-notice')
  ),
  document_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, document_id, document_version)
);

CREATE INDEX idx_legal_acceptances_owner_accepted
  ON legal_acceptances(owner_id, accepted_at);
