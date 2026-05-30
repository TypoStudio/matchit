<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Block, BlockStyleName, GameKind, GameMode, LessonItem, LessonPack, PowerKind, SolveMode, ThemeName } from './types';
import { messages, type Locale, type MessageKey } from './locales';

// 화면 라벨 언어팩(src/locales). locale 값만 바꾸면 다른 언어로 확장.
const locale = ref<Locale>('ko');
function t(key: MessageKey): string {
  return messages[locale.value][key];
}

const cols = ref(Number(localStorage.getItem('matchit-cols')) || 7);
const rows = ref(Number(localStorage.getItem('matchit-rows')) || 7);
const appVersion = `v${__APP_VERSION__}`;
const baseUrl = import.meta.env.BASE_URL;
// 기본 학습팩 카탈로그. 로컬 개발에선 같은 저장소의 packs/, 배포 후엔 matchit-packs(GitHub Pages).
const PACK_CATALOG_URL = import.meta.env.PROD
  ? 'https://typostudio.github.io/matchit-packs/packs.json'
  : '/packs/packs.json';
// 기본 목록에서 뺀 과일 맞추기 — 꾸러미 추가에서 한 번에 넣을 수 있게.
const FRUIT_PACK_URL = import.meta.env.PROD
  ? 'https://typostudio.github.io/matchit-packs/arcade/fruit-emoji/pack.json'
  : '/packs/arcade/fruit-emoji/pack.json';
const palette = [
  '#14b8a6', '#f97316', '#6366f1', '#e11d48', '#84cc16', '#0891b2', '#d946ef', '#eab308',
  '#3b82f6', '#ef4444', '#10b981', '#a855f7', '#f43f5e', '#0ea5e9', '#65a30d', '#fb923c',
  '#8b5cf6', '#06b6d4', '#db2777', '#22c55e', '#f59e0b', '#7c3aed', '#dc2626', '#2dd4bf',
];

const themes: Array<{ id: ThemeName; label: string }> = [
  { id: 'paper', label: t('themePaper') },
  { id: 'midnight', label: t('themeNight') },
  { id: 'lab', label: t('themeLab') },
];

const blockStyles: Array<{ id: BlockStyleName; label: string }> = [
  { id: 'jelly', label: t('designJelly') },
  { id: 'card', label: t('designCard') },
  { id: 'tile', label: t('designTile') },
  { id: 'transparent', label: t('designTransparent') },
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

const solveModes: Array<{ id: SolveMode; label: string; desc: string }> = [
  { id: 'sequence', label: t('solveSequence'), desc: t('solveSequenceDesc') },
  { id: 'collect', label: t('solveCollect'), desc: t('solveCollectDesc') },
];

const gameKinds: Array<{ id: GameKind; label: string }> = [
  { id: 'lesson', label: t('kindLesson') },
  { id: 'numbers', label: t('kindNumbers') },
];

const mobilePanels = [
  { id: 'packs', label: t('panelPacks') },
  { id: 'score', label: t('panelScore') },
  { id: 'game', label: t('panelGame') },
] as const;

type MobilePanel = (typeof mobilePanels)[number]['id'];

const packs = ref<LessonPack[]>([]);
const selectedPackId = ref('');
const selectedLevel = ref(1);
const lessonItems = ref<LessonItem[]>([]); // 현재 레벨 파일의 문제
const currentRaw = ref<unknown[]>([]); // 현재 레벨의 원본 배열(방향 전환 시 재구성용)
const rawWordEntries = ref<Array<{ word: string; meaning: string; hint?: string }>>([]); // 현재 레벨 영어단어 원본
const wordDirection = ref<'spell' | 'meaning'>((localStorage.getItem('matchit-word-direction') as 'spell' | 'meaning') || 'spell');
// 외부/통합 팩: 한 파일에 들어온 레벨 문항을 메모리에 보관(packId -> level -> 원본 문항 배열)
const inlineLevels = ref<Record<string, Record<number, unknown[]>>>({});
const packBases = ref<Record<string, string>>({}); // packId -> 외부 레벨 파일 기준 URL
const packLevelFiles = ref<Record<string, Record<number, string>>>({}); // packId -> level -> 레벨 파일 URL
const packLevelLabels = ref<Record<string, Record<number, string>>>({}); // packId -> level -> 표시 라벨
const packFormats = ref<Record<string, 'word' | 'lesson'>>({}); // packId -> 문항 형식(명시/감지된 경우)
const packRandoms = ref<Record<string, boolean>>({}); // packId -> 완전 무작위 채움 여부
// 메타정보로 구동(하드코딩 제거): 보드 사이즈·넓은 블럭·블럭 디자인·양방향·방향 라벨
const packBoards = ref<Record<string, { cols: number; rows: number }>>({}); // packId -> 기본 보드 사이즈
const packWide = ref<Record<string, boolean>>({}); // packId -> 가로로 긴 블럭
const packBlockStyles = ref<Record<string, BlockStyleName>>({}); // packId -> 기본 블럭 디자인
const packBidi = ref<Record<string, boolean>>({}); // packId -> 양방향(출제 방향 토글) 지원
const packDirections = ref<Record<string, { asis?: string; reverse?: string }>>({}); // packId -> 방향 버튼 라벨
// word 형식 여부: 메타(format)로만 판단
function isWordFmt(packId: string) {
  return packFormats.value[packId] === 'word';
}
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
const storedBlockStyle = localStorage.getItem('matchit-block-style');
const blockStyle = ref<BlockStyleName>(storedBlockStyle === 'neon' ? 'transparent' : ((storedBlockStyle as BlockStyleName) || 'jelly')); // neon은 transparent로 마이그레이션
// 모으기 옵션: 인접한 블럭만 교환 / 연속(자유) 모드에서 낙하 후 정답 자동 깨짐(연쇄)
const adjacentSwap = ref(localStorage.getItem('matchit-adjacent-swap') === 'on');
// 숫자 더하기 게임 합치기 모드: 'swap'=블럭 교체(기존), 'add'=블럭 더하기(두 수 합)
const mergeMode = ref<'swap' | 'add'>((localStorage.getItem('matchit-merge-mode') as 'swap' | 'add') || 'swap');
const autoChain = ref(localStorage.getItem('matchit-auto-chain') === 'on');
const showAnswer = ref(localStorage.getItem('matchit-show-answer') !== 'off');
const answerItem = ref<LessonItem | null>(null);
const answerSlotSize = ref(48);
const answerSlotColors = ref<string[]>([]); // 각 정답 슬롯 색(날아온 보드 블럭과 동일)
const boardEl = ref<HTMLElement | null>(null);
const answerEl = ref<HTMLElement | null>(null);
// 한문제씩 모드: 목표 문장이 길면 좌우로 자동 마퀴 + 수동 가로 스크롤
const goalScrollEl = ref<HTMLElement | null>(null);
let marqueeRaf = 0;
let marqueePauseUntil = 0;
function stopGoalMarquee() {
  if (marqueeRaf) cancelAnimationFrame(marqueeRaf);
  marqueeRaf = 0;
}
function pauseGoalMarquee() {
  marqueePauseUntil = Date.now() + 2500; // 사용자가 스크롤하면 잠시 자동 마퀴 멈춤
}
// 마우스로 목표 문장을 잡아끌어 좌우 스크롤(터치는 네이티브 pan 사용)
let goalDragging = false;
let goalDragX = 0;
let goalDragScroll = 0;
function goalDragStart(e: PointerEvent) {
  pauseGoalMarquee();
  if (e.pointerType !== 'mouse') return;
  const el = goalScrollEl.value;
  if (!el) return;
  goalDragging = true;
  goalDragX = e.clientX;
  goalDragScroll = el.scrollLeft;
  el.setPointerCapture(e.pointerId);
}
function goalDragMove(e: PointerEvent) {
  if (!goalDragging) return;
  const el = goalScrollEl.value;
  if (el) el.scrollLeft = goalDragScroll - (e.clientX - goalDragX);
}
function goalDragEnd() {
  goalDragging = false;
}
function startGoalMarquee() {
  stopGoalMarquee();
  const el = goalScrollEl.value;
  if (!el) return;
  let dir = 1;
  const tick = () => {
    if (!goalScrollEl.value) { marqueeRaf = 0; return; }
    marqueeRaf = requestAnimationFrame(tick);
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1 || Date.now() < marqueePauseUntil) return; // 넘치지 않거나 조작 중이면 정지
    el.scrollLeft += dir * 0.5;
    if (el.scrollLeft >= max - 0.5) { dir = -1; marqueePauseUntil = Date.now() + 1000; }
    else if (el.scrollLeft <= 0.5) { dir = 1; marqueePauseUntil = Date.now() + 1000; }
  };
  marqueeRaf = requestAnimationFrame(tick);
}
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
// 사용자가 추가한 외부 학습팩 URL 목록(로컬 저장만). 기본 카탈로그와 합쳐서 보여준다.
const extraPacks = ref<string[]>(readExtraPacks());
const showPackManager = ref(false); // 추가팩 관리 팝업
const newPackUrl = ref('');
const extraPackNames = ref<Record<string, string>>({}); // 추가 꾸러미 url -> 읽어온 이름
const packMgrError = ref('');
const showResetScoreConfirm = ref(false); // 점수 초기화 확인 팝업
const showClearDataConfirm = ref(false); // 로컬 데이터 삭제 확인 팝업
const board = ref<Block[]>([]);
const selectedIndexes = ref<number[]>([]);
const score = ref(0);
const matchedCount = ref(0); // 맞춘 정답 개수(누적)
const clearedBlocks = ref(0); // 없앤 블럭 개수(누적)
const bestKey = (kind = gameKind.value) => `matchit-best-${kind}`;
const best = ref(Number(localStorage.getItem(bestKey()) || 0));
const combo = ref(1);
const moves = ref(25);
const passes = ref(0);
const gameOver = ref(false);
// 레벨별 누적 점수/푼 문제수 (현재 팩 기준)
const levelStats = ref<Record<number, { score: number; solved: number }>>({});
// 숫자 더하기 누적 통계(전 생애): 누적 점수·최고 수 기록·최고 이음·합친 횟수
function readNumStats() {
  try {
    const v = JSON.parse(localStorage.getItem('matchit-numstats') || '{}');
    return { total: Number(v.total) || 0, bestMax: Number(v.bestMax) || 0, bestCombo: Number(v.bestCombo) || 0, merges: Number(v.merges) || 0, breaks: Number(v.breaks) || 0 };
  } catch {
    return { total: 0, bestMax: 0, bestCombo: 0, merges: 0, breaks: 0 };
  }
}
const numStats = ref(readNumStats());
function saveNumStats() {
  localStorage.setItem('matchit-numstats', JSON.stringify(numStats.value));
}
// 합체/더하기 1회 기록(점수 증가량 gain, 이번에 만든 값 madeValue)
function recordNumMerge(gain: number, madeValue: number) {
  const s = numStats.value;
  s.total += gain;
  s.merges += 1;
  if (combo.value > s.bestCombo) s.bestCombo = combo.value;
  if (madeValue > s.bestMax) s.bestMax = madeValue;
  saveNumStats();
}
const message = ref('목표 블럭을 순서대로 누르세요.');
const loading = ref(false);
const isResolving = ref(false);
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
const saveOnExit = ref(true); // 나가기 시 저장(다음에 이어서) 여부
const gameFullscreen = ref(false);

