<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { Block, BlockStyleName, GameKind, GameMode, LessonItem, LessonPack, SolveMode, ThemeName } from './types';

const cols = ref(Number(localStorage.getItem('matchit-cols')) || 7);
const rows = ref(Number(localStorage.getItem('matchit-rows')) || 7);
const boardSizes = [3, 4, 5, 6, 7, 8, 9];
const packBoardSizes: Record<string, { cols: number; rows: number }> = {
  'english-grammar': { cols: 5, rows: 7 },
  'math-formula': { cols: 5, rows: 7 },
};
// 토큰(글자)이 긴 팩은 가로로 1.5배 긴 블럭 사용
const wideBlockPacks = new Set(['english-grammar', 'math-formula']);
const appVersion = `v${__APP_VERSION__}`;
const baseUrl = import.meta.env.BASE_URL;
const localPackUrl = `${baseUrl}data/lesson-packs.json`;
const palette = ['#14b8a6', '#f97316', '#6366f1', '#e11d48', '#84cc16', '#0891b2', '#d946ef'];

const themes: Array<{ id: ThemeName; label: string }> = [
  { id: 'paper', label: 'Paper' },
  { id: 'midnight', label: 'Night' },
  { id: 'lab', label: 'Lab' },
];

const blockStyles: Array<{ id: BlockStyleName; label: string }> = [
  { id: 'jelly', label: 'Jelly' },
  { id: 'card', label: 'Card' },
  { id: 'tile', label: 'Tile' },
  { id: 'neon', label: 'Neon' },
];

const solveModes: Array<{ id: SolveMode; label: string }> = [
  { id: 'sequence', label: '순서대로 선택' },
  { id: 'collect', label: '블럭 모으기' },
];

const gameKinds: Array<{ id: GameKind; label: string }> = [
  { id: 'lesson', label: '학습 매칭' },
  { id: 'numbers', label: '숫자 더하기' },
];

const mobilePanels = [
  { id: 'packs', label: '학습팩' },
  { id: 'game', label: '게임하기' },
  { id: 'score', label: '점수' },
] as const;

type MobilePanel = (typeof mobilePanels)[number]['id'];

const packs = ref<LessonPack[]>([]);
const selectedPackId = ref('');
const selectedLevel = ref(1);
const lessonItems = ref<LessonItem[]>([]);
const sampleItems = ref<LessonItem[]>([]); // 팩 문항 목록에 보여줄 랜덤 30개
const mode = ref<GameMode>('single');
const gameKind = ref<GameKind>((localStorage.getItem('matchit-game-kind') as GameKind) || 'lesson');
const solveMode = ref<SolveMode>((localStorage.getItem('matchit-solve-mode') as SolveMode) || 'sequence');
const swapFirstIndex = ref<number | null>(null);
const theme = ref<ThemeName>((localStorage.getItem('matchit-theme') as ThemeName) || 'midnight');
const blockStyle = ref<BlockStyleName>((localStorage.getItem('matchit-block-style') as BlockStyleName) || 'card');
const showAnswer = ref(localStorage.getItem('matchit-show-answer') !== 'off');
const answerItem = ref<LessonItem | null>(null);
const answerSlotSize = ref(48);
const boardEl = ref<HTMLElement | null>(null);
const answerEl = ref<HTMLElement | null>(null);
let answerTimer: number | undefined;
let answerStartRects: Array<DOMRect | null> = [];
const remoteUrl = ref(localStorage.getItem('matchit-data-url') || localPackUrl);
const board = ref<Block[]>([]);
const selectedIndexes = ref<number[]>([]);
const score = ref(0);
const bestKey = (kind = gameKind.value) => `matchit-best-${kind}`;
const best = ref(Number(localStorage.getItem(bestKey()) || 0));
const combo = ref(1);
const moves = ref(25);
const passes = ref(0);
const gameOver = ref(false);
// 레벨별 누적 점수/푼 문제수 (현재 팩 기준)
const levelStats = ref<Record<number, { score: number; solved: number }>>({});
const message = ref('목표 블럭을 순서대로 누르세요.');
const loading = ref(false);
const isResolving = ref(false);
const clearingIndexes = ref<number[]>([]);
const fadingIndexes = ref<number[]>([]);
const hintIndexes = ref<number[]>([]);
// 숫자 모드: 사라지는 블럭이 합쳐지는 칸으로 모이는 인라인 트랜스폼 (index -> style)
const gatherStyles = ref<Map<number, Record<string, string>>>(new Map());
const draggedIndex = ref<number | null>(null);
const dragGhost = ref<{ token: string; color: string; x: number; y: number; w: number; h: number } | null>(null);
const motionPhase = ref<'idle' | 'swap' | 'fall'>('idle');
const error = ref('');
const shareUrl = ref('');
const lastSolved = ref<LessonItem | null>(null);
const targetIndex = ref(0);
const showHint = ref(false);
const activeMobilePanel = ref<MobilePanel>('packs');
const showExitConfirm = ref(false);
const gameFullscreen = ref(false);

const activePack = computed(() => packs.value.find((pack) => pack.id === selectedPackId.value));
const target = computed(() => {
  if (mode.value === 'endless') {
    return {
      id: 'endless',
      label: 'Endless Mode',
      prompt: '아무거나 맞춰보세요',
      tokens: [],
      hint: '보드에 있는 정답을 연속으로 맞추세요.',
    };
  }
  if (!lessonItems.value.length) return null;
  return lessonItems.value[targetIndex.value % lessonItems.value.length];
});
const selectedBlocks = computed((): Block[] => selectedIndexes.value.map((index) => board.value[index]).filter((block): block is Block => Boolean(block)));
const selectedText = computed(() => selectedBlocks.value.map((block) => block.token).join(' '));

// 블럭모으기 모드: 블럭을 교환해 목표 식의 글자들을 상하좌우로 붙이면(연결) 제거
const collectTargetItem = ref<LessonItem | null>(null);
const collectableItems = computed(() =>
  lessonItems.value.filter((it) => it.tokens.length >= 2 && it.tokens.length <= Math.max(rows.value, cols.value)),
);
const maxValue = computed(() => board.value.reduce((max, block) => Math.max(max, block?.value ?? 0), 0));
// 토큰(글자)이 긴 팩(영문법·수학식)은 가로로 긴 블럭 사용
const wideBlocks = computed(() => gameKind.value === 'lesson' && wideBlockPacks.has(selectedPackId.value));
const goalPrompt = computed(() => {
  if (gameKind.value === 'numbers') return `최고 숫자 ${formatValue(maxValue.value)}`;
  if (solveMode.value === 'collect') {
    if (mode.value === 'endless') return '보드의 식 글자들을 붙여 맞추기';
    return collectTargetItem.value?.prompt || '로딩 중';
  }
  return target.value?.prompt || '로딩 중';
});
// 힌트 버튼이 켜졌을 때 현재 목표 문항의 hint 텍스트
const hintText = computed(() => {
  if (!hintIndexes.value.length || gameKind.value !== 'lesson') return '';
  const item = solveMode.value === 'collect' ? collectTargetItem.value : target.value;
  return item?.hint ?? '';
});

function blockId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function refreshSampleItems() {
  sampleItems.value = shuffle(lessonItems.value).slice(0, 30);
}
watch(lessonItems, refreshSampleItems);

function colorForToken(token: string) {
  const tokens = Array.from(new Set(lessonItems.value.flatMap((it) => it.tokens)));
  const tokenIndex = Math.max(0, tokens.indexOf(token));
  return palette[tokenIndex % palette.length];
}

function makeBlock(item: LessonItem, token?: string): Block {
  const blockToken = token || item.tokens[Math.floor(Math.random() * item.tokens.length)];
  return {
    id: blockId(),
    token: blockToken,
    lessonId: item.id,
    label: item.label,
    color: colorForToken(blockToken),
  };
}

// ── 숫자 더하기 모드 ──
function formatValue(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (value >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(value);
}

function colorForValue(value: number): string {
  const tier = value > 0 ? Math.floor(Math.log2(value)) : 0;
  return palette[tier % palette.length];
}

// 작은 수에 가중치를 두되 1~8을 다양하게 스폰
const spawnPool = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 6, 8];
function randomSpawnValue(): number {
  return spawnPool[Math.floor(Math.random() * spawnPool.length)];
}

