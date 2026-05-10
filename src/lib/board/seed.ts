// Phase 5 transitional: seed.ts is no longer used from page.tsx (localStorage
// hydration removed). Stays in tree through Phase 5; Phase 7 deletes.
// Adapted to compile against post-T2 types (laneId: string, Lane.order: string).
import { Card, Lane } from './types';
import { normalizeLanesOrder } from './state';

let nextId = 1000;
const newId = (prefix = 'n') => `${prefix}${nextId++}`;

function makeCard(
  title: string,
  laneId: string,
  status: Card['status'] = 'todo',
  extras: Partial<Card> = {},
  createdAtOffset = 0,
): Card {
  return {
    id: newId('c'),
    title,
    status,
    laneId,
    order: 'a0',
    createdAt: Date.now() - createdAtOffset,
    lanes: [],
    cards: [],
    principles: [],
    archived: [],
    ...extras,
  };
}

function seedChildren(
  parent: Card,
  lanes: Lane[],
  items: [string, number, Card['status']][],
  baseOffset = 0,
) {
  parent.lanes = lanes;
  const laneIds = lanes.map(l => l.id);
  items.forEach(([title, laneIdx, status], i) => {
    const laneId = laneIds[laneIdx] !== undefined ? laneIds[laneIdx] : laneIds[0];
    parent.cards.push(makeCard(title, laneId, status, {}, baseOffset + i * 60000));
  });
}

