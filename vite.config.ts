import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// GitHub Pages 프로젝트 사이트(/matchit/) 기준. 개발 시엔 '/'.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/matchit/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [vue()],
});
