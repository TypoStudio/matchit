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

## 외부 저장소 / 단일 파일로 팩 올리기

화면의 **JSON URL** 입력칸은 위 마스터 파일 외에도 아래 3가지 형태를 모두 자동 인식합니다. 이 저장소를 건드리지 않고 **별도 저장소·CDN**에 팩을 올려 불러올 수 있습니다.

### 형태 1 — 통합 단일 파일 (메타 + 모든 레벨을 한 파일에)

`levels`를 `{ level, items }` 배열로 주면 문항을 같은 파일에 인라인으로 담습니다. 레벨별 파일을 따로 만들 필요가 없습니다.

```json
{
  "id": "my-vocab",
  "title": "내 단어장",
  "accent": "#0ea5e9",
  "format": "word",
  "levels": [
    { "level": 1, "items": [
      { "word": "go", "meaning": "가다", "hint": "동작" },
      { "word": "run", "meaning": "달리다" }
    ] },
    { "level": 2, "items": [ { "word": "eat", "meaning": "먹다" } ] }
  ]
}
```

### 형태 2 — 여러 팩 목록 (외부 base 참조)

팩 배열을 주되, 각 팩에 `base`(레벨 파일 기준 URL)를 지정하면 레벨 파일을 외부에서 읽어옵니다. `base + {level}.json` 로 요청합니다.

```json
[
  {
    "id": "my-vocab",
    "title": "내 단어장",
    "accent": "#0ea5e9",
    "format": "word",
    "base": "https://USER.github.io/REPO/my-vocab/",
    "levels": [1, 2, 3]
  }
]
```
→ 레벨 1은 `https://USER.github.io/REPO/my-vocab/1.json` 에서 로드됩니다. `levels`를 형태 1처럼 `{level,items}` 배열로 줘서 인라인으로 섞어도 됩니다.

### 형태 3 — 문항 배열만 직접 지정

URL이 문항 배열(`[{word,meaning}, ...]` 또는 `LessonItem` 배열)을 직접 가리키면, 1레벨짜리 임시 팩으로 자동 래핑되어 바로 플레이됩니다.

```json
[
  { "word": "go", "meaning": "가다", "hint": "동작" },
  { "word": "run", "meaning": "달리다" }
]
```

### 필드

| 필드 | 위치 | 설명 |
| --- | --- | --- |
| `id` | 팩 | 고유 식별자 (ascii kebab-case) |
| `title` | 팩 | 화면에 표시할 팩 이름 |
| `accent` | 팩 | 강조색 (생략 시 기본값) |
| `format` | 팩 | `"word"`(단어팩: `word`/`meaning`/`hint`) 또는 `"lesson"`(LessonItem). 생략 시 문항 키로 자동 판별 |
| `base` | 팩 | 레벨 파일을 외부에서 읽을 때의 기준 URL (끝에 `/` 포함). 생략 시 인라인 또는 이 저장소의 `data/packs/{id}/` |
| `random` | 팩 | `true`면 보드/낙하 블럭을 정답 유도 없이 완전 무작위로 채움(같은 토큰을 모으는 매치형 팩에 적합) |
| `levels` | 팩 | 숫자 배열(`[1,2,3]`=파일 참조) 또는 `[{level,items}]`(인라인) |

### 호스팅 (별도 저장소)

브라우저 `fetch` 가 되려면 **CORS 허용 + JSON 직접 서빙**이 필요합니다. 권장 순서:

- **별도 GitHub Pages** (권장): 저장소를 Pages로 배포하면 `https://USER.github.io/REPO/packs.json`. CORS 허용·무료.
- **Cloudflare Pages / Netlify** 등 정적 호스팅: 모두 가능.
- **raw.githubusercontent.com** / **GitHub Gist raw**: CORS 허용됨. 단 캐시 갱신이 느릴 수 있음.
- ⚠️ **GitHub Wiki는 부적합** — 페이지가 HTML로 렌더링되고 raw JSON을 CORS·`application/json`으로 서빙하지 않습니다.
