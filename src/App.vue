<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Block, BlockStyleName, GameKind, GameMode, LessonItem, LessonPack, SolveMode, ThemeName } from './types';

const cols = ref(Number(localStorage.getItem('matchit-cols')) || 7);
const rows = ref(Number(localStorage.getItem('matchit-rows')) || 7);
const packBoardSizes: Record<string, { cols: number; rows: number }> = {
  'english-grammar': { cols: 5, rows: 7 },
  'math-formula': { cols: 5, rows: 7 },
};
// 토큰(글자)이 긴 팩은 가로로 1.5배 긴 블럭 사용
const wideBlockPacks = new Set(['english-grammar', 'math-formula']);
// 영어 단어 팩(학년별): 철자/뜻 양방향 모드. id가 english-word 로 시작.
const isWordPackId = (id: string) => id.startsWith('english-word');
const appVersion = `v${__APP_VERSION__}`;
const baseUrl = import.meta.env.BASE_URL;
const localPackUrl = `${baseUrl}data/lesson-packs.json`;
const palette = [
  '#14b8a6', '#f97316', '#6366f1', '#e11d48', '#84cc16', '#0891b2', '#d946ef', '#eab308',
  '#3b82f6', '#ef4444', '#10b981', '#a855f7', '#f43f5e', '#0ea5e9', '#65a30d', '#fb923c',
  '#8b5cf6', '#06b6d4', '#db2777', '#22c55e', '#f59e0b', '#7c3aed', '#dc2626', '#2dd4bf',
];

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
const blockPreviewColors = ['#f97316', '#3b82f6'];
const boardPresets: Array<{ cols: number; rows: number; wide?: boolean }> = [
  { cols: 3, rows: 3 },
  { cols: 5, rows: 5 },
  { cols: 7, rows: 7 },
  { cols: 5, rows: 7 },
  { cols: 9, rows: 9, wide: true },
  { cols: 7, rows: 9, wide: true },
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
const lessonItems = ref<LessonItem[]>([]); // 현재 레벨 파일의 문제
const rawWordEntries = ref<Array<{ word: string; meaning: string; hint?: string }>>([]); // 현재 레벨 영어단어 원본
const wordDirection = ref<'spell' | 'meaning'>((localStorage.getItem('matchit-word-direction') as 'spell' | 'meaning') || 'spell');
const STAGE_SIZE = 10; // 한 스테이지의 문제 수
const currentStage = ref(1); // 현재 스테이지(1-based)
const clearedStages = ref<Record<number, number[]>>({}); // {레벨: [클리어한 스테이지...]} (현재 팩)
const showStageClear = ref(false);
const stageClearInfo = ref<{ level: number; stage: number; hasNext: boolean }>({ level: 1, stage: 1, hasNext: false });
const sampleItems = ref<LessonItem[]>([]); // 팩 문항 목록에 보여줄 랜덤 30개
const mode = ref<GameMode>('single');
const gameKind = ref<GameKind>((localStorage.getItem('matchit-game-kind') as GameKind) || 'lesson');
const solveMode = ref<SolveMode>((localStorage.getItem('matchit-solve-mode') as SolveMode) || 'sequence');
const swapFirstIndex = ref<number | null>(null);
const theme = ref<ThemeName>((localStorage.getItem('matchit-theme') as ThemeName) || 'midnight');
const blockStyle = ref<BlockStyleName>((localStorage.getItem('matchit-block-style') as BlockStyleName) || 'jelly');
const showAnswer = ref(localStorage.getItem('matchit-show-answer') !== 'off');
const answerItem = ref<LessonItem | null>(null);
const answerSlotSize = ref(48);
const answerSlotColors = ref<string[]>([]); // 각 정답 슬롯 색(날아온 보드 블럭과 동일)
const boardEl = ref<HTMLElement | null>(null);
const answerEl = ref<HTMLElement | null>(null);
// 셀 실제 픽셀 크기(글자 크기 계산용). Safari의 container-type:size + aspect-ratio 버그를 피해 JS로 측정.
const cellW = ref(0);
const cellH = ref(0);
let boardResizeObserver: ResizeObserver | null = null;
function measureCell() {
  const el = boardEl.value?.querySelector('.block-label') as HTMLElement | null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width && r.height) {
    cellW.value = r.width;
    cellH.value = r.height;
  }
}
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
const isWordPack = computed(() => isWordPackId(selectedPackId.value));
const levels = computed(() => activePack.value?.levels ?? []);
function levelLabel(level: number) {
  return `Lv ${level}`;
}
// 영어단어 원본을 방향(철자/뜻)에 따라 LessonItem으로 변환
function buildWordItems(raw: Array<{ word: string; meaning: string; hint?: string }>, dir: 'spell' | 'meaning'): LessonItem[] {
  return raw.map((r) => {
    const word = r.word.trim();
    const meaning = r.meaning.trim();
    const extra = r.hint ? ` · ${r.hint}` : '';
    if (dir === 'spell') {
      return {
        id: `${word}-spell`,
        label: word,
        prompt: `${meaning} 의 철자`,
        tokens: word.toLowerCase().replace(/[^a-z]/g, '').split(''),
        hint: `${word} = ${meaning}${extra}`,
      };
    }
    return {
      id: `${word}-mean`,
      label: meaning,
      prompt: word,
      tokens: meaning.replace(/\s/g, '').split(''),
      hint: `${word} = ${meaning}${extra}`,
    };
  });
}
// 레벨을 10문제씩 스테이지로 분할
const stageCount = computed(() => Math.max(1, Math.ceil(lessonItems.value.length / STAGE_SIZE)));
const stageItems = computed(() => lessonItems.value.slice((currentStage.value - 1) * STAGE_SIZE, currentStage.value * STAGE_SIZE));
// 한 문제씩 모드는 현재 스테이지(10문제)만, 연속 모드는 레벨 전체를 대상으로
const activeItems = computed(() => (gameKind.value === 'lesson' && mode.value === 'single' ? stageItems.value : lessonItems.value));

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
  if (!activeItems.value.length) return null;
  return activeItems.value[targetIndex.value % activeItems.value.length];
});
const selectedBlocks = computed((): Block[] => selectedIndexes.value.map((index) => board.value[index]).filter((block): block is Block => Boolean(block)));
const selectedText = computed(() => selectedBlocks.value.map((block) => block.token).join(' '));

