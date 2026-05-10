// Output helpers. The CLI is dual-mode: human-readable by default, JSON
// when --json is set. Both modes write to stdout so a script can pipe.
// Errors always go to stderr (see errors.ts + index.ts top-level handler).
//
// Why one helper instead of `console.log` directly: every command that
// supports `--json` would otherwise need an `if (json) ... else ...`
// branch. Centralizing keeps formatting decisions together and makes it
// trivial to add e.g. NDJSON or table output later.

export type OutputMode = 'human' | 'json'

export function printResult(mode: OutputMode, jsonValue: unknown, humanLines: string[]): void {
  if (mode === 'json') {
    process.stdout.write(JSON.stringify(jsonValue, null, 2) + '\n')
    return
  }
  for (const line of humanLines) {
    process.stdout.write(line + '\n')
  }
}

export function printError(message: string, hint: string | null = null): void {
  process.stderr.write(`error: ${message}\n`)
  if (hint !== null) process.stderr.write(`hint: ${hint}\n`)
}
