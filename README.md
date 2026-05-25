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

데이터는 **마스터 파일 + 레벨별 파일** 두 단계로 구성됩니다.

### 1. 마스터 파일 `public/data/lesson-packs.json`

각 팩의 메타데이터와 사용 가능한 **레벨 목록**만 담습니다 (문항은 포함하지 않음).

```json
[
  {
    "id": "science-core",
    "title": "화학식",
    "accent": "#14b8a6",
    "levels": [1, 2, 3, 4, 5]
  }
]
```

### 2. 레벨 파일 `public/data/packs/{pack-id}/{level}.json`

해당 팩·레벨의 문항(`LessonItem`) 배열입니다. 레벨이 올라갈수록 난이도가 높아집니다.

```json
[
  {
    "id": "water",
    "label": "물",
    "prompt": "물 만들기",
    "tokens": ["H", "H", "O"],
    "hint": "H2O — 수소 2개와 산소 1개"
  }
]
```

| 필드 | 설명 |
| --- | --- |
| `id` | 팩 안에서 고유한 식별자 (ascii kebab-case) |
| `label` | 문항 이름 (예: `물`) |
| `prompt` | 화면에 보여줄 문제 (예: `물 만들기`) |
| `tokens` | 정답을 이루는 블럭 토큰 배열 (예: `["H","H","O"]`) |
| `hint` | 힌트 |

- 화면의 **JSON URL** 입력으로 마스터 파일을 원격 주소로 교체할 수 있습니다. 원격 JSON은 정적 파일 URL이 CORS를 허용해야 합니다.
- 한 레벨 파일은 100문항 규모이며, 새 팩·레벨 추가 방법은 `AGENT_GUIDE.md`를 참고하세요.
