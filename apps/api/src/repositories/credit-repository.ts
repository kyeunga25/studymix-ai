import {
  creditSummarySchema,
  jobIdSchema,
  ownerIdSchema,
  type CreditSummary,
} from "@studymix/contracts";
import { z } from "zod";
import { RepositoryNotFoundError, RepositoryStateError } from "./errors";

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
  plan_code: z.literal("private-beta"),
  reserved_credits: z.number().int().nonnegative().safe(),
  settled_credits: z.number().int().nonnegative().safe(),
  status: z.enum(["trialing", "active", "past_due", "grace", "uncollectible", "cancelled"]),
  updated_at: z.string().datetime({ offset: true }),
});

export type CreditReservationStatus = "none" | "released" | "reserved" | "settled";

function mapCreditSummary(value: unknown): CreditSummary {
  const row = creditSummaryRowSchema.parse(value);
  return creditSummarySchema.parse({
    availableCredits: row.available_credits,
    plan: row.plan_code,
    reservedCredits: row.reserved_credits,
    settledCredits: row.settled_credits,
    status: row.status,
    updatedAt: row.updated_at,
  });
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
        entitlements.updated_at,
        COALESCE(balances.available_credits, 0) AS available_credits,
        COALESCE(balances.reserved_credits, 0) AS reserved_credits,
        COALESCE(balances.settled_credits, 0) AS settled_credits
      FROM owner_entitlements AS entitlements
      LEFT JOIN credit_balances AS balances ON balances.owner_id = entitlements.owner_id
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

  const summary = await getOwnedCreditSummary(db, parsed.ownerId);
  if (summary === null) {
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

async function finalizeOwnedJobCredits(
  db: D1Database,
  input: {
    createdAt: string;
    eventId: string;
    eventType: "release" | "settle";
    jobId: string;
    ownerId: string;
  },
): Promise<CreditReservationStatus> {
  const parsed = z
    .object({
      createdAt: z.string().datetime({ offset: true }),
      eventId: creditEventIdSchema,
      eventType: z.enum(["release", "settle"]),
      jobId: jobIdSchema,
      ownerId: ownerIdSchema,
    })
    .parse(input);
  const referenceKey = `job:${parsed.jobId}:${parsed.eventType}`;
  await db
    .prepare(
      `INSERT INTO credit_ledger (
        id, owner_id, job_id, event_type, quantity, reference_key, created_at
      )
      SELECT ?1, reserve.owner_id, reserve.job_id, ?2, reserve.quantity, ?3, ?4
      FROM credit_ledger AS reserve
      WHERE reserve.owner_id = ?5
        AND reserve.job_id = ?6
        AND reserve.event_type = 'reserve'
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger AS final
          WHERE final.owner_id = reserve.owner_id
            AND final.job_id = reserve.job_id
            AND final.event_type IN ('settle', 'release')
        )
      ON CONFLICT (owner_id, reference_key) DO NOTHING`,
    )
    .bind(
      parsed.eventId,
      parsed.eventType,
      referenceKey,
      parsed.createdAt,
      parsed.ownerId,
      parsed.jobId,
    )
    .run();

  const status = await getOwnedCreditReservationStatus(db, parsed.ownerId, parsed.jobId);
  if (status === "none") {
    throw new RepositoryStateError("The job has no credit reservation.");
  }
  return status;
}

export async function settleOwnedJobCredits(
  db: D1Database,
  input: Omit<Parameters<typeof finalizeOwnedJobCredits>[1], "eventType">,
): Promise<CreditReservationStatus> {
  return await finalizeOwnedJobCredits(db, { ...input, eventType: "settle" });
}

export async function releaseOwnedJobCredits(
  db: D1Database,
  input: Omit<Parameters<typeof finalizeOwnedJobCredits>[1], "eventType">,
): Promise<CreditReservationStatus> {
  return await finalizeOwnedJobCredits(db, { ...input, eventType: "release" });
}
