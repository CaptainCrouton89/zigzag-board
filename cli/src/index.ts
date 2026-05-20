#!/usr/bin/env node
import { Command } from 'commander'
import { CLIError } from './errors.js'

import { authLoginCommand } from './commands/auth/login.js'
import { authLogoutCommand } from './commands/auth/logout.js'
import { authWhoamiCommand } from './commands/auth/whoami.js'
import { orgListCommand } from './commands/org/list.js'
import { orgUseCommand } from './commands/org/use.js'
import { orgCreateCommand } from './commands/org/create.js'
import { orgInviteCommand, orgInviteRotateCommand } from './commands/org/invite.js'
import { boardShowCommand } from './commands/board/show.js'
import { laneListCommand } from './commands/lane/list.js'
import { laneAddCommand } from './commands/lane/add.js'
import { laneUpdateCommand } from './commands/lane/update.js'
import { laneMoveCommand } from './commands/lane/move.js'
import { laneRmCommand } from './commands/lane/rm.js'
import { cardListCommand } from './commands/card/list.js'
import { cardShowCommand } from './commands/card/show.js'
import { cardAddCommand } from './commands/card/add.js'
import { cardUpdateCommand } from './commands/card/update.js'
import { cardMoveCommand } from './commands/card/move.js'
import { cardRestoreCommand } from './commands/card/restore.js'
import { cardRmCommand } from './commands/card/rm.js'

const program = new Command()
program
  .name('zigzag')
  .version('0.2.0')
  .description(`zigzag: Zigzag Board CLI.

Concepts
  auth    identity and session management
  org     organization membership and settings
  board   read the full board tree
  lane    columns within a board
  card    work items within lanes

Subtrees
  auth    login, logout, whoami                         | use when managing credentials or identity
  org     list, use, create, invite, invite-rotate      | use when managing organizations
  board   show                                          | use when reading full board state
  lane    list, add, update, move, rm                   | use when managing columns
  card    list, show, add, update, move, restore, rm    | use when managing work items

Globals
  ZIGZAG_API_URL  override the API endpoint (default: production Railway service)
  Credentials stored at ~/.config/zigzag/credentials.json (mode 0600)

I/O contract: flags and positional args on input. Stdout is always JSON. Stderr is diagnostic only.
Exit 0 on success, non-zero on failure. Error shape: {error, message, received?, expected?, next?}.`)
  .addHelpCommand(false)

// ── auth ─────────────────────────────────────────────────────────────────────

const auth = program
  .command('auth')
  .description(`auth: identity and session management.

Branches
  login           device-flow browser authentication       | use when not yet logged in or re-authenticating
  logout          revoke session and delete local creds     | use when ending a session
  whoami          print current identity and memberships    | use when verifying active user or org`)

auth
  .command('login')
  .description(`auth login: authenticate via browser device flow. Writes credentials.

Input
  (no flags)

Output (stdout, JSON)
  userId        string. Permanent user id.
  email         string | null. User email if resolved.
  activeOrgId   string | null. The org set active after login; null if none or ambiguous.
  apiUrl        string. The API URL the credentials target.

Effects
  Writes ~/.config/zigzag/credentials.json (mode 0600).
  Opens a browser tab for approval. If ZIGZAG_API_URL is set, targets that server.`)
  .action(async () => { await authLoginCommand() })

auth
  .command('logout')
  .description(`auth logout: revoke the current session and delete local credentials.

Input
  (no flags)

Output (stdout, JSON)
  ok   true

Effects
  Sends best-effort revoke to the server (failure is non-fatal).
  Deletes ~/.config/zigzag/credentials.json. Idempotent if already logged out.`)
  .action(async () => { await authLogoutCommand() })

auth
  .command('whoami')
  .description(`auth whoami: print current identity, API endpoint, and org memberships.

Input
  (no flags)

Output (stdout, JSON)
  userId        string. Permanent user id.
  email         string | null.
  apiUrl        string. API endpoint in use.
  activeOrgId   string | null. Currently active org id.
  orgs          {id, name, slug, role}[]. All memberships.

Effects
  None. Read-only.`)
  .action(async () => { await authWhoamiCommand() })

// ── org ──────────────────────────────────────────────────────────────────────

const org = program
  .command('org')
  .description(`org: organization membership and settings.

Branches
  list            list all orgs you belong to         | use when picking or verifying an org
  use             set the active org locally           | use before board/lane/card operations
  create          create a new org                     | use when starting a new workspace
  invite          show the current invite URL          | use when sharing access to the active org
  invite-rotate   regenerate the invite URL            | use when revoking the existing invite link`)

org
  .command('list')
  .description(`org list: list organizations you are a member of.

Input
  (no flags)

Output (stdout, JSON)
  activeOrgId   string | null. Currently active org id in local credentials.
  orgs          {id, name, slug, role}[]. Sorted by name ascending.

Effects
  None. Read-only.`)
  .action(async () => { await orgListCommand() })

