// Structured error shape — stdout for command-level failures.
// Every error includes error code, message, and optionally received/expected/next.
export interface StructuredError {
  error: string
  message: string
  received?: unknown
  expected?: string
  next?: string
}

export function structuredError(e: StructuredError): never {
  process.stdout.write(JSON.stringify(e) + '\n')
  process.exit(1)
}

export function internalError(message: string, cause?: unknown): never {
  const e: StructuredError = {
    error: 'internal',
    message,
  }
  process.stdout.write(JSON.stringify(e) + '\n')
  if (process.env.ZIGZAG_DEBUG === '1' && cause instanceof Error && cause.stack !== undefined) {
    process.stderr.write(cause.stack + '\n')
  }
  process.exit(1)
}

// Thrown internally; caught at top-level and converted to structured output.
export class CLIError extends Error {
  readonly structured: StructuredError
  constructor(e: StructuredError) {
    super(e.message)
    this.structured = e
  }
}
