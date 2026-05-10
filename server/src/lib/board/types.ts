// Mirror of /src/lib/board/types.ts for the server-side mutation port.
// Keep field shapes in lockstep with the web copy — these are stored in the
// shared Y.Doc and any divergence corrupts cross-client state.
export type CardStatus = 'todo' | 'doing' | 'done'
export type LaneType = 'saga' | 'backlog'
export type SortMode = 'manual' | 'newest' | 'oldest'
