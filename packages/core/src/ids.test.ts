import { describe, expect, it } from "vitest";
import { createSecureId, isSecureId, resourceIdPrefixes } from "./ids";

describe("secure resource IDs", () => {
  it.each(resourceIdPrefixes)("creates a cryptographically-shaped %s ID", (prefix) => {
    const id = createSecureId(prefix);

    expect(id).toMatch(new RegExp(`^${prefix}_[0-9a-f]{32}$`));
    expect(isSecureId(id, prefix)).toBe(true);
  });

  it("does not repeat IDs across a representative batch", () => {
    const ids = new Set(Array.from({ length: 512 }, () => createSecureId("job")));

    expect(ids.size).toBe(512);
  });

  it("rejects IDs with the wrong prefix or entropy length", () => {
    expect(isSecureId("upl_0123456789abcdef0123456789abcdef", "job")).toBe(false);
    expect(isSecureId("job_0123", "job")).toBe(false);
  });
});