function makeNumberBlock(value: number): Block {
  return {
    id: blockId(),
    token: formatValue(value),
    value,
    lessonId: 'number',
    label: String(value),
    color: colorForValue(value),
  };
}

function seedNumberBoard(): Block[] {
  const newBoard = Array.from({ length: rows.value * cols.value }, () => makeNumberBlock(randomSpawnValue()));
  // 시작부터 자동 합체되지 않도록 3개 이상 연결된 덩어리를 깬다
  let guard = 0;
  let clusters = findAllMergeClusters(newBoard);
  while (clusters.length && guard < 300) {
    for (const comp of clusters) {
      const idx = comp[Math.floor(Math.random() * comp.length)];
      newBoard[idx] = makeNumberBlock(randomSpawnValue());
    }
    clusters = findAllMergeClusters(newBoard);
    guard += 1;
  }
  return newBoard;
}


function cellNeighbors(index: number): number[] {
  const row = Math.floor(index / cols.value);
  const col = index % cols.value;
  const result: number[] = [];
  if (row > 0) result.push(index - cols.value);
  if (row < rows.value - 1) result.push(index + cols.value);
  if (col > 0) result.push(index - 1);
  if (col < cols.value - 1) result.push(index + 1);
  return result;
}

// 목표 식의 글자들이 상하좌우로 서로 붙어(연결) 한 덩어리를 이루면 그 인덱스를 반환.
// startCells를 주면 그 칸을 포함하는 덩어리만 찾는다.
function findTargetCluster(brd: Block[], tokens: string[], startCells?: number[]): number[] | null {
  const n = tokens.length;
  if (n < 2) return null;
  const need = new Map<string, number>();
  for (const token of tokens) need.set(token, (need.get(token) || 0) + 1);

  const grow = (members: number[], used: Set<number>, remaining: Map<string, number>): number[] | null => {
    if (members.length === n) return [...members];
    const frontier = new Set<number>();
    for (const cell of members) {
      for (const next of cellNeighbors(cell)) {
        if (used.has(next)) continue;
        const token = brd[next]?.token;
        if (token && (remaining.get(token) || 0) > 0) frontier.add(next);
      }
    }
    for (const next of frontier) {
      const token = brd[next]!.token;
      members.push(next);
      used.add(next);
      remaining.set(token, remaining.get(token)! - 1);
      const found = grow(members, used, remaining);
      if (found) return found;
      members.pop();
      used.delete(next);
      remaining.set(token, remaining.get(token)! + 1);
    }
    return null;
  };

  const starts = startCells ?? Array.from({ length: rows.value * cols.value }, (_, i) => i);
  for (const start of starts) {
    const token = brd[start]?.token;
    if (!token || !need.has(token)) continue;
    const remaining = new Map(need);
    remaining.set(token, remaining.get(token)! - 1);
    const found = grow([start], new Set([start]), remaining);
    if (found) return found;
  }
  return null;
}

function findAnyTargetCluster(brd: Block[], startCells?: number[]): { indexes: number[]; item: LessonItem } | null {
  for (const item of collectableItems.value) {
    const indexes = findTargetCluster(brd, item.tokens, startCells);
    if (indexes) return { indexes, item };
  }
  return null;
}

// 현재 보드에 있는 글자들만으로 그 식을 만들 수 있는지 (개수 충족 여부)
function canFormFromBoard(item: LessonItem) {
  const counts = new Map<string, number>();
  for (const block of board.value) {
    if (block) counts.set(block.token, (counts.get(block.token) || 0) + 1);
  }
  const need = new Map<string, number>();
  for (const token of item.tokens) need.set(token, (need.get(token) || 0) + 1);
  for (const [token, count] of need) {
    if ((counts.get(token) || 0) < count) return false;
  }
  return true;
}

