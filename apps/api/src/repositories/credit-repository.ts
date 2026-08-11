import {
  creditSummarySchema,
  jobIdSchema,
  ownerIdSchema,
  type CreditSummary,
} from "@studymix/contracts";
import { z } from "zod";
import { RepositoryConflictError, RepositoryNotFoundError } from "./errors";

const creditEventIdSchema = z.string().regex(/^evt_[0-9a-f]{32}$/);
const creditReferenceKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);
const creditQuantitySchema = z.number().int().positive().max(1_000_000);

const grantCreditsSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  eventId: creditEventIdSchema,
  ownerId: ownerIdSchema,
  quantity: creditQuantitySchema,
  referenceKey: creditReferenceKeySchema,
});

const creditSummaryRowSchema = z.object({
  available_credits: z.number().int().nonnegative().safe(),
  entitlement_updated_at: z.string().datetime({ offset: true }),
  ledger_updated_at: z.string().datetime({ offset: true }).nullable(),
  plan_code: z.literal("private-beta"),
  reserved_credits: z.number().int().nonnegative().safe(),
  settled_credits: z.number().int().nonnegative().safe(),
  status: z.enum(["trialing", "active", "past_due", "grace", "uncollectible", "cancelled"]),
});
const creditReferenceRowSchema = z.object({
  event_type: z.enum(["grant", "reserve", "settle", "release"]),
  quantity: creditQuantitySchema,
});

export type CreditReservationStatus = "none" | "released" | "reserved" | "settled";

function mapCreditSummary(value: unknown): CreditSummary {
  const row = creditSummaryRowSchema.parse(value);
  const updatedAt =
    row.ledger_updated_at !== null &&
    Date.parse(row.ledger_updated_at) > Date.parse(row.entitlement_updated_at)
      ? row.ledger_updated_at
      : row.entitlement_updated_at;
  return creditSummarySchema.parse({
    availableCredits: row.available_credits,
    plan: row.plan_code,
    reservedCredits: row.reserved_credits,
    settledCredits: row.settled_credits,
    status: row.status,
    updatedAt,
  });
}

async function getOwnedCreditReference(
  db: D1Database,
  ownerId: string,
  referenceKey: string,
): Promise<z.infer<typeof creditReferenceRowSchema> | null> {
  const row = await db
    .prepare(
      `SELECT event_type, quantity
       FROM credit_ledger
       WHERE owner_id = ?1 AND reference_key = ?2`,
    )
    .bind(ownerIdSchema.parse(ownerId), creditReferenceKeySchema.parse(referenceKey))
    .first();
  return row === null ? null : creditReferenceRowSchema.parse(row);
}

function assertMatchingGrantReference(
  reference: z.infer<typeof creditReferenceRowSchema>,
  quantity: number,
): void {
  if (reference.event_type !== "grant" || reference.quantity !== quantity) {
    throw new RepositoryConflictError(
      "The credit reference is already bound to a different grant.",
    );
  }
}

export async function getOwnedCreditSummary(
  db: D1Database,
  ownerId: string,
): Promise<CreditSummary | null> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const row = await db
    .prepare(
      `SELECT
        entitlements.plan_code,
        entitlements.status,
        entitlements.updated_at AS entitlement_updated_at,
        (
          SELECT ledger.created_at
          FROM credit_ledger AS ledger
          WHERE ledger.owner_id = entitlements.owner_id
          ORDER BY julianday(ledger.created_at) DESC, ledger.created_at DESC
          LIMIT 1
        ) AS ledger_updated_at,
        COALESCE(balances.available_credits, 0) AS available_credits,
        COALESCE(balances.reserved_credits, 0) AS reserved_credits,
        COALESCE(balances.settled_credits, 0) AS settled_credits
      FROM owner_entitlements AS entitlements
      LEFT JOIN (
        SELECT owner_id, available_credits, reserved_credits, settled_credits
        FROM credit_balances
        WHERE owner_id = ?1
      ) AS balances ON balances.owner_id = entitlements.owner_id
      WHERE entitlements.owner_id = ?1`,
    )
    .bind(parsedOwnerId)
    .first();
  return row === null ? null : mapCreditSummary(row);
}

export async function grantPrivateBetaCredits(
  db: D1Database,
  input: z.input<typeof grantCreditsSchema>,
): Promise<CreditSummary> {
  const parsed = grantCreditsSchema.parse(input);
  const existingReference = await getOwnedCreditReference(db, parsed.ownerId, parsed.referenceKey);
  if (existingReference !== null) {
    assertMatchingGrantReference(existingReference, parsed.quantity);
    const existingSummary = await getOwnedCreditSummary(db, parsed.ownerId);
    if (existingSummary === null) {
      throw new RepositoryNotFoundError("The owner entitlement could not be found.");
    }
    return existingSummary;
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO owner_entitlements (
          owner_id, plan_code, status, created_at, updated_at
        )
        SELECT id, 'private-beta', 'active', ?2, ?2
        FROM owners
        WHERE id = ?1
        ON CONFLICT (owner_id) DO NOTHING`,
      )
      .bind(parsed.ownerId, parsed.createdAt),
    db
      .prepare(
        `INSERT INTO credit_ledger (
          id, owner_id, job_id, event_type, quantity, reference_key, created_at
        )
        SELECT ?1, owners.id, NULL, 'grant', ?3, ?4, ?5
        FROM owners
        WHERE owners.id = ?2
        ON CONFLICT (owner_id, reference_key) DO NOTHING`,
      )
      .bind(parsed.eventId, parsed.ownerId, parsed.quantity, parsed.referenceKey, parsed.createdAt),
  ]);

  const recordedReference = await getOwnedCreditReference(db, parsed.ownerId, parsed.referenceKey);
  if (recordedReference !== null) {
    assertMatchingGrantReference(recordedReference, parsed.quantity);
  }
  const summary = await getOwnedCreditSummary(db, parsed.ownerId);
  if (recordedReference === null || summary === null) {
    throw new RepositoryNotFoundError("The owner entitlement could not be provisioned.");
  }
  return summary;
}

export async function getOwnedCreditReservationStatus(
  db: D1Database,
  ownerId: string,
  jobId: string,
): Promise<CreditReservationStatus> {
  const parsedOwnerId = ownerIdSchema.parse(ownerId);
  const parsedJobId = jobIdSchema.parse(jobId);
  const rows = await db
    .prepare(
      `SELECT event_type FROM credit_ledger
       WHERE owner_id = ?1
         AND job_id = ?2
         AND event_type IN ('reserve', 'settle', 'release')`,
    )
    .bind(parsedOwnerId, parsedJobId)
    .all<{ event_type: "release" | "reserve" | "settle" }>();
  const events = new Set(rows.results.map((row) => row.event_type));
  if (events.has("settle")) {
    return "settled";
  }
  if (events.has("release")) {
    return "released";
  }
  return events.has("reserve") ? "reserved" : "none";
}