// 블럭모으기 모드: 블럭을 교환해 목표 식의 글자들을 상하좌우로 붙이면(연결) 제거
const collectTargetItem = ref<LessonItem | null>(null);
const collectableItems = computed(() =>
  // 1글자 답도 포함(탭으로 해결). 상한은 보드 한 변 길이.
  activeItems.value.filter((it) => it.tokens.length >= 1 && it.tokens.length <= Math.max(rows.value, cols.value)),
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
// 힌트로 강조한 실제 문항 (연속모드 가상 목표 대신 사용)
const hintItem = ref<LessonItem | null>(null);
// 힌트 버튼이 켜졌을 때 현재 목표 문항의 hint 텍스트
const hintText = computed(() => {
  if (!hintIndexes.value.length || gameKind.value !== 'lesson') return '';
  return hintItem.value?.hint ?? '';
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
  // 여러 답이 동시에 성립하면 블럭(토큰) 개수가 많은 답을 우선
  const candidates = [...collectableItems.value].sort((a, b) => b.tokens.length - a.tokens.length);
  for (const item of candidates) {
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
  // 이미 푼 문제는 제외(스테이지 내 중복 출제 방지), 다 풀었으면 전체에서
  const unsolved = collectableItems.value.filter((it) => !solvedItems.value.includes(it.id));
  const base = unsolved.length ? unsolved : collectableItems.value;
  // 보드에서 실제로 만들 수 있는 것만 목표가 될 수 있다(없으면 null → 새 판)
  const supportable = base.filter(canFormFromBoard);
  if (!supportable.length) return null;
  const fresh = supportable.filter((item) => !findTargetCluster(board.value, item.tokens));
  const pool = fresh.length ? fresh : supportable;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickCollectItem() {
  const unsolved = collectableItems.value.filter((it) => !solvedItems.value.includes(it.id));
  const pool = unsolved.length ? unsolved : collectableItems.value;
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
  const items = activeItems.value; // 현재 스테이지(10문제)
  if (!items.length) return;
  // 이미 푼 문제는 제외해 스테이지 내 중복 출제를 막는다
  const remaining = items.filter((it) => !solvedItems.value.includes(it.id));
  const candidates = remaining.length ? remaining : items;
  // 목표를 먼저 무작위로 고른다(보드에 이미 있는지와 무관하게 매번 달라지도록)
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  targetIndex.value = items.indexOf(chosen);
  // 고른 목표를 보드에서 만들 수 없으면 새 판을 만들고 안내
  if (!canFormFromBoard(chosen)) {
    message.value = '보드에 답이 없어 새 판을 만들었어요.';
    const fresh = seededBlocks();
    // 새 판에도 목표 글자가 반드시 포함되도록 보장
    const positions = shuffle(Array.from({ length: rows.value * cols.value }, (_, i) => i));
    chosen.tokens.forEach((token, k) => {
      const block = makeBlock(chosen, token);
      block.dropFrom = rows.value;
      fresh[positions[k]] = block;
    });
    board.value = fresh;
  }
}

function buildCollectBoard(): Block[] {
  const items = activeItems.value;
  const target = collectTargetItem.value;
  const pool = collectableItems.value;
  const total = rows.value * cols.value;
  let candidate: Block[] = [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    // 풀 수 있는 정답들을 최대한 보드에 깔고(중복 최소화), 남는 칸은 스테이지 글자로
    candidate = fillAnswerBoard(pool, items, total);
    // 목표는 반드시 보드에 있도록 흩뿌려 보장
    const guarantee = target || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
    if (guarantee) scatterTokens(candidate, guarantee);
    // 1글자 목표는 항상 보드에 존재(탭으로 해결)하므로 미리완성 검사 생략
    if (target && target.tokens.length < 2) break;
    // 시작부터 정답이 완성돼(붙어) 있지 않도록
    const preSolved = target ? findTargetCluster(candidate, target.tokens) : findAnyTargetCluster(candidate);
    if (!preSolved) break;
  }
  return candidate;
}

function seededBlocks() {
  if (gameKind.value === 'numbers') return seedNumberBoard();

  const items = activeItems.value;
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

  return fillAnswerBoard(items, items, total);
}

// 정답들을 "완전한 단위"로 보드에 채운다(중복 최소화·부분 잘림 없이).
// answerPool: 보장하려는 정답들, fillerPool: 남는 칸을 채울 글자 출처.
function fillAnswerBoard(answerPool: LessonItem[], fillerPool: LessonItem[], total: number): Block[] {
  const blocks: Block[] = [];
  for (const item of shuffle(answerPool)) {
    if (blocks.length + item.tokens.length > total) continue; // 안 들어가면 통째로 건너뜀
    for (const token of item.tokens) blocks.push(makeBlock(item, token));
  }
  const pool = fillerPool.length ? fillerPool : answerPool;
  while (blocks.length < total && pool.length) {
    const item = pool[Math.floor(Math.random() * pool.length)];
    blocks.push(makeBlock(item, item.tokens[Math.floor(Math.random() * item.tokens.length)]));
  }
  return shuffle(blocks);
}

const solvedItems = ref<string[]>([]);
// 현재 스테이지 진행도(푼 개수 / 총 개수) — 학습·한문제씩 모드에서만
const showProgress = computed(() => gameKind.value === 'lesson' && mode.value === 'single');
const levelProgress = computed(() => {
  const total = activeItems.value.length; // 스테이지 문제 수(=10)
  return { current: Math.min(solvedItems.value.length + 1, total), total, levelTotal: lessonItems.value.length };
});

watch(solvedItems, (solved) => {
  const required = solveMode.value === 'collect' ? collectableItems.value : activeItems.value;
  if (mode.value === 'single' && gameKind.value === 'lesson' && required.length > 0 && solved.length >= required.length) {
    markStageCleared(selectedLevel.value, currentStage.value);
  }
});

// 한 레벨의 스테이지 수(레벨 N = N개 스테이지). 현재 레벨은 실제 문제 수로 계산.
function stagesInLevel(level: number) {
  if (level === selectedLevel.value) return stageCount.value;
  return level; // 10·20·30… 설계상 레벨 번호 = 스테이지 수
}
function isLevelCleared(level: number) {
  return (clearedStages.value[level]?.length || 0) >= stagesInLevel(level);
}
function firstUnclearedStage(level: number) {
  const done = clearedStages.value[level] || [];
  for (let s = 1; s <= stageCount.value; s += 1) if (!done.includes(s)) return s;
  return 1;
}
function clearedKey() {
  return `matchit-cleared-${selectedPackId.value}`;
}
function loadClearedStages() {
  try {
    const raw = JSON.parse(localStorage.getItem(clearedKey()) || '{}');
    clearedStages.value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    clearedStages.value = {};
  }
}
function markStageCleared(level: number, stage: number) {
  const done = clearedStages.value[level] || [];
  if (!done.includes(stage)) {
    clearedStages.value = { ...clearedStages.value, [level]: [...done, stage].sort((a, b) => a - b) };
    localStorage.setItem(clearedKey(), JSON.stringify(clearedStages.value));
  }
  const maxLevel = levels.value[levels.value.length - 1] ?? level;
  const hasNext = stage < stageCount.value || level < maxLevel;
  stageClearInfo.value = { level, stage, hasNext };
  showStageClear.value = true;
}
function onStageSelect(e: Event) {
  const stage = Number((e.target as HTMLSelectElement).value);
  if (stage === currentStage.value) return;
  currentStage.value = stage;
  resetGame();
}
function goNextStageAfterClear() {
  showStageClear.value = false;
  const { level, stage } = stageClearInfo.value;
  if (stage < stageCount.value) {
    currentStage.value = stage + 1;
    resetGame();
  } else if (levels.value.includes(level + 1)) {
    selectLevel(level + 1); // 다음 레벨(스테이지 1부터)
  }
}
function resetGame(keepScore = false) {
  // 보드를 만들기 전에 상태를 먼저 초기화(목표 선택이 이전 상태를 보지 않도록)
  solvedItems.value = [];
  targetIndex.value = 0;
  hintIndexes.value = [];
  hintItem.value = null;
  board.value = seededBlocks();
  selectedIndexes.value = [];
  swapFirstIndex.value = null;
  clearingIndexes.value = [];
  fadingIndexes.value = [];
  draggedIndex.value = null;
  motionPhase.value = 'idle';
  combo.value = 1;
  moves.value = 25;
  passes.value = 0;
  gameOver.value = false;
  shareUrl.value = '';
  lastSolved.value = null;
  showHint.value = false;
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

// 레벨별 파일(packs/{id}/{level}.json)을 불러온다.
async function loadLevel(packId: string, level: number) {
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch(`${baseUrl}data/packs/${packId}/${level}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    if (!Array.isArray(raw) || !raw.length) throw new Error('문제가 없습니다.');
    if (isWordPackId(packId)) {
      rawWordEntries.value = raw as Array<{ word: string; meaning: string; hint?: string }>;
      lessonItems.value = buildWordItems(rawWordEntries.value, wordDirection.value);
    } else {
      rawWordEntries.value = [];
      lessonItems.value = raw as LessonItem[];
    }
    loadClearedStages();
    loadLevelStats();
    currentStage.value = firstUnclearedStage(level); // 첫 미클리어 스테이지부터
    resetGame();
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : '데이터를 읽지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

// 같은 팩 안에서 레벨만 바꾼다.
function selectLevel(level: number) {
  selectedLevel.value = level;
  loadLevel(selectedPackId.value, level);
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
    if (!selectedPackId.value || !data.some((p) => p.id === selectedPackId.value)) {
      selectedPackId.value = data[0].id;
      selectedLevel.value = 1;
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
  // 문제당 10점 × 콤보 배수(최대 5배). 토큰 수는 점수에 미반영.
  void length;
  const base = 10;
  const gained = base * Math.min(combo.value, 5);
  const comboBonus = gained - base;
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
    targetIndex.value = Math.floor(Math.random() * activeItems.value.length);
  }
  showHint.value = false;
  hintIndexes.value = [];
  message.value = comboBonus > 0
    ? `${item.label} 해결 +${base}점 + Combo ${comboBonus}점`
    : `${item.label} 해결 +${base}점`;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function applyGravity(indexes: number[]) {
  const removed = new Set(indexes);
  const nextBoard: Block[] = new Array(rows.value * cols.value);
  // 새로 떨어질 블럭: 미해결 정답이 보드에서 만들어지도록 부족한 글자를 우선 보충
  const refill = gameKind.value === 'numbers' ? [] : refillTokens(indexes.length, removed);
  let refillIdx = 0;

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
        let fresh: Block;
        if (gameKind.value === 'numbers') {
          fresh = makeNumberBlock(randomSpawnValue());
        } else {
          const spec = refill[refillIdx++];
          fresh = spec ? makeBlock(spec.item, spec.token) : makeBlock(activeItems.value[Math.floor(Math.random() * activeItems.value.length)]);
        }
        // 보드 최상단 위에서부터(열에서 비워진 칸 수만큼) 떨어지도록
        fresh.dropFrom = emptyCount;
        nextBoard[index] = fresh;
      }
    }
  }

  board.value = nextBoard;
}

// 빈 칸을 채울 토큰 목록 — 미해결 정답들을 만들 수 있도록 부족한 글자를 우선 보충
function refillTokens(count: number, removed: Set<number>): Array<{ token: string; item: LessonItem }> {
  const result: Array<{ token: string; item: LessonItem }> = [];
  if (count <= 0) return result;
  const items = activeItems.value;
  if (!items.length) return result;
  // 살아남는 보드의 토큰 수(가용량)
  const avail = new Map<string, number>();
  board.value.forEach((b, i) => {
    if (!removed.has(i) && b) avail.set(b.token, (avail.get(b.token) || 0) + 1);
  });
  const unsolved = items.filter((it) => !solvedItems.value.includes(it.id));
  for (const item of unsolved) {
    if (result.length >= count) break;
    const tmp = new Map(avail);
    const deficit: string[] = [];
    for (const [tk, c] of tokenCounts(item.tokens)) {
      const have = tmp.get(tk) || 0;
      if (have >= c) tmp.set(tk, have - c);
      else { for (let k = 0; k < c - have; k += 1) deficit.push(tk); tmp.set(tk, 0); }
    }
    if (deficit.length <= count - result.length) {
      // 이 정답을 만들 수 있게 부족분 추가 + 사용량 예약(다른 정답과 글자 공유 방지)
      for (const tk of deficit) result.push({ token: tk, item });
      for (const [k, v] of tmp) avail.set(k, v);
    }
  }
  // 남는 칸은 정답 글자로 무작위 채움
  const pool = unsolved.length ? unsolved : items;
  while (result.length < count) {
    const item = pool[Math.floor(Math.random() * pool.length)];
    result.push({ token: item.tokens[Math.floor(Math.random() * item.tokens.length)], item });
  }
  return shuffle(result);
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
    solvedItems.value = [...solvedItems.value, item.id]; // 재할당해야 watch가 감지
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
    solvedItems.value = [...solvedItems.value, item.id]; // 재할당해야 watch가 감지
  }

  // 다음 목표는 보드가 이미 지원하는 식 중에서 선택 (블럭을 덮어쓰지 않음)
  if (mode.value === 'endless') {
    if (!collectableItems.value.some(canFormFromBoard)) board.value = buildCollectBoard();
  } else {
    const next = chooseNextCollectTarget();
    if (next) {
      collectTargetItem.value = next;
    } else {
      message.value = '보드에 답이 없어 새 판을 만들었어요.';
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
  // 1글자 정답은 해당 블럭을 탭하면 바로 해결
  if (mode.value !== 'endless') {
    const t = collectTargetItem.value;
    if (t && t.tokens.length === 1 && board.value[index]?.token === t.tokens[0]) {
      swapFirstIndex.value = null;
      selectedIndexes.value = [];
      await resolveCollect([index], t);
      return;
    }
  } else {
    // 연속 모드: 1글자 답이면 그 블럭 탭으로 해결
    const one = collectableItems.value.find((it) => it.tokens.length === 1 && it.tokens[0] === board.value[index]?.token);
    if (one) {
      swapFirstIndex.value = null;
      selectedIndexes.value = [];
      await resolveCollect([index], one);
      return;
    }
  }
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
  clearedStages.value = {};
  localStorage.setItem(clearedKey(), '{}');
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
  const rawPreferred = solveMode.value === 'collect' ? collectTargetItem.value : target.value;
  // 연속모드의 가상 목표(tokens 비어있음)는 제외
  const preferred = rawPreferred && rawPreferred.tokens.length ? rawPreferred : null;
  // 단일 모드: 힌트는 반드시 현재 목표만 가리킨다(문제·답·힌트 일치 보장)
  if (mode.value !== 'endless') {
    if (preferred) {
      const found = tokensOnBoard(preferred);
      if (found && found.length) {
        hintItem.value = preferred;
        return found;
      }
    }
    hintItem.value = null;
    return [];
  }
  // 연속 모드: 보드에서 만들 수 있는 아무 식이나 강조
  for (const item of activeItems.value) {
    const found = tokensOnBoard(item);
    if (found && found.length) {
      hintItem.value = item;
      return found;
    }
  }
  hintItem.value = null;
  return [];
}

function toggleHint() {
  if (hintIndexes.value.length) {
    hintIndexes.value = [];
    return;
  }
  // 힌트는 보드를 새로 만들지 않는다(현재 목표만 강조). 답 보장은 블럭 낙하 흐름에서 처리.
  const hint = computeHintIndexes();
  hintIndexes.value = hint;
  if (!hint.length) message.value = '표시할 조합이 없어요.';
}

// 모르면 다음 문제로 넘어가기 (학습 한 문제씩 모드)
const canPass = computed(() => gameKind.value === 'lesson' && mode.value === 'single');
function passCurrent() {
  if (!canPass.value || isResolving.value) return;
  passes.value += 1;
  combo.value = 1;
  selectedIndexes.value = [];
  swapFirstIndex.value = null;
  hintIndexes.value = [];
  if (solveMode.value === 'collect') {
    const next = chooseNextCollectTarget();
    if (next) {
      collectTargetItem.value = next;
    } else {
      message.value = '보드에 답이 없어 새 판을 만들었어요.';
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

function setBoardPreset(c: number, r: number) {
  cols.value = c;
  rows.value = r;
  applyBoardSize();
}

function setShowAnswer(on: boolean) {
  showAnswer.value = on;
  localStorage.setItem('matchit-show-answer', on ? 'on' : 'off');
}

function showAnswerPopup(item: LessonItem, indexes: number[]) {
  if (gameKind.value !== 'lesson' || !showAnswer.value) return;
  // 정답이 된 보드 블럭들의 화면 위치를 먼저 기록 (제거되기 전)
  const buttons = boardEl.value?.querySelectorAll<HTMLElement>('.block-face');
  // 각 정답 슬롯(item.tokens 순서)을 같은 글자의 보드 셀에서 출발시킨다(가까운 순 아님)
  const remaining = [...indexes];
  const colors: string[] = [];
  answerStartRects = item.tokens.map((token) => {
    let pos = remaining.findIndex((idx) => board.value[idx]?.token === token);
    if (pos < 0) pos = 0; // 같은 글자가 없으면(예외) 남은 것 중 앞에서
    const idx = remaining.splice(pos, 1)[0];
    colors.push(idx != null ? (board.value[idx]?.color ?? colorForToken(token)) : colorForToken(token));
    return idx != null ? (buttons?.[idx]?.getBoundingClientRect() ?? null) : null;
  });
  answerSlotColors.value = colors; // 팝업 색을 실제 보드 블럭 색과 일치
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

function setWordDirection(dir: 'spell' | 'meaning') {
  if (wordDirection.value === dir) return;
  wordDirection.value = dir;
  localStorage.setItem('matchit-word-direction', dir);
  if (rawWordEntries.value.length) {
    lessonItems.value = buildWordItems(rawWordEntries.value, dir);
    resetGame();
  }
}

async function handleLevelChange() {
  if (!activePack.value) return;
  await loadLevel(selectedPackId.value, selectedLevel.value);
}

async function handlePackChange() {
  if (!activePack.value) return;
  selectedLevel.value = 1;
  applyPackDefaultSize(selectedPackId.value);
  await loadLevel(selectedPackId.value, 1);
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
    : `${activePack.value?.title || ''}${mode.value === 'single' ? ` · ${levelLabel(selectedLevel.value)}` : ' · 연속으로'}`;
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

  // 박스 아래: 최고점수 · 콤보 · 푼문제(또는 최고 숫자) · 블럭(보드 크기) 4열
  const stats: Array<[string, string]> = [
    ['BEST', String(best.value)],
    ['COMBO', `x${Math.max(1, combo.value - 1)}`],
    [detailLabel, detailValue],
    ['블럭', `${cols.value}×${rows.value}`],
  ];
  const colWidth = 912 / stats.length;
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
      stage: currentStage.value,
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
  packId: string; level: number; stage?: number; cols?: number; rows?: number;
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
  currentStage.value = s.stage ?? 1;
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
  // 복원한 보드에서 현재 답을 만들 수 없으면(과거 저장 오류 등) 새 판을 만든다
  if (gameKind.value === 'lesson' && mode.value === 'single') {
    const t = solveMode.value === 'collect' ? collectTargetItem.value : target.value;
    if (t && t.tokens.length && !canFormFromBoard(t)) {
      if (solveMode.value === 'collect') {
        pickCollectItem();
        board.value = buildCollectBoard();
      } else {
        ensureSequenceTargetOnBoard();
      }
    }
  }
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

  // 셀 크기 측정: 보드 크기·전체화면·패널 전환·블럭 수 변화 시 재측정
  await nextTick();
  measureCell();
  boardResizeObserver = new ResizeObserver(() => measureCell());
  if (boardEl.value) boardResizeObserver.observe(boardEl.value);
  watch([cols, rows, gameFullscreen, activeMobilePanel, () => board.value.length], () => nextTick(measureCell));
});

onBeforeUnmount(() => {
  boardResizeObserver?.disconnect();
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
              블럭 맞추기로 여러가지 문제를 풀어보세요.
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
                <option v-for="level in levels" :key="level" :value="level">{{ levelLabel(level) }}{{ isLevelCleared(level) ? ' ✓' : '' }}</option>
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

          <template v-if="isWordPack">
          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">Word Mode</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="wordDirection === 'spell' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setWordDirection('spell')">
              뜻 → 철자
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="wordDirection === 'meaning' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setWordDirection('meaning')">
              영단어 → 뜻
            </button>
          </div>
          </template>

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
            <p class="text-xs font-bold uppercase text-[var(--muted)]">Board Size (Width x Height)</p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button
                v-for="preset in boardPresets"
                :key="`${preset.cols}x${preset.rows}`"
                class="h-11 rounded-md border text-sm font-black"
                :class="[
                  preset.wide ? 'hidden min-[900px]:block' : '',
                  cols === preset.cols && rows === preset.rows ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]',
                ]"
                type="button"
                @click="setBoardPreset(preset.cols, preset.rows)"
              >
                {{ preset.cols }} x {{ preset.rows }}
              </button>
            </div>
          </div>

          <div class="mt-5">
            <p class="text-xs font-bold uppercase text-[var(--muted)]">Block Design</p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button
                v-for="style in blockStyles"
                :key="style.id"
                class="flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-sm font-black"
                :class="blockStyle === style.id ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'"
                type="button"
                @click="setBlockStyle(style.id)"
              >
                <span class="flex gap-1.5">
                  <span
                    v-for="(c, i) in blockPreviewColors"
                    :key="i"
                    class="block-face block-preview h-6 w-6 rounded"
                    :class="`block-style-${style.id}`"
                    :style="{ backgroundColor: c, '--block-color': c }"
                  ></span>
                </span>
                {{ style.label }}
              </button>
            </div>
          </div>

        </aside>

        <section
          class="relative rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 sm:p-4"
          :class="[activeMobilePanel === 'game' ? 'app-game-panel' : 'hidden lg:block', gameFullscreen ? 'app-game-fullscreen' : '']"
        >
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="flex gap-2">
              <button
                class="inline-flex h-10 items-center justify-center rounded-md border px-3 font-black"
                :class="hintIndexes.length ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'"
                type="button"
                title="힌트"
                aria-label="힌트"
                @click="toggleHint"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
                  <path d="M9 18h6"/>
                  <path d="M10 22h4"/>
                </svg>
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
            <div v-if="showProgress" class="flex items-center">
              <select
                class="h-10 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-sm font-black"
                :value="currentStage"
                @change="onStageSelect"
              >
                <option v-for="n in stageCount" :key="n" :value="n">스테이지 {{ n }}{{ (clearedStages[selectedLevel] || []).includes(n) ? ' ✓' : '' }}</option>
              </select>
            </div>
            <div class="flex gap-2">
              <button
                class="inline-flex h-10 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 font-black"
                type="button"
                title="새판"
                aria-label="새판"
                @click="resetGame()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
              <button
                class="hidden h-10 items-center rounded-md border px-3 text-sm font-black lg:inline-flex"
                :class="gameFullscreen ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel)]'"
                type="button"
                @click="gameFullscreen = !gameFullscreen"
              >
                {{ gameFullscreen ? '✕ 해제' : '⛶' }}
              </button>
              <button
                class="inline-flex h-10 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 font-black lg:hidden"
                type="button"
                title="나가기"
                aria-label="나가기"
                @click="requestExit"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" x2="9" y1="12" y2="12"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="relative mb-3 rounded-md bg-[var(--panel-strong)] p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-bold uppercase text-[var(--muted)]">Score <strong class="text-base">{{ score }}</strong></p>
              <div class="flex items-center gap-3">
                <div v-if="showProgress" class="flex flex-col items-end leading-tight">
                  <span class="text-[10px] font-bold uppercase text-[var(--muted)]">{{ activePack?.title }} · Lv{{ selectedLevel }} · 스테이지 {{ currentStage }}/{{ stageCount }}</span>
                  <span class="text-sm font-black text-[var(--accent)]">{{ levelProgress.current }} / {{ levelProgress.total }} / {{ levelProgress.levelTotal }}</span>
                </div>
              </div>
            </div>
            <p class="mt-3 text-xs font-bold uppercase text-[var(--muted)]">Current Goal</p>
            <p class="mt-1 truncate text-xl font-black">{{ goalPrompt }}</p>
            <div v-if="hintText" class="hint-overlay">
              <p>💡 {{ hintText }}</p>
            </div>
          </div>

          <div class="mb-3 flex flex-wrap items-center justify-between gap-3 lg:flex max-lg:hidden">
            <div>
              <p class="text-sm font-bold text-[var(--muted)]">{{ message }}</p>
              <p class="text-xs text-[var(--muted)]">선택: {{ selectedText || '-' }}</p>
            </div>
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
            :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, '--cell-w': `${cellW}px`, '--cell-h': `${cellH}px` }"
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
            <!-- 우측: 레벨별 점수 / 푼 문제수 (학습 모드). 5개 높이만 보이고 나머지는 스크롤 -->
            <div v-if="gameKind === 'lesson'" class="space-y-2 max-h-[27rem] overflow-y-auto pr-1">
              <div
                v-for="level in levels"
                :key="level"
                class="flex h-20 flex-col justify-center rounded-md p-3"
                :class="level === selectedLevel ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--panel-strong)]'"
              >
                <p class="text-xs font-bold uppercase" :class="level === selectedLevel ? '' : 'text-[var(--muted)]'">
                  {{ levelLabel(level) }}{{ isLevelCleared(level) ? ' ✓' : '' }} · 스테이지 {{ (clearedStages[level]?.length || 0) }}/{{ level }}
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
        class="block-face grid h-full w-full place-items-center font-black opacity-90 shadow-2xl"
        :class="`block-style-${blockStyle}`"
        :style="{ backgroundColor: dragGhost.color, '--block-color': dragGhost.color, '--cell-w': `${dragGhost.w}px`, '--cell-h': `${dragGhost.h}px` }"
      >
        <span class="block-label flex h-full w-full items-center justify-center font-black" :style="{ '--len': dragGhost.token.length }">{{ dragGhost.token }}</span>
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
            :style="{ width: `${answerSlotSize}px`, height: `${wideBlocks ? Math.round(answerSlotSize / 1.5) : answerSlotSize}px`, backgroundColor: answerSlotColors[i] ?? colorForToken(token), '--block-color': answerSlotColors[i] ?? colorForToken(token), '--cell-w': `${answerSlotSize}px`, '--cell-h': `${wideBlocks ? Math.round(answerSlotSize / 1.5) : answerSlotSize}px` }"
          >
            <span class="block-label flex h-full w-full items-center justify-center" :style="{ '--len': token.length }">{{ token }}</span>
          </span>
        </div>
        <p v-if="answerItem.hint" class="mt-4 text-sm font-bold text-[var(--accent)]">💡 {{ answerItem.hint }}</p>
        <p class="mt-3 text-xs text-[var(--muted)]">탭하거나 5초 후 닫힘 · 길게 누르면 유지</p>
      </div>
    </div>

    <div
      v-if="showStageClear"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
    >
      <div class="level-clear-pop w-full max-w-xs rounded-2xl border border-[var(--accent)] bg-[var(--panel)] p-6 text-center shadow-2xl">
        <p class="text-5xl">🎉</p>
        <p class="mt-2 text-2xl font-black text-[var(--accent)]">스테이지 클리어!</p>
        <p class="mt-1 text-sm font-bold">{{ levelLabel(stageClearInfo.level) }} · 스테이지 {{ stageClearInfo.stage }} 완료!</p>
        <div class="mt-5 grid gap-2" :class="stageClearInfo.hasNext ? 'grid-cols-2' : 'grid-cols-1'">
          <button class="h-11 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="showStageClear = false">
            계속
          </button>
          <button v-if="stageClearInfo.hasNext" class="h-11 rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="goNextStageAfterClear">
            다음 →
          </button>
        </div>
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