const activePack = computed(() => packs.value.find((pack) => pack.id === selectedPackId.value));
// 양방향(출제 방향 토글) 지원: 단어팩이거나 메타에 bidirectional 지정된 팩
const isBidi = computed(() => isWordFmt(selectedPackId.value) || packBidi.value[selectedPackId.value] === true);
// 방향 버튼 라벨: 'spell' 버튼 = 원본 그대로(asis), 'meaning' 버튼 = 역방향(reverse)
const dirLabelAsis = computed(() => isWordFmt(selectedPackId.value) ? '뜻 → 철자' : (packDirections.value[selectedPackId.value]?.asis ?? '문제 → 답'));
const dirLabelReverse = computed(() => isWordFmt(selectedPackId.value) ? '단어 → 뜻' : (packDirections.value[selectedPackId.value]?.reverse ?? '답 → 문제'));
const isRandomPack = computed(() => packRandoms.value[selectedPackId.value] === true);
// 특수블럭(폭탄): 자유모드 + 모으기(collect) + 학습팩에서만 생성·발동
const specialEnabled = computed(() => mode.value === 'free' && solveMode.value === 'collect' && gameKind.value === 'lesson');
const levels = computed(() => activePack.value?.levels ?? []);
function levelLabel(level: number) {
  return packLevelLabels.value[selectedPackId.value]?.[level] ?? `Lv ${level}`;
}
// GA4 이벤트 전송 — pack/level/mode/solve_mode/game_kind를 공통 주입
function track(name: string, params: Record<string, unknown> = {}) {
  (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag?.('event', name, {
    pack_id: selectedPackId.value,
    level: selectedLevel.value,
    mode: mode.value,
    solve_mode: solveMode.value,
    game_kind: gameKind.value,
    ...params,
  });
}
let stageStartAt = Date.now(); // 현재 스테이지 시작 시각(체류시간 계산용)
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
        prompt: meaning,
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
// 일반(lesson) 팩 역방향: 답(label)을 문제로 보여주고, 원래 문제(prompt)를 정답 블럭으로.
function reverseLessonItems(raw: LessonItem[]): LessonItem[] {
  return raw.map((it) => ({
    ...it,
    id: `${it.id}-rev`,
    label: it.prompt,
    prompt: it.label,
    tokens: [...String(it.prompt).replace(/\s/g, '')],
  }));
}
// 팩 형식·방향에 맞춰 원본 배열 → 표시용 LessonItem 배열
function buildLevelItems(packId: string, raw: unknown[], dir: 'spell' | 'meaning'): LessonItem[] {
  if (!raw.length) return [];
  if (isWordFmt(packId)) return buildWordItems(raw as Array<{ word: string; meaning: string; hint?: string }>, dir);
  if (packBidi.value[packId] && dir === 'meaning') return reverseLessonItems(raw as LessonItem[]);
  return raw as LessonItem[];
}
// 레벨을 10문제씩 스테이지로 분할
const stageCount = computed(() => Math.max(1, Math.ceil(lessonItems.value.length / STAGE_SIZE)));
const stageItems = computed(() => lessonItems.value.slice((currentStage.value - 1) * STAGE_SIZE, currentStage.value * STAGE_SIZE));

// 연속 모드: 팩의 모든 레벨 문제를 이어붙인 풀에서, 스테이지 번호는 레벨1부터 누적된 "전역" 번호
const fullItems = ref<LessonItem[]>([]); // 모든 레벨 문제(이어붙임)
const fullLevelLens = ref<number[]>([]); // 레벨별 문제 수(순서대로)
const endlessStage = ref(1); // 전역 스테이지 번호(레벨1 스테이지1부터 누적)
// 선택 레벨이 풀에서 시작하는 위치(이전 레벨들의 문제 수 합)
const endlessStartOffset = computed(() => {
  const idx = (activePack.value?.levels ?? []).indexOf(selectedLevel.value);
  if (idx <= 0) return 0;
  return fullLevelLens.value.slice(0, idx).reduce((s, n) => s + n, 0);
});
// 선택 레벨의 첫 전역 스테이지 번호(예: 레벨2면 레벨1의 1스테이지 다음인 2)
const endlessFirstStage = computed(() => Math.floor(endlessStartOffset.value / STAGE_SIZE) + 1);
// 전체(레벨1~끝) 전역 스테이지 수
const endlessStageCount = computed(() => Math.max(1, Math.ceil((fullItems.value.length || lessonItems.value.length) / STAGE_SIZE)));
// 연속(endless) + 자유(free): 한 문제씩이 아닌 "이어서 푸는" 모드
const continuous = computed(() => mode.value !== 'single');
// 현재 모드 한글 라벨(게임화면 표시용)
const modeLabel = computed(() => (mode.value === 'single' ? t('modeSingle') : mode.value === 'endless' ? t('modeEndless') : t('modeFree')));
// 선택된 해법모드 설명(버튼 아래 표시)
const solveModeDesc = computed(() => solveModes.find((s) => s.id === solveMode.value)?.desc ?? '');
const activeItems = computed(() => {
  if (gameKind.value !== 'lesson') return lessonItems.value;
  if (mode.value === 'single') return stageItems.value;
  // 자유: 팩의 모든 레벨을 통틀어 전체 풀을 한꺼번에 사용
  if (mode.value === 'free') return fullItems.value.length ? fullItems.value : lessonItems.value;
  // 연속: 선택 레벨 시작부터 현재 전역 스테이지 끝까지(레벨 경계를 넘어 이어짐)
  if (fullItems.value.length) {
    return fullItems.value.slice(endlessStartOffset.value, endlessStage.value * STAGE_SIZE);
  }
  return lessonItems.value.slice(0, endlessStage.value * STAGE_SIZE); // 풀 로드 전 폴백
});
// 연속 모드 현재 "최상위 스테이지"(가장 최근 도입된 10문제 창, 전역 인덱스)
const endlessTopStageItems = computed(() => {
  const base = fullItems.value.length ? fullItems.value : lessonItems.value;
  return base.slice((endlessStage.value - 1) * STAGE_SIZE, endlessStage.value * STAGE_SIZE);
});
// 연속 모드: 현재 스테이지가 속한 레벨(스테이지가 다음 레벨로 넘어가면 함께 바뀜)
const endlessCurrentLevel = computed(() => {
  const it = endlessTopStageItems.value[0];
  return it ? levelOfItem(it) : selectedLevel.value;
});

const target = computed(() => {
  if (continuous.value) {
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
const wideBlocks = computed(() => gameKind.value === 'lesson' && packWide.value[selectedPackId.value] === true);
// 보드 종횡비(가로/세로) — 셀 모양(정사각 또는 3:2 넓은 블럭)을 반영. 높이 제약 화면에서 contain 맞춤에 사용.
const boardAspect = computed(() => {
  const cw = wideBlocks.value ? 3 : 1;
  const ch = wideBlocks.value ? 2 : 1;
  return `${cols.value * cw} / ${rows.value * ch}`;
});
// 종횡비 숫자값(가로/세로) — 높이 제약 화면에서 width = min(가로, 세로×비율) 계산용
const boardAspectNum = computed(() => {
  const cw = wideBlocks.value ? 3 : 1;
  const ch = wideBlocks.value ? 2 : 1;
  return (cols.value * cw) / (rows.value * ch);
});
// 현재 목표 문항(학습 모드)
const goalItem = computed(() => {
  if (gameKind.value !== 'lesson' || continuous.value) return null;
  return solveMode.value === 'collect' ? collectTargetItem.value : target.value;
});
const goalVars = computed(() => (stageDone.value ? '' : goalItem.value?.vars || ''));
// 연속 모드: 보드에서 지금 만들 수 있는 답들의 문제·힌트(마퀴용)
const endlessTicker = computed(() => {
  if (gameKind.value !== 'lesson' || !continuous.value) return [] as string[];
  const counts = new Map<string, number>();
  for (const b of board.value) if (b) counts.set(b.token, (counts.get(b.token) || 0) + 1);
  const canForm = (it: LessonItem) => {
    const need = new Map<string, number>();
    for (const t of it.tokens) need.set(t, (need.get(t) || 0) + 1);
    for (const [t, c] of need) if ((counts.get(t) || 0) < c) return false;
    return true;
  };
  const out: string[] = [];
  for (const it of activeItems.value) {
    if (canForm(it)) {
      out.push(it.name ? `${it.name}: ${it.prompt}` : it.prompt);
      if (out.length >= 40) break;
    }
  }
  return out;
});
const goalPrompt = computed(() => {
  if (gameKind.value === 'numbers') return `최고 숫자 ${formatValue(maxValue.value)}`;
  if (stageDone.value) return '참 잘 했어요~ 🎉';
  if (solveMode.value === 'collect') {
    if (continuous.value) return '보드의 식 글자들을 붙여 맞추기';
  } else if (continuous.value) {
    return '보드의 식 글자들을 순서대로 맞추기';
  }
  const it = goalItem.value;
  if (!it) return '로딩 중';
  return (it.name ? `${it.name}: ` : '') + it.prompt;
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

// 레벨 문제를 무작위 순서로 출제하되, 그 순서를 localStorage에 저장해 재시작 시 동일하게 복원.
function orderKey(packId: string, level: number) {
  return `matchit-order-${packId}-${level}`;
}
function stableItemKey(it: unknown, i: number): string {
  const o = it as { id?: unknown; word?: unknown };
  return String(o?.id ?? o?.word ?? i);
}
function applyStoredOrder(packId: string, level: number, raw: unknown[]): unknown[] {
  if (raw.length <= 1) return raw.slice();
  const keyOf = new Map<unknown, string>();
  raw.forEach((it, i) => keyOf.set(it, stableItemKey(it, i)));
  const byKey = new Map<string, unknown>();
  for (const it of raw) {
    const k = keyOf.get(it) as string;
    if (!byKey.has(k)) byKey.set(k, it);
  }
  let savedKeys: string[] | null = null;
  try {
    const v = JSON.parse(localStorage.getItem(orderKey(packId, level)) || 'null');
    if (Array.isArray(v)) savedKeys = v.map(String);
  } catch { savedKeys = null; }

  let ordered: unknown[];
  if (savedKeys) {
    const used = new Set<string>();
    ordered = [];
    for (const k of savedKeys) {
      const it = byKey.get(k);
      if (it !== undefined && !used.has(k)) { ordered.push(it); used.add(k); }
    }
    const rest = raw.filter((it) => !used.has(keyOf.get(it) as string)); // 저장 이후 추가된 문제
    if (rest.length) ordered.push(...shuffle(rest));
    if (!ordered.length) ordered = shuffle(raw);
  } else {
    ordered = shuffle(raw);
  }
  try {
    localStorage.setItem(orderKey(packId, level), JSON.stringify(ordered.map((it) => keyOf.get(it) as string)));
  } catch { /* 저장 용량 초과 등은 무시 */ }
  return ordered;
}

function refreshSampleItems() {
  sampleItems.value = shuffle(lessonItems.value).slice(0, 30);
}
watch(lessonItems, refreshSampleItems);

// 글자→색 인덱스 맵. 연속 모드는 전체 풀 기준(다른 레벨 글자도 제 색을 갖도록), 그 외엔 현재 레벨 기준.
const tokenColorIndex = computed(() => {
  const source = gameKind.value === 'lesson' && continuous.value && fullItems.value.length ? fullItems.value : lessonItems.value;
  const m = new Map<string, number>();
  let i = 0;
  for (const it of source) for (const t of it.tokens) if (!m.has(t)) m.set(t, i++);
  return m;
});
function colorForToken(token: string) {
  let idx = tokenColorIndex.value.get(token);
  if (idx === undefined) {
    // 목록에 없으면 글자 코드 합으로 안정적 색 부여(모두 같은 색이 되는 것 방지)
    idx = 0;
    for (const ch of token) idx += ch.codePointAt(0) || 0;
  }
  return palette[idx % palette.length];
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

// 다음 모으기 목표를 표시용으로 즉시 선택(미해결 우선, 보드 지원 여부 무관)
function pickCollectTargetForDisplay(): LessonItem | null {
  const unsolved = collectableItems.value.filter((it) => !solvedItems.value.includes(it.id));
  const pool = unsolved.length ? unsolved : collectableItems.value;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
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
// 다음 목표만 고른다(문제 즉시 갱신용). 보드 보장은 별도.
function pickSequenceTarget() {
  if (gameKind.value !== 'lesson' || solveMode.value !== 'sequence' || mode.value !== 'single') return;
  const items = activeItems.value;
  if (!items.length) return;
  const remaining = items.filter((it) => !solvedItems.value.includes(it.id));
  const candidates = remaining.length ? remaining : items;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  targetIndex.value = items.indexOf(chosen);
}
// 현재 목표를 보드에서 만들 수 없으면 새 판을 만들어 보장(목표는 바꾸지 않음)
function ensureTargetFormable() {
  if (gameKind.value !== 'lesson' || solveMode.value !== 'sequence' || mode.value !== 'single') return;
  const chosen = target.value;
  if (!chosen || !chosen.tokens.length || canFormFromBoard(chosen)) return;
  message.value = t('msgNewBoard');
  const fresh = seededBlocks();
  const positions = shuffle(Array.from({ length: rows.value * cols.value }, (_, i) => i));
  chosen.tokens.forEach((token, k) => {
    const block = makeBlock(chosen, token);
    block.dropFrom = rows.value;
    fresh[positions[k]] = block;
  });
  board.value = fresh;
}
function ensureSequenceTargetOnBoard() {
  pickSequenceTarget();
  ensureTargetFormable();
}

// 연속 모드: 현재 최상위 스테이지를 2/3 이상 풀면 다음 스테이지 답을 섞는다(보드는 낙하 보충으로 점진 반영)
function advanceEndlessStageIfReady() {
  if (gameKind.value !== 'lesson' || mode.value !== 'endless') return;
  if (endlessStage.value >= endlessStageCount.value) return; // 풀 끝까지(다음 레벨 포함)
  const stageSlice = endlessTopStageItems.value;
  if (!stageSlice.length) return;
  // 현재 최상위 스테이지를 2/3 이상 맞추면 다음 스테이지(또는 다음 레벨) 답이 섞이기 시작
  const solvedInStage = stageSlice.filter((it) => solvedItems.value.includes(it.id)).length;
  if (solvedInStage >= Math.ceil((stageSlice.length * 2) / 3)) {
    endlessStage.value += 1;
  }
}

// 완전 무작위: 활성 문항의 고유 토큰에서 균등 추출(정답 유도·쏠림 보정 없음)
function randomTokenSpecs(count: number): Array<{ token: string; item: LessonItem }> {
  const items = activeItems.value;
  const map = new Map<string, LessonItem>();
  for (const it of items) for (const tk of it.tokens) if (!map.has(tk)) map.set(tk, it);
  const tokens = [...map.keys()];
  const out: Array<{ token: string; item: LessonItem }> = [];
  if (!tokens.length) return out;
  for (let i = 0; i < count; i += 1) {
    const tk = tokens[Math.floor(Math.random() * tokens.length)];
    out.push({ token: tk, item: map.get(tk)! });
  }
  return out;
}
function randomBoard(): Block[] {
  return randomTokenSpecs(rows.value * cols.value).map((s) => makeBlock(s.item, s.token));
}

function buildCollectBoard(): Block[] {
  if (isRandomPack.value) return randomBoard();
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
    if (!continuous.value) pickCollectItem();
    else collectTargetItem.value = null;
    return buildCollectBoard();
  }

  if (isRandomPack.value) return randomBoard();

  const total = rows.value * cols.value;
  if (mode.value === 'free') {
    // 자유: 전체 풀에서 "완성된 정답" 단위로 깔아 특정 토큰(예: 산소)이 쏠리지 않게 한다.
    return fillAnswerBoard(items, items, total);
  }
  if (continuous.value) {
    const cap = tokenCap.value;
    const counts = new Map<string, number>();
    const newBoard: Block[] = Array.from({ length: total }, () => {
      for (let tries = 0; tries < 8; tries += 1) {
        const item = items[Math.floor(Math.random() * items.length)];
        const token = item.tokens[Math.floor(Math.random() * item.tokens.length)];
        if ((counts.get(token) || 0) < cap) {
          counts.set(token, (counts.get(token) || 0) + 1);
          return makeBlock(item, token);
        }
      }
      const item = items[Math.floor(Math.random() * items.length)]; // 못 찾으면 그냥 채움
      const token = item.tokens[Math.floor(Math.random() * item.tokens.length)];
      counts.set(token, (counts.get(token) || 0) + 1);
      return makeBlock(item, token);
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

// 보드 한 종류 토큰이 쏠리지 않도록 동일 토큰 상한(보드 크기에 비례, 최소 6)
const tokenCap = computed(() => Math.max(6, Math.ceil((rows.value * cols.value) / 5)));

// 정답들을 "완전한 단위"로 보드에 채운다(중복 최소화·부분 잘림 없이).
// answerPool: 보장하려는 정답들, fillerPool: 남는 칸을 채울 글자 출처.
function fillAnswerBoard(answerPool: LessonItem[], fillerPool: LessonItem[], total: number): Block[] {
  const cap = tokenCap.value;
  const counts = new Map<string, number>();
  const blocks: Block[] = [];
  const add = (item: LessonItem, token: string) => {
    blocks.push(makeBlock(item, token));
    counts.set(token, (counts.get(token) || 0) + 1);
  };
  for (const item of shuffle(answerPool)) {
    if (blocks.length + item.tokens.length > total) continue; // 안 들어가면 통째로 건너뜀
    // 이미 깔린 토큰이 있는데 상한을 넘기면 이 정답은 건너뜀(첫 등장은 허용)
    let ok = true;
    for (const [tk, c] of tokenCounts(item.tokens)) {
      const have = counts.get(tk) || 0;
      if (have > 0 && have + c > cap) { ok = false; break; }
    }
    if (!ok) continue;
    for (const token of item.tokens) add(item, token);
  }
  const pool = fillerPool.length ? fillerPool : answerPool;
  let guard = 0;
  while (blocks.length < total && pool.length) {
    const item = pool[Math.floor(Math.random() * pool.length)];
    const token = item.tokens[Math.floor(Math.random() * item.tokens.length)];
    // 상한 넘으면 다른 토큰을 다시 뽑되, 못 찾으면(작은 풀) 그냥 채움
    if ((counts.get(token) || 0) >= cap && guard < total * 4) { guard += 1; continue; }
    add(item, token);
  }
  return shuffle(blocks);
}

const solvedItems = ref<string[]>([]);
// 현재 스테이지 진행도(푼 개수 / 총 개수) — 한문제씩·연속 동일
const showProgress = computed(() => gameKind.value === 'lesson' && mode.value !== 'free');
// 표시용 현재 스테이지(한문제씩=currentStage, 연속=endlessStage)
const displayStage = computed(() => (mode.value === 'endless' ? endlessStage.value : currentStage.value));
const levelProgress = computed(() => {
  // 현재 스테이지 슬라이스(한문제씩=현재 레벨 스테이지, 연속=풀에서의 최상위 스테이지)
  const slice = mode.value === 'endless'
    ? endlessTopStageItems.value
    : lessonItems.value.slice((displayStage.value - 1) * STAGE_SIZE, displayStage.value * STAGE_SIZE);
  const total = slice.length || STAGE_SIZE;
  // 스테이지당 푼 문제수(중복 제외 = 고유 id 기준)
  const solvedInStage = slice.filter((it) => solvedItems.value.includes(it.id)).length;
  return { current: solvedInStage, total };
});
// 현재 스테이지를 다 풀었는가
const stageDone = computed(() => {
  if (gameKind.value !== 'lesson' || mode.value !== 'single') return false;
  const req = solveMode.value === 'collect' ? collectableItems.value : activeItems.value;
  return req.length > 0 && solvedItems.value.length >= req.length;
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
function markStageCleared(level: number, stage: number, celebrate = true) {
  const done = clearedStages.value[level] || [];
  if (!done.includes(stage)) {
    const wasLevelCleared = isLevelCleared(level);
    clearedStages.value = { ...clearedStages.value, [level]: [...done, stage].sort((a, b) => a - b) };
    localStorage.setItem(clearedKey(), JSON.stringify(clearedStages.value));
    track('stage_clear', { level, stage, score: score.value, duration_sec: Math.round((Date.now() - stageStartAt) / 1000) });
    if (!wasLevelCleared && isLevelCleared(level)) track('level_complete', { level });
    stageStartAt = Date.now();
  }
  if (!celebrate) return; // 연속/자유: 통계만 기록하고 축하 팝업은 띄우지 않음
  const maxLevel = levels.value[levels.value.length - 1] ?? level;
  const hasNext = stage < stageCount.value || level < maxLevel;
  stageClearInfo.value = { level, stage, hasNext };
  showStageClear.value = true;
}
function onStageSelect(e: Event) {
  const stage = Number((e.target as HTMLSelectElement).value);
  if (stage === currentStage.value) return;
  track('select_stage', { stage });
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
function resetGame(keepScore = false, keepStage = false) {
  // 진행 중인 매치/스왑/낙하 async를 즉시 무효화 — 새 보드 위로 잔여 갱신이 흘러들지 않게
  abortInflight();
  // 진행 중인 게임은 재시작 시 복원 대상(나가기에서 미저장 선택 시 해제)
  localStorage.setItem('matchit-resume', '1');
  stageStartAt = Date.now(); // 새 보드 = 스테이지 체류시간 측정 시작점
  // 보드를 만들기 전에 상태를 먼저 초기화(목표 선택이 이전 상태를 보지 않도록)
  solvedItems.value = [];
  if (!keepStage) endlessStage.value = endlessFirstStage.value; // 연속: 선택 레벨의 첫 전역 스테이지부터
  targetIndex.value = 0;
  hintIndexes.value = [];
  hintItem.value = null;
  board.value = seededBlocks();
  selectedIndexes.value = [];
  swapFirstIndex.value = null;
  draggedIndex.value = null;
  motionPhase.value = 'idle';
  combo.value = 1;
  moves.value = 25;
  passes.value = 0;
  gameOver.value = false;
  shareUrl.value = '';
  lastSolved.value = null;
  showHint.value = false;
  if (!keepScore) { score.value = 0; matchedCount.value = 0; clearedBlocks.value = 0; }
  if (gameKind.value === 'numbers') {
    message.value = mergeMode.value === 'add'
      ? t('numStartAdd')
      : t('numStartSwap');
  } else if (solveMode.value === 'collect') {
    message.value = continuous.value
      ? t('msgCollectCont')
      : t('msgCollectSingle');
  } else if (continuous.value) {
    message.value = t('msgSeqFree');
  } else {
    message.value = t('msgSeqGoal');
  }
  // 초기 목표를 랜덤으로 고르고 보드에 답이 있도록 보장
  ensureSequenceTargetOnBoard();
}

// 한 레벨의 원본 문항 배열을 얻는다: 인라인(통합 파일) → 외부 base → 기존 상대경로 순.
async function fetchLevelRaw(packId: string, level: number): Promise<unknown[]> {
  const inline = inlineLevels.value[packId]?.[level];
  if (inline) return inline;
  const fileUrl = packLevelFiles.value[packId]?.[level]; // 레벨별 명시 파일 URL
  const base = packBases.value[packId];
  const url = fileUrl ?? (base ? `${base}${level}.json` : `${baseUrl}data/packs/${packId}/${level}.json`);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  return Array.isArray(raw) ? raw : [];
}
// 문항 키로 형식 자동 판별: word/meaning 키가 있으면 단어팩
function detectFormat(items: unknown[]): 'word' | 'lesson' {
  const it = items[0] as { word?: unknown; meaning?: unknown } | undefined;
  return it && it.word !== undefined && it.meaning !== undefined ? 'word' : 'lesson';
}

// 레벨별 파일(packs/{id}/{level}.json)을 불러온다.
// 연속 모드용: 팩의 모든 레벨 문제를 이어붙여 풀 구성(레벨별 길이도 기록)
let fullKey = '';
async function loadFullPool(packId: string) {
  const dirKey = isWordFmt(packId) || packBidi.value[packId] ? wordDirection.value : '';
  const key = packId + '|' + dirKey;
  if (fullKey === key && fullItems.value.length) return; // 캐시
  const pack = packs.value.find((p) => p.id === packId);
  const all: LessonItem[] = [];
  const lens: number[] = [];
  for (const lv of pack?.levels ?? []) {
    try {
      const raw = await fetchLevelRaw(packId, lv);
      const ordered = applyStoredOrder(packId, lv, raw); // 레벨별 저장된 무작위 순서 적용
      const items = buildLevelItems(packId, ordered, wordDirection.value);
      all.push(...items);
      lens.push(items.length);
    } catch { lens.push(0); }
  }
  fullItems.value = all;
  fullLevelLens.value = lens;
  fullKey = key;
}

async function loadLevel(packId: string, level: number) {
  loading.value = true;
  error.value = '';
  try {
    const raw = await fetchLevelRaw(packId, level);
    if (!Array.isArray(raw) || !raw.length) throw new Error('문제가 없습니다.');
    const ordered = applyStoredOrder(packId, level, raw); // 무작위 순서(저장된 순서 있으면 복원)
    currentRaw.value = ordered;
    rawWordEntries.value = isWordFmt(packId) ? (ordered as Array<{ word: string; meaning: string; hint?: string }>) : [];
    lessonItems.value = buildLevelItems(packId, ordered, wordDirection.value);
    loadClearedStages();
    loadLevelStats();
    currentStage.value = firstUnclearedStage(level); // 첫 미클리어 스테이지부터
    resetGame();
    track('game_start', { level, stage: currentStage.value });
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : '데이터를 읽지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

// 같은 팩 안에서 레벨만 바꾼다.
function selectLevel(level: number) {
  track('select_level', { level });
  selectedLevel.value = level;
  loadLevel(selectedPackId.value, level);
}

// 불러온 JSON을 팩 목록으로 정규화한다. 3가지 형태를 모두 인식:
//  (a) 팩 목록 배열  [{id,title,accent,levels:[1,2]}, ...]  (levels가 [{level,items}]면 통합 인라인)
//  (b) 통합 단일 팩 객체  {id,title,levels:[{level,items}] | [1,2]}
//  (c) 문항 배열만  [{word,meaning,...}] | [LessonItem]  → 1레벨짜리 임시 팩으로 래핑
//  (d) 카탈로그 항목  {id,title,accent,base,levels:N}  → base + {level}.json 지연 로드
// sourceUrl: 이 데이터를 가져온 URL(상대 base를 절대 URL로 해석하는 기준).
function ingestPackData(data: unknown, sourceUrl: string): LessonPack[] {
  let rawPacks: Array<Record<string, unknown>>;
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    if (first && (first.levels !== undefined || (first.id && first.title))) {
      rawPacks = data as Array<Record<string, unknown>>; // (a) 팩 목록 / (d) 카탈로그
    } else {
      rawPacks = [{ id: 'custom', title: '불러온 문제', levels: [{ level: 1, items: data }] }]; // (c) 문항 배열
    }
  } else if (data && typeof data === 'object' && (data as Record<string, unknown>).levels !== undefined) {
    rawPacks = [data as Record<string, unknown>]; // (b) 단일 통합 팩
  } else {
    throw new Error('알 수 없는 데이터 형식입니다.');
  }

  const result: LessonPack[] = [];
  for (const p of rawPacks) {
    const id = String(p.id ?? 'custom');
    const accent = typeof p.accent === 'string' ? p.accent : '#0ea5e9';
    const levelsRaw = p.levels;
    let levelNums: number[];
    if (Array.isArray(levelsRaw) && levelsRaw.length && typeof levelsRaw[0] === 'object') {
      // 레벨 객체 배열: { level, label?, items?(인라인) | file?(외부 파일) }
      const inlineMap: Record<number, unknown[]> = {};
      const fileMap: Record<number, string> = {};
      const labelMap: Record<number, string> = {};
      for (const lv of levelsRaw as Array<{ level: number; label?: string; items?: unknown[]; file?: string }>) {
        const n = Number(lv.level);
        if (Array.isArray(lv.items)) inlineMap[n] = lv.items;
        else if (typeof lv.file === 'string') fileMap[n] = new URL(lv.file, sourceUrl).href;
        if (typeof lv.label === 'string') labelMap[n] = lv.label;
      }
      if (Object.keys(inlineMap).length) inlineLevels.value[id] = inlineMap;
      if (Object.keys(fileMap).length) packLevelFiles.value[id] = fileMap;
      if (Object.keys(labelMap).length) packLevelLabels.value[id] = labelMap;
      levelNums = [...new Set([...Object.keys(inlineMap), ...Object.keys(fileMap)].map(Number))].sort((a, b) => a - b);
      const fmt = p.format === 'word' || p.format === 'lesson' ? (p.format as 'word' | 'lesson') : undefined;
      if (fmt) packFormats.value[id] = fmt;
      else if (levelNums.length && inlineMap[levelNums[0]]) packFormats.value[id] = detectFormat(inlineMap[levelNums[0]]);
    } else {
      // 레벨수(숫자) 또는 레벨 번호 배열 → base + {level}.json 로 지연 로드
      if (typeof levelsRaw === 'number') {
        levelNums = Array.from({ length: levelsRaw }, (_, i) => i + 1);
      } else if (Array.isArray(levelsRaw)) {
        levelNums = (levelsRaw as number[]).map(Number);
      } else {
        levelNums = [1];
      }
      // 레벨 파일 기준 경로: base가 있으면 그것, 없으면 이 팩 파일과 같은 디렉터리. 절대 URL로 변환.
      const base = typeof p.base === 'string' ? p.base : './';
      packBases.value[id] = new URL(base, sourceUrl).href;
      if (p.format === 'word' || p.format === 'lesson') packFormats.value[id] = p.format;
    }
    if (p.random === true) packRandoms.value[id] = true;
    // 메타 구동 옵션(하드코딩 대체)
    if (p.board && typeof p.board === 'object') {
      const b = p.board as { cols?: number; rows?: number };
      if (b.cols && b.rows) packBoards.value[id] = { cols: Number(b.cols), rows: Number(b.rows) };
    }
    if (p.wide === true) packWide.value[id] = true;
    if (typeof p.blockStyle === 'string') packBlockStyles.value[id] = p.blockStyle as BlockStyleName;
    if (p.bidirectional === true) packBidi.value[id] = true;
    if (p.directions && typeof p.directions === 'object') {
      packDirections.value[id] = p.directions as { asis?: string; reverse?: string };
    }
    result.push({ id, title: String(p.title ?? id), accent, levels: levelNums });
  }
  return result;
}

// 한 소스(URL)에서 학습팩들을 불러온다.
//  - 카탈로그(포인터 배열 [{name,url,levels}])면 각 항목의 url(개별 팩)을 병렬로 가져와 정규화.
//  - 그 외(단일 팩 / 팩 목록 / 문항 배열)면 그대로 정규화.
// 개별 팩은 '파일 1개짜리(인라인 levels)' 또는 '메타 + 하위 레벨파일(levels 번호 배열)' 구조를 모두 인식.
async function loadSource(srcUrl: string): Promise<LessonPack[]> {
  const res = await fetch(srcUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const isCatalog = Array.isArray(data) && data.length > 0
    && data.every((e) => e && typeof e === 'object' && typeof (e as { url?: unknown }).url === 'string');
  if (!isCatalog) return ingestPackData(data, srcUrl);

  const entries = data as Array<{ name?: string; url: string }>;
  const defs = await Promise.all(entries.map(async (e) => {
    const packUrl = new URL(e.url, srcUrl).href;
    try {
      const r = await fetch(packUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      return { name: e.name, packUrl, def: await r.json() };
    } catch {
      return null;
    }
  }));
  const out: LessonPack[] = [];
  for (const d of defs) {
    if (!d) continue;
    const ps = ingestPackData(d.def, d.packUrl);
    if (d.name && ps[0]) ps[0].title = d.name; // 목록 표시 이름은 카탈로그 우선
    out.push(...ps);
  }
  return out;
}

// 기본 카탈로그 + 사용자가 추가한 외부팩을 불러온다.
// 표시 순서: 추가팩 → 기본팩, 각 그룹은 이름 가나다순. 같은 id는 추가팩 우선.
async function loadPacks() {
  loading.value = true;
  error.value = '';
  inlineLevels.value = {};
  packBases.value = {};
  packLevelFiles.value = {};
  packLevelLabels.value = {};
  packFormats.value = {};
  packRandoms.value = {};
  packBoards.value = {};
  packWide.value = {};
  packBlockStyles.value = {};
  packBidi.value = {};
  packDirections.value = {};
  let failures = 0;

  const catalogUrl = new URL(PACK_CATALOG_URL, window.location.href).href;
  const defaultPacks = await loadSource(catalogUrl).catch(() => { failures++; return [] as LessonPack[]; });
  const addedPacks: LessonPack[] = [];
  extraPackNames.value = {};
  for (const raw of extraPacks.value) {
    try {
      const list = await loadSource(new URL(raw, window.location.href).href);
      addedPacks.push(...list);
      extraPackNames.value[raw] = list.map((p) => p.title).join(', ');
    } catch {
      failures++;
    }
  }

  const byName = (a: LessonPack, b: LessonPack) => a.title.localeCompare(b.title, 'ko');
  addedPacks.sort(byName);
  defaultPacks.sort(byName);
  const merged: LessonPack[] = [];
  const seen = new Set<string>();
  for (const p of [...addedPacks, ...defaultPacks]) {
    if (seen.has(p.id)) continue; // 추가팩 우선
    seen.add(p.id);
    merged.push(p);
  }

  try {
    if (!merged.length) throw new Error('학습팩을 불러오지 못했습니다.');
    packs.value = merged;
    if (!selectedPackId.value || !merged.some((p) => p.id === selectedPackId.value)) {
      selectedPackId.value = merged[0].id;
      selectedLevel.value = merged[0].levels[0] ?? 1;
    }
    if (gameKind.value === 'lesson') applyPackDefaultSize(selectedPackId.value);
    await loadLevel(selectedPackId.value, selectedLevel.value);
    error.value = failures ? `일부 학습팩을 불러오지 못했습니다 (${failures}건)` : '';
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : '데이터를 읽지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

// --- 추가 학습팩 URL 관리(목록만 로컬 저장) ---
function readExtraPacks(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem('matchit-extra-packs') || '[]');
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveExtraPacks() {
  localStorage.setItem('matchit-extra-packs', JSON.stringify(extraPacks.value));
}
async function addExtraPack() {
  const url = newPackUrl.value.trim();
  if (!url || extraPacks.value.includes(url)) { newPackUrl.value = ''; return; }
  packMgrError.value = '';
  // 추가 전에 파일을 읽어 유효한 꾸러미인지 검증
  try {
    const list = await loadSource(new URL(url, window.location.href).href);
    if (!list.length) throw new Error('empty');
  } catch {
    packMgrError.value = t('packInvalid');
    return;
  }
  newPackUrl.value = '';
  extraPacks.value.push(url);
  saveExtraPacks();
  await loadPacks();
}
async function removeExtraPack(url: string) {
  extraPacks.value = extraPacks.value.filter((u: string) => u !== url);
  saveExtraPacks();
  await loadPacks();
}
// 과일 맞추기 꾸러미를 한 번에 추가
async function addFruitPack() {
  if (extraPacks.value.includes(FRUIT_PACK_URL)) return;
  extraPacks.value.push(FRUIT_PACK_URL);
  saveExtraPacks();
  await loadPacks();
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

// 연속 모드: 풀에서 해당 문제가 속한 레벨 번호
function levelOfItem(item: LessonItem): number {
  const levels = activePack.value?.levels ?? [];
  const idx = fullItems.value.findIndex((x) => x.id === item.id);
  if (idx < 0) return selectedLevel.value;
  let acc = 0;
  for (let i = 0; i < fullLevelLens.value.length; i += 1) {
    acc += fullLevelLens.value[i];
    if (idx < acc) return levels[i] ?? i + 1;
  }
  return selectedLevel.value;
}

// 아이템이 속한 (레벨, 레벨 내 로컬 스테이지). 연속/자유는 전체 풀 기준, 단일은 현재 레벨 기준.
function stageOfItem(item: LessonItem): { level: number; stage: number } {
  const levels = activePack.value?.levels ?? [];
  if (fullItems.value.length) {
    const idx = fullItems.value.findIndex((x) => x.id === item.id);
    if (idx >= 0) {
      let acc = 0;
      for (let i = 0; i < fullLevelLens.value.length; i += 1) {
        const len = fullLevelLens.value[i];
        if (idx < acc + len) return { level: levels[i] ?? i + 1, stage: Math.floor((idx - acc) / STAGE_SIZE) + 1 };
        acc += len;
      }
    }
  }
  const li = lessonItems.value.findIndex((x) => x.id === item.id);
  return { level: selectedLevel.value, stage: li >= 0 ? Math.floor(li / STAGE_SIZE) + 1 : currentStage.value };
}

// (레벨, 스테이지)에 속한 문제 목록
function itemsOfStage(level: number, stage: number): LessonItem[] {
  const levels = activePack.value?.levels ?? [];
  if (fullItems.value.length) {
    const i = levels.indexOf(level);
    if (i >= 0) {
      let acc = 0;
      for (let k = 0; k < i; k += 1) acc += fullLevelLens.value[k];
      const start = acc + (stage - 1) * STAGE_SIZE;
      const end = acc + Math.min(stage * STAGE_SIZE, fullLevelLens.value[i]);
      return fullItems.value.slice(start, end);
    }
  }
  return lessonItems.value.slice((stage - 1) * STAGE_SIZE, stage * STAGE_SIZE);
}

// 방금 푼 문제가 속한 스테이지를 다 풀었으면 클리어로 기록(연속/자유는 축하 팝업 없이 통계만).
function maybeMarkStageCleared(item: LessonItem) {
  if (gameKind.value !== 'lesson') return;
  const { level, stage } = stageOfItem(item);
  let stageList = itemsOfStage(level, stage);
  // 모으기 모드: 보드에 담을 수 있는(토큰 길이 ≤ 보드 한 변) 문제만으로 완성 판정
  if (solveMode.value === 'collect') {
    const cap = Math.max(rows.value, cols.value);
    stageList = stageList.filter((it) => it.tokens.length >= 1 && it.tokens.length <= cap);
  }
  if (!stageList.length) return;
  if (stageList.every((it) => solvedItems.value.includes(it.id))) {
    markStageCleared(level, stage, mode.value === 'single');
  }
}

function scoreMatch(item: LessonItem, length: number) {
  let gained: number;
  let detail: string;
  if (continuous.value) {
    // 연속/자유: 문제당 10점(토큰 3개 초과 시 20점) × 레벨
    const base = length > 3 ? 20 : 10;
    const lv = levelOfItem(item);
    gained = base * lv;
    detail = `+${base}점 × Lv${lv}`;
  } else {
    // 한문제씩: 10점 × 콤보 배수(최대 5배)
    const base = 10;
    gained = base * Math.min(combo.value, 5);
    const comboBonus = gained - base;
    detail = comboBonus > 0 ? `+${base}점 + Combo ${comboBonus}점` : `+${base}점`;
  }
  score.value += gained;
  combo.value += 1;
  lastSolved.value = item;
  best.value = Math.max(best.value, score.value);
  localStorage.setItem(bestKey(), String(best.value));
  // 레벨별 누적 점수/푼 문제수 기록 — 실제 푼 문제의 레벨에 적립(연속/자유는 레벨이 섞이므로)
  // 푼 문제수는 고유 기준: 아직 풀지 않은 문제일 때만 +1(점수는 매 정답마다 누적)
  const isNewSolve = gameKind.value === 'lesson' && !solvedItems.value.includes(item.id);
  const lv = levelOfItem(item);
  const cur = levelStats.value[lv] ?? { score: 0, solved: 0 };
  levelStats.value = { ...levelStats.value, [lv]: { score: cur.score + gained, solved: cur.solved + (isNewSolve ? 1 : 0) } };
  saveLevelStats();
  track('item_solved', { item_id: item.id, word: item.label, length, gained, solved_level: lv, is_new: isNewSolve });
  showHint.value = false;
  hintIndexes.value = [];
  message.value = `${item.label} ${t('wordSolved')} ${detail}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// 진행 중인 매치/스왑/낙하 async를 일괄 무효화하는 토큰. 모드/레벨/팩 변경 시 abortInflight()를 호출하면 토큰이 증가해
// 그 이전에 시작된 async는 await 후 token 비교에서 빠져나가 board.value 갱신을 멈춘다.
let runId = 0;
const isAlive = (id: number) => id === runId;
function abortInflight() {
  runId += 1;
  isResolving.value = false;
  motionPhase.value = 'idle';
}

// 애니메이션 속도 — 1.0이 기본, 값이 커질수록 느려진다(0.5 = 2배 빠름, 2.0 = 절반 속도)
const ANIM_SPEED = 1.5;
// 각 애니메이션 phase 기본 시간(ms). ANIM_SPEED를 곱해 실제 시간 산출 — animMs()로 통일
const ANIM = {
  vanish: 360,        // 매치 셀이 scale 0으로 사라지는 시간 (vanishCells)
  morph: 360,         // 폭탄 영향 셀이 폭탄 외형으로 변신해 보여주는 시간
  fall: 1000,         // applyGravity 후 낙하 대기 (긴)
  fallShort: 700,     // cascadeClear 라운드 사이 낙하 대기 (짧은)
  popupSlide: 440,    // 정답팝업 슬롯이 보드 → 자기 자리로 슬라이드
  popupHold: 160,     // 정답표시 ON에서 팝업 슬라이드 출발 직후 대기
  swap: 340,          // 블럭 교환(swap) 대기
  gather: 120,        // 숫자모드 수렴 효과 대기
  gatherStep: 85,     // 숫자모드 블럭이 한 칸 이동하는 시간(합쳐지는 모션)
  fallCss: 600,       // CSS .block-move/.block-enter-active 기본 transition
  fallCssFalling: 800,// CSS .is-falling 시 transition
};
const animMs = (n: number) => Math.round(n * ANIM_SPEED);

// 정답표시 OFF용 사라짐: 매치된 셀들이 제자리에서 scale 0 + opacity 0으로 축소되어 사라진다
async function vanishCells(indexes: number[]) {
  if (!boardEl.value) return;
  const cells = indexes
    .map((i) => boardEl.value!.querySelector(`.block-face[data-cell="${i}"]:not(.block-leave-active)`) as HTMLElement | null)
    .filter((c): c is HTMLElement => !!c);
  const dur = animMs(ANIM.vanish);
  // 시작 상태(scale 1)를 먼저 고정해 커밋해야 트랜지션이 일관되게 발생한다.
  // (transition과 끝값을 같은 프레임에 설정하면 일부 블럭이 애니메이션 없이 즉시 사라진다)
  cells.forEach((c) => {
    c.style.transition = 'none';
    c.style.transformOrigin = 'center';
    c.style.transform = 'scale(1)';
    c.style.opacity = '1';
  });
  void boardEl.value.offsetHeight; // 강제 리플로우로 시작 상태 커밋
  cells.forEach((c) => {
    c.style.transition = `transform ${dur}ms ease, opacity ${dur}ms ease`;
    c.style.transform = 'scale(0)';
    c.style.opacity = '0';
  });
  await sleep(dur);
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
  // 완전 무작위 팩: 정답 유도/쏠림 보정 없이 균등 랜덤으로 채움
  if (isRandomPack.value) return randomTokenSpecs(count);
  const cap = tokenCap.value;
  // 자유 모드: "이미 많이 깔린 문제 우선" 전략은 공통 토큰(예: 산소)을 무한 증식시키므로
  // 대신 무작위 정답들을 완성된 단위로 균형 있게 채우되, 동일 토큰 상한을 지킨다.
  if (mode.value === 'free') {
    const proj = new Map<string, number>(); // 살아남는 보드 + 추가 예정 토큰 수
    board.value.forEach((b, i) => { if (!removed.has(i) && b) proj.set(b.token, (proj.get(b.token) || 0) + 1); });
    const base = items.filter((it) => !solvedItems.value.includes(it.id));
    const pool = shuffle(base.length ? base : items.slice());
    let guard = 0;
    for (let i = 0; result.length < count && guard < pool.length * 8; i += 1, guard += 1) {
      const item = pool[i % pool.length];
      let ok = true; // 통째로 넣어도 상한을 넘지 않을 때만 채택
      for (const [tk, c] of tokenCounts(item.tokens)) if ((proj.get(tk) || 0) + c > cap) { ok = false; break; }
      if (!ok) continue;
      for (const tk of item.tokens) {
        if (result.length >= count) break;
        result.push({ token: tk, item });
        proj.set(tk, (proj.get(tk) || 0) + 1);
      }
    }
    while (result.length < count) { // 부족분은 상한 무시하고 채움(작은 풀 대비)
      const item = pool[Math.floor(Math.random() * pool.length)];
      result.push({ token: item.tokens[Math.floor(Math.random() * item.tokens.length)], item });
    }
    return shuffle(result);
  }
  // 살아남는 보드의 토큰 수(가용량)
  const avail = new Map<string, number>();
  board.value.forEach((b, i) => {
    if (!removed.has(i) && b) avail.set(b.token, (avail.get(b.token) || 0) + 1);
  });
  // 보드에 이미 일부 토큰이 남아있는 문제를 먼저 완성시킨다(남은 토큰을 마저 채워 제거 가능하게)
  const presentCount = (it: LessonItem) => {
    let n = 0;
    for (const [tk, c] of tokenCounts(it.tokens)) n += Math.min(avail.get(tk) || 0, c);
    return n;
  };
  const unsolved = items
    .filter((it) => !solvedItems.value.includes(it.id))
    .sort((a, b) => presentCount(b) - presentCount(a)); // 이미 많이 깔린 문제 우선
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
  // 남는 칸은 정답 글자로 무작위 채우되 동일 토큰 상한을 지킨다
  const pool = unsolved.length ? unsolved : items;
  const proj = new Map<string, number>();
  board.value.forEach((b, i) => { if (!removed.has(i) && b) proj.set(b.token, (proj.get(b.token) || 0) + 1); });
  for (const r of result) proj.set(r.token, (proj.get(r.token) || 0) + 1);
  let guard = 0;
  while (result.length < count) {
    const item = pool[Math.floor(Math.random() * pool.length)];
    const token = item.tokens[Math.floor(Math.random() * item.tokens.length)];
    if ((proj.get(token) || 0) >= cap && guard < count * 8) { guard += 1; continue; }
    result.push({ token, item });
    proj.set(token, (proj.get(token) || 0) + 1);
  }
  return shuffle(result);
}

async function resolveMatch(item: LessonItem, indexes: number[]) {
  isResolving.value = true;
  const myRun = runId;
  scoreMatch(item, indexes.length);
  matchedCount.value += 1;
  clearedBlocks.value += indexes.length;
  showAnswerPopup(item, indexes);
  clearSelection();
  moves.value -= 1;
  // 정답 즉시 기록 + 다음 문제를 바로 표시(애니메이션 대기 없이). 스테이지를 다 풀면 "참 잘 했어요~"
  if (gameKind.value === 'lesson' && !solvedItems.value.includes(item.id)) {
    solvedItems.value = [...solvedItems.value, item.id]; // 재할당해야 watch가 감지
    maybeMarkStageCleared(item); // 모든 모드에서 스테이지 완성 시 클리어 기록
  }
  if (mode.value === 'endless') advanceEndlessStageIfReady();
  else if (mode.value === 'single' && !stageDone.value) pickSequenceTarget();
  // 정답표시 OFF일 때만 제자리 번쩍임/페이드. ON이면 블럭이 팝업으로 이동만 하고 바로 제거.
  if (showAnswer.value) {
    await sleep(animMs(ANIM.popupHold));
  } else {
    await vanishCells(indexes);
  }
  if (!isAlive(myRun)) return;
  motionPhase.value = 'fall';
  applyGravity(indexes);
  // 낙하 후, 화면에 표시 중인 목표를 보드가 지원하도록 보장(목표는 유지)
  if (!stageDone.value) ensureTargetFormable();
  // 연속/자유 모드: 보드가 최종 상태가 됐으니 정답 팝업이 떠 있는 동안에도 다음 블럭을 선택할 수 있게 잠금 해제
  if (continuous.value) isResolving.value = false;
  await sleep(animMs(ANIM.fall));
  if (!isAlive(myRun)) return;
  motionPhase.value = 'idle';
  if (!continuous.value) isResolving.value = false;
}

function clearSelection() {
  cancelPendingMatch();
  selectedIndexes.value = [];
}

// 부분집합 정답(예: O2 ⊂ O3) 충돌 처리용 보류 타이머
const PENDING_MATCH_MS = 1000; // 짧은 답 자동 채택까지 추가 선택을 기다리는 시간
let pendingMatchTimer: ReturnType<typeof setTimeout> | null = null;
function cancelPendingMatch() {
  if (pendingMatchTimer) {
    clearTimeout(pendingMatchTimer);
    pendingMatchTimer = null;
  }
}
// 현재 선택이 snapshot과 동일한지(보류 중 추가 선택 여부 판별)
function sameSelection(snap: number[]) {
  const cur = selectedIndexes.value;
  return cur.length === snap.length && cur.every((v, i) => v === snap[i]);
}
// 현재 선택을 더 긴 정답으로 확장 가능한지: 부족 토큰을 보드의 미선택 블럭으로 채울 수 있어야 함
function hasRemainingForExtension(selected: string[], answer: string[]) {
  const need = tokenCounts(answer);
  const have = tokenCounts(selected);
  const deficit = new Map<string, number>();
  for (const [tk, c] of need) {
    const d = c - (have.get(tk) || 0);
    if (d > 0) deficit.set(tk, d);
  }
  if (!deficit.size) return false;
  const avail = new Map<string, number>();
  board.value.forEach((b, i) => {
    if (!b || selectedIndexes.value.includes(i)) return;
    avail.set(b.token, (avail.get(b.token) || 0) + 1);
  });
  for (const [tk, d] of deficit) {
    if ((avail.get(tk) || 0) < d) return false;
  }
  return true;
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
    cancelPendingMatch();
    selectedIndexes.value = selectedIndexes.value.filter((_, i) => i !== existing);
    return;
  }
  cancelPendingMatch(); // 새 블럭 선택 → 직전 보류 취소 후 다시 판별
  selectedIndexes.value.push(index);
  const tokens = selectedBlocks.value.map((block) => block.token);

  if (continuous.value) {
    const matchedItem = activeItems.value.find(
      (item) => item.tokens.length === tokens.length && isSubset(tokens, item.tokens),
    );
    if (!matchedItem) return;
    // 더 긴 정답으로 확장 가능하면 즉시 체결하지 않고 잠시 보류(추가 선택 대기)
    const canExtend = activeItems.value.some(
      (item) =>
        item.tokens.length > tokens.length &&
        isSubset(tokens, item.tokens) &&
        hasRemainingForExtension(tokens, item.tokens),
    );
    if (!canExtend) {
      await resolveMatch(matchedItem, [...selectedIndexes.value]);
      return;
    }
    const snapshot = [...selectedIndexes.value];
    pendingMatchTimer = setTimeout(() => {
      pendingMatchTimer = null;
      if (!isResolving.value && sameSelection(snapshot)) void resolveMatch(matchedItem, snapshot);
    }, PENDING_MATCH_MS);
    return;
  }

  if (!target.value) return;
  if (tokens.length === target.value.tokens.length && isSubset(tokens, target.value.tokens)) {
    await resolveMatch(target.value, [...selectedIndexes.value]);
  }
}

async function resolveCollect(indexes: number[], item: LessonItem, swapCandidates: number[] = []) {
  isResolving.value = true;
  const myRun = runId;
  scoreMatch(item, indexes.length);
  matchedCount.value += 1;
  clearedBlocks.value += indexes.length;
  clearSelection();
  // 스왑으로 만든 매치면 교체 칸에 특수블럭 생성(해당 칸은 제거하지 않고 남김)
  const sp = analyzeSpecial(indexes, swapCandidates);
  const removeIdx = sp ? indexes.filter((i) => i !== sp.keepIndex) : indexes;
  if (sp) board.value[sp.keepIndex] = { ...board.value[sp.keepIndex]!, power: sp.power, token: powerToken(sp.power) };
  // 폭탄 자리(keepIndex)는 슬라이드/숨김 대상에서 제외 — 폭탄 블럭이 그 자리에 남아야 보임
  showAnswerPopup(item, removeIdx);
  // 정답 즉시 기록 + 다음 문제를 바로 표시. 스테이지를 다 풀면 "참 잘 했어요~"
  if (gameKind.value === 'lesson' && !solvedItems.value.includes(item.id)) {
    solvedItems.value = [...solvedItems.value, item.id]; // 재할당해야 watch가 감지
    maybeMarkStageCleared(item); // 모든 모드에서 스테이지 완성 시 클리어 기록
  }
  if (mode.value === 'endless') advanceEndlessStageIfReady();
  else if (mode.value === 'single' && !stageDone.value) {
    const disp = pickCollectTargetForDisplay();
    if (disp) collectTargetItem.value = disp;
  }
  // 정답표시 OFF일 때만 제자리 번쩍임/페이드. ON이면 블럭이 팝업으로 이동만 하고 바로 제거.
  if (showAnswer.value) {
    // 정답팝업으로 슬라이드되는 동안 잠깐 대기. fade는 적용하지 않음(복제된 슬롯이 팝업으로 이동, 원본은 leave로 사라짐)
    await sleep(animMs(ANIM.popupHold));
  } else {
    await vanishCells(removeIdx);
  }
  if (!isAlive(myRun)) return;
  motionPhase.value = 'fall';
  applyGravity(removeIdx);
  await sleep(animMs(ANIM.fall));
  if (!isAlive(myRun)) return;
  motionPhase.value = 'idle';

  // 연속 블럭깨기: 연속/자유 모드에서 낙하 후 정답 조건이 된 덩어리를 자동으로 연쇄 제거
  if (autoChain.value && continuous.value) await cascadeClear();

  ensureCollectAfterClear();
  isResolving.value = false;
}

// 낙하 후: 표시 중인 목표가 보드에서 안 되면 보장(목표 교체 또는 새 판)
function ensureCollectAfterClear() {
  if (continuous.value) {
    if (!collectableItems.value.some(canFormFromBoard)) board.value = buildCollectBoard();
  } else if (!stageDone.value) {
    if (!collectTargetItem.value || !canFormFromBoard(collectTargetItem.value)) {
      const next = chooseNextCollectTarget();
      if (next) {
        collectTargetItem.value = next;
      } else {
        message.value = t('msgNewBoard');
        pickCollectItem();
        board.value = buildCollectBoard();
      }
    }
  }
}

// 보드에서 서로 겹치지 않는 완성(연결) 정답 덩어리를 모두 찾는다(토큰 많은 답 우선).
function findAllTargetClusters(brd: Block[]): Array<{ indexes: number[]; item: LessonItem }> {
  let work = brd.slice();
  const out: Array<{ indexes: number[]; item: LessonItem }> = [];
  for (let guard = 0; guard < 50; guard += 1) {
    const m = findAnyTargetCluster(work);
    if (!m) break;
    out.push(m);
    const next = work.slice();
    for (const i of m.indexes) next[i] = undefined as unknown as Block; // 사용한 칸은 다음 탐색에서 제외
    work = next;
  }
  return out;
}

// 제거되는 덩어리의 모양을 분석해 생성할 특수블럭을 결정(스왑으로 만든 매치만, 교체 칸에 생성).
// 직선4 → 가로/세로 줄폭탄, 2x2 → 영역폭탄, 직선5+ → 동색전체 폭탄.
function analyzeSpecial(indexes: number[], swapCandidates: number[]): { keepIndex: number; power: PowerKind } | null {
  if (!specialEnabled.value) return null;
  // keepIndex: 스왑 후보 중 매치에 포함된 칸 우선, 없으면 클러스터 중앙(자동 매치/cascade에서도 폭탄 생성)
  const swapIn = swapCandidates.find((s) => indexes.includes(s));
  const swapIndex = swapIn !== undefined ? swapIn : indexes[Math.floor(indexes.length / 2)];
  const n = indexes.length;
  const rs = indexes.map((i) => Math.floor(i / cols.value));
  const cs = indexes.map((i) => i % cols.value);
  const sameRow = rs.every((r) => r === rs[0]);
  const sameCol = cs.every((c) => c === cs[0]);
  // 5개 이상(모양 무관) → 영역폭탄(💣 3x3)
  if (n >= 5) return { keepIndex: swapIndex, power: 'area' };
  if (n === 4) {
    // 직선 4: 매치-3 표준(가로 매치는 세로폭탄, 세로 매치는 가로폭탄)
    if (sameRow) return { keepIndex: swapIndex, power: 'col' };
    if (sameCol) return { keepIndex: swapIndex, power: 'row' };
    // 2x2 사각형 → 무지개 폭탄(같은 색 전부 제거)
    const minR = Math.min(...rs);
    const minC = Math.min(...cs);
    const set = new Set(indexes);
    const square = [minR * cols.value + minC, minR * cols.value + minC + 1, (minR + 1) * cols.value + minC, (minR + 1) * cols.value + minC + 1];
    if (Math.max(...rs) - minR === 1 && Math.max(...cs) - minC === 1 && square.every((s) => set.has(s))) {
      return { keepIndex: swapIndex, power: 'all' };
    }
  }
  return null;
}

// 특수블럭이 터질 때 제거되는 칸들(자신 포함)
function getPowerArea(index: number): number[] {
  const b = board.value[index];
  if (!b?.power) return [index];
  const total = rows.value * cols.value;
  const row = Math.floor(index / cols.value);
  const col = index % cols.value;
  if (b.power === 'row') return Array.from({ length: cols.value }, (_, c) => row * cols.value + c);
  if (b.power === 'col') return Array.from({ length: rows.value }, (_, r) => r * cols.value + col);
  if (b.power === 'all') {
    // 폭탄 자신은 원래 과일색을 유지하므로 같은 색(=같은 과일) 블럭을 모두 제거
    const out: number[] = [];
    for (let i = 0; i < total; i += 1) if (board.value[i]?.color === b.color) out.push(i);
    return out;
  }
  // area: 3x3
  const out: number[] = [];
  for (let r = row - 1; r <= row + 1; r += 1) {
    for (let c = col - 1; c <= col + 1; c += 1) {
      if (r >= 0 && r < rows.value && c >= 0 && c < cols.value) out.push(r * cols.value + c);
    }
  }
  return out;
}

// 특수블럭 발동: 효과 범위 제거(범위 안 다른 특수블럭은 연쇄) → 낙하
// extraRemove: 폭발과 함께 제거할 추가 칸(예: 스왑으로 완성된 정답 글자들)
async function detonate(startIndexes: number[], extraRemove: number[] = []) {
  isResolving.value = true;
  const myRun = runId;
  hintIndexes.value = [];
  const toRemove = new Set<number>(extraRemove);
  const queue = [...startIndexes];
  // 영향 범위 셀이 어떤 폭탄의 외형(token/color)으로 바뀔지 기록 — 첫 영향 폭탄 우선
  const morph = new Map<number, { token: string; color: string }>();
  while (queue.length) {
    const i = queue.shift()!;
    const det = board.value[i];
    const morphTo = det ? { token: det.token, color: det.color } : null;
    for (const c of getPowerArea(i)) {
      if (!toRemove.has(c)) {
        toRemove.add(c);
        if (board.value[c]?.power && !queue.includes(c)) queue.push(c); // 연쇄
      }
      // 시작 폭탄 자신은 자기 외형 유지, 나머지 영향 받은 셀을 폭탄 외형으로 교체
      if (morphTo && c !== i && !morph.has(c)) morph.set(c, morphTo);
    }
    toRemove.add(i);
  }
  // 영향 범위 블럭들을 폭탄 모양으로 교체해 잠시 보여줌
  if (morph.size) {
    board.value = board.value.map((b, i) => {
      const m = morph.get(i);
      return m && b ? { ...b, token: m.token, color: m.color } : b;
    });
    await sleep(animMs(ANIM.morph));
    if (!isAlive(myRun)) return;
  }
  const idx = [...toRemove];
  score.value += idx.length * 10;
  best.value = Math.max(best.value, score.value);
  localStorage.setItem(bestKey(), String(best.value));
  clearedBlocks.value += idx.length;
  message.value = `💥 ${idx.length}${t('bombRemovedSuffix')}`;
  clearSelection();
  swapFirstIndex.value = null;
  // 폭탄 외형으로 변신한 셀들도 같은 축소+페이드 효과로 사라짐
  await vanishCells(idx);
  if (!isAlive(myRun)) return;
  motionPhase.value = 'fall';
  applyGravity(idx);
  await sleep(animMs(ANIM.fall));
  if (!isAlive(myRun)) return;
  motionPhase.value = 'idle';
  if (autoChain.value && continuous.value) await cascadeClear();
  ensureCollectAfterClear();
  isResolving.value = false;
}

// 폭탄 블럭의 외형(토큰 자체를 폭탄 아이콘으로 교체)
function powerToken(power: PowerKind): string {
  return power === 'row' ? '↔️' : power === 'col' ? '↕️' : power === 'area' ? '💣' : '🌈';
}

// 정답표시 OFF: 보드의 모든 완성 덩어리를 동시에 제거 → 한 번에 낙하(여러 답 동시 깨짐)
async function resolveCollectBatch(matches: Array<{ indexes: number[]; item: LessonItem }>, swapCandidates: number[] = []) {
  isResolving.value = true;
  const myRun = runId;
  const all: number[] = [];
  const specials: Array<{ keepIndex: number; power: PowerKind }> = [];
  for (const m of matches) {
    scoreMatch(m.item, m.indexes.length);
    matchedCount.value += 1;
    clearedBlocks.value += m.indexes.length;
    if (gameKind.value === 'lesson' && !solvedItems.value.includes(m.item.id)) {
      solvedItems.value = [...solvedItems.value, m.item.id];
      maybeMarkStageCleared(m.item);
    }
    const sp = analyzeSpecial(m.indexes, swapCandidates); // 스왑으로 만든 매치면 교체 칸에 특수블럭 생성
    if (sp) specials.push(sp);
    for (const i of m.indexes) if (!sp || i !== sp.keepIndex) all.push(i);
  }
  // 특수블럭은 제거하지 않고 교체 칸에 남긴다(블럭 자체를 폭탄으로 교체)
  for (const sp of specials) board.value[sp.keepIndex] = { ...board.value[sp.keepIndex]!, power: sp.power, token: powerToken(sp.power) };
  clearSelection();
  await vanishCells(all);
  if (!isAlive(myRun)) return;
  motionPhase.value = 'fall';
  applyGravity(all);
  if (mode.value === 'endless') advanceEndlessStageIfReady();
  await sleep(animMs(ANIM.fall));
  if (!isAlive(myRun)) return;
  motionPhase.value = 'idle';
  if (autoChain.value && continuous.value) await cascadeClear();
  ensureCollectAfterClear();
  isResolving.value = false;
}

// 연속 블럭깨기: 보드에서 완성된(연결된) 정답 덩어리를 찾아 자동 제거 → 낙하 → 반복
async function cascadeClear() {
  const myRun = runId;
  for (let guard = 0; guard < 30; guard += 1) {
    if (!isAlive(myRun)) return;
    // 정답표시 OFF면 한 라운드의 모든 완성 덩어리를 동시에, ON이면 하나씩(팝업)
    const round = showAnswer.value
      ? (findAnyTargetCluster(board.value) ? [findAnyTargetCluster(board.value)!] : [])
      : findAllTargetClusters(board.value);
    if (!round.length) break;
    const idx: number[] = [];
    const specials: Array<{ keepIndex: number; power: PowerKind }> = [];
    for (const m of round) {
      scoreMatch(m.item, m.indexes.length);
      matchedCount.value += 1;
      clearedBlocks.value += m.indexes.length;
      if (gameKind.value === 'lesson' && !solvedItems.value.includes(m.item.id)) {
        solvedItems.value = [...solvedItems.value, m.item.id];
        maybeMarkStageCleared(m.item);
      }
      const sp = analyzeSpecial(m.indexes, []); // 자동 매치도 형태 만족하면 폭탄 생성(클러스터 중앙에)
      if (sp) specials.push(sp);
      for (const i of m.indexes) if (!sp || i !== sp.keepIndex) idx.push(i);
    }
    for (const sp of specials) board.value[sp.keepIndex] = { ...board.value[sp.keepIndex]!, power: sp.power, token: powerToken(sp.power) };
    if (showAnswer.value) {
      // round[0]에 폭탄이 생성됐다면 그 keepIndex는 슬라이드/숨김에서 제외
      const firstSp = specials.find((sp) => round[0].indexes.includes(sp.keepIndex));
      const popupIdx = firstSp ? round[0].indexes.filter((i) => i !== firstSp.keepIndex) : round[0].indexes;
      showAnswerPopup(round[0].item, popupIdx);
      // 정답팝업으로 슬라이드되는 동안 잠깐 대기
      await sleep(animMs(ANIM.popupHold));
    } else {
      await vanishCells(idx);
    }
    if (!isAlive(myRun)) return;
    motionPhase.value = 'fall';
    applyGravity(idx);
    await sleep(animMs(ANIM.fallShort));
    if (!isAlive(myRun)) return;
    motionPhase.value = 'idle';
  }
  if (mode.value === 'endless') advanceEndlessStageIfReady();
}

function findCollectMatch(seeds: number[]) {
  if (continuous.value) return findAnyTargetCluster(board.value, seeds);
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
  return { ...block, value: val, token: formatValue(val), label: String(val), color: colorForValue(val), adds: 0 };
}

// 조각별 금(빗금) 각도 — id로 결정해 블럭마다 다르게(랜덤처럼), 다시 그려도 고정
function crackAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 180;
  return h;
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
      recordNumMerge(mergedValue * combo.value, mergedValue);
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
    message.value = clusters.length > 1 ? `${clusters.length}${t('mergedManySuffix')}` : t('merged');

    clearSelection();
    // 가까운 칸부터 차례로, 연결 경로를 따라 칸칸이 최종 합체 칸까지 이동한 뒤 사라진다
    const gatherOrder = [...removedAll].sort((a, b) => depthOf.get(a)! - depthOf.get(b)!);
    const perCell = animMs(ANIM.gatherStep);
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
    await sleep(animMs(ANIM.gather));
    gatherStyles.value = new Map();
    motionPhase.value = 'fall';
    applyGravity(removedAll);
    await sleep(animMs(ANIM.fall));
    motionPhase.value = 'idle';

    firstPass = false;
  }
  return mergedAny;
}

function checkNumberGameOver() {
  if (gameKind.value !== 'numbers') return;
  if (mergeMode.value === 'add') return; // 더하기 모드는 항상 합칠 수 있어 게임오버 없음
  // 자유 스왑이므로, 같은 값이 3개 이상인 숫자가 하나라도 있으면 아직 합칠 수 있다
  const counts = new Map<number, number>();
  for (const block of board.value) {
    if (block?.value !== undefined) counts.set(block.value, (counts.get(block.value) || 0) + 1);
  }
  const canStillMerge = [...counts.values()].some((count) => count >= 3);
  if (!canStillMerge) {
    gameOver.value = true;
    message.value = `${t('gameOverNoMergePrefix')} ${score.value}`;
    track('game_over', { score: score.value, best: best.value });
  }
}

async function numberSwap(a: number, b: number) {
  isResolving.value = true;
  const myRun = runId;
  motionPhase.value = 'swap';
  const next = [...board.value];
  [next[a], next[b]] = [next[b], next[a]];
  board.value = next;
  await sleep(animMs(ANIM.swap));
  motionPhase.value = 'idle';

  // 옮긴 칸(b) 우선, 보드 전체의 3개 이상 연결 덩어리를 연쇄로 합침
  const merged = await resolveNumberClusters(b);
  if (!merged) {
    combo.value = 1;
    message.value = t('msgMerge3');
  }
  isResolving.value = false;
  checkNumberGameOver();
}

// 블럭 더하기: a 블럭을 b 칸으로 끌어가 b = a+b 로 만들고 a는 흡수(제거 후 리필)
async function numberAdd(a: number, b: number) {
  const av = board.value[a]?.value;
  const bv = board.value[b]?.value;
  if (av === undefined || bv === undefined) return;
  // 작은 수에 큰 수를 더하지 못하게: 끌어온 수가 대상 수보다 크면 막음
  if (av > bv) {
    message.value = t('cantAddBigger');
    swapFirstIndex.value = null;
    selectedIndexes.value = [];
    return;
  }
  isResolving.value = true;
  combo.value = 1; // 이번 더하기 액션의 콤보 시작(이어지는 자동 합체에서 증가)
  motionPhase.value = 'swap';
  const dCol = (b % cols.value) - (a % cols.value);
  const dRow = Math.floor(b / cols.value) - Math.floor(a / cols.value);
  const dur = animMs(ANIM.gatherStep) * 2;
  const styleMap = new Map(gatherStyles.value);
  styleMap.set(a, {
    transform: `translate(calc(${dCol} * (100% + 0.5rem)), calc(${dRow} * (100% + 0.5rem)))`,
    zIndex: '7',
    transition: `transform ${dur}ms linear`,
  });
  gatherStyles.value = styleMap;
  await sleep(dur);

  const sum = av + bv;
  const newAdds = (board.value[b]?.adds ?? 0) + 1; // b에 더해진 횟수
  const next = board.value.slice();
  next[b] = { ...recolorBlock(next[b]!, sum), adds: newAdds };
  board.value = next;
  const hidden = new Map(gatherStyles.value);
  hidden.set(a, { ...(hidden.get(a) || {}), opacity: '0', transition: 'none' });
  gatherStyles.value = hidden;
  score.value += sum;
  recordNumMerge(sum, sum);
  best.value = Math.max(best.value, score.value);
  localStorage.setItem(bestKey(), String(best.value));
  // 3번 더했어도, 합쳐진 수가 이웃의 같은 수와 3개 이상 합체될 수 있으면 깨지지 않고 합체를 우선한다
  const bWillCluster = findAllMergeClusters(board.value).some((c) => c.includes(b));
  const breakNow = newAdds >= 3 && !bWillCluster;
  message.value = breakNow
    ? `${t('addBang')} ${formatValue(av)} + ${formatValue(bv)} ${t('blockBroke')}`
    : `${t('addBang')} ${formatValue(av)} + ${formatValue(bv)} = ${formatValue(sum)}`;

  await sleep(animMs(ANIM.gather));
  if (breakNow) {
    numStats.value.breaks += 1; // 깨진 횟수 기억
    saveNumStats();
    // 3번 더했고 합체도 안 되면 산산이 깨진다
    const sh = new Map(gatherStyles.value);
    sh.set(b, { animation: 'block-shatter 320ms ease-in forwards', zIndex: '8' });
    gatherStyles.value = sh;
    await sleep(320);
  }
  gatherStyles.value = new Map();
  motionPhase.value = 'fall';
  applyGravity(breakNow ? [a, b] : [a]); // 깨지면 b칸도 비우고 리필
  await sleep(animMs(ANIM.fall));
  motionPhase.value = 'idle';

  // 더하기 후에도 같은 숫자 3개 이상이 붙으면 자동으로 합체(연쇄) — 교체 모드와 동일
  await resolveNumberClusters(b);
  isResolving.value = false;
}

async function trySwap(a: number, b: number) {
  if (a === b) return;
  hintIndexes.value = [];
  // 숫자더하기는 인접 옵션 설정과 무관하게 항상 자유 교환/더하기
  if (gameKind.value === 'numbers') {
    if (mergeMode.value === 'add') await numberAdd(a, b);
    else await numberSwap(a, b);
    return;
  }
  // 학습 모드: 인접만 교환 옵션이 켜져 있으면 상하좌우 이웃만 허용
  if (adjacentSwap.value && !cellNeighbors(a).includes(b)) {
    message.value = t('msgAdjOnly');
    swapFirstIndex.value = null;
    selectedIndexes.value = [];
    return;
  }
  isResolving.value = true;
  const myRun = runId;
  motionPhase.value = 'swap';
  const next = [...board.value];
  [next[a], next[b]] = [next[b], next[a]];
  board.value = next;
  moves.value -= 1;
  await sleep(animMs(ANIM.swap));
  if (!isAlive(myRun)) return;
  motionPhase.value = 'idle';

  // 특수블럭을 스왑하면 옮겨진 위치에서 발동
  if (specialEnabled.value) {
    const dets: number[] = [];
    if (board.value[b]?.power) dets.push(b);
    if (board.value[a]?.power) dets.push(a);
    if (dets.length) {
      // 무지개(all) 폭탄: 상대 블럭과 같은 종류(=color) 전부 제거
      for (const d of dets) {
        if (board.value[d]?.power === 'all') {
          const otherColor = board.value[d === a ? b : a]?.color;
          if (otherColor) board.value[d] = { ...board.value[d]!, color: otherColor };
        }
      }
      // 스왑으로 답이 완성됐으면 정답으로 인정하고, 그 글자들도 폭발과 함께 제거
      const clusters = continuous.value
        ? findAllTargetClusters(board.value)
        : (() => { const m = findCollectMatch([a, b]); return m ? [m] : []; })();
      const credited = clusters.filter((m) => m.indexes.includes(a) || m.indexes.includes(b));
      const extra: number[] = [];
      for (const m of credited) {
        scoreMatch(m.item, m.indexes.length);
        matchedCount.value += 1;
        if (gameKind.value === 'lesson' && !solvedItems.value.includes(m.item.id)) {
          solvedItems.value = [...solvedItems.value, m.item.id];
          maybeMarkStageCleared(m.item);
        }
        extra.push(...m.indexes);
      }
      await detonate(dets, extra);
      return;
    }
  }

  // 정답표시 OFF + 연속/자유: 보드에 완성된 모든 덩어리를 동시에 깬다
  if (!showAnswer.value && continuous.value) {
    const all = findAllTargetClusters(board.value);
    if (all.length) {
      await resolveCollectBatch(all, [a, b]);
      return;
    }
    message.value = t('msgMoveJoin');
    isResolving.value = false;
    return;
  }

  const match = findCollectMatch([a, b]);
  if (!match) {
    message.value = t('msgMoveJoin');
    isResolving.value = false;
    return;
  }
  await resolveCollect(match.indexes, match.item, [a, b]);
}

async function handleCollectClick(index: number) {
  if (isResolving.value) return;
  // 특수블럭을 탭하면 그 자리에서 발동
  if (specialEnabled.value && board.value[index]?.power) {
    // 무지개(all) 폭탄을 그냥 탭: 보드의 일반 블럭 색 중 랜덤 한 종류를 골라 그 색 전부 제거
    if (board.value[index]?.power === 'all') {
      const colors = [...new Set(board.value.filter((b) => b && !b.power).map((b) => b!.color))];
      if (colors.length) {
        const pick = colors[Math.floor(Math.random() * colors.length)];
        board.value[index] = { ...board.value[index]!, color: pick };
      }
    }
    swapFirstIndex.value = null;
    selectedIndexes.value = [];
    await detonate([index]);
    return;
  }
  // 1글자 정답은 해당 블럭을 탭하면 바로 해결
  if (!continuous.value) {
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
    let to = el ? Number(el.dataset.cell) : -1;
    // 직접 셀에 못 떨어졌으면(보드 사이 여백) 보드 안에서 가장 가까운 셀로 대체
    if (to < 0) {
      const br = boardEl.value?.getBoundingClientRect();
      if (br && event.clientX >= br.left && event.clientX <= br.right && event.clientY >= br.top && event.clientY <= br.bottom) {
        const cells = boardEl.value?.querySelectorAll('.block-face[data-cell]') as NodeListOf<HTMLElement> | undefined;
        let bestDist = Infinity;
        cells?.forEach((c) => {
          const r = c.getBoundingClientRect();
          const dx = event.clientX - (r.left + r.width / 2);
          const dy = event.clientY - (r.top + r.height / 2);
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; to = Number(c.dataset.cell); }
        });
      }
    }
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
  if (solveMode.value === nextMode) return;
  track('set_solve_mode', { from_solve_mode: solveMode.value, to_solve_mode: nextMode });
  solveMode.value = nextMode;
  localStorage.setItem('matchit-solve-mode', nextMode);
  // 진행 중인 판은 그대로 두고(점수·보드 유지) 전환에 필요한 상태만 갱신한다.
  selectedIndexes.value = [];
  swapFirstIndex.value = null;
  hintIndexes.value = [];
  hintItem.value = null;
  showHint.value = false;
  if (nextMode === 'collect') {
    if (continuous.value) {
      collectTargetItem.value = null; // 가상 목표(보드의 아무 답이나)
    } else {
      pickCollectItem();
      // 단일 모드에서 현재 보드로 목표를 못 만들면 그때만 모으기용 보드로 재구성
      if (collectTargetItem.value && !canFormFromBoard(collectTargetItem.value)) {
        board.value = buildCollectBoard();
      }
    }
  } else {
    // 순서대로: 단일 모드만 목표 보장(보드에 답 있으면 재구성 안 함)
    if (!continuous.value) ensureSequenceTargetOnBoard();
  }
}

function setGameKind(nextKind: GameKind) {
  track('set_game_kind', { from_kind: gameKind.value, to_kind: nextKind });
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
  numStats.value = { total: 0, bestMax: 0, bestCombo: 0, merges: 0, breaks: 0 };
  saveNumStats();
}

// 이 기기에 저장된 모든 게임 데이터(진행도·순서·설정·추가팩 등) 삭제 후 새로고침
function clearLocalData() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('matchit'))
    .forEach((k) => localStorage.removeItem(k));
  location.reload();
}

function requestExit() {
  showExitConfirm.value = true;
}
function cancelExit() {
  showExitConfirm.value = false;
}
function confirmExit() {
  showExitConfirm.value = false;
  track('exit_game', { stage: currentStage.value, score: score.value, saved: saveOnExit.value });
  // 모든 게임: 체크 시 현재 상태 저장(다음에 이어서 시작), 해제 시 저장 삭제
  if (saveOnExit.value) {
    saveGame();
    localStorage.setItem('matchit-resume', '1');
  } else {
    localStorage.removeItem(SAVE_KEY);
    localStorage.setItem('matchit-resume', '0');
  }
  activeMobilePanel.value = 'packs';
}

// 새판: 경고 후 진행
const showNewBoardConfirm = ref(false);
function requestNewBoard() {
  showNewBoardConfirm.value = true;
}
function cancelNewBoard() {
  showNewBoardConfirm.value = false;
}
function confirmNewBoard() {
  showNewBoardConfirm.value = false;
  track('new_board', { stage: currentStage.value });
  resetGame(true, true); // 새판: 점수·현재 스테이지 유지하고 보드만 새로
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
  if (!continuous.value) {
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
  if (hint.length) track('hint_used', { item_id: hintItem.value?.id, word: hintItem.value?.label });
  else message.value = t('msgNoCombo');
}

// 모르면 다음 문제로 넘어가기 (학습 한 문제씩 모드)
const canPass = computed(() => gameKind.value === 'lesson' && mode.value === 'single');
function passCurrent() {
  if (!canPass.value || isResolving.value) return;
  track('pass_item', { item_id: target.value?.id, word: target.value?.label });
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
      message.value = t('msgNewBoard');
      pickCollectItem();
      board.value = buildCollectBoard();
    }
  } else {
    ensureSequenceTargetOnBoard();
  }
  message.value = t('msgPass');
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
  track('set_theme', { theme: nextTheme });
}

function setBlockStyle(nextStyle: BlockStyleName) {
  blockStyle.value = nextStyle;
  localStorage.setItem('matchit-block-style', nextStyle);
  track('set_block_style', { style: nextStyle });
}

function setMergeMode(m: 'swap' | 'add') {
  mergeMode.value = m;
  localStorage.setItem('matchit-merge-mode', m);
  if (m === 'add') gameOver.value = false; // 더하기 모드는 게임오버 없음
}
function setAdjacentSwap(on: boolean) {
  adjacentSwap.value = on;
  localStorage.setItem('matchit-adjacent-swap', on ? 'on' : 'off');
  track('set_adjacent_swap', { enabled: on });
}

function setAutoChain(on: boolean) {
  autoChain.value = on;
  localStorage.setItem('matchit-auto-chain', on ? 'on' : 'off');
  track('set_auto_chain', { enabled: on });
}

function applyBoardSize() {
  localStorage.setItem('matchit-cols', String(cols.value));
  localStorage.setItem('matchit-rows', String(rows.value));
  resetGame();
}

function setBoardPreset(c: number, r: number) {
  track('set_board_size', { cols: c, rows: r });
  cols.value = c;
  rows.value = r;
  applyBoardSize();
}

function setShowAnswer(on: boolean) {
  showAnswer.value = on;
  localStorage.setItem('matchit-show-answer', on ? 'on' : 'off');
  track('set_show_answer', { enabled: on });
}

function showAnswerPopup(item: LessonItem, indexes: number[]) {
  if (gameKind.value !== 'lesson' || !showAnswer.value) return;
  // 사라질 보드 셀의 시작 좌표를 기록 — leave 중인 element는 배제(자동 연쇄에서 이전 라운드 잔류로 인덱스 어긋남 방지)
  const cellAt = (i: number) =>
    (boardEl.value?.querySelector(`.block-face[data-cell="${i}"]:not(.block-leave-active)`) as HTMLElement | null) ?? null;
  const remaining = [...indexes];
  const colors: string[] = [];
  const startRects: Array<DOMRect | null> = item.tokens.map((token) => {
    let pos = remaining.findIndex((idx) => board.value[idx]?.token === token);
    if (pos < 0) pos = 0;
    const idx = remaining.splice(pos, 1)[0];
    colors.push(idx != null ? (board.value[idx]?.color ?? colorForToken(token)) : colorForToken(token));
    return idx != null ? (cellAt(idx)?.getBoundingClientRect() ?? null) : null;
  });
  answerSlotColors.value = colors;
  // 팝업 슬롯 크기를 보드 셀 크기에 맞춤(트랜지션 시작 크기와 일치)
  const startW = startRects.find((r) => r)?.width;
  answerSlotSize.value = startW ? Math.round(startW) : (cellW.value ? Math.round(cellW.value) : 48);
  answerItem.value = item;
  // 슬라이드 출발과 동시에 원본 보드 셀들을 즉시 숨김(applyGravity의 leave 대기 사이에 잔상이 보이는 문제 방지).
  // key 기반 element 재사용 안 되므로 leave element에 그대로 박혀 사라짐, 같은 자리에 들어오는 새 enter block은 영향 없음.
  const originCells = indexes.map((i) => cellAt(i)).filter((c): c is HTMLElement => !!c);
  originCells.forEach((c) => { c.style.opacity = '0'; });
  // 팝업 슬롯이 렌더된 다음 frame에 보드 셀 시작 위치 → 자기 자리로 슬라이드
  void nextTick().then(() => {
    const slots = answerEl.value?.querySelectorAll('.answer-slot') as NodeListOf<HTMLElement> | undefined;
    if (!slots) return;
    slots.forEach((el, i) => {
      const start = startRects[i];
      if (!start) return;
      const end = el.getBoundingClientRect();
      const dx = start.left - end.left;
      const dy = start.top - end.top;
      const sx = end.width ? start.width / end.width : 1;
      const sy = end.height ? start.height / end.height : 1;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'translate(0, 0) scale(1, 1)' }],
        { duration: animMs(ANIM.popupSlide), easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      );
    });
  });
  window.clearTimeout(answerTimer);
  answerTimer = window.setTimeout(() => {
    answerItem.value = null;
  }, continuous.value ? 1600 : 5000);
}
function holdAnswer() {
  window.clearTimeout(answerTimer); // 누르고 있는 동안 유지
}
function releaseAnswer() {
  answerItem.value = null; // 손을 떼면 닫힘 (탭 포함)
}

function applyPackDefaultSize(packId: string) {
  const size = packBoards.value[packId] ?? { cols: 7, rows: 7 };
  cols.value = size.cols;
  rows.value = size.rows;
  localStorage.setItem('matchit-cols', String(cols.value));
  localStorage.setItem('matchit-rows', String(rows.value));
  const style = packBlockStyles.value[packId];
  if (style) {
    blockStyle.value = style;
    localStorage.setItem('matchit-block-style', style);
  }
}

async function setMode(nextMode: GameMode) {
  track('set_mode', { from_mode: mode.value, to_mode: nextMode });
  mode.value = nextMode;
  if (nextMode !== 'single' && gameKind.value === 'lesson') await loadFullPool(selectedPackId.value);
  resetGame(true);
}

async function setWordDirection(dir: 'spell' | 'meaning') {
  if (wordDirection.value === dir) return;
  track('set_word_direction', { direction: dir });
  wordDirection.value = dir;
  localStorage.setItem('matchit-word-direction', dir);
  fullKey = ''; // 방향 바뀌면 전체 풀 캐시 무효화
  if (currentRaw.value.length) {
    lessonItems.value = buildLevelItems(selectedPackId.value, currentRaw.value, dir);
    if (continuous.value && gameKind.value === 'lesson') await loadFullPool(selectedPackId.value);
    resetGame();
  }
}

async function handleLevelChange() {
  if (!activePack.value) return;
  await loadLevel(selectedPackId.value, selectedLevel.value);
  if (continuous.value && gameKind.value === 'lesson') { await loadFullPool(selectedPackId.value); resetGame(true); }
}

async function handlePackChange() {
  if (!activePack.value) return;
  track('select_pack');
  selectedLevel.value = 1;
  applyPackDefaultSize(selectedPackId.value);
  fullKey = ''; // 팩 바뀌면 전체 풀 캐시 무효화
  await loadLevel(selectedPackId.value, 1);
  if (continuous.value && gameKind.value === 'lesson') { await loadFullPool(selectedPackId.value); resetGame(true); }
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
    ? t('kindNumbers')
    : `${activePack.value?.title || ''}${mode.value === 'single' ? ` · ${levelLabel(selectedLevel.value)}` : ` · ${modeLabel.value}`}`;
  const solvedTotal = Object.values(levelStats.value).reduce((sum, s) => sum + (s?.solved || 0), 0);
  const detailLabel = gameKind.value === 'numbers' ? t('statMaxNumber') : '푼 문제';
  const detailValue = gameKind.value === 'numbers' ? formatValue(maxValue.value) : `${solvedTotal}`;

  // 제목 + 버전 (제목 폰트로 폭을 재서 겹치지 않게)
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#1f2937';
  context.font = '800 84px sans-serif';
  context.fillText(t('appName'), 84, 156);
  const titleWidth = context.measureText(t('appName')).width;
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
  context.fillText(t('statScore'), 134, 404);
  context.fillStyle = '#0f766e';
  context.font = '800 176px sans-serif';
  context.fillText(String(score.value), 130, 566);

  // 박스 아래: 최고점수 · 콤보 · 푼문제(또는 최고 숫자) · 블럭(보드 크기) 4열
  const stats: Array<[string, string]> = [
    [t('statBest'), String(best.value)],
    [t('statCombo'), `x${Math.max(1, combo.value - 1)}`],
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
  track('share', { method: 'image', content_type: 'score_card', score: score.value });
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
      endlessStage: endlessStage.value,
      cols: cols.value,
      rows: rows.value,
      board: board.value.map((b) => ({ token: b.token, value: b.value, lessonId: b.lessonId, label: b.label, color: b.color, power: b.power })),
      lessonItems: lessonItems.value,
      score: score.value,
      matchedCount: matchedCount.value,
      clearedBlocks: clearedBlocks.value,
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
  packId: string; level: number; stage?: number; endlessStage?: number; cols?: number; rows?: number;
  board: Array<{ token: string; value?: number; lessonId: string; label: string; color: string; power?: PowerKind }>;
  lessonItems: LessonItem[];
  score: number; matchedCount?: number; clearedBlocks?: number; combo: number; moves: number; passes: number;
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
    power: b.power,
  }));
  score.value = s.score || 0;
  matchedCount.value = s.matchedCount || 0;
  clearedBlocks.value = s.clearedBlocks || 0;
  combo.value = s.combo || 1;
  moves.value = s.moves ?? 25;
  passes.value = s.passes || 0;
  targetIndex.value = s.targetIndex || 0;
  gameOver.value = !!s.gameOver;
  collectTargetItem.value = lessonItems.value.find((it) => it.id === s.collectTargetId) || null;
  endlessStage.value = s.endlessStage ?? 1;
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
  // CSS의 --anim-speed를 JS의 ANIM_SPEED와 동기화(낙하 등 CSS 트랜지션이 같은 값으로 스케일됨)
  document.documentElement.style.setProperty('--anim-speed', String(ANIM_SPEED));
  selectedPackId.value = localStorage.getItem('matchit-selected-pack-id') || '';
  selectedLevel.value = Number(localStorage.getItem('matchit-selected-level') || 1);
  const savedPanel = localStorage.getItem('matchit-panel');
  const save = readSave();
  // 마지막 게임 상태로 재시작(나가기에서 '저장하고 나가기' 선택, 또는 게임 중 새로고침). 미저장 나가기는 '0'으로 해제.
  const canResume = !!(save && Array.isArray(save.board) && save.board.length && localStorage.getItem('matchit-resume') !== '0');

  await loadPacks();

  if (canResume && save) {
    // 게임 중이었으면 저장된 보드/상태로 복원하고 게임 화면으로
    restoreFromSave(save);
    activeMobilePanel.value = 'game';
    if (gameKind.value === 'lesson' && continuous.value) void loadFullPool(selectedPackId.value);
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
  // 새로고침으로 바로 게임 화면에 들어온 경우: 레이아웃·폰트가 안정된 뒤 다시 측정
  requestAnimationFrame(() => requestAnimationFrame(measureCell));
  window.setTimeout(measureCell, 200);
  if (document.fonts?.ready) document.fonts.ready.then(measureCell);

  // 목표 마퀴(모든 학습 모드): 문제·티커·모드·화면 전환 시 재시작(아니면 정지)
  watch([goalPrompt, endlessTicker, mode, gameKind, activeMobilePanel], () => {
    if (gameKind.value === 'lesson') nextTick(startGoalMarquee);
    else stopGoalMarquee();
  }, { immediate: true });
});

onBeforeUnmount(() => {
  boardResizeObserver?.disconnect();
  stopGoalMarquee();
});
</script>

<template>
  <main :class="['app-main min-h-screen px-4 py-5 text-[var(--ink)] sm:px-6 lg:px-8', `theme-${theme}`]" style="background: var(--page)">
    <div class="app-shell mx-auto flex max-w-7xl flex-col gap-5">
      <header class="flex flex-col gap-4 border-b border-[var(--line)] pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div class="flex grow items-start justify-between">
          <div>
            <p class="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{{ t('appTagline') }}</p>
            <h1 class="mt-2 flex items-baseline gap-2 text-3xl font-black sm:text-5xl">
              {{ t('appName') }}
              <span class="text-sm font-bold text-[var(--muted)] sm:text-base">{{ appVersion }}</span>
            </h1>
            <p class="mt-2 hidden max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base lg:block">
              {{ t('appDesc') }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <label for="theme-select" class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrTheme') }}</label>
            <select id="theme-select" v-model="theme" class="h-9 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 text-xs font-bold" @change="setTheme(($event.target as HTMLSelectElement).value as ThemeName)">
              <option v-for="item in themes" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </div>
        </div>
      </header>

      <nav class="flex gap-2 lg:hidden" :aria-label="t('ariaSwitchPanel')">
        <button
          v-for="panel in mobilePanels"
          :key="panel.id"
          class="flex h-11 items-center justify-center gap-1 rounded-md border px-4 text-sm font-black"
          :class="[
            activeMobilePanel === panel.id ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel)]',
            panel.id === 'game' ? 'ml-auto' : '',
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
          <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrGame') }}</p>
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
            <h2 class="text-lg font-black">{{ t('hdrPack') }}</h2>
            <span class="rounded bg-[var(--panel-strong)] px-2 py-1 text-xs font-bold text-[var(--muted)]">{{ packs.length }} {{ t('packsUnit') }}</span>
          </div>

          <div class="mt-4 grid grid-cols-[2fr_1fr] gap-2">
            <div>
              <label class="block text-xs font-bold uppercase text-[var(--muted)]" for="pack">{{ t('hdrPack') }}</label>
              <select id="pack" v-model="selectedPackId" class="mt-1 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3" @change="handlePackChange">
                <option v-for="pack in packs" :key="pack.id" :value="pack.id">{{ pack.title }}</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-[var(--muted)]" for="level">{{ t('hdrLevel') }}</label>
              <select id="level" v-model="selectedLevel" class="mt-1 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3" @change="handleLevelChange">
                <option v-for="level in levels" :key="level" :value="level">{{ levelLabel(level) }}{{ isLevelCleared(level) ? ' ✅' : '' }}</option>
              </select>
            </div>
          </div>

          <div class="mt-3 flex gap-2">
            <button class="h-10 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="showPackManager = true">
              {{ t('btnManagePacks') }}{{ extraPacks.length ? ` (${extraPacks.length})` : '' }}
            </button>
            <button class="h-10 rounded-md bg-[var(--accent)] px-3 text-sm font-black text-[var(--accent-ink)]" type="button" :title="t('btnRefresh')" @click="loadPacks()">
              ↻
            </button>
          </div>
          <p v-if="error" class="mt-2 text-sm font-semibold text-rose-600">{{ error }}</p>

          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrGameMode') }}</p>
          <div class="mt-2 grid grid-cols-3 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="mode === 'single' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setMode('single')">
              {{ t('modeSingle') }}
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="mode === 'endless' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setMode('endless')">
              {{ t('modeEndless') }}
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="mode === 'free' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setMode('free')">
              {{ t('modeFree') }}
            </button>
          </div>

          <template v-if="isBidi">
          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrDirection') }}</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="wordDirection === 'spell' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setWordDirection('spell')">
              {{ dirLabelAsis }}
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="wordDirection === 'meaning' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setWordDirection('meaning')">
              {{ dirLabelReverse }}
            </button>
          </div>
          </template>

          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrSolveMode') }}</p>
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
          <p class="mt-2 text-sm text-[var(--muted)]">{{ solveModeDesc }}</p>

          <template v-if="swapEnabled">
          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrNearbySwap') }}</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="adjacentSwap ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setAdjacentSwap(true)">
              {{ t('on') }}
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="!adjacentSwap ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setAdjacentSwap(false)">
              {{ t('off') }}
            </button>
          </div>
          <p class="mt-2 text-sm text-[var(--muted)]">{{ t('nearbySwapDesc') }}</p>
          </template>

          <template v-if="solveMode === 'collect' && continuous">
          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrChainClear') }}</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="autoChain ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setAutoChain(true)">
              {{ t('on') }}
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="!autoChain ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setAutoChain(false)">
              {{ t('off') }}
            </button>
          </div>
          <p class="mt-2 text-sm text-[var(--muted)]">{{ t('chainClearDesc') }}</p>
          </template>

          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrAnswer') }}</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="showAnswer ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setShowAnswer(true)">
              {{ t('on') }}
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="!showAnswer ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setShowAnswer(false)">
              {{ t('off') }}
            </button>
          </div>
          <p class="mt-2 text-sm text-[var(--muted)]">{{ t('answerDesc') }}</p>

          </template>

          <template v-if="gameKind === 'numbers'">
          <p class="mt-5 text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrMergeMode') }}</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button class="h-11 rounded-md border text-sm font-black" :class="mergeMode === 'swap' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setMergeMode('swap')">
              {{ t('mergeSwap') }}
            </button>
            <button class="h-11 rounded-md border text-sm font-black" :class="mergeMode === 'add' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--panel-strong)]'" type="button" @click="setMergeMode('add')">
              {{ t('mergeAdd') }}
            </button>
          </div>
          <p class="mt-2 text-sm text-[var(--muted)]">{{ mergeMode === 'add' ? t('mergeAddDesc') : t('mergeSwapDesc') }}</p>
          </template>

          <div class="mt-5">
            <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrBoardSize') }}</p>
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
            <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrBlockDesign') }}</p>
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

          <hr class="mt-6 mb-4" />
          <button
            class="h-11 w-full rounded-md border border-rose-500/60 bg-[var(--panel-strong)] text-sm font-black text-rose-500"
            type="button"
            @click="showClearDataConfirm = true"
          >
            {{ t('btnClearData') }}
          </button>

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
                :title="t('titleHint')"
                :aria-label="t('titleHint')"
                @click="toggleHint"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
                  <path d="M9 18h6"/>
                  <path d="M10 22h4"/>
                </svg>
              </button>
              <button
                v-if="solveMode === 'sequence' && selectedIndexes.length"
                class="inline-flex h-10 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-sm font-black"
                type="button"
                :title="t('titleDeselect')"
                :aria-label="t('titleDeselect')"
                @click="clearSelection"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M15 9l-6 6"/>
                  <path d="M9 9l6 6"/>
                </svg>
              </button>
              <button
                v-if="canPass"
                class="h-10 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-sm font-black"
                type="button"
                @click="passCurrent"
              >
                {{ t('btnPass') }}
              </button>
            </div>
            <div v-if="gameKind === 'lesson' && mode === 'single'" class="flex items-center">
              <select
                class="h-10 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-sm font-black"
                :value="currentStage"
                @change="onStageSelect"
              >
                <option v-for="n in stageCount" :key="n" :value="n">{{ n }} {{ t('stageWord') }}{{ (clearedStages[selectedLevel] || []).includes(n) ? ' ✅' : '' }}</option>
              </select>
            </div>
            <div class="flex gap-2">
              <button
                class="inline-flex h-10 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 font-black"
                type="button"
                :title="t('titleNewBoard')"
                :aria-label="t('titleNewBoard')"
                @click="requestNewBoard"
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
                {{ gameFullscreen ? t('fullscreenExit') : '⛶' }}
              </button>
              <button
                class="inline-flex h-10 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 font-black lg:hidden"
                type="button"
                :title="t('titleExit')"
                :aria-label="t('titleExit')"
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
              <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('statScore') }} <strong class="text-base">{{ score }}</strong></p>
              <div class="flex items-center gap-3">
                <div v-if="gameKind === 'lesson' && mode === 'free'" class="flex flex-col items-end leading-tight">
                  <span class="text-[10px] font-bold uppercase text-[var(--muted)]">{{ activePack?.title }} · {{ modeLabel }}</span>
                  <span class="text-sm font-black text-[var(--accent)]">{{ matchedCount }} / {{ clearedBlocks }}</span>
                </div>
                <div v-if="showProgress" class="flex flex-col items-end leading-tight">
                  <span class="text-[10px] font-bold uppercase text-[var(--muted)]">{{ activePack?.title }} · {{ modeLabel }} · {{ levelLabel(mode === 'endless' ? endlessCurrentLevel : selectedLevel) }} · {{ t('stageWord') }} {{ displayStage }}/{{ mode === 'endless' ? endlessStageCount : stageCount }}</span>
                  <span class="text-sm font-black text-[var(--accent)]">{{ levelProgress.current }} / {{ levelProgress.total }}</span>
                </div>
              </div>
            </div>
            <p class="mt-3 text-xs font-bold uppercase text-[var(--muted)]">{{ t('hdrCurrentGoal') }}</p>
            <template v-if="gameKind === 'lesson' && continuous">
              <div
                v-if="endlessTicker.length"
                ref="goalScrollEl"
                class="goal-scroll mt-1"
                @pointerdown="goalDragStart"
                @pointermove="goalDragMove"
                @pointerup="goalDragEnd"
                @pointercancel="goalDragEnd"
                @pointerleave="goalDragEnd"
                @wheel.passive="pauseGoalMarquee"
                @touchstart.passive="pauseGoalMarquee"
              >
                <span class="goal-prompt text-3xl font-black sm:text-4xl">{{ endlessTicker.join('       ·       ') }}</span>
              </div>
              <p v-else class="mt-1 text-2xl font-black sm:text-3xl">{{ t('boardAnswerHere') }}</p>
            </template>
            <template v-else>
              <div
                ref="goalScrollEl"
                class="goal-scroll mt-1"
                @pointerdown="goalDragStart"
                @pointermove="goalDragMove"
                @pointerup="goalDragEnd"
                @pointercancel="goalDragEnd"
                @pointerleave="goalDragEnd"
                @wheel.passive="pauseGoalMarquee"
                @touchstart.passive="pauseGoalMarquee"
              >
                <span class="goal-prompt text-3xl font-black sm:text-4xl">{{ goalPrompt }}</span>
              </div>
              <p v-if="goalVars" class="truncate text-xs text-[var(--muted)]">{{ goalVars }}</p>
            </template>
            <div v-if="hintText" class="hint-overlay">
              <p>💡 {{ hintText }}</p>
            </div>
          </div>

          <div class="mb-3 flex flex-wrap items-center justify-between gap-3 lg:flex max-lg:hidden">
            <div>
              <p class="text-sm font-bold text-[var(--muted)]">{{ message }}</p>
              <p class="text-xs text-[var(--muted)]">{{ t('selectedLabel') }}: {{ selectedText || '-' }}</p>
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
            class="board-grid grid gap-2"
            :class="{
              'is-swapping': motionPhase === 'swap',
              'is-falling': motionPhase === 'fall',
              'numbers-board': gameKind === 'numbers',
            }"
            :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, aspectRatio: boardAspect, '--board-ar': boardAspectNum, '--cell-w': `${cellW}px`, '--cell-h': `${cellH}px` }"
          >
            <button
              v-for="(block, index) in board"
              :key="block.id"
              class="block-face border-2 p-1 text-center focus:outline-none disabled:cursor-wait"
              :class="[
                wideBlocks ? 'aspect-[3/2]' : 'aspect-square',
                `block-style-${blockStyle}`,
                selectedIndexes.includes(index) ? 'block-selected' : 'border-white/70',
                hintIndexes.includes(index) ? 'block-hint' : '',
                draggedIndex === index ? 'opacity-60' : '',
                block.power ? 'has-power' : '',
              ]"
              :style="[{ backgroundColor: block.color, '--block-color': block.color, '--drop': block.dropFrom ?? 1 }, gatherStyles.get(index)]"
              type="button"
              :data-cell="index"
              :disabled="isResolving"
              @pointerdown="onBlockPointerDown(index, $event)"
            >
              <span class="block-label flex h-full w-full items-center justify-center font-black" :style="{ '--len': [...block.token].length }">
                {{ block.token }}
              </span>
              <span v-if="block.adds && mergeMode === 'add'" class="block-cracks" :data-adds="block.adds" :style="{ '--crack-a': `${crackAngle(block.id)}deg` }" aria-hidden="true"></span>
            </button>
          </TransitionGroup>
          </div>

          <div
            v-if="gameKind === 'numbers' && gameOver"
            class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/60 px-4 text-center backdrop-blur-sm"
          >
            <p class="text-4xl font-black text-white">{{ t('gameOverWord') }}</p>
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
          <div class="grid grid-cols-2 gap-2">
            <!-- 좌측: 현재 점수 카드들 -->
            <div class="space-y-2">
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('statScore') }}</p>
                <p class="mt-1 text-2xl font-black">{{ score }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('statBest') }}</p>
                <p class="mt-1 text-2xl font-black">{{ best }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('statCombo') }}</p>
                <p class="mt-1 text-2xl font-black">x{{ combo }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ gameKind === 'numbers' ? t('statMaxNumber') : t('statMoves') }}</p>
                <p class="mt-1 text-2xl font-black">{{ gameKind === 'numbers' ? formatValue(maxValue) : moves }}</p>
              </div>
              <div v-if="canPass" class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('statPass') }}</p>
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
                  {{ levelLabel(level) }}{{ isLevelCleared(level) ? ' ✓' : '' }} · {{ t('stageWord') }} {{ (clearedStages[level]?.length || 0) }}/{{ level }}
                </p>
                <p class="mt-1 text-2xl font-black">{{ levelStats[level]?.score || 0 }}</p>
              </div>
            </div>
            <!-- 우측: 숫자 더하기 누적 통계 -->
            <div v-else-if="gameKind === 'numbers'" class="space-y-2">
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('cumScore') }}</p>
                <p class="mt-1 text-2xl font-black">{{ numStats.total }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('cumBestMax') }}</p>
                <p class="mt-1 text-2xl font-black">{{ formatValue(numStats.bestMax) }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('cumBestCombo') }}</p>
                <p class="mt-1 text-2xl font-black">x{{ numStats.bestCombo }}</p>
              </div>
              <div class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('cumMerges') }}</p>
                <p class="mt-1 text-2xl font-black">{{ numStats.merges }}</p>
              </div>
              <div v-if="mergeMode === 'add'" class="flex h-20 flex-col justify-center rounded-md bg-[var(--panel-strong)] p-3">
                <p class="text-xs font-bold uppercase text-[var(--muted)]">{{ t('cumBreaks') }}</p>
                <p class="mt-1 text-2xl font-black">{{ numStats.breaks }}</p>
              </div>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-[2fr_1fr_1fr] gap-2">
            <button class="h-12 rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="createShareImage">
              {{ t('btnShareScore') }}
            </button>
            <button class="inline-flex h-12 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] font-black" type="button" :title="t('btnResetScore')" :aria-label="t('btnResetScore')" @click="showResetScoreConfirm = true">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            </button>
            <a href="https://www.buymeacoffee.com/typ0s2d10" target="_blank" rel="noopener" class="inline-flex h-12 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-xl" :title="t('btnCoffee')" :aria-label="t('btnCoffee')">
              ☕
            </a>
          </div>
          <div v-if="gameKind === 'numbers'" class="mt-5">
            <h3 class="text-sm font-black text-[var(--muted)]">{{ t('howToPlay') }}</h3>
            <ul v-if="mergeMode === 'add'" class="mt-2 space-y-2 text-sm text-[var(--muted)]">
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">{{ t('numRuleAdd1') }}</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">{{ t('numRuleAdd2') }}</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">{{ t('numRuleAdd3') }}</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">{{ t('numRuleAdd4') }}</li>
            </ul>
            <ul v-else class="mt-2 space-y-2 text-sm text-[var(--muted)]">
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">{{ t('numRule1') }}</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">{{ t('numRule2') }}</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">{{ t('numRule3') }}</li>
              <li class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] p-3">{{ t('numRule4') }}</li>
            </ul>
          </div>
          <div v-else class="mt-5">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-black text-[var(--muted)]">{{ t('sampleHdr') }}</h3>
              <button
                class="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-base"
                type="button"
                :title="t('titleOtherItems')"
                :aria-label="t('titleOtherItems')"
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
        <a href="https://github.com/TypoStudio/matchit" target="_blank" rel="noopener" aria-label="GitHub">
          <img src="https://img.shields.io/badge/GitHub-TypoStudio%2Fmatchit-181717?logo=github&logoColor=white" alt="GitHub" class="h-5" loading="lazy" />
        </a>
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
        <span class="block-label flex h-full w-full items-center justify-center font-black" :style="{ '--len': [...dragGhost.token].length }">{{ dragGhost.token }}</span>
      </div>
    </div>

    <Transition name="answer-fade">
    <div
      v-if="answerItem"
      class="answer-popup"
      :class="continuous
        ? 'fixed inset-x-0 top-[4.4rem] z-40 flex justify-center px-3 pointer-events-none'
        : 'fixed inset-0 z-40 flex items-center justify-center bg-black/55 px-6'"
      @pointerdown="!continuous ? holdAnswer() : null"
      @pointerup="!continuous ? releaseAnswer() : null"
      @pointercancel="!continuous ? releaseAnswer() : null"
    >
      <div ref="answerEl" :class="['rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl', continuous ? 'flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-2 px-3 py-2' : 'p-6 text-center']">
        <p v-if="!continuous" class="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{{ t('answerLabel') }}</p>
        <p :class="continuous ? 'text-lg font-black whitespace-nowrap' : 'mt-1 text-2xl font-black'">{{ answerItem.label }}</p>
        <p v-if="!continuous" class="text-sm text-[var(--muted)]">{{ answerItem.prompt }}</p>
        <div :class="continuous ? 'flex gap-1.5' : 'mt-4 flex flex-wrap justify-center gap-2'">
          <span
            v-for="(token, i) in answerItem.tokens"
            :key="i"
            class="answer-slot block-face grid place-items-center font-black text-white"
            :class="`block-style-${blockStyle}`"
            :style="{ width: `${answerSlotSize}px`, height: `${wideBlocks ? Math.round(answerSlotSize / 1.5) : answerSlotSize}px`, backgroundColor: answerSlotColors[i] ?? colorForToken(token), '--block-color': answerSlotColors[i] ?? colorForToken(token), '--cell-w': `${answerSlotSize}px`, '--cell-h': `${wideBlocks ? Math.round(answerSlotSize / 1.5) : answerSlotSize}px` }"
          >
            <span class="block-label flex h-full w-full items-center justify-center" :style="{ '--len': [...token].length }">{{ token }}</span>
          </span>
        </div>
        <p v-if="answerItem.hint" :class="continuous ? 'w-full truncate text-center text-sm font-bold text-[var(--accent)]' : 'mt-4 text-sm font-bold text-[var(--accent)]'">💡 {{ answerItem.hint }}</p>
        <p v-if="!continuous" class="mt-3 text-xs text-[var(--muted)]">{{ t('answerHelp') }}</p>
      </div>
    </div>
    </Transition>

    <div
      v-if="showStageClear"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
    >
      <div class="level-clear-pop w-full max-w-xs rounded-2xl border border-[var(--accent)] bg-[var(--panel)] p-6 text-center shadow-2xl">
        <p class="text-5xl">🎉</p>
        <p class="mt-2 text-2xl font-black text-[var(--accent)]">{{ t('stageClearTitle') }}</p>
        <p class="mt-1 text-sm font-bold">{{ levelLabel(stageClearInfo.level) }} · {{ t('stageWord') }} {{ stageClearInfo.stage }} {{ t('doneSuffix') }}</p>
        <div class="mt-5 grid gap-2" :class="stageClearInfo.hasNext ? 'grid-cols-2' : 'grid-cols-1'">
          <button class="h-11 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="showStageClear = false">
            {{ t('btnContinue') }}
          </button>
          <button v-if="stageClearInfo.hasNext" class="h-11 rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="goNextStageAfterClear">
            {{ t('btnNext') }}
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
        <p class="text-lg font-black">{{ t('exitTitle') }}</p>
        <p class="mt-1 text-sm text-[var(--muted)]">{{ saveOnExit ? t('exitSaveYes') : t('exitSaveNo') }}</p>
        <label class="mt-3 flex items-center justify-center gap-2 text-sm font-bold">
          <input type="checkbox" v-model="saveOnExit" class="h-4 w-4 accent-[var(--accent)]" />
          {{ t('exitSaveLabel') }}
        </label>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="cancelExit">
            {{ t('btnCancel') }}
          </button>
          <button class="h-11 rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="confirmExit">
            {{ t('btnExit') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showNewBoardConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
      @click.self="cancelNewBoard"
    >
      <div class="w-full max-w-xs rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 text-center">
        <p class="text-lg font-black">{{ t('newBoardTitle') }}</p>
        <p class="mt-1 text-sm text-[var(--muted)]">{{ t('newBoardBody') }}</p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="cancelNewBoard">
            {{ t('btnCancel') }}
          </button>
          <button class="h-11 rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="confirmNewBoard">
            {{ t('btnNewBoard') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showResetScoreConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
      @click.self="showResetScoreConfirm = false"
    >
      <div class="w-full max-w-xs rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 text-center">
        <p class="text-lg font-black">{{ t('resetTitle') }}</p>
        <p class="mt-1 text-sm text-[var(--muted)]">{{ t('resetBody') }}</p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="showResetScoreConfirm = false">
            {{ t('btnCancel') }}
          </button>
          <button class="h-11 rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="resetScore(); showResetScoreConfirm = false">
            {{ t('btnReset') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showClearDataConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
      @click.self="showClearDataConfirm = false"
    >
      <div class="w-full max-w-xs rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 text-center">
        <p class="text-lg font-black">{{ t('clearTitle') }}</p>
        <p class="mt-1 text-sm text-[var(--muted)]">{{ t('clearBody') }}</p>
        <div class="mt-4 grid grid-cols-2 gap-2">
          <button class="h-11 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="showClearDataConfirm = false">
            {{ t('btnCancel') }}
          </button>
          <button class="h-11 rounded-md bg-rose-500 text-sm font-black text-white" type="button" @click="clearLocalData">
            {{ t('btnDelete') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showPackManager"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
      @click.self="showPackManager = false"
    >
      <div class="w-full max-w-md rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5">
        <p class="text-lg font-black">{{ t('packMgrTitle') }}</p>
        <p class="mt-1 text-sm text-[var(--muted)]">{{ t('packMgrDesc') }}</p>
        <button
          v-if="!extraPacks.includes(FRUIT_PACK_URL)"
          class="mt-3 h-8 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-xs font-black"
          type="button"
          @click="addFruitPack"
        >
          {{ t('btnAddFruit') }}
        </button>
        <div class="mt-3 flex gap-2">
          <input
            v-model="newPackUrl"
            placeholder="https://.../pack.json"
            class="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 text-sm"
            @keydown.enter="addExtraPack"
          />
          <button class="h-11 rounded-md bg-[var(--accent)] px-4 text-sm font-black text-[var(--accent-ink)]" type="button" @click="addExtraPack">
            {{ t('btnAdd') }}
          </button>
        </div>
        <p v-if="packMgrError" class="mt-2 text-sm font-semibold text-rose-600">{{ packMgrError }}</p>
        <ul v-if="extraPacks.length" class="mt-3 max-h-56 space-y-1 overflow-y-auto">
          <li v-for="url in extraPacks" :key="url" class="flex items-center gap-2 rounded-md bg-[var(--panel-strong)] px-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-black">{{ extraPackNames[url] || '…' }}</p>
              <p class="truncate text-[10px] text-[var(--muted)]">{{ url }}</p>
            </div>
            <button class="shrink-0 rounded px-2 text-sm font-black text-rose-500" type="button" :title="t('titleRemove')" @click="removeExtraPack(url)">
              ✕
            </button>
          </li>
        </ul>
        <p v-else class="mt-3 text-sm text-[var(--muted)]">{{ t('noExtraPacks') }}</p>
        <button class="mt-4 h-11 w-full rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-sm font-black" type="button" @click="showPackManager = false">
          {{ t('btnClose') }}
        </button>
      </div>
    </div>

    <div
      v-if="shareUrl"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      @click.self="shareUrl = ''"
    >
      <div class="flex w-full max-w-sm flex-col items-center gap-3">
        <img :src="shareUrl" :alt="t('shareAlt')" class="w-full rounded-xl border border-white/20 shadow-2xl" />
        <p class="text-center text-sm font-bold text-white/90">{{ t('shareHelp') }}</p>
        <button class="h-11 w-full max-w-[12rem] rounded-md bg-[var(--accent)] text-sm font-black text-[var(--accent-ink)]" type="button" @click="shareUrl = ''">
          {{ t('btnClose') }}
        </button>
      </div>
    </div>
  </main>
</template>
