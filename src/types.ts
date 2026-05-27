export type SolveMode = 'sequence' | 'collect';
export type GameMode = 'single' | 'endless' | 'free';
export type GameKind = 'lesson' | 'synthesis' | 'numbers';
export type ThemeName = 'paper' | 'midnight' | 'lab';
export type BlockStyleName = 'jelly' | 'card' | 'tile' | 'neon';

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
}

export interface Block {
  id: string;
  token: string;
  lessonId: string;
  label: string;
  color: string;
  locked?: boolean;
  value?: number;
  dropFrom?: number;
}
