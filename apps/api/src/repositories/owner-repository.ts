import { z } from "zod";
import type { OwnerContext } from "../auth/owner-context";

const ownerRowSchema = z.object({
  created_at: z.string().datetime({ offset: true }),
  id: z.string().regex(/^own_[0-9a-f]{32}$/),
  kind: z.enum(["authenticated", "development"]),
  last_seen_at: z.string().datetime({ offset: true }),
  status: z.enum(["active", "disabled"]),
});

export type OwnerRecord = {
  createdAt: string;
  id: string;
  kind: "authenticated" | "development";
  lastSeenAt: string;
  status: "active" | "disabled";
};

function mapOwnerRow(value: unknown): OwnerRecord {
  const row = ownerRowSchema.parse(value);
  return {
    createdAt: row.created_at,
    id: row.id,
    kind: row.kind,
    lastSeenAt: row.last_seen_at,
    status: row.status,
  };
}

export async function upsertOwner(
  db: D1Database,
  owner: OwnerContext,
  now: string,
): Promise<OwnerRecord> {
  const row = await db
    .prepare(
      `INSERT INTO owners (
        id, kind, auth_issuer, auth_subject_hash, status, created_at, last_seen_at
      ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)
      ON CONFLICT (auth_issuer, auth_subject_hash) DO UPDATE SET
        last_seen_at = excluded.last_seen_at
      RETURNING id, kind, status, created_at, last_seen_at`,
    )
    .bind(owner.ownerId, owner.kind, owner.authIssuer, owner.authSubjectHash, now)
    .first();

  return mapOwnerRow(row);
}

export async function getOwner(db: D1Database, ownerId: string): Promise<OwnerRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, kind, status, created_at, last_seen_at
       FROM owners
       WHERE id = ?1`,
    )
    .bind(ownerId)
    .first();

  return row === null ? null : mapOwnerRow(row);
}