org
  .command('use <id-or-slug>')
  .description(`org use: set the active organization in local credentials.

Input
  id-or-slug   positional, required. Must match an org id or slug from \`zigzag org list\`.

Output (stdout, JSON)
  activeOrgId   string. The org id now active.
  name          string. Org display name.
  slug          string. Org slug.

Effects
  Updates activeOrgId in ~/.config/zigzag/credentials.json.
  All subsequent board/lane/card commands will use this org.`)
  .action(async (target: string) => { await orgUseCommand(target) })

org
  .command('create <name>')
  .description(`org create: create a new organization and set it active.

Input
  name   positional, required. Display name for the new org. Non-empty string.

Output (stdout, JSON)
  organizationId   string. New org id.
  inviteUrl        string. Invite link to share with teammates.
  activeOrgId      string. Same as organizationId — auto-activated.

Effects
  Creates the org server-side. Caller becomes the owner.
  Updates activeOrgId in ~/.config/zigzag/credentials.json to the new org.`)
  .action(async (name: string) => { await orgCreateCommand(name) })

org
  .command('invite')
  .description(`org invite: show the current invite URL for the active org.

Input
  (no flags; uses activeOrgId from credentials)

Output (stdout, JSON)
  inviteUrl   string. Anyone with this URL can join the org.

Effects
  None. Read-only. Server enforces owner-only access.`)
  .action(async () => { await orgInviteCommand() })

org
  .command('invite-rotate')
  .description(`org invite-rotate: regenerate the invite URL for the active org.

Input
  (no flags; uses activeOrgId from credentials)

Output (stdout, JSON)
  inviteUrl   string. New invite URL. The old URL stops working immediately.

Effects
  Rotates the server-side invite code. The previous invite URL is invalidated.
  Server enforces owner-only access.`)
  .action(async () => { await orgInviteRotateCommand() })

// ── board ─────────────────────────────────────────────────────────────────────

const board = program
  .command('board')
  .description(`board: read the full board tree.

Branches
  show   read all lanes and cards at a path   | use when you need the full board state`)

board
  .command('show')
  .description(`board show: read the full board at a path (default root).

Input
  --path <cardId>   optional, repeatable. Descend into a card's nested board.
                    Omit for the root board. Repeat to traverse nested boards.

Output (stdout, JSON)
  orgId      string. Organization id.
  path       string[]. Resolved path used for this request.
  lanes      {id, name, type, cards: [{id, text, status, order, laneId}]}[].
             Sorted by fractional order ascending.
             Cards within each lane sorted by order ascending, then id ascending.
  archived   {id, archivedAt, node: {id, text, status, laneId}}[].
             Sorted by archivedAt descending (most recent first).

Effects
  None. Read-only.`)
  .option('--path <cardId>', 'descend into a card\'s nested board (repeatable)', collect, [])
  .action(async (opts: { path: string[] }) => { await boardShowCommand(opts.path) })

// ── lane ──────────────────────────────────────────────────────────────────────

const lane = program
  .command('lane')
  .description(`lane: columns within a board.

Branches
  list     list lanes at a path             | use when you need lane ids for other operations
  add      create a new lane                | use when adding a column
  update   rename or retype a lane          | use when changing a lane's name or type
  move     reorder a lane within the board  | use when changing column order
  rm       delete a lane                    | use when removing an empty column`)

lane
  .command('list')
  .description(`lane list: list lanes at a path.

Input
  --path <cardId>   optional, repeatable. Path to the board context.

Output (stdout, JSON)
  path    string[]. Resolved path.
  lanes   {id, name, type}[]. Sorted by fractional order ascending.

Effects
  None. Read-only.`)
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (opts: { path: string[] }) => { await laneListCommand(opts.path) })

lane
  .command('add')
  .description(`lane add: append a new lane.

Input
  --name <text>       required. Lane display name.
  --type <saga|backlog>  optional. Default: saga.
  --path <cardId>     optional, repeatable. Board context path.

Output (stdout, JSON)
  lane   {id, name, type}.

Effects
  Appends a new lane to the parent board's lanes Y.Map.`)
  .requiredOption('--name <text>', 'lane display name')
  .option('--type <saga|backlog>', 'lane type', 'saga')
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (opts: { name: string; type: string; path: string[] }) => {
    const type = opts.type === 'backlog' ? 'backlog' : 'saga'
    await laneAddCommand({ name: opts.name, type, path: opts.path })
  })

