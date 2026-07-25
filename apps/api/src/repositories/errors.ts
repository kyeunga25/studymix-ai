export class RepositoryConflictError extends Error {
  readonly code = "CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

export class RepositoryNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "RepositoryNotFoundError";
  }
}

export class RepositoryQuotaError extends Error {
  readonly code = "RATE_LIMITED";

  constructor(message: string) {
    super(message);
    this.name = "RepositoryQuotaError";
  }
}

export class RepositoryLegalAcceptanceRequiredError extends Error {
  readonly code = "LEGAL_ACCEPTANCE_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "RepositoryLegalAcceptanceRequiredError";
  }
}

export class RepositoryStateError extends Error {
  readonly code = "ILLEGAL_JOB_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "RepositoryStateError";
  }
}
