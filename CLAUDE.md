# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Stack

- Next.js 16.2.6 (App Router) with Turbopack
- React 19.2
- TypeScript 5 (strict)
- Tailwind CSS v4 via `@tailwindcss/postcss` (no `tailwind.config.*` — configure in `src/app/globals.css` with `@theme` / `@import "tailwindcss"`)
- ESLint 9 flat config (`eslint.config.mjs`) extending `eslint-config-next`

Next.js 16 + React 19 + Tailwind v4 all have breaking changes vs. older training data. Per `AGENTS.md`, consult `node_modules/next/dist/docs/` (`01-app/`, `03-architecture/`) before assuming an API exists.

## Commands

```bash
npm run dev          # next dev (Turbopack) on :3000
npm run build        # production build
npm start            # serve built output
npm run lint         # eslint (flat config)
npx tsc --noEmit     # type-check (no script defined)
```

No test runner is configured.

## Architecture

The product is "Zigzag Board" — a recursive priority board where each card can zoom into its own nested board. The whole app is a single client page (`src/app/page.tsx`, marked `'use client'`) backed by `useReducer`; persistence is localStorage only.

**State tree** (`src/lib/board/types.ts`)
- `Card` is recursive: each card owns its own `lanes`, `cards`, `principles`, and `archived` list. The root is just a `Card` with `id: 'root'`.
- `AppState = { root, path, openArchive }`. `path` is an array of card ids from root to the currently-zoomed node — `getNodeByPath` (in `state.ts`) resolves it.
- Lanes have `type: 'saga' | 'backlog'`. Sagas form a priority-weave across lanes (rendered with the SVG zigzag); backlogs are flat compact lists with optional sort.

**Reducer** (`src/lib/board/state.ts`)
- All mutations go through `reducer(state, Action)`. `deepClone` on every dispatch — there is no in-place mutation.
- `ensureLanes` runs before each action so a freshly-zoomed-into card always has at least one lane.
- `normalizeLanesOrder` keeps backlogs visually rightmost; called after `ADD_LANE` and `TOGGLE_LANE_TYPE`. It remaps every card's `lane` index, so don't store lane indices outside the current render.
- Card ranking is laneType-aware: saga rank is the index within `getSagaCards(node)` (across all saga lanes, in priority order); backlog rank is the index within that lane's filtered cards. `ADD_CARD` / `MOVE_CARD` translate (laneIdx, rank) → an absolute splice index inside `node.cards`.
- Status flow: `todo → doing → done`. Hitting "done" splices the card out of `cards` and into `archived`.

**Persistence** (`src/lib/board/storage.ts`)
- localStorage key `zigzagboard-v1`. `loadState` re-runs `normalizeLanesOrder` defensively and calls `syncNextIdFromTree` to bump the runtime id counter past any persisted id (otherwise `newId()` collides with restored cards).
- `page.tsx` hydrates via a `LOAD_STATE` action on mount and uses a `hydratedRef` to avoid writing the seed back over real data.

**Components** (`src/components/board/`)
- `Board.tsx` — owns pointer-event drag (live reorder via `MOVE_CARD` on every move, plus a final move on pointerup), the new-card textarea, and absolute positioning math for saga cards. `computeDropTarget` translates pointer coords → (lane, rank).
- `Card.tsx` — uses a FLIP-style animation (reads `data-drop-x/y` set by `Board` on pointerup) to animate from the actual drop position rather than the stale last-pointermove position. Saga cards are absolutely positioned at the board level; backlog cards live inside their lane's flex column.
- `ZigzagPath.tsx` — pure math: builds an SVG cubic Bézier through saga card centers based on `(lane, rankIdx)`, deliberately ignoring DOM transforms so it stays correct mid-drag.
- `Sidebar.tsx` walks `path` to surface inherited principles + lane stances from ancestor nodes.
- Zoom in/out in `page.tsx` is a manual scale+opacity animation on a wrapper div, with the dispatch happening at the midpoint (320ms in). Esc zooms out; it's suppressed while editing text fields.

**Layout constants** (`src/lib/board/layout.ts`) — `LANE_WIDTH`, `GAP`, `HEADER_H`, `RANK_STEP`, `COMPACT_STEP`, `CARD_H`. These are duplicated as CSS vars in `globals.css` for the mockup; if you change one, change both.

## Other

- `mockup.html` — single-file HTML/CSS design spec. Visual target for colors, spacing, and interaction patterns; the React app should match.
- Path alias `@/*` → `src/*` (see `tsconfig.json`).
- `next.config.ts` is empty; add config there, not in JS.
