export class BrainUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainUserError";
  }
}

export class BrainInternalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BrainInternalError";
  }
}
