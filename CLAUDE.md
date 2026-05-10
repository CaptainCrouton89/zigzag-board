@AGENTS.md

## Stack
- React 19.2 — breaking changes vs. 18

## Commands
```bash
npx tsc --noEmit     # no tsc npm script defined
```

## Constraints
- **Tailwind v4**: Creating a `tailwind.config.*` file does nothing — configure via `@theme` in `src/app/globals.css`.
- **Lane indices are unstable**: `normalizeLanesOrder` remaps every card's `lane` index after `ADD_LANE` and `TOGGLE_LANE_TYPE`. Never store a lane index outside the current render — it will silently point to the wrong lane.
- **ID counter must be synced on load**: Any load path must call `syncNextIdFromTree`; omitting it causes `newId()` to collide with restored card IDs.
- **Seed-overwrite guard**: `page.tsx` uses `hydratedRef` to gate the seed write on mount — removing it silently overwrites real localStorage data with seed state.
- **FLIP animation coupling**: `Board.tsx` writes `data-drop-x/y` on the card element at pointerup; `Card.tsx` reads those attributes for animation origin. Removing those writes silently breaks the drop animation.
- **ZigzagPath ignores DOM transforms intentionally**: Do not add transform-awareness — it would break SVG path correctness mid-drag.
- **Layout constants are duplicated**: `src/lib/board/layout.ts` and CSS vars in `src/app/globals.css` must stay in sync — changing one without the other causes a silent visual mismatch.
