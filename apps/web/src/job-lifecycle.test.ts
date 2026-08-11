import type { JobStatus } from "@studymix/contracts";
import { describe, expect, it } from "vitest";
import { isPendingJob } from "./job-lifecycle";

describe("job lifecycle presentation", () => {
  it.each([
    ["created", true],
    ["validating", true],
    ["queued", true],
    ["generating", true],
    ["processing_output", true],
    ["completed", false],
    ["failed", false],
    ["expired", false],
    ["cancelled", false],
  ] satisfies readonly (readonly [JobStatus, boolean])[])(
    "classifies %s without changing server state",
    (status, expected) => {
      expect(isPendingJob(status)).toBe(expected);
    },
  );
});
