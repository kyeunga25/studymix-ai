import { describe, expect, it } from "vitest";
import {
  DisabledPaymentBoundary,
  MockPaymentBoundary,
  PaymentBoundaryDisabledError,
  PaymentBoundaryEventNotFoundError,
  verifiedPaymentEventSchema,
} from "./payment-boundary";

const ownerId = "own_0123456789abcdef0123456789abcdef";
const occurredAt = "2026-08-02T00:00:00.000Z";
const eventReference = "pye_11111111111111111111111111111111";

describe("provider-neutral payment boundary", () => {
  it("keeps payment collection disabled by default", async () => {
    const boundary = new DisabledPaymentBoundary();
    expect(boundary.mode).toBe("disabled");
    await expect(boundary.getVerifiedEvent(eventReference)).rejects.toBeInstanceOf(
      PaymentBoundaryDisabledError,
    );
  });

  it("accepts only strict normalized synthetic events", async () => {
    const event = verifiedPaymentEventSchema.parse({
      creditUnits: 20,
      eventReference,
      kind: "topup",
      occurredAt,
      ownerId,
      paymentStatus: "paid",
      subscriptionStatus: null,
    });
    const boundary = new MockPaymentBoundary([event]);

    await expect(boundary.getVerifiedEvent(event.eventReference)).resolves.toEqual(event);
    await expect(
      boundary.getVerifiedEvent("pye_22222222222222222222222222222222"),
    ).rejects.toBeInstanceOf(PaymentBoundaryEventNotFoundError);
    expect(
      verifiedPaymentEventSchema.safeParse({ ...event, merchantId: "private-merchant" }).success,
    ).toBe(false);
  });

  it("keeps recurring and top-up lifecycle state unambiguous", () => {
    expect(
      verifiedPaymentEventSchema.safeParse({
        creditUnits: 10,
        eventReference: "pye_33333333333333333333333333333333",
        kind: "recurring",
        occurredAt,
        ownerId,
        paymentStatus: "paid",
        subscriptionStatus: "active",
      }).success,
    ).toBe(true);
    expect(
      verifiedPaymentEventSchema.safeParse({
        creditUnits: 10,
        eventReference: "pye_44444444444444444444444444444444",
        kind: "topup",
        occurredAt,
        ownerId,
        paymentStatus: "paid",
        subscriptionStatus: "active",
      }).success,
    ).toBe(false);
  });
});
