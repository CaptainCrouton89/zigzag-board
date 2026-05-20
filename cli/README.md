# `zigzag` — Zigzag Board CLI

Command-line interface for [Zigzag Board](https://github.com/CaptainCrouton89/zigzagboard). Designed so an AI agent can read and modify a board on the user's behalf.

**Version 0.2.0** — JSON-default output, noun-verb structure, no `--json` flag.

## Install

```bash
npm install -g @crouton-kit/zigzag
```

For local development:

```bash
cd cli && npm install && npm run build && npm link
```

## Configure

```bash
export ZIGZAG_API_URL=http://localhost:8787   # override API endpoint
```

Credentials are stored at `~/.config/zigzag/credentials.json` (mode `0600`).

## I/O contract

- **Stdout**: always JSON (single-shot). No `--json` flag, no human mode.
- **Stderr**: diagnostic chatter only (warnings, browser-open notices). Never carries results.
- **Errors**: `{ error, message, received?, expected?, next? }` on stdout, exit code 1.

## Command tree

```
zigzag
├─ auth
│   ├─ login            device-flow browser authentication
│   ├─ logout           revoke session and delete local credentials
│   └─ whoami           print identity, API URL, and org memberships
├─ org
│   ├─ list             list orgs sorted by name ascending
│   ├─ use <id|slug>    set active org in local credentials
│   ├─ create <name>    create org and set it active
│   ├─ invite           show current invite URL (owner-only)
│   └─ invite-rotate    regenerate invite URL (owner-only)
├─ board
│   └─ show             read lanes + cards at a path (default root)
├─ lane
│   ├─ list             list lanes at a path
│   ├─ add              create a lane
│   ├─ update <id>      rename / retype a lane
│   ├─ move <id>        reorder a lane
│   └─ rm <id>          hard-delete a lane (server refuses if non-empty)
└─ card
    ├─ list             list cards with optional lane/status filters
    ├─ show <id>        read a card and its nested board
    ├─ add              create a card
    ├─ update <id>      change text, status, lane, or position
    ├─ move <id>        change lane and/or position
    ├─ restore <id>     restore an archived card as todo
    └─ rm <id>          PERMANENT hard-delete (no archive entry created)
```

Pass `-h` to any node for full Input/Output/Effects documentation.

## Nested boards

Cards can contain their own boards. Use `--path <cardId>` (repeatable) to descend:

```bash
zigzag board show --path c-abc --path c-def
zigzag lane list --path c-abc
zigzag card add --lane l-xyz --text "subtask" --path c-abc
```

## Migrating from 0.1.0

| 0.1.0 | 0.2.0 | Notes |
|---|---|---|
| `zigzag login` | `zigzag auth login` | moved under `auth` branch |
| `zigzag logout` | `zigzag auth logout` | moved under `auth` branch |
| `zigzag whoami [--json]` | `zigzag auth whoami` | JSON always; output shape changed |
| `zigzag org list [--json]` | `zigzag org list` | JSON always; orgs sorted by name |
| `zigzag org use <id>` | `zigzag org use <id>` | output is now JSON |
| `zigzag org create <name> [--json]` | `zigzag org create <name>` | JSON always |
| `zigzag board show [--json]` | `zigzag board show [--path …]` | JSON always; path support added |
| `zigzag card add` | `zigzag card add` | added `--path`; JSON always |
| `zigzag card move <id>` | `zigzag card move <id>` | added `--path`; JSON always |
| `zigzag card edit <id> --text …` | `zigzag card update <id> --text …` | renamed `edit` → `update`; update now also handles status/lane/position |
| `zigzag card rm <id>` | `zigzag card rm <id>` | added `--path`; JSON always |
| `zigzag lane add` | `zigzag lane add` | added `--path`; JSON always |
| `zigzag lane rename <id> --name …` | `zigzag lane update <id> --name …` | renamed; `update` also handles `--type` |
| `zigzag lane type <id> --type …` | `zigzag lane update <id> --type …` | merged into `lane update` |
| `zigzag lane rm <id>` | `zigzag lane rm <id>` | added `--path`; JSON always |
| _(new)_ | `zigzag org invite` | show invite URL |
| _(new)_ | `zigzag org invite-rotate` | regenerate invite URL |
| _(new)_ | `zigzag lane list` | list lanes at a path |
| _(new)_ | `zigzag card show <id>` | read card + nested board |
| _(new)_ | `zigzag card restore <archivedItemId>` | restore archived card |
| `--json` flag everywhere | removed | stdout is always JSON |
