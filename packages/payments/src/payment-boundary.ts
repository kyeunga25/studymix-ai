import { isoDateTimeSchema, ownerIdSchema } from "@studymix/contracts";
import { z } from "zod";

export const paymentKinds = ["recurring", "topup"] as const;
export const paymentKindSchema = z.enum(paymentKinds);

export const paymentStatuses = [
  "pending",
  "paid",
  "failed",
  "expired",
  "partially_refunded",
  "refunded",
  "disputed",
  "reversed",
] as const;
export const paymentStatusSchema = z.enum(paymentStatuses);

export const subscriptionStatuses = [
  "trialing",
  "active",
  "past_due",
  "grace",
  "uncollectible",
  "cancelled",
] as const;
export const subscriptionStatusSchema = z.enum(subscriptionStatuses);

export const paymentEventReferenceSchema = z.string().regex(/^pye_[0-9a-f]{32}$/);

export const verifiedPaymentEventSchema = z
  .object({
    creditUnits: z.number().int().nonnegative().max(1_000_000),
    eventReference: paymentEventReferenceSchema,
    kind: paymentKindSchema,
    occurredAt: isoDateTimeSchema,
    ownerId: ownerIdSchema,
    paymentStatus: paymentStatusSchema,
    subscriptionStatus: subscriptionStatusSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "recurring" && value.subscriptionStatus === null) {
      context.addIssue({
        code: "custom",
        message: "Recurring events require a subscription status.",
        path: ["subscriptionStatus"],
      });
    }
    if (value.kind === "topup" && value.subscriptionStatus !== null) {
      context.addIssue({
        code: "custom",
        message: "Top-up events cannot carry a subscription status.",
        path: ["subscriptionStatus"],
      });
    }
  });

export type VerifiedPaymentEvent = z.infer<typeof verifiedPaymentEventSchema>;

export interface PaymentBoundary {
  readonly mode: "disabled" | "mock";
  getVerifiedEvent(eventReference: string): Promise<VerifiedPaymentEvent>;
}

export class PaymentBoundaryDisabledError extends Error {
  override readonly name = "PaymentBoundaryDisabledError";
}

export class PaymentBoundaryEventNotFoundError extends Error {
  override readonly name = "PaymentBoundaryEventNotFoundError";
}

export class DisabledPaymentBoundary implements PaymentBoundary {
  readonly mode = "disabled" as const;

  async getVerifiedEvent(eventReference: string): Promise<VerifiedPaymentEvent> {
    void eventReference;
    throw new PaymentBoundaryDisabledError("Payment collection is disabled.");
  }
}

export class MockPaymentBoundary implements PaymentBoundary {
  readonly mode = "mock" as const;
  readonly #events: ReadonlyMap<string, VerifiedPaymentEvent>;

  constructor(events: readonly VerifiedPaymentEvent[]) {
    const parsedEvents = z.array(verifiedPaymentEventSchema).max(100).parse(events);
    this.#events = new Map(parsedEvents.map((event) => [event.eventReference, event]));
    if (this.#events.size !== parsedEvents.length) {
      throw new TypeError("Synthetic payment event references must be unique.");
    }
  }

  async getVerifiedEvent(eventReference: string): Promise<VerifiedPaymentEvent> {
    const parsedReference = paymentEventReferenceSchema.parse(eventReference);
    const event = this.#events.get(parsedReference);
    if (event === undefined) {
      throw new PaymentBoundaryEventNotFoundError("Synthetic payment event was not found.");
    }
    return await Promise.resolve(event);
  }
}
