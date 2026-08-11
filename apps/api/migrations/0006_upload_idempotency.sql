ALTER TABLE uploads ADD COLUMN idempotency_key TEXT CHECK (
  idempotency_key IS NULL
  OR (
    length(idempotency_key) >= 8
    AND length(idempotency_key) <= 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  )
);

ALTER TABLE uploads ADD COLUMN request_fingerprint TEXT CHECK (
  (idempotency_key IS NULL AND request_fingerprint IS NULL)
  OR (
    idempotency_key IS NOT NULL
    AND request_fingerprint GLOB '[0-9a-f]*'
    AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
    AND length(request_fingerprint) = 64
  )
);

CREATE UNIQUE INDEX idx_uploads_owner_idempotency
  ON uploads(owner_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