// 보드가 이미 지원하는(만들 수 있고 아직 붙어있지 않은) 식 중에서 다음 목표를 고른다
function chooseNextCollectTarget(): LessonItem | null {
  const supportable = collectableItems.value.filter(canFormFromBoard);
  const fresh = supportable.filter((item) => !findTargetCluster(board.value, item.tokens));
  const pool = fresh.length ? fresh : supportable;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function pickCollectItem() {
  const pool = collectableItems.value;
  collectTargetItem.value = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

// 목표 식의 토큰들을 보드 위 무작위 위치에 흩뿌려 항상 풀 수 있게 보장 (정렬은 아직 안 됨)
function scatterTokens(brd: Block[], item: LessonItem) {
  const positions = shuffle(Array.from({ length: rows.value * cols.value }, (_, i) => i));
  item.tokens.forEach((token, k) => {
    brd[positions[k]] = makeBlock(item, token);
  });
}

// 순서대로(단일) 모드: 목표가 항상 풀 수 있도록 보장.
// 보드에 글자가 다 있는 식을 우선 목표로, 없으면 새 목표를 고르고 답 글자를 위에서 떨어뜨린다.
function ensureSequenceTargetOnBoard() {
  if (gameKind.value !== 'lesson' || solveMode.value !== 'sequence' || mode.value !== 'single') return;
  const items = lessonItems.value;
  if (!items.length) return;
  const present = items.filter(canFormFromBoard);
  if (present.length) {
    targetIndex.value = items.indexOf(present[Math.floor(Math.random() * present.length)]);
    return;
  }
  const chosen = items[Math.floor(Math.random() * items.length)];
  targetIndex.value = items.indexOf(chosen);
  const positions = shuffle(Array.from({ length: rows.value * cols.value }, (_, i) => i));
  const next = [...board.value];
  chosen.tokens.forEach((token, k) => {
    const block = makeBlock(chosen, token);
    block.dropFrom = rows.value;
    next[positions[k]] = block;
  });
  board.value = next;
}

function buildCollectBoard(): Block[] {
  const items = lessonItems.value;
  const target = collectTargetItem.value;
  const pool = collectableItems.value;
  let candidate: Block[] = [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    candidate = Array.from({ length: rows.value * cols.value }, () => makeBlock(items[Math.floor(Math.random() * items.length)]));
    // 풀 수 있도록 목표(엔드리스는 무작위 식)의 토큰을 흩뿌림
    const guarantee = target || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
    if (guarantee) scatterTokens(candidate, guarantee);
    // 시작부터 정답이 완성돼(붙어) 있지 않도록
    const preSolved = target ? findTargetCluster(candidate, target.tokens) : findAnyTargetCluster(candidate);
    if (!preSolved) break;
  }
  return candidate;
}

function seededBlocks() {
  if (gameKind.value === 'numbers') return seedNumberBoard();

  const items = lessonItems.value;
  if (!items.length) return [];

  if (solveMode.value === 'collect') {
    if (mode.value !== 'endless') pickCollectItem();
    else collectTargetItem.value = null;
    return buildCollectBoard();
  }

  const total = rows.value * cols.value;
  if (mode.value === 'endless') {
    const newBoard: Block[] = Array.from({ length: total }, () => {
      const item = items[Math.floor(Math.random() * items.length)];
      return makeBlock(item);
    });
    // Embed a random solution
    const randomItem = items[Math.floor(Math.random() * items.length)];
    const startIndex = Math.floor(Math.random() * (total - randomItem.tokens.length));
    for (let i = 0; i < randomItem.tokens.length; i++) {
      newBoard[startIndex + i] = makeBlock(randomItem, randomItem.tokens[i]);
    }
    return shuffle(newBoard);
  }

  const exactTargets = items.flatMap((item) => item.tokens.map((token) => makeBlock(item, token)));
  const fillers = Array.from({ length: Math.max(0, total - exactTargets.length) }, () => {
    const item = items[Math.floor(Math.random() * items.length)];
    return makeBlock(item);
  });
  return shuffle([...exactTargets, ...fillers]).slice(0, total);
}

const solvedItems = ref<string[]>([]);

watch(solvedItems, (solved) => {
  const required = solveMode.value === 'collect' ? collectableItems.value : lessonItems.value;
  if (mode.value === 'single' && required.length > 0 && solved.length >= required.length) {
    const currentLevelIndex = activePack.value?.levels.indexOf(selectedLevel.value) ?? -1;
    if (currentLevelIndex !== -1 && activePack.value && currentLevelIndex < activePack.value.levels.length - 1) {
      const nextLevel = activePack.value.levels[currentLevelIndex + 1];
      selectedLevel.value = nextLevel;
      loadLevel(selectedPackId.value, nextLevel);
      message.value = `레벨 클리어! 다음 레벨로 이동합니다.`;
    } else {
      message.value = '팩의 모든 레벨을 클리어했습니다!';
    }
  }
});
function resetGame(keepScore = false) {
  board.value = seededBlocks();
  selectedIndexes.value = [];
  swapFirstIndex.value = null;
  clearingIndexes.value = [];
  fadingIndexes.value = [];
  hintIndexes.value = [];
  draggedIndex.value = null;
  motionPhase.value = 'idle';
  combo.value = 1;
  moves.value = 25;
  passes.value = 0;
  gameOver.value = false;
  shareUrl.value = '';
  lastSolved.value = null;
  targetIndex.value = 0;
  showHint.value = false;
  solvedItems.value = [];
  if (!keepScore) score.value = 0;
  if (gameKind.value === 'numbers') {
    message.value = '같은 숫자 3개 이상을 붙여 더 큰 수를 만드세요.';
  } else if (solveMode.value === 'collect') {
    message.value = mode.value === 'endless'
      ? '블럭을 바꿔 보드의 식 글자들을 서로 붙여 맞춰보세요.'
      : '블럭을 바꿔 목표 식의 글자들을 상하좌우로 서로 붙여 맞춰보세요.';
  } else if (mode.value === 'endless') {
    message.value = '아무 블럭이나 순서대로 맞춰보세요.';
  } else {
    message.value = '목표 블럭을 순서대로 누르세요.';
  }
  // 초기 목표를 랜덤으로 고르고 보드에 답이 있도록 보장
  ensureSequenceTargetOnBoard();
}

async function loadLevel(packId: string, level: number) {
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch(`${baseUrl}data/packs/${packId}/${level}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = (await response.json()) as LessonItem[];
    if (!items.length) throw new Error('수준에 항목이 없습니다.');
    lessonItems.value = items;
    loadLevelStats();
    resetGame();
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : '데이터를 읽지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

async function loadPacks(url = remoteUrl.value) {
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as LessonPack[];
    if (!data.length) throw new Error('packs 배열이 비어 있습니다.');
    packs.value = data;
    if (!selectedPackId.value) {
      selectedPackId.value = data[0].id;
      selectedLevel.value = data[0].levels[0];
    }
    localStorage.setItem('matchit-data-url', url);
    if (gameKind.value === 'lesson') applyPackDefaultSize(selectedPackId.value);
    await loadLevel(selectedPackId.value, selectedLevel.value);
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : '데이터를 읽지 못했습니다.';
  } finally {
    loading.value = false;
  }
}


function levelStatsKey() {
  return `matchit-levelstats-${selectedPackId.value}`;
}
function loadLevelStats() {
  try {
    levelStats.value = JSON.parse(localStorage.getItem(levelStatsKey()) || '{}');
  } catch {
    levelStats.value = {};
  }
}
function saveLevelStats() {
  localStorage.setItem(levelStatsKey(), JSON.stringify(levelStats.value));
}

function scoreMatch(item: LessonItem, length: number) {
  const gained = length * 120 * combo.value;
  score.value += gained;
  combo.value += 1;
  lastSolved.value = item;
  best.value = Math.max(best.value, score.value);
  localStorage.setItem(bestKey(), String(best.value));
  // 레벨별 누적 점수/푼 문제수 기록
  const lv = selectedLevel.value;
  const cur = levelStats.value[lv] ?? { score: 0, solved: 0 };
  levelStats.value = { ...levelStats.value, [lv]: { score: cur.score + gained, solved: cur.solved + 1 } };
  saveLevelStats();
  if (mode.value !== 'endless') {
    targetIndex.value = Math.floor(Math.random() * lessonItems.value.length);
  }
  showHint.value = false;
  hintIndexes.value = [];
  message.value = `${item.label} 해결 +${gained}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function applyGravity(indexes: number[]) {
  const items = lessonItems.value;
  const removed = new Set(indexes);
  const nextBoard: Block[] = new Array(rows.value * cols.value);

  for (let col = 0; col < cols.value; col += 1) {
    const survivors: Block[] = [];

    for (let row = rows.value - 1; row >= 0; row -= 1) {
      const index = row * cols.value + col;
      if (!removed.has(index)) survivors.push(board.value[index]);
    }

    const emptyCount = rows.value - survivors.length;

    for (let row = rows.value - 1; row >= 0; row -= 1) {
      const index = row * cols.value + col;
      const survivor = survivors.shift();
      if (survivor) {
        nextBoard[index] = survivor;
      } else {
        const fresh = gameKind.value === 'numbers'
          ? makeNumberBlock(randomSpawnValue())
          : makeBlock(items[Math.floor(Math.random() * items.length)]);
        // 보드 최상단 위에서부터(열에서 비워진 칸 수만큼) 떨어지도록
        fresh.dropFrom = emptyCount;
        nextBoard[index] = fresh;
      }
    }
  }

  board.value = nextBoard;
}

async function resolveMatch(item: LessonItem, indexes: number[]) {
  isResolving.value = true;
  scoreMatch(item, indexes.length);
  showAnswerPopup(item, indexes);
  clearSelection();
  clearingIndexes.value = [...indexes];
  await sleep(1000);
  fadingIndexes.value = [...indexes];
  await sleep(700);
  clearingIndexes.value = [];
  fadingIndexes.value = [];
  motionPhase.value = 'fall';
  applyGravity(indexes);
  moves.value -= 1;
  if (mode.value === 'single' && !solvedItems.value.includes(item.id)) {
    solvedItems.value.push(item.id);
  }
  // 다음 목표를 랜덤 선택하고 보드에 답이 있도록 보장 (없으면 답 글자가 떨어짐)
  ensureSequenceTargetOnBoard();
  await sleep(1000);
  motionPhase.value = 'idle';
  isResolving.value = false;
}

function clearSelection() {
  selectedIndexes.value = [];
}

function tokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}
// 선택한 글자들이 정답 글자 구성의 일부인지 (개수 초과 없이)
function isSubset(selected: string[], answer: string[]) {
  const need = tokenCounts(answer);
  const have = tokenCounts(selected);
  for (const [token, count] of have) {
    if (count > (need.get(token) || 0)) return false;
  }
  return true;
}

async function handleSequenceClick(index: number) {
  if (isResolving.value) return;

  // 자유롭게 여러 블럭 선택 (다시 누르면 해제). 정답 개수+구성이 맞으면 자동 완성
  const existing = selectedIndexes.value.indexOf(index);
  if (existing >= 0) {
    selectedIndexes.value = selectedIndexes.value.filter((_, i) => i !== existing);
    return;
  }
  selectedIndexes.value.push(index);
  const tokens = selectedBlocks.value.map((block) => block.token);

  if (mode.value === 'endless') {
    const matchedItem = lessonItems.value.find(
      (item) => item.tokens.length === tokens.length && isSubset(tokens, item.tokens),
    );
    if (matchedItem) await resolveMatch(matchedItem, [...selectedIndexes.value]);
    return;
  }

  if (!target.value) return;
  if (tokens.length === target.value.tokens.length && isSubset(tokens, target.value.tokens)) {
    await resolveMatch(target.value, [...selectedIndexes.value]);
  }
}

async function resolveCollect(indexes: number[], item: LessonItem) {
  isResolving.value = true;
  scoreMatch(item, indexes.length);
  showAnswerPopup(item, indexes);
  clearSelection();
  clearingIndexes.value = [...indexes];
  await sleep(1000);
  fadingIndexes.value = [...indexes];
  await sleep(700);
  clearingIndexes.value = [];
  fadingIndexes.value = [];
  motionPhase.value = 'fall';
  applyGravity(indexes);
  await sleep(1000);
  motionPhase.value = 'idle';

  if (mode.value === 'single' && !solvedItems.value.includes(item.id)) {
    solvedItems.value.push(item.id);
  }

  // 다음 목표는 보드가 이미 지원하는 식 중에서 선택 (블럭을 덮어쓰지 않음)
  if (mode.value === 'endless') {
    if (!collectableItems.value.some(canFormFromBoard)) board.value = buildCollectBoard();
  } else {
    const next = chooseNextCollectTarget();
    if (next) {
      collectTargetItem.value = next;
    } else {
      pickCollectItem();
      board.value = buildCollectBoard();
    }
  }
  isResolving.value = false;
}

function findCollectMatch(seeds: number[]) {
  if (mode.value === 'endless') return findAnyTargetCluster(board.value, seeds);
  const item = collectTargetItem.value;
  if (!item) return null;
  const indexes = findTargetCluster(board.value, item.tokens, seeds);
  return indexes ? { indexes, item } : null;
}

// 보드 전체에서 같은 값이 상하좌우로 3개 이상 연결된 덩어리(연결 성분)들을 모두 찾음
function findAllMergeClusters(brd: Block[]): number[][] {
  const total = rows.value * cols.value;
  const visited = new Array<boolean>(total).fill(false);
  const clusters: number[][] = [];
  for (let i = 0; i < total; i += 1) {
    if (visited[i]) continue;
    visited[i] = true;
    const value = brd[i]?.value;
    if (value === undefined) continue;
    const comp: number[] = [];
    const stack = [i];
    while (stack.length) {
      const cell = stack.pop()!;
      comp.push(cell);
      for (const next of cellNeighbors(cell)) {
        if (!visited[next] && brd[next]?.value === value) {
          visited[next] = true;
          stack.push(next);
        }
      }
    }
    if (comp.length >= 3) clusters.push(comp);
  }
  return clusters;
}

function recolorBlock(block: Block, val: number): Block {
  return { ...block, value: val, token: formatValue(val), label: String(val), color: colorForValue(val) };
}

// 3개 이상 연결된 덩어리를 모두 합치고, 낙하 후 새로 생긴 덩어리도 연쇄로 합침
async function resolveNumberClusters(preferIndex: number): Promise<boolean> {
  let firstPass = true;
  let mergedAny = false;
  while (true) {
    const clusters = findAllMergeClusters(board.value);
    if (!clusters.length) break;
    mergedAny = true;

    const removedAll: number[] = [];
    const parentOf = new Map<number, number>(); // keep 쪽으로 한 칸 가까운 이웃
    const depthOf = new Map<number, number>(); // keep 으로부터의 연결 경로 거리
    const keepOf = new Map<number, number>(); // 사라지는 칸 -> 합체 칸
    const valueOf = new Map<number, number>(); // 사라지는 칸의 값(합체 칸에 더해질 양)
    for (const comp of clusters) {
      const value = board.value[comp[0]]!.value!;
      const mergedValue = value * comp.length;
      const keep = firstPass && comp.includes(preferIndex) ? preferIndex : Math.max(...comp);
      score.value += mergedValue * combo.value;
      combo.value += 1;
      // keep 에서 BFS: 각 칸의 부모(한 칸 가까운 이웃)와 깊이를 구함 → 연결 경로를 따라 모임
      const inComp = new Set(comp);
      const visited = new Set<number>([keep]);
      const queue: Array<[number, number]> = [[keep, 0]];
      while (queue.length) {
        const [cur, depth] = queue.shift()!;
        for (const nb of cellNeighbors(cur)) {
          if (inComp.has(nb) && !visited.has(nb)) {
            visited.add(nb);
            parentOf.set(nb, cur);
            depthOf.set(nb, depth + 1);
            queue.push([nb, depth + 1]);
          }
        }
      }
      for (const cell of comp) {
        if (cell !== keep) {
          removedAll.push(cell);
          keepOf.set(cell, keep);
          valueOf.set(cell, value);
        }
      }
    }
    best.value = Math.max(best.value, score.value);
    localStorage.setItem(bestKey(), String(best.value));
    message.value = clusters.length > 1 ? `${clusters.length}곳 동시 합체!` : '합체!';

    clearSelection();
    // 가까운 칸부터 차례로, 연결 경로를 따라 칸칸이 최종 합체 칸까지 이동한 뒤 사라진다
    const gatherOrder = [...removedAll].sort((a, b) => depthOf.get(a)! - depthOf.get(b)!);
    const perCell = 85;
    for (const cell of gatherOrder) {
      const path: number[] = [];
      let cursor = cell;
      while (parentOf.has(cursor)) {
        cursor = parentOf.get(cursor)!;
        path.push(cursor);
      }
      for (let i = 0; i < path.length; i += 1) {
        const waypoint = path[i];
        const dCol = (waypoint % cols.value) - (cell % cols.value);
        const dRow = Math.floor(waypoint / cols.value) - Math.floor(cell / cols.value);
        const styleMap = new Map(gatherStyles.value);
        styleMap.set(cell, {
          transform: `translate(calc(${dCol} * (100% + 0.5rem)), calc(${dRow} * (100% + 0.5rem)))`,
          zIndex: '7',
          transition: `transform ${perCell}ms linear`,
        });
        gatherStyles.value = styleMap;
        await sleep(perCell);
      }
      // 도착: 합체 칸 숫자를 더한 만큼 올리고, 흡수된 블럭은 즉시 숨김
      const keep = keepOf.get(cell)!;
      const next = board.value.slice();
      next[keep] = recolorBlock(next[keep], (next[keep].value ?? 0) + valueOf.get(cell)!);
      board.value = next;
      const hidden = new Map(gatherStyles.value);
      hidden.set(cell, { transform: hidden.get(cell)!.transform, opacity: '0', transition: 'none' });
      gatherStyles.value = hidden;
    }
    await sleep(120);
    gatherStyles.value = new Map();
    motionPhase.value = 'fall';
    applyGravity(removedAll);
    await sleep(1000);
    motionPhase.value = 'idle';

    firstPass = false;
  }
  return mergedAny;
}

function checkNumberGameOver() {
  if (gameKind.value !== 'numbers') return;
  // 자유 스왑이므로, 같은 값이 3개 이상인 숫자가 하나라도 있으면 아직 합칠 수 있다
  const counts = new Map<number, number>();
  for (const block of board.value) {
    if (block?.value !== undefined) counts.set(block.value, (counts.get(block.value) || 0) + 1);
  }
  const canStillMerge = [...counts.values()].some((count) => count >= 3);
  if (!canStillMerge) {
    gameOver.value = true;
    message.value = `게임 오버! 더 합칠 수 없습니다. 점수 ${score.value}`;
  }
}

async function numberSwap(a: number, b: number) {
  isResolving.value = true;
  motionPhase.value = 'swap';
  const next = [...board.value];
  [next[a], next[b]] = [next[b], next[a]];
  board.value = next;
  await sleep(340);
  motionPhase.value = 'idle';

  // 옮긴 칸(b) 우선, 보드 전체의 3개 이상 연결 덩어리를 연쇄로 합침
  const merged = await resolveNumberClusters(b);
  if (!merged) {
    combo.value = 1;
    message.value = '같은 숫자 3개 이상을 붙여보세요.';
  }
  isResolving.value = false;
  checkNumberGameOver();
}

async function trySwap(a: number, b: number) {
  if (a === b) return;
  hintIndexes.value = [];
  if (gameKind.value === 'numbers') {
    await numberSwap(a, b);
    return;
  }
  isResolving.value = true;
  // 어떤 두 블럭이든 자유롭게 교환해 배치 (완성하지 못해도 되돌리지 않음)
  motionPhase.value = 'swap';
  const next = [...board.value];
  [next[a], next[b]] = [next[b], next[a]];
  board.value = next;
  moves.value -= 1;
  await sleep(340);
  motionPhase.value = 'idle';

  const match = findCollectMatch([a, b]);
  if (!match) {
    message.value = '블럭을 옮겨 식의 글자들을 서로 붙여보세요.';
    isResolving.value = false;
    return;
  }
  await resolveCollect(match.indexes, match.item);
}

async function handleCollectClick(index: number) {
  if (isResolving.value) return;
  if (swapFirstIndex.value === null) {
    swapFirstIndex.value = index;
    selectedIndexes.value = [index];
    return;
  }
  const first = swapFirstIndex.value;
  if (first === index) {
    swapFirstIndex.value = null;
    selectedIndexes.value = [];
    return;
  }
  swapFirstIndex.value = null;
  selectedIndexes.value = [];
  await trySwap(first, index);
}

const swapEnabled = computed(() => gameKind.value === 'numbers' || solveMode.value === 'collect');

// 포인터 기반 입력 (마우스 + 모바일 터치 모두 동작). 탭=선택, 드래그=교환.
let pointerStartIndex: number | null = null;
let pointerStartX = 0;
let pointerStartY = 0;
let pointerStartW = 48;
let pointerStartH = 48;
let pointerMoved = false;

function onPointerMove(event: PointerEvent) {
  if (pointerStartIndex === null) return;
  if (Math.abs(event.clientX - pointerStartX) > 8 || Math.abs(event.clientY - pointerStartY) > 8) {
    pointerMoved = true;
  }
  if (pointerMoved && swapEnabled.value) {
    draggedIndex.value = pointerStartIndex;
    const block = board.value[pointerStartIndex];
    if (block) {
      dragGhost.value = { token: block.token, color: block.color, x: event.clientX, y: event.clientY, w: pointerStartW, h: pointerStartH };
    }
  }
}

function onPointerUp(event: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  const from = pointerStartIndex;
  pointerStartIndex = null;
  draggedIndex.value = null;
  dragGhost.value = null;
  if (from === null) return;

  if (pointerMoved && swapEnabled.value) {
    const el = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest('[data-cell]') as HTMLElement | null;
    const to = el ? Number(el.dataset.cell) : -1;
    if (to >= 0 && to !== from) {
      void trySwap(from, to);
    } else {
      swapFirstIndex.value = null;
      selectedIndexes.value = [];
    }
    return;
  }
  // 움직이지 않았으면 탭으로 처리
  handleBlockClick(from);
}

function onBlockPointerDown(index: number, event: PointerEvent) {
  if (isResolving.value) return;
  if (gameKind.value === 'numbers' && gameOver.value) return;
  pointerStartIndex = index;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  pointerStartW = rect.width;
  pointerStartH = rect.height;
  pointerMoved = false;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function setSolveMode(nextMode: SolveMode) {
  solveMode.value = nextMode;
  localStorage.setItem('matchit-solve-mode', nextMode);
  resetGame(true);
}

function setGameKind(nextKind: GameKind) {
  gameKind.value = nextKind;
  localStorage.setItem('matchit-game-kind', nextKind);
  best.value = Number(localStorage.getItem(bestKey(nextKind)) || 0);
  if (nextKind === 'lesson' && selectedPackId.value) applyPackDefaultSize(selectedPackId.value);
  resetGame();
}

function resetScore() {
  score.value = 0;
  combo.value = 1;
  best.value = 0;
  localStorage.setItem(bestKey(), '0');
  levelStats.value = {};
  saveLevelStats();
}

function requestExit() {
  showExitConfirm.value = true;
}
function cancelExit() {
  showExitConfirm.value = false;
}
function confirmExit() {
  showExitConfirm.value = false;
  activeMobilePanel.value = 'packs';
}

function computeHintIndexes(): number[] {
  if (gameKind.value === 'numbers') {
    const byValue = new Map<number, number[]>();
    board.value.forEach((block, i) => {
      if (block?.value === undefined) return;
      const list = byValue.get(block.value) ?? [];
      list.push(i);
      byValue.set(block.value, list);
    });
    for (const list of byValue.values()) {
      if (list.length >= 3) return list.slice(0, 3);
    }
    return [];
  }
  // 학습 모드: 보드에 글자가 모두 있는 식을 찾아 표시 (현재 목표 우선, 없으면 가능한 다른 식)
  const tokensOnBoard = (item: LessonItem): number[] | null => {
    const result: number[] = [];
    const used = new Set<number>();
    for (const token of item.tokens) {
      const found = board.value.findIndex((block, i) => !used.has(i) && block?.token === token);
      if (found < 0) return null;
      used.add(found);
      result.push(found);
    }
    return result;
  };
  const pool = solveMode.value === 'collect' ? collectableItems.value : lessonItems.value;
  const preferred = solveMode.value === 'collect' ? collectTargetItem.value : target.value;
  const ordered = preferred ? [preferred, ...pool.filter((it) => it.id !== preferred.id)] : pool;
  for (const item of ordered) {
    const found = tokensOnBoard(item);
    if (found) return found;
  }
  return [];
}

function toggleHint() {
  if (hintIndexes.value.length) {
    hintIndexes.value = [];
    return;
  }
  const hint = computeHintIndexes();
  hintIndexes.value = hint;
  if (!hint.length) message.value = '표시할 조합이 없어요.';
}

// 모르면 다음 문제로 넘어가기 (학습 한 문제씩 모드)
const canPass = computed(() => gameKind.value === 'lesson' && mode.value === 'single');
function passCurrent() {
  if (!canPass.value || isResolving.value) return;
  passes.value += 1;
  selectedIndexes.value = [];
  swapFirstIndex.value = null;
  hintIndexes.value = [];
  if (solveMode.value === 'collect') {
    const next = chooseNextCollectTarget();
    if (next) {
      collectTargetItem.value = next;
    } else {
      pickCollectItem();
      board.value = buildCollectBoard();
    }
  } else {
    ensureSequenceTargetOnBoard();
  }
  message.value = '패스 — 다음 문제!';
}

function handleBlockClick(index: number) {
  if (isResolving.value) return;
  if (gameKind.value === 'numbers' && gameOver.value) return;
  if (swapEnabled.value) {
    void handleCollectClick(index);
    return;
  }
  if (moves.value <= 0) return;
  void handleSequenceClick(index);
}

function setTheme(nextTheme: ThemeName) {
  theme.value = nextTheme;
  localStorage.setItem('matchit-theme', nextTheme);
}

function setBlockStyle(nextStyle: BlockStyleName) {
  blockStyle.value = nextStyle;
  localStorage.setItem('matchit-block-style', nextStyle);
}

function applyBoardSize() {
  localStorage.setItem('matchit-cols', String(cols.value));
  localStorage.setItem('matchit-rows', String(rows.value));
  resetGame();
}

function setShowAnswer(on: boolean) {
  showAnswer.value = on;
  localStorage.setItem('matchit-show-answer', on ? 'on' : 'off');
}

function showAnswerPopup(item: LessonItem, indexes: number[]) {
  if (gameKind.value !== 'lesson' || !showAnswer.value) return;
  // 정답이 된 보드 블럭들의 화면 위치를 먼저 기록 (제거되기 전)
  const buttons = boardEl.value?.querySelectorAll<HTMLElement>('.block-face');
  answerStartRects = indexes.map((i) => buttons?.[i]?.getBoundingClientRect() ?? null);
  // 팝업 블럭 크기를 현재 보드 블럭 크기에 맞춤 (보드 크기에 비례)
  const cellWidth = answerStartRects.find((r) => r)?.width;
  answerSlotSize.value = cellWidth ? Math.round(cellWidth) : 48;
  answerItem.value = item;
  // 팝업 슬롯이 그려진 뒤, 각 슬롯을 원래 보드 위치에서 제자리로 슬라이드
  void nextTick().then(() => {
    const slots = answerEl.value?.querySelectorAll<HTMLElement>('.answer-slot');
    if (!slots) return;
    slots.forEach((el, i) => {
      const start = answerStartRects[i];
      if (!start) return;
      const end = el.getBoundingClientRect();
      const dx = start.left - end.left;
      const dy = start.top - end.top;
      const sx = end.width ? start.width / end.width : 1;
      const sy = end.height ? start.height / end.height : 1;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transform: 'translate(0, 0) scale(1, 1)' },
        ],
        { duration: 440, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      );
    });
  });
  window.clearTimeout(answerTimer);
  answerTimer = window.setTimeout(() => {
    answerItem.value = null;
  }, 5000);
}
function holdAnswer() {
  window.clearTimeout(answerTimer); // 누르고 있는 동안 유지
}
function releaseAnswer() {
  answerItem.value = null; // 손을 떼면 닫힘 (탭 포함)
}

function applyPackDefaultSize(packId: string) {
  const size = packBoardSizes[packId] ?? { cols: 7, rows: 7 };
  cols.value = size.cols;
  rows.value = size.rows;
  localStorage.setItem('matchit-cols', String(cols.value));
  localStorage.setItem('matchit-rows', String(rows.value));
}

function setMode(nextMode: GameMode) {
  mode.value = nextMode;
  resetGame(true);
}

async function handleLevelChange() {
  if (!activePack.value) return;
  await loadLevel(selectedPackId.value, selectedLevel.value);
}

async function handlePackChange() {
  if (!activePack.value) return;
  selectedLevel.value = activePack.value.levels[0];
  applyPackDefaultSize(selectedPackId.value);
  await handleLevelChange();
}

async function createShareImage() {
  shareUrl.value = '';
  await nextTick();
  const canvas = document.createElement('canvas');
  const width = 1080;
  const height = 1080;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#fff7ed');
  gradient.addColorStop(0.48, '#e0f2fe');
  gradient.addColorStop(1, '#fce7f3');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const subtitle = gameKind.value === 'numbers'
    ? '숫자 더하기'
    : `${activePack.value?.title || ''}${mode.value === 'single' ? ` · Level ${selectedLevel.value}` : ' · 연속으로'}`;
  const solvedTotal = Object.values(levelStats.value).reduce((sum, s) => sum + (s?.solved || 0), 0);
  const detailLabel = gameKind.value === 'numbers' ? '최고 숫자' : '푼 문제';
  const detailValue = gameKind.value === 'numbers' ? formatValue(maxValue.value) : `${solvedTotal}`;

  // 제목 + 버전 (제목 폰트로 폭을 재서 겹치지 않게)
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#1f2937';
  context.font = '800 84px sans-serif';
  context.fillText('Match It', 84, 156);
  const titleWidth = context.measureText('Match It').width;
  context.font = '700 40px sans-serif';
  context.fillStyle = '#64748b';
  context.fillText(appVersion, 84 + titleWidth + 22, 156);
  // 게임/팩명
  context.fillStyle = '#334155';
  context.font = '600 48px sans-serif';
  context.fillText(subtitle, 86, 240);

  // 점수 박스
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#cbd5e1';
  context.lineWidth = 4;
  context.roundRect(84, 304, 912, 320, 36);
  context.fill();
  context.stroke();
  context.fillStyle = '#64748b';
  context.font = '700 40px sans-serif';
  context.fillText('SCORE', 134, 404);
  context.fillStyle = '#0f766e';
  context.font = '800 176px sans-serif';
  context.fillText(String(score.value), 130, 566);

  // 박스 아래: 최고점수 · 콤보 · 푼문제(또는 최고 숫자) 3열
  const stats: Array<[string, string]> = [
    ['BEST', String(best.value)],
    ['COMBO', `x${Math.max(1, combo.value - 1)}`],
    [detailLabel, detailValue],
  ];
  const colWidth = 912 / 3;
  context.textAlign = 'center';
  stats.forEach(([label, value], i) => {
    const cx = 84 + colWidth * i + colWidth / 2;
    context.fillStyle = '#94a3b8';
    context.font = '600 34px sans-serif';
    context.fillText(label, cx, 720);
    context.fillStyle = '#1f2937';
    context.font = '800 60px sans-serif';
    context.fillText(value, cx, 790);
  });
  context.textAlign = 'left';

  // 푸터
  context.fillStyle = '#0f172a';
  context.font = '600 32px sans-serif';
  context.fillText('typostudio.github.io/matchit', 84, 992);
  shareUrl.value = canvas.toDataURL('image/png');
}

watch(selectedPackId, (id) => localStorage.setItem('matchit-selected-pack-id', id));
watch(selectedLevel, (level) => localStorage.setItem('matchit-selected-level', String(level)));

// 게임 상태/블럭 저장 → 새로고침 시 진행 중이던 게임 복원
const SAVE_KEY = 'matchit-save';
function saveGame() {
  if (!board.value.length) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      gameKind: gameKind.value,
      mode: mode.value,
      solveMode: solveMode.value,
      packId: selectedPackId.value,
      level: selectedLevel.value,
      cols: cols.value,
      rows: rows.value,
      board: board.value.map((b) => ({ token: b.token, value: b.value, lessonId: b.lessonId, label: b.label, color: b.color })),
      lessonItems: lessonItems.value,
      score: score.value,
      combo: combo.value,
      moves: moves.value,
      passes: passes.value,
      targetIndex: targetIndex.value,
      gameOver: gameOver.value,
      collectTargetId: collectTargetItem.value?.id ?? null,
    }));
  } catch {
    /* 저장 용량 초과 등은 무시 */
  }
}

