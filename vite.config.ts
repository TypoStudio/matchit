import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages 프로젝트 사이트(/matchit/) 기준. 개발 시엔 '/'.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/matchit/' : '/',
  plugins: [vue()],
});
