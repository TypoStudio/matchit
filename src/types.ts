export type SolveMode = 'sequence' | 'collect';
export type GameMode = 'single' | 'endless';
export type GameKind = 'lesson' | 'synthesis' | 'numbers';
export type ThemeName = 'paper' | 'midnight' | 'lab';
export type BlockStyleName = 'jelly' | 'card' | 'tile' | 'neon';

export interface LessonItem {
  id: string;
  label: string;
  prompt: string;
  tokens: string[];
  hint: string;
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
