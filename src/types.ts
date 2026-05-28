export type SolveMode = 'sequence' | 'collect';
export type GameMode = 'single' | 'endless' | 'free';
export type GameKind = 'lesson' | 'synthesis' | 'numbers';
export type ThemeName = 'paper' | 'midnight' | 'lab';
export type BlockStyleName = 'jelly' | 'card' | 'tile' | 'transparent';

export interface LessonItem {
  id: string;
  label: string;
  prompt: string;
  tokens: string[];
  hint: string;
  name?: string; // 공식/항목 이름 (문제 앞에 표시)
  vars?: string; // 변수 설명 (작은 글씨)
}

export interface LessonPack {
  id: string;
  title: string;
  accent: string;
  levels: number[];
  base?: string; // 외부 호스팅 시 레벨 파일 기준 URL (예: https://user.github.io/repo/my-pack/)
  format?: 'word' | 'lesson'; // 외부 팩의 문항 형식 (생략 시 id 규칙·문항 키로 자동 판별)
  random?: boolean; // true면 보드/낙하 블럭을 정답 유도 없이 완전 무작위로 채움(과일 모으기 등)
}

// 통합 팩 파일: 메타데이터 + 모든 레벨 문항을 한 파일에 담는 형식
export interface BundledPack {
  id: string;
  title: string;
  accent?: string;
  format?: 'word' | 'lesson';
  base?: string;
  random?: boolean;
  levels: number[] | Array<{ level: number; items: unknown[] }>;
}

export type PowerKind = 'row' | 'col' | 'area' | 'all'; // 가로줄/세로줄/3x3영역/동색전체 제거 폭탄

export interface Block {
  id: string;
  token: string;
  lessonId: string;
  label: string;
  color: string;
  locked?: boolean;
  value?: number;
  dropFrom?: number;
  power?: PowerKind; // 자유모드 모으기에서 생성되는 특수블럭
}
