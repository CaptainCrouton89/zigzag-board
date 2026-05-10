# `zigzag` — Zigzag Board CLI

A command-line interface for [Zigzag Board](https://github.com/CaptainCrouton89/zigzagboard) designed so an AI agent (e.g. Claude Code) can read and modify a user's board on their behalf.

## Install

```bash
npm install -g @crouton-kit/zigzag
# or one-shot:
npx @crouton-kit/zigzag <command>
```

For local development from this repo:

```bash
cd cli
npm install
npm run build
npm link
```

## Configure

Default API URL is the production Railway service. To target a local dev server:

```bash
export ZIGZAG_API_URL=http://localhost:8787
```

The CLI persists credentials in `~/.config/zigzag/credentials.json` (mode `0600`).

## Login

```bash
zigzag login
```

Opens a browser to confirm the device. After approval, the CLI stores a long-lived bearer token bound to your account.

## Commands

```text
zigzag whoami [--json]               Print the active user and org
zigzag logout                        Revoke the current device token

zigzag org list [--json]             List orgs you are a member of
zigzag org use <id|slug>             Set the active org for this CLI session

zigzag board show [--json]           Print the board (lanes + cards)

zigzag card add --lane <id> --text <s> [--before <id> | --after <id>]
zigzag card move <id> [--lane <id>] [--before <id> | --after <id>]
zigzag card edit <id> --text <s>
zigzag card rm <id>

zigzag lane add --name <s> [--type saga|backlog]
zigzag lane rename <id> --name <s>
zigzag lane type <id> --type saga|backlog
zigzag lane rm <id>
```

All commands support `--json` for stable machine-readable output. Errors print to stderr with exit code `1` (auth/api), `2` (bad arguments), or `0` on success.

## How mutations propagate

The CLI talks to the same server the web app talks to. Mutations land in the live Y.Doc via Hocuspocus's direct connection, so any browser tabs viewing the board see the change within ~1 second without a reload.