interface SavedGame {
  gameKind: GameKind; mode: GameMode; solveMode: SolveMode;
  packId: string; level: number; cols?: number; rows?: number;
  board: Array<{ token: string; value?: number; lessonId: string; label: string; color: string }>;
  lessonItems: LessonItem[];
  score: number; combo: number; moves: number; passes: number;
  targetIndex: number; gameOver: boolean; collectTargetId: string | null;
}

function readSave(): SavedGame | null {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  } catch {
    return null;
  }
}

function restoreFromSave(s: SavedGame) {
  gameKind.value = s.gameKind;
  mode.value = s.mode;
  solveMode.value = s.solveMode;
  selectedPackId.value = s.packId;
  selectedLevel.value = s.level;
  if (s.cols) cols.value = s.cols;
  if (s.rows) rows.value = s.rows;
  lessonItems.value = s.lessonItems || [];
  board.value = (s.board || []).map((b) => ({
    id: blockId(),
    token: b.token,
    value: b.value,
    lessonId: b.lessonId,
    label: b.label,
    color: b.color,
  }));
  score.value = s.score || 0;
  combo.value = s.combo || 1;
  moves.value = s.moves ?? 25;
  passes.value = s.passes || 0;
  targetIndex.value = s.targetIndex || 0;
  gameOver.value = !!s.gameOver;
  collectTargetItem.value = lessonItems.value.find((it) => it.id === s.collectTargetId) || null;
  best.value = Number(localStorage.getItem(bestKey()) || 0);
}

