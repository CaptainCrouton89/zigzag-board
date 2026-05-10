#!/usr/bin/env node
import { Command, Option } from 'commander'
import { CLIError } from './errors.js'
import { printError, type OutputMode } from './output.js'
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { whoamiCommand } from './commands/whoami.js'
import { orgListCommand, orgUseCommand } from './commands/org.js'
import { boardShowCommand } from './commands/board.js'
import {
  cardAddCommand, cardMoveCommand, cardEditCommand, cardRmCommand,
} from './commands/card.js'
import {
  laneAddCommand, laneRenameCommand, laneTypeCommand, laneRmCommand,
} from './commands/lane.js'

// One JSON option, threaded into every command that supports machine
// output. Defining it as a local helper keeps each subcommand's
// declaration single-line.
const jsonOpt = new Option('--json', 'output JSON instead of human text')

function modeFromOpts(opts: { json?: boolean }): OutputMode {
  return opts.json === true ? 'json' : 'human'
}

const program = new Command()
program
  .name('zigzag')
  .description('Zigzag Board CLI — designed so an AI agent can read and modify a board on the user\'s behalf')
  .version('0.1.0')

program
  .command('login')
  .description('Authenticate via the browser device flow and save a long-lived bearer token')
  .action(async () => {
    await loginCommand()
  })

program
  .command('logout')
  .description('Revoke the current device token and remove local credentials')
  .action(async () => {
    await logoutCommand()
  })

program
  .command('whoami')
  .description('Print the active user, API URL, and active org')
  .addOption(jsonOpt)
  .action(async (opts: { json?: boolean }) => {
    await whoamiCommand(modeFromOpts(opts))
  })

const orgGroup = program
  .command('org')
  .description('Manage which organization the CLI operates on')

orgGroup
  .command('list')
  .description('List organizations you are a member of')
  .addOption(jsonOpt)
  .action(async (opts: { json?: boolean }) => {
    await orgListCommand(modeFromOpts(opts))
  })

orgGroup
  .command('use <id-or-slug>')
  .description('Set the active organization for this CLI session (matched by id then slug)')
  .action(async (target: string) => {
    await orgUseCommand(target)
  })

const boardGroup = program
  .command('board')
  .description('Read the active board')

boardGroup
  .command('show')
  .description('Print all lanes and cards on the active board')
  .addOption(jsonOpt)
  .action(async (opts: { json?: boolean }) => {
    await boardShowCommand(modeFromOpts(opts))
  })

const cardGroup = program
  .command('card')
  .description('Create, move, edit, and remove cards')

cardGroup
  .command('add')
  .description('Add a new card to a lane. Use --before/--after to position relative to an existing card; default is end of lane')
  .requiredOption('--lane <id>', 'destination lane id (from `zigzag board show`)')
  .requiredOption('--text <text>', 'card text')
  .option('--before <cardId>', 'place this card immediately before the given card')
  .option('--after <cardId>', 'place this card immediately after the given card')
  .addOption(jsonOpt)
  .action(async (opts: { lane: string; text: string; before?: string; after?: string; json?: boolean }) => {
    await cardAddCommand(opts, modeFromOpts(opts))
  })

cardGroup
  .command('move <cardId>')
  .description('Move a card to a different lane and/or position. At least one of --lane, --before, --after is required')
  .option('--lane <id>', 'destination lane id (omit to keep current lane)')
  .option('--before <cardId>', 'place this card immediately before the given card')
  .option('--after <cardId>', 'place this card immediately after the given card')
  .addOption(jsonOpt)
  .action(async (cardId: string, opts: { lane?: string; before?: string; after?: string; json?: boolean }) => {
    await cardMoveCommand(cardId, opts, modeFromOpts(opts))
  })

cardGroup
  .command('edit <cardId>')
  .description('Replace the text of a card')
  .requiredOption('--text <text>', 'new card text')
  .addOption(jsonOpt)
  .action(async (cardId: string, opts: { text: string; json?: boolean }) => {
    await cardEditCommand(cardId, opts, modeFromOpts(opts))
  })

cardGroup
  .command('rm <cardId>')
  .description('Permanently remove a card. Note: web UI users would archive instead — this is a hard delete with no undo')
  .addOption(jsonOpt)
  .action(async (cardId: string, opts: { json?: boolean }) => {
    await cardRmCommand(cardId, modeFromOpts(opts))
  })

const laneGroup = program
  .command('lane')
  .description('Create, rename, change type, and remove lanes')

laneGroup
  .command('add')
  .description('Add a new lane to the end of the board')
  .requiredOption('--name <name>', 'lane name')
  .option('--type <type>', 'lane type: saga (default) or backlog')
  .addOption(jsonOpt)
  .action(async (opts: { name: string; type?: 'saga' | 'backlog'; json?: boolean }) => {
    await laneAddCommand(opts, modeFromOpts(opts))
  })

laneGroup
  .command('rename <laneId>')
  .description('Rename a lane')
  .requiredOption('--name <name>', 'new lane name')
  .addOption(jsonOpt)
  .action(async (laneId: string, opts: { name: string; json?: boolean }) => {
    await laneRenameCommand(laneId, opts, modeFromOpts(opts))
  })

laneGroup
  .command('type <laneId>')
  .description('Switch a lane between saga and backlog')
  .requiredOption('--type <type>', 'saga or backlog')
  .addOption(jsonOpt)
  .action(async (laneId: string, opts: { type: 'saga' | 'backlog'; json?: boolean }) => {
    await laneTypeCommand(laneId, opts, modeFromOpts(opts))
  })

laneGroup
  .command('rm <laneId>')
  .description('Remove a lane. Refuses if the lane has cards — move or delete them first')
  .addOption(jsonOpt)
  .action(async (laneId: string, opts: { json?: boolean }) => {
    await laneRmCommand(laneId, modeFromOpts(opts))
  })

// Top-level handler. Translates CLIError to formatted stderr + exit code,
// and unknown errors to a generic exit code 1 with the original message
// preserved for diagnosis.
program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof CLIError) {
    printError(err.message, err.hint)
    process.exit(err.exitCode())
  }
  printError(`unexpected error: ${(err as Error).message}`)
  if (process.env.ZIGZAG_DEBUG === '1' && err instanceof Error && err.stack !== undefined) {
    process.stderr.write(err.stack + '\n')
  }
  process.exit(1)
})
