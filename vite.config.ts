import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 프로덕션(빌드)만 GitHub Pages 프로젝트 페이지(/matchit/) 기준 경로.
// dev 서버는 루트(/) 기준 — 루트의 /packs/(별도 레포) 기본 학습팩을 그대로 불러오기 위함.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/matchit/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [vue()],
}));
