// Typed errors that map to consistent exit codes and recovery hints.
// Commands should `throw new CLIError(...)` rather than `console.error +
// process.exit` so the top-level handler can format every failure the
// same way (JSON or human, exit code consistent).
export type ErrorCategory =
  | 'auth'        // not logged in / token revoked / 401
  | 'api'         // server returned an error response
  | 'network'     // fetch threw
  | 'usage'       // bad arguments
  | 'state'       // local state precondition failed (e.g. no active org)

const EXIT_CODE_BY_CATEGORY: Record<ErrorCategory, number> = {
  auth: 1,
  api: 1,
  network: 1,
  state: 1,
  usage: 2,
}

export class CLIError extends Error {
  category: ErrorCategory
  hint: string | null
  constructor(
    category: ErrorCategory,
    message: string,
    hint: string | null = null,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined)
    this.category = category
    this.hint = hint
  }
  exitCode(): number {
    return EXIT_CODE_BY_CATEGORY[this.category]
  }
}
