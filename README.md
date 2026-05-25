# Match It

학습 개념을 블럭 퍼즐 규칙으로 맞추는 Vue 3 + TypeScript + Tailwind CSS 정적 게임 프로토타입입니다.

## 기능

- 순서 선택 모드: 목표식이나 문장 구조에 맞춰 블럭을 순서대로 눌러 제거
- 줄맞춤 모드: 이웃 블럭을 교환해 같은 개념 3개 이상을 가로/세로로 맞춰 제거
- JSON 학습팩 로딩: 기본값은 `public/data/lesson-packs.json`, 화면에서 원격 URL로 교체 가능
- 테마 전환: Paper, Night, Lab
- 점수 이미지 생성: 캔버스로 공유용 PNG 생성

## 실행

```bash
npm install
npm run dev
```

## 빌드

```bash
npm run build
```

`dist` 폴더를 GitHub Pages, Cloudflare Pages, Netlify 같은 정적 호스팅에 올리면 됩니다.

## 데이터팩 스키마

```json
{
  "packs": [
    {
      "id": "science-core",
      "title": "과학 기초",
      "accent": "#14b8a6",
      "items": [
        {
          "id": "water",
          "label": "물",
          "prompt": "H2O 만들기",
          "tokens": ["H", "H", "O"],
          "hint": "수소 2개와 산소 1개"
        }
      ]
    }
  ]
}
```

원격 JSON을 쓸 때는 정적 파일 URL이 CORS를 허용해야 합니다.