export function createSeedData(): Card {
  const t = Date.now();

  const lanes: Lane[] = [
    { id: 'l0', title: 'Sales octopus saga', type: 'saga', stance: 'Hypergrowth — max focus', order: 'a0' },
    { id: 'l1', title: 'Backlog', type: 'backlog', stance: 'Capture, triage later', order: 'a1' },
    { id: 'l2', title: 'Chaz personal', type: 'saga', stance: 'Marathon-level discipline', order: 'a2' },
  ];

  const cards: Card[] = [
    // Sales octopus saga (lane l0)
    makeCard('Inbox bugs / issues', 'l0', 'doing', {}, 0),
    makeCard('Onboarding is too slow', 'l0', 'todo', {}, 60000),
    makeCard('CRM ZIG: cross-workspace contact store', 'l0', 'doing', {
      principles: ["Don't overfit previous CRM spec — store unique IDs across LinkedIn/Twitter/GitHub/Insta to prevent double-hits"],
    }, 120000),
    makeCard('Seeded workers spoon-feed enough value to buy', 'l0', 'todo', {}, 180000),
    makeCard('Workers not working properly', 'l0', 'todo', {}, 240000),
    makeCard('Onboarding straight-line to sales octopus', 'l0', 'todo', {}, 300000),
    makeCard('Risk mitigation & failure modes', 'l0', 'todo', {}, 360000),
    makeCard('Trial credits enough to become sales octopus', 'l0', 'todo', {}, 420000),
    makeCard('Inbox: boundless skill ceiling', 'l0', 'todo', {}, 480000),
    makeCard('Agent steers user toward sales octopus', 'l0', 'todo', {}, 540000),

    // Backlog (lane l1)
    makeCard("Agent doesn't gather context properly when creating tickets", 'l1', 'todo', {}, 0),
    makeCard('Stop the python install popup', 'l1', 'todo', {}, 60000),
    makeCard("Cmd+shift+space can't approve things", 'l1', 'todo', {}, 120000),
    makeCard('Why do non-call onboarders drop off?', 'l1', 'todo', {}, 180000),
    makeCard('Permissions popup is just `ls ~`', 'l1', 'todo', {}, 240000),
    makeCard('Multi-chat switching regressed in UI refactor', 'l1', 'todo', {}, 300000),
    makeCard('Reminder-with-draft for kicked-off chats', 'l1', 'todo', {}, 360000),
    makeCard('Manhattan project', 'l1', 'todo', {}, 420000),
    makeCard('One ticket can spawn many tickets', 'l1', 'todo', {}, 480000),
    makeCard('LinkedIn account bans (Vamo, Collin, Brad)', 'l1', 'todo', {}, 540000),
    makeCard('Lost-in-conversation context never resurfaces', 'l1', 'todo', {}, 600000),
    makeCard('Inbox 0: view-workers button broken', 'l1', 'todo', {}, 660000),
    makeCard('Team features / shared workspaces', 'l1', 'todo', {}, 720000),
    makeCard('Skip-but-return onboarding steps', 'l1', 'todo', {}, 780000),
    makeCard('Hivemind admin-only (Austin → super admin next chart)', 'l1', 'todo', {}, 840000),
    makeCard('Windows build', 'l1', 'todo', {}, 900000),
    makeCard('Hiring page with culture blurb', 'l1', 'todo', {}, 960000),
    makeCard('Worker behavior diagram (baseline)', 'l1', 'todo', {}, 1020000),
    makeCard('Cmd+shift+space on Slack', 'l1', 'todo', {}, 1080000),
    makeCard('What worked with Ben Thompson?', 'l1', 'todo', {}, 1140000),
    makeCard('Credit visibility', 'l1', 'todo', {}, 1200000),
    makeCard('DO R: Luke on more users', 'l1', 'todo', {}, 1260000),
    makeCard('Desktop app bugs', 'l1', 'todo', {}, 1320000),
    makeCard('Cmd+shift+space showing HITL', 'l1', 'todo', {}, 1380000),
    makeCard('"Your ROI" features', 'l1', 'todo', {}, 1440000),
    makeCard('End-to-end LinkedIn meeting workers (toggle on)', 'l1', 'todo', {}, 1500000),

    // Chaz personal (lane l2)
    makeCard('Get sleep', 'l2', 'todo', {}, 0),
    makeCard('Run in mornings', 'l2', 'todo', {}, 60000),
    makeCard('Meditate', 'l2', 'todo', {}, 120000),
  ];

  const root: Card = {
    id: 'root',
    title: 'Northlight',
    status: 'todo',
    laneId: '',
    order: '',
    createdAt: t,
    principles: [
      'Hypergrowth gets max time, attention, and resources. Standard growth gets minimal.',
      'Make the product really good',
    ],
    lanes,
    cards,
    archived: [],
  };

  // CRM ZIG (index 2)
  seedChildren(cards[2], [
    { id: 'crm-data', title: 'Data model', type: 'saga', stance: 'Cross-workspace primitive', order: 'a0' },
    { id: 'crm-ui', title: 'Surfaces', type: 'saga', order: 'a1' },
    { id: 'crm-bk', title: 'Open questions', type: 'backlog', stance: 'Resolve before shipping', order: 'a2' },
  ], [
    ['Schema: contact + cross-platform IDs', 0, 'doing'],
    ['Workspace-shared store, per-org access', 0, 'todo'],
    ['Sync from existing inbox/tickets', 0, 'todo'],
    ['Contact panel in inbox view', 1, 'todo'],
    ['Conflict UI when 2 workers target same person', 1, 'todo'],
    ['How do we de-dupe contacts across spellings?', 2, 'todo'],
    ['Do non-admins see all contacts?', 2, 'todo'],
  ]);

  // Workers not working properly (index 4)
  seedChildren(cards[4], [
    { id: 'wnw-now', title: 'Active fires', type: 'saga', stance: 'Currently broken', order: 'a0' },
    { id: 'wnw-arch', title: 'Architecture issues', type: 'saga', order: 'a1' },
    { id: 'wnw-bk', title: 'Reports', type: 'backlog', order: 'a2' },
  ], [
    ['Chaz: Kaitlyn worker — claims no Gmail alias when one exists', 0, 'doing'],
    ['Failed to start sending due to timing (silas)', 0, 'todo'],
    ['Failed to detect Stanford Gmail alias (silas)', 0, 'todo'],
    ['Worker / cron-job context placement is awkward (matt)', 1, 'todo'],
    ['Workers should learn from human edits', 1, 'todo'],
  ]);

  // Risk mitigation (index 6)
  seedChildren(cards[6], [
    { id: 'rm-active', title: 'Active mitigations', type: 'saga', order: 'a0' },
    { id: 'rm-edge', title: 'Failure modes', type: 'backlog', order: 'a1' },
  ], [
    ['Prevent account bans', 0, 'todo'],
    ['Surface auth issues as tickets', 0, 'todo'],
    ['Bulk-edit 20+ wrongly-done tickets at scale', 1, 'todo'],
    ['Update worker but old tickets stay (regenerate?)', 1, 'todo'],
    ['One approved ticket spawns many follow-ups', 1, 'todo'],
  ]);

  // LinkedIn bans (index 19)
  seedChildren(cards[19], [
    { id: 'lb-cases', title: 'Cases', type: 'saga', order: 'a0' },
  ], [
    ['Vamo — limited on LinkedIn Recruiter (not understood)', 0, 'todo'],
    ['Collin Stockton — seems diagnosed', 0, 'doing'],
    ['Brad — pretty confusing', 0, 'todo'],
  ]);

  // Worker behavior diagram (index 27)
  seedChildren(cards[27], [
    { id: 'wb-q', title: 'Questions to answer', type: 'saga', stance: 'Should answer all "Chaz questions"', order: 'a0' },
  ], [
    ['Worker behavior', 0, 'todo'],
    ['Worker context', 0, 'todo'],
    ['What happens when works fail', 0, 'todo'],
    ['Tools available to workers', 0, 'todo'],
    ['Prompting on workers', 0, 'todo'],
  ]);

  // Visit every node in the tree and normalize lane order (backlogs always last)
  const visit = (n: Card) => {
    normalizeLanesOrder(n);
    n.cards.forEach(visit);
  };
  visit(root);

  return root;
}
