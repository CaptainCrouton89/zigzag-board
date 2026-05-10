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

