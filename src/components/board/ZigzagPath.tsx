'use client';

import { useLayoutEffect, useState } from 'react';
import { Card, Lane } from '@/lib/board/types';
import { LANE_WIDTH, GAP, HEADER_H, RANK_STEP, CARD_H } from '@/lib/board/layout';

interface Props {
  sagaCards: Card[];
  lanes: Lane[];
  boardRef: React.RefObject<HTMLDivElement | null>;
}

function buildPath(sagaCards: Card[], lanes: Lane[]): string {
  if (sagaCards.length < 2) return '';
  // Filter+map: skip cards whose laneId references a concurrently-deleted lane
  // (findIndex === -1 guard per gotcha 9 in hook sub-plan).
  const points = sagaCards.flatMap((card, rankIdx) => {
    const i = lanes.findIndex(l => l.id === card.laneId);
    if (i < 0) return [];
    return [{ x: i * (LANE_WIDTH + GAP) + LANE_WIDTH / 2, y: HEADER_H + rankIdx * RANK_STEP + CARD_H / 2 }];
  });
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const dy = p1.y - p0.y;
    const cp1 = { x: p0.x, y: p0.y + dy * 0.55 };
    const cp2 = { x: p1.x, y: p1.y - dy * 0.55 };
    d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

export function ZigzagPath({ sagaCards, lanes, boardRef }: Props) {
  const [dims, setDims] = useState({ w: 0, h: 0 });

  // Pure math — endpoints are where cards SHOULD be (immune to transforms / drag-fixed positioning).
  const path = buildPath(sagaCards, lanes);

  useLayoutEffect(() => {
    const update = () => {
      const board = boardRef.current;
      if (!board) return;
      const rect = board.getBoundingClientRect();
      setDims({ w: rect.width, h: rect.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [boardRef, sagaCards]);

  if (!path) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={dims.w}
      height={dims.h}
      viewBox={`0 0 ${dims.w || 1} ${dims.h || 1}`}
      className="absolute top-0 left-0 pointer-events-none overflow-visible"
      style={{ zIndex: 2 }}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.10}
        style={{ filter: 'blur(2px)' }}
      />
      <path
        d={path}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </svg>
  );
}