onMounted(async () => {
  selectedPackId.value = localStorage.getItem('matchit-selected-pack-id') || '';
  selectedLevel.value = Number(localStorage.getItem('matchit-selected-level') || 1);
  const savedPanel = localStorage.getItem('matchit-panel');
  const save = readSave();
  const canResume = !!(save && Array.isArray(save.board) && save.board.length && savedPanel === 'game');

  await loadPacks();

  if (canResume && save) {
    // 게임 중이었으면 저장된 보드/상태로 복원하고 게임 화면으로
    restoreFromSave(save);
    activeMobilePanel.value = 'game';
  } else {
    // 평소엔 설정(학습팩) 화면으로
    activeMobilePanel.value = savedPanel === 'score' ? 'score' : 'packs';
  }

  // 복원 이후부터 상태 저장 시작 (loadPacks의 새 보드가 저장을 덮어쓰지 않도록)
  watch(board, saveGame, { deep: true });
  watch([score, combo, moves, passes, targetIndex, gameOver, collectTargetItem, gameKind, solveMode, mode], saveGame);
  watch(activeMobilePanel, (panel) => localStorage.setItem('matchit-panel', panel));
});
</script>

<template>
  <main :class="['app-main min-h-screen px-4 py-5 text-[var(--ink)] sm:px-6 lg:px-8', `theme-${theme}`]" style="background: var(--page)">
    <div class="app-shell mx-auto flex max-w-7xl flex-col gap-5">
      <header class="flex flex-col gap-4 border-b border-[var(--line)] pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div class="flex grow items-start justify-between">
          <div>
            <p class="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Study Block Puzzle</p>
            <h1 class="mt-2 flex items-baseline gap-2 text-3xl font-black sm:text-5xl">
              Match It
              <span class="text-sm font-bold text-[var(--muted)] sm:text-base">{{ appVersion }}</span>
            </h1>
            <p class="mt-2 hidden max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base lg:block">
              화학식, 문법, 공식, 사자성어를 블럭 규칙으로 맞추는 정적 웹 게임 프로토타입.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <label for="theme-select" class="text-xs font-bold uppercase text-[var(--muted)]">Theme</label>
            <select id="theme-select" v-model="theme" class="h-9 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 text-xs font-bold" @change="setTheme(($event.target as HTMLSelectElement).value as ThemeName)">
              <option v-for="item in themes" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </div>
        </div>
      </header>

      <nav class="grid grid-cols-3 gap-2 lg:hidden" aria-label="모바일 화면 전환">
        <button
          v-for="panel in mobilePanels"
          :key="panel.id"
          class="flex h-11 items-center justify-center gap-1 rounded-md border px-2 text-sm font-black"
          :class="[
            activeMobilePanel === panel.id ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel)]',
            panel.id === 'game' && activeMobilePanel !== panel.id ? 'nav-game-cta' : '',
          ]"
          type="button"
          @click="activeMobilePanel = panel.id"
        >
          <span v-if="panel.id === 'game'" aria-hidden="true">▶</span>
          {{ panel.label }}
        </button>
      </nav>

      <section class="app-layout grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside
          class="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4"
          :class="activeMobilePanel === 'packs' ? 'app-panel' : 'hidden lg:block'"
        >
          <p class="text-xs font-bold uppercase text-[var(--muted)]">Game</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button
              v-for="kind in gameKinds"
              :key="kind.id"
              class="h-11 rounded-md border text-sm font-black"
              :class="gameKind === kind.id ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'"
              type="button"
              @click="setGameKind(kind.id)"
            >
              {{ kind.label }}
            </button>
          </div>

          <template v-if="gameKind === 'lesson'">
          <div class="mt-5 flex items-center justify-between gap-3">
            <h2 class="text-lg font-black">학습팩</h2>
            <span class="rounded bg-[var(--panel-strong)] px-2 py-1 text-xs font-bold text-[var(--muted)]">{{ packs.length }} packs</span>
          </div>

          <div class="mt-4 grid grid-cols-[2fr_1fr] gap-2">
            <div>
              <label class="block text-xs font-bold uppercase text-[var(--muted)]" for="pack">Pack</label>
              <select id="pack" v-model="selectedPackId" class="mt-1 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3" @change="handlePackChange">
                <option v-for="pack in packs" :key="pack.id" :value="pack.id">{{ pack.title }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-[var(--muted)]" for="level">Level</label>
              <select id="level" v-model="selectedLevel" class="mt-1 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3" @change="handleLevelChange">
                <option v-for="level in activePack?.levels" :key="level" :value="level">{{ level }}</option>
              </select>
            </div>
          </div>

          <label class="mt-4 block text-xs font-bold uppercase text-[var(--muted)]" for="remote">JSON URL</label>
          <div class="mt-1 flex gap-2">
            <input id="remote" v-model="remoteUrl" class="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-sm" />
            <button class="h-11 rounded-md bg-[var(--accent)] px-3 text-sm font-black text-[var(--accent-ink)]" type="button" @click="loadPacks(remoteUrl)">
              ↻
            </button>
          </div>
          <p v-if="error" class="mt-2 text-sm font-semibold text-rose-600">{{ error }}</p>
          <p v-else class="mt-2 text-sm text-[var(--muted)]">JSON 스키마를 원격으로 읽습니다. (CORS 허용 필요)</p>

          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">Game Mode</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="mode === 'single' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setMode('single')">
              한 문제씩
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="mode === 'endless' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setMode('endless')">
              연속으로
            </button>
          </div>

          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">Solve Mode</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button
              v-for="solve in solveModes"
              :key="solve.id"
              class="h-11 rounded-md border text-sm font-black"
              :class="solveMode === solve.id ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'"
              type="button"
              @click="setSolveMode(solve.id)"
            >
              {{ solve.label }}
            </button>
          </div>

          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">ANSWER</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="showAnswer ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setShowAnswer(true)">
              ON
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="!showAnswer ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setShowAnswer(false)">
              OFF
            </button>
          </div>
          <p class="mt-2 text-sm text-[var(--muted)]">문제해결 후 정답을 보여줍니다.</p>

          </template>

          <div class="mt-5">
            <p class="text-xs font-bold uppercase text-[var(--muted)]">Block Design</p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button
                v-for="style in blockStyles"
                :key="style.id"
                class="h-12 rounded-md border px-2 text-sm font-black"
                :class="blockStyle === style.id ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'"
                type="button"
                @click="setBlockStyle(style.id)"
              >
                {{ style.label }}
              </button>
            </div>
          </div>

          <div class="mt-5">
            <p class="text-xs font-bold uppercase text-[var(--muted)]">Board Size (Width x Height)</p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <label class="flex items-center gap-2 text-sm font-bold">
                <select v-model.number="cols" class="h-10 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-2" @change="applyBoardSize">
                  <option v-for="n in boardSizes" :key="n" :value="n">{{ n }}</option>
                </select>
              </label>
              <label class="flex items-center gap-2 text-sm font-bold">
                <select v-model.number="rows" class="h-10 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-2" @change="applyBoardSize">
                  <option v-for="n in boardSizes" :key="n" :value="n">{{ n }}</option>
                </select>
              </label>
            </div>
          </div>

        </aside>

        <section
          class="relative rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 sm:p-4"
          :class="[activeMobilePanel === 'game' ? 'app-game-panel' : 'hidden lg:block', gameFullscreen ? 'app-game-fullscreen' : '']"
        >
          <div class="mb-3 flex items-center justify-between gap-2 lg:hidden">
            <div class="flex gap-2">
              <button
                class="h-10 rounded-md border px-3 text-sm font-black"
                :class="hintIndexes.length ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'"
                type="button"
                @click="toggleHint"
              >
                힌트
              </button>
              <button
                v-if="canPass"
                class="h-10 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-sm font-black"
                type="button"
                @click="passCurrent"
              >
                패스 →
              </button>
            </div>
            <div class="flex gap-2">
              <button
                class="h-10 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-4 text-sm font-black"
                type="button"
                @click="resetGame()"
              >
                새판
              </button>
              <button
                class="h-10 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-4 text-sm font-black"
                type="button"
                @click="requestExit"
              >
                나가기
              </button>
            </div>
          </div>

          <div class="mb-3 rounded-md bg-[var(--panel-strong)] p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-bold uppercase text-[var(--muted)]">Score <strong class="text-base">{{ score }}</strong></p>
              <div class="flex flex-wrap gap-2 max-lg:hidden">
                <button
                  class="h-10 rounded-md border px-3 text-sm font-black"
                  :class="hintIndexes.length ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel)]'"
                  type="button"
                  @click="toggleHint"
                >
                  힌트
                </button>
                <button
                  v-if="canPass"
                  class="h-10 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-black"
                  type="button"
                  @click="passCurrent"
                >
                  패스 →
                </button>
                <button
                  class="hidden h-10 items-center rounded-md border px-3 text-sm font-black lg:inline-flex"
                  :class="gameFullscreen ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel)]'"
                  type="button"
                  @click="gameFullscreen = !gameFullscreen"
                >
                  {{ gameFullscreen ? '✕ 해제' : '⛶' }}
                </button>
              </div>
            </div>
            <p class="mt-3 text-xs font-bold uppercase text-[var(--muted)]">Current Goal</p>
            <p v-if="hintText" class="mt-1 text-xl font-black text-[var(--accent)]">💡 {{ hintText }}</p>
            <p v-else class="mt-1 text-xl font-black">{{ goalPrompt }}</p>
          </div>

          <div class="mb-3 flex flex-wrap items-center justify-between gap-3 lg:flex max-lg:hidden">
            <div>
              <p class="text-sm font-bold text-[var(--muted)]">{{ message }}</p>
              <p class="text-xs text-[var(--muted)]">선택: {{ selectedText || '-' }}</p>
            </div>
            <button class="h-10 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-sm font-black" type="button" @click="resetGame()">
              새판
            </button>
          </div>

          <div ref="boardEl" class="app-board">
          <div v-if="loading" class="grid min-h-[420px] place-items-center rounded-md bg-[var(--panel-strong)] text-sm font-bold text-[var(--muted)]">
            학습팩 로딩 중
          </div>
          <TransitionGroup
            v-else
            name="block"
            tag="div"
            class="board-grid grid gap-2 max-lg:w-full"
            :class="{
              'is-swapping': motionPhase === 'swap',
              'is-falling': motionPhase === 'fall',
              'numbers-board': gameKind === 'numbers',
            }"
            :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }"
          >
            <button
              v-for="(block, index) in board"
              :key="block.id"
              class="block-face border-2 p-1 text-center transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-cyan-300 disabled:cursor-wait"
              :class="[
                wideBlocks ? 'aspect-[3/2]' : 'aspect-square',
                `block-style-${blockStyle}`,
                selectedIndexes.includes(index) ? 'block-selected' : 'border-white/70',
                hintIndexes.includes(index) ? 'block-hint' : '',
                clearingIndexes.includes(index) ? `block-clear-${blockStyle}` : '',
                fadingIndexes.includes(index) ? `block-fade-${blockStyle}` : '',
                draggedIndex === index ? 'opacity-60' : '',
              ]"
              :style="[{ backgroundColor: block.color, '--block-color': block.color, '--drop': block.dropFrom ?? 1 }, gatherStyles.get(index)]"
              type="button"
              :data-cell="index"
              :disabled="isResolving"
              @pointerdown="onBlockPointerDown(index, $event)"
            >
              <span class="block-label flex h-full w-full items-center justify-center font-black" :style="{ '--len': block.token.length }">
                {{ block.token }}
              </span>
            </button>
          </TransitionGroup>
          </div>

          <div
            v-if="gameKind === 'numbers' && gameOver"
            class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/60 px-4 text-center backdrop-blur-sm"
          >
            <p class="text-4xl font-black text-white">게임 오버</p>
            <p class="text-lg font-bold text-white/90">점수 {{ score }} · 최고 {{ best }}</p>
            <button class="mt-2 h-12 rounded-md bg-[var(--accent)] px-6 text-sm font-black text-[var(--accent-ink)]" type="button" @click="resetGame()">
              새 판 시작
            </button>
          </div>
        </section>

        <aside
          class="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4"
          :class="activeMobilePanel === 'score' ? 'app-panel' : 'hidden lg:block'"
        >
          <h2 class="text-lg font-black">{{ gameKind === 'lesson' ? `${activePack?.title || ''}` : '점수' }}</h2>

          <div class="mt-4 grid grid-cols-2 gap-2">
            <!-- 좌측: 현재 점수 카드들 -->
            <div class="space-y-2">
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">Score</p>
                <p class="mt-1 text-2xl font-black">{{ score }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">Best</p>
                <p class="mt-1 text-2xl font-black">{{ best }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">Combo</p>
                <p class="mt-1 text-2xl font-black">x{{ combo }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ gameKind === 'numbers' ? '최고 숫자' : 'Moves' }}</p>
                <p class="mt-1 text-2xl font-black">{{ gameKind === 'numbers' ? formatValue(maxValue) : moves }}</p>
              </div>
              <div v-if="canPass" class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">패스</p>
                <p class="mt-1 text-2xl font-black">{{ passes }}</p>
              </div>
            </div>
            <!-- 우측: 레벨별 점수 / 푼 문제수 (학습 모드) -->
            <div v-if="gameKind === 'lesson'" class="space-y-2">
              <div
                v-for="level in activePack?.levels"
                :key="level"
                class="flex h-20 flex-col justify-center rounded-md p-3"
                :class="level === selectedLevel ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--panel-strong)]'"
              >
                <p class="text-xs font-bold uppercase" :class="level === selectedLevel ? '' : 'text-[var(--muted)]'">
                  Level {{ level }} · {{ levelStats[level]?.solved || 0 }}문제
                </p>
                <p class="mt-1 text-2xl font-black">{{ levelStats[level]?.score || 0 }}</p>
              </div>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-2">
            <button class="h-12 rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="createShareImage">
              점수 공유
            </button>
            <button class="h-12 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="resetScore">
              점수 초기화
            </button>
          </div>

          <div v-if="gameKind === 'numbers'" class="mt-5">
            <h3 class="text-sm font-black text-[var(--muted)]">플레이 방법</h3>
            <ul class="mt-2 space-y-2 text-sm text-[var(--muted)]">
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">같은 숫자 3개 이상을 상하좌우로 붙이면 합쳐집니다.</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">합쳐진 수는 모은 개수만큼 커집니다 (2+2+2 = 6).</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">연쇄로 더 합쳐질수록 콤보 점수가 올라갑니다.</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">더 합칠 수 있는 숫자가 없으면 게임 오버.</li>
            </ul>
          </div>
          <div v-else class="mt-5">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-black text-[var(--muted)]">팩 문항</h3>
              <button
                class="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-base"
                type="button"
                title="다른 문항 보기"
                aria-label="다른 문항 보기"
                @click="refreshSampleItems"
              >
                ↻
              </button>
            </div>
            <ul class="mt-2 space-y-2">
              <li v-for="item in sampleItems" :key="item.id" class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">
                <p class="font-black">{{ item.label }}</p>
                <p class="text-sm text-[var(--muted)]">{{ item.prompt }}</p>
              </li>
            </ul>
          </div>
        </aside>
      </section>

      <footer class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        <span>© 2026 TypoStudio</span>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/TypoStudio/matchit" target="_blank" rel="noopener" class="font-bold text-[var(--accent)] underline">GitHub</a>
      </footer>
    </div>

    <div
      v-if="dragGhost"
      class="pointer-events-none fixed z-50"
      :style="{ left: `${dragGhost.x}px`, top: `${dragGhost.y}px`, width: `${dragGhost.w}px`, height: `${dragGhost.h}px`, transform: 'translate(-50%, -50%)' }"
    >
      <div
        class="block-face grid h-full w-full place-items-center text-xl font-black opacity-90 shadow-2xl"
        :class="`block-style-${blockStyle}`"
        :style="{ backgroundColor: dragGhost.color, '--block-color': dragGhost.color }"
      >
        {{ dragGhost.token }}
      </div>
    </div>

    <div
      v-if="answerItem"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/55 px-6"
      @pointerdown="holdAnswer"
      @pointerup="releaseAnswer"
      @pointercancel="releaseAnswer"
    >
      <div ref="answerEl" class="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 text-center shadow-2xl">
        <p class="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">정답</p>
        <p class="mt-1 text-2xl font-black">{{ answerItem.label }}</p>
        <p class="text-sm text-[var(--muted)]">{{ answerItem.prompt }}</p>
        <div class="mt-4 flex flex-wrap justify-center gap-2">
          <span
            v-for="(token, i) in answerItem.tokens"
            :key="i"
            class="answer-slot block-face grid place-items-center font-black text-white"
            :class="`block-style-${blockStyle}`"
            :style="{ width: `${answerSlotSize}px`, height: `${wideBlocks ? Math.round(answerSlotSize / 1.5) : answerSlotSize}px`, backgroundColor: colorForToken(token), '--block-color': colorForToken(token) }"
          >
            <span class="block-label flex h-full w-full items-center justify-center" :style="{ '--len': token.length }">{{ token }}</span>
          </span>
        </div>
        <p v-if="answerItem.hint" class="mt-4 text-sm font-bold text-[var(--accent)]">💡 {{ answerItem.hint }}</p>
        <p class="mt-3 text-xs text-[var(--muted)]">탭하거나 5초 후 닫힘 · 길게 누르면 유지</p>
      </div>
    </div>

    <div
      v-if="showExitConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
      @click.self="cancelExit"
    >
      <div class="w-full max-w-xs rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 text-center">
        <p class="text-lg font-black">게임을 나가시겠어요?</p>
        <p class="mt-1 text-sm text-[var(--muted)]">진행 중인 판은 사라집니다.</p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="cancelExit">
            취소
          </button>
          <button class="h-11 rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="confirmExit">
            나가기
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="shareUrl"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      @click.self="shareUrl = ''"
    >
      <div class="flex w-full max-w-sm flex-col items-center gap-3">
        <img :src="shareUrl" alt="점수 공유 이미지" class="w-full rounded-xl border border-white/20 shadow-2xl" />
        <p class="text-center text-sm font-bold text-white/90">이미지를 길게 눌러 저장하세요</p>
        <button class="h-11 w-full max-w-[12rem] rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="shareUrl = ''">
          닫기
        </button>
      </div>
    </div>
  </main>
</template>