lane
  .command('update <laneId>')
  .description(`lane update: rename and/or retype a lane.

Input
  laneId            positional, required. Lane id to modify.
  --name <text>     optional. New display name.
  --type <saga|backlog>  optional. New type.
  --path <cardId>   optional, repeatable. Board context path.
  At least one of --name or --type must be provided.

Output (stdout, JSON)
  lane   {id, name, type}.

Effects
  In-place rename and/or retype within the parent board's lanes Y.Map.`)
  .option('--name <text>', 'new lane name')
  .option('--type <saga|backlog>', 'new lane type')
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (laneId: string, opts: { name?: string; type?: string; path: string[] }) => {
    const type = opts.type === 'backlog' ? 'backlog' : opts.type === 'saga' ? 'saga' : undefined
    await laneUpdateCommand(laneId, { name: opts.name, type, path: opts.path })
  })

lane
  .command('move <laneId>')
  .description(`lane move: reorder a lane within the board.

Input
  laneId               positional, required. Lane id to move.
  --before <laneId>    place this lane immediately before the given lane.
  --after <laneId>     place this lane immediately after the given lane.
  --path <cardId>      optional, repeatable. Board context path.
  Exactly one of --before or --after is required.

Output (stdout, JSON)
  lane   {id, name, type}.

Effects
  Updates the fractional order of the lane in the parent board's lanes Y.Map.`)
  .option('--before <laneId>', 'place before this lane')
  .option('--after <laneId>', 'place after this lane')
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (laneId: string, opts: { before?: string; after?: string; path: string[] }) => {
    await laneMoveCommand(laneId, opts)
  })

lane
  .command('rm <laneId>')
  .description(`lane rm: hard-delete a lane.

Input
  laneId          positional, required. Lane id to delete.
  --path <cardId> optional, repeatable. Board context path.

Output (stdout, JSON)
  ok   true
  id   string. The deleted lane id.

Effects
  Hard-deletes the lane from the parent board's lanes Y.Map.
  Server refuses deletion if the lane has cards:
    {error: "non_empty", message: "lane has cards", next: "move or archive cards first, then retry"}`)
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (laneId: string, opts: { path: string[] }) => {
    await laneRmCommand(laneId, opts.path)
  })

// ── card ──────────────────────────────────────────────────────────────────────

const card = program
  .command('card')
  .description(`card: work items within lanes.

Branches
  list      list cards, optionally filtered           | use when scanning the board
  show      read a single card and its nested board   | use when inspecting one card
  add       create a card in a lane                   | use when adding work
  update    change text, status, lane, or position    | use when editing a card
  move      change lane or position only              | use for pure reordering
  restore   restore an archived card as todo          | use when un-archiving work
  rm        hard-delete a card (unrecoverable)        | use only when truly discarding work`)

card
  .command('list')
  .description(`card list: list cards at a path, with optional filters.

Input
  --path <cardId>           optional, repeatable. Board context path (default root).
  --lane <laneId>           optional. Restrict to one lane.
  --status <todo|doing|done>  optional. Restrict to one status.

Output (stdout, JSON)
  path    string[]. Resolved path.
  items   {id, text, status, laneId, order}[].
          Sorted by laneId ascending, then order ascending, then id ascending.
          No pagination; cards-per-org is bounded by the Y.Doc size.

Effects
  None. Read-only.`)
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .option('--lane <laneId>', 'filter to one lane')
  .option('--status <todo|doing|done>', 'filter by status')
  .action(async (opts: { path: string[]; lane?: string; status?: string }) => {
    await cardListCommand(opts)
  })

card
  .command('show <cardId>')
  .description(`card show: read a card and its nested board contents.

Input
  cardId          positional, required. Card id.
  --path <cardId> optional, repeatable. Path to the card's PARENT board (default root).

Output (stdout, JSON)
  card      {id, text, status, laneId, order}. The card itself.
  lanes     {id, name, type, cards}[]. Nested lanes inside this card, if any.
  archived  {id, archivedAt, node}[]. Archived items inside this card, if any.
            lanes and archived are empty arrays when the card has no nested board.

Effects
  None. Read-only.`)
  .option('--path <cardId>', 'path to the card\'s parent board (repeatable)', collect, [])
  .action(async (cardId: string, opts: { path: string[] }) => {
    await cardShowCommand(cardId, opts.path)
  })

card
  .command('add')
  .description(`card add: create a new card in a lane.

Input
  --lane <laneId>     required. Destination lane id.
  --text <text>       required. Card text content.
  --before <cardId>   optional. Place immediately before this card. Mutually exclusive with --after.
  --after <cardId>    optional. Place immediately after this card. Mutually exclusive with --before.
  --path <cardId>     optional, repeatable. Board context path.

Output (stdout, JSON)
  card   {id, text, status, laneId, order}.

Effects
  Appends a new card to the lane's children at the specified path.`)
  .requiredOption('--lane <laneId>', 'destination lane id')
  .requiredOption('--text <text>', 'card text')
  .option('--before <cardId>', 'place immediately before this card')
  .option('--after <cardId>', 'place immediately after this card')
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (opts: { lane: string; text: string; before?: string; after?: string; path: string[] }) => {
    await cardAddCommand(opts)
  })

