export type CardStatus = 'todo' | 'doing' | 'done';
export type LaneType = 'saga' | 'backlog';
export type SortMode = 'manual' | 'newest' | 'oldest';

export type Lane = {
  id: string;
  title: string;
  type: LaneType;
  stance?: string;
  sort?: SortMode;
  order: string;                           // NEW — fractional index
};

export type ArchivedItem = {
  id: string;
  title: string;
  laneId: string;                          // CHANGED from `lane: number`
  node: Card;
};

export type Card = {
  id: string;
  title: string;
  status: CardStatus;
  laneId: string;                          // CHANGED from `lane: number`
  order: string;                           // NEW — fractional index in (parent, laneId)
  createdAt: number;
  lanes: Lane[];
  cards: Card[];
  principles: string[];
  archived: ArchivedItem[];
};

export type RootCard = Card & { id: 'root' };

export type AppState = {
  root: Card;
  path: string[];
  openArchive: string | null;              // CHANGED — was number | null (laneIdx)
};

export interface BoardCallbacks {
  onAddCard: (laneId: string, rank: number, title: string) => void;
  onMoveCard: (cardId: string, newLaneId: string, newRank: number) => void;
  onSetStatus: (cardId: string) => void;
  onRevertStatus: (cardId: string) => void;
  onSetCardTitle: (cardId: string, title: string) => void;
  onAddLane: () => void;
  onToggleLaneType: (laneId: string) => void;
  onSetLaneTitle: (laneId: string, title: string) => void;
  onSetLaneStance: (laneId: string, stance: string) => void;
  onSetLaneSort: (laneId: string, sort: SortMode) => void;
  onAddPrinciple: (text: string) => void;
  onSetPrinciple: (idx: number, value: string) => void;
  onRemovePrinciple: (idx: number) => void;
  onRestoreArchived: (id: string) => void;
  onSetOpenArchive: (laneId: string | null) => void;
  onZoomIn: (cardId: string) => void;
  onZoomTo: (pathIdx: number) => void;
}

// Action union — kept for reducer in state.ts (spec reference; not used by page.tsx post-Phase-5).
export type Action =
  | { type: 'ADD_CARD'; laneIdx: number; rank: number; title: string }
  | { type: 'MOVE_CARD'; cardId: string; newLaneIdx: number; newRank: number }
  | { type: 'SET_STATUS'; cardId: string }
  | { type: 'REVERT_STATUS'; cardId: string }
  | { type: 'SET_CARD_TITLE'; cardId: string; title: string }
  | { type: 'ADD_LANE' }
  | { type: 'TOGGLE_LANE_TYPE'; laneIdx: number }
  | { type: 'SET_LANE_TITLE'; laneIdx: number; title: string }
  | { type: 'SET_LANE_STANCE'; laneIdx: number; stance: string }
  | { type: 'SET_LANE_SORT'; laneIdx: number; sort: SortMode }
  | { type: 'ADD_PRINCIPLE'; principle: string }
  | { type: 'SET_PRINCIPLE'; idx: number; value: string }
  | { type: 'REMOVE_PRINCIPLE'; idx: number }
  | { type: 'ZOOM_INTO'; cardId: string }
  | { type: 'ZOOM_TO'; pathIdx: number }
  | { type: 'RESTORE_ARCHIVED'; archivedId: string }
  | { type: 'SET_OPEN_ARCHIVE'; laneIdx: number | null }
  | { type: 'LOAD_STATE'; state: AppState };
