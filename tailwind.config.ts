import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Pretendard', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        block: '0 12px 24px rgba(40, 35, 28, 0.14)',
      },
    },
  },
  plugins: [],
} satisfies Config;