card
  .command('update <cardId>')
  .description(`card update: change a card's text, status, lane, or position.

Input
  cardId                      positional, required.
  --text <text>               optional. New text content.
  --status <todo|doing|done>  optional. New status.
  --lane <laneId>             optional. Move to a different lane.
  --before <cardId>           optional. Place before this card. Mutually exclusive with --after.
  --after <cardId>            optional. Place after this card. Mutually exclusive with --before.
  --path <cardId>             optional, repeatable. Board context path.
  At least one of --text, --status, --lane, --before, --after must be provided.

Output (stdout, JSON)
  card   {id, text, status, laneId, order}. The updated card.
  OR when --status done archives the card:
  archived        true
  archivedItemId  string. Use with \`zigzag card restore\` to un-archive.

Effects
  Updates card fields in-place.
  When --status done: archives the card; the original card is removed from the live board.
  The archivedItemId (not the original card id) is required to restore.`)
  .option('--text <text>', 'new text')
  .option('--status <todo|doing|done>', 'new status')
  .option('--lane <laneId>', 'move to a different lane')
  .option('--before <cardId>', 'place before this card')
  .option('--after <cardId>', 'place after this card')
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (cardId: string, opts: { text?: string; status?: string; lane?: string; before?: string; after?: string; path: string[] }) => {
    const status = opts.status === 'todo' || opts.status === 'doing' || opts.status === 'done' ? opts.status : undefined
    await cardUpdateCommand(cardId, { ...opts, status, path: opts.path })
  })

card
  .command('move <cardId>')
  .description(`card move: change a card's lane and/or position.

Input
  cardId            positional, required.
  --lane <laneId>   optional. Destination lane id.
  --before <cardId> optional. Place before this card. Mutually exclusive with --after.
  --after <cardId>  optional. Place after this card. Mutually exclusive with --before.
  --path <cardId>   optional, repeatable. Board context path.
  At least one of --lane, --before, --after is required.

Output (stdout, JSON)
  card   {id, text, status, laneId, order}.

Effects
  Updates lane assignment and/or fractional order in-place.`)
  .option('--lane <laneId>', 'destination lane')
  .option('--before <cardId>', 'place before this card')
  .option('--after <cardId>', 'place after this card')
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (cardId: string, opts: { lane?: string; before?: string; after?: string; path: string[] }) => {
    await cardMoveCommand(cardId, opts)
  })

card
  .command('restore <archivedItemId>')
  .description(`card restore: restore an archived card as a live todo card.

Input
  archivedItemId   positional, required. The archive-snapshot id, NOT the original card id.
                   Obtained from: \`card update --status done\` (archivedItemId field)
                   or from the archived[] array in \`board show\` / \`card show\`.
  --path <cardId>  optional, repeatable. Board context path for the parent board.

Output (stdout, JSON)
  card   {id, text, status, laneId, order}. Restored card with status "todo".

Effects
  Creates a live card from the archived snapshot. Status is reset to "todo".
  The archived entry is removed.`)
  .option('--path <cardId>', 'parent board context path (repeatable)', collect, [])
  .action(async (archivedItemId: string, opts: { path: string[] }) => {
    await cardRestoreCommand(archivedItemId, opts.path)
  })

card
  .command('rm <cardId>')
  .description(`card rm: HARD-DELETE a card. This is permanent and unrecoverable.

Input
  cardId          positional, required. Card id to delete.
  --path <cardId> optional, repeatable. Board context path.

Output (stdout, JSON)
  ok   true
  id   string. The deleted card id.

Effects
  PERMANENT HARD DELETE. There is no undo and no archive entry created.
  The canonical reversible flow is: \`card update --status done\` (archives)
  followed by \`card restore <archivedItemId>\` (un-archives).
  Use rm only when work is truly being discarded with no possibility of recovery.`)
  .option('--path <cardId>', 'board context path (repeatable)', collect, [])
  .action(async (cardId: string, opts: { path: string[] }) => {
    await cardRmCommand(cardId, opts.path)
  })

// ── run ───────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof CLIError) {
    process.stdout.write(JSON.stringify(err.structured) + '\n')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify({
    error: 'internal',
    message: `unexpected error: ${(err as Error).message}`,
  }) + '\n')
  if (process.env.ZIGZAG_DEBUG === '1' && err instanceof Error && err.stack !== undefined) {
    process.stderr.write(err.stack + '\n')
  }
  process.exit(1)
})

// Collector for repeatable --path flags.
function collect(val: string, acc: string[]): string[] {
  acc.push(val)
  return acc
}
