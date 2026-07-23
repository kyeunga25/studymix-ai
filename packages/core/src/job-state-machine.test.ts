import { describe, expect, it } from "vitest";
import { jobStatuses, type JobStatus } from "@studymix/contracts";
import {
  canTransitionJob,
  getAllowedJobTransitions,
  IllegalJobTransitionError,
  jobTransitions,
  transitionJobState,
} from "./job-state-machine";

const allowedPairs = jobStatuses.flatMap((current) =>
  jobTransitions[current].map((next) => [current, next] as const),
);

const rejectedPairs = jobStatuses.flatMap((current) =>
  jobStatuses
    .filter((next) => !jobTransitions[current].some((allowed) => allowed === next))
    .map((next) => [current, next] as const),
);

describe("job state machine", () => {
  it.each(allowedPairs)("allows %s -> %s", (current, next) => {
    expect(canTransitionJob(current, next)).toBe(true);
    expect(transitionJobState(current, next)).toBe(next);
  });

  it.each(rejectedPairs)("rejects %s -> %s", (current, next) => {
    expect(canTransitionJob(current, next)).toBe(false);
    expect(() => transitionJobState(current, next)).toThrow(IllegalJobTransitionError);
  });

  it("reports transition context without exposing implementation details", () => {
    try {
      transitionJobState("completed", "generating");
      throw new Error("Expected transition to fail.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(IllegalJobTransitionError);

      const transitionError = error as IllegalJobTransitionError;
      expect(transitionError.code).toBe("ILLEGAL_JOB_TRANSITION");
      expect(transitionError.current).toBe("completed");
      expect(transitionError.next).toBe("generating");
    }
  });

  it("returns the complete allowed target set for every state", () => {
    for (const status of jobStatuses) {
      expect(getAllowedJobTransitions(status)).toEqual(jobTransitions[status]);
    }
  });

  it("covers every possible public state pair", () => {
    const expectedPairCount = jobStatuses.length * jobStatuses.length;
    expect(allowedPairs.length + rejectedPairs.length).toBe(expectedPairCount);
  });
});

const _compileTimeStatusCheck: JobStatus = "processing_output";
void _compileTimeStatusCheck;
