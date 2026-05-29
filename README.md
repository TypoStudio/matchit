# Match It

학습 개념을 블럭 퍼즐 규칙으로 맞추는 Vue 3 + TypeScript + Tailwind CSS 정적 게임입니다.

## 기능

- **출제 모드**: 한문제씩 / 연속 / 자유, 순서 선택·줄맞춤·모으기 풀이 방식
- **학습팩 카탈로그**: 시작 시 별도 저장소([matchit-packs](https://github.com/TypoStudio/matchit-packs))의 `packs.json` 목록을 불러옴 (한자·영어단어·영문법·국어·과학·수학·역사 등)
- **출제 방향(양방향)**: 단어팩(뜻↔철자)·한자(한자↔훈음) 등 메타가 허용한 팩에서 방향 토글
- **무작위 출제 순서**: 레벨 문제를 무작위로 섞고, 그 순서를 기기에 저장해 재시작 시 복원
- **팩별 화면 구성**: 메타로 보드 사이즈·블럭 디자인·넓은 블럭을 팩마다 지정(하드코딩 없음)
- **추가팩 관리**: 사용자가 외부 팩 URL을 추가/삭제(목록은 기기에만 저장)
- **로컬 데이터 삭제**: 진행도·순서·설정을 한 번에 초기화
- 테마 전환, 점수 이미지(PNG) 공유

## 실행 / 빌드

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5174)
npm run build    # dist/ 정적 산출물
```

`dist`를 GitHub Pages 등 정적 호스팅에 올립니다. 배포 시 base는 `/matchit/`(프로덕션), 개발 시 `/`.

## 학습팩 로딩 구조

학습팩은 게임 본체와 분리된 **[matchit-packs](https://github.com/TypoStudio/matchit-packs)** 저장소에서 서빙됩니다.

- 기본 카탈로그 URL: 프로덕션은 `https://typostudio.github.io/matchit-packs/packs.json`, 로컬 개발은 같은 저장소의 `packs/packs.json`([src/App.vue](src/App.vue)의 `PACK_CATALOG_URL`).
- 화면의 **추가팩 관리**에서 다른 팩/카탈로그 JSON URL을 더할 수 있고, 그 목록은 `localStorage`(`matchit-extra-packs`)에만 저장됩니다.
- 표시 순서: **추가팩 → 기본팩**, 각 그룹 이름 가나다순.

### 카탈로그 `packs.json`

이름·URL·레벨수만 가지는 포인터 목록입니다.

```json
[
  { "name": "한자능력시험", "url": "language/hanja-grade/pack.json", "levels": 16 }
]
```

### 개별 팩 `pack.json`

**단일 파일형**(모든 레벨 인라인) 또는 **메타 + 레벨파일형**(각 레벨이 외부 파일 참조) 둘 다 인식합니다.

```jsonc
// 메타 + 레벨파일형: levels는 {level, label, file} 객체 배열
{ "id": "hanja-grade", "title": "한자능력시험", "accent": "#dc2626",
  "bidirectional": true,
  "directions": { "asis": "한자 → 훈음", "reverse": "훈음 → 한자" },
  "board": { "cols": 5, "rows": 5 },
  "blockStyle": "card",
  "levels": [ { "level": 1, "label": "8급", "file": "./1.json" } ] }
```

레벨 파일(`{level}.json`)은 문항(`LessonItem`) 배열입니다.

```json
[
  { "id": "water", "label": "물", "prompt": "물 만들기", "tokens": ["H","H","O"], "hint": "H2O" }
]
```

### 팩 메타 필드

| 필드 | 설명 |
| --- | --- |
| `id` / `title` / `accent` | 식별자 / 표시 이름 / 강조색 |
| `format` | `"word"`(단어팩 `word`/`meaning`/`hint`) 또는 `"lesson"`(LessonItem). 생략 시 자동 판별 |
| `bidirectional` | `true`면 출제 방향 토글 노출. lesson 팩 역방향은 답↔문제를 뒤집음. 단어팩은 자동 양방향 |
| `directions` | 방향 버튼 라벨 `{ "asis": "...", "reverse": "..." }`(lesson 양방향용) |
| `board` | 기본 보드 사이즈 `{ "cols": n, "rows": n }`(미지정 7×7). 모으기 모드는 토큰 길이 ≤ 보드 한 변 |
| `wide` | `true`면 가로로 긴 블럭(토큰이 긴 팩) |
| `blockStyle` | 기본 블럭 디자인 `jelly`/`card`/`tile`/`transparent` |
| `random` | `true`면 보드를 정답 유도 없이 완전 무작위로 채움(모으기형) |
| `levels` | `[{level,label,items}]`(단일 파일) 또는 `[{level,label,file}]`(레벨파일) |

> 팩 작성·배포 상세와 폴더 구성은 [matchit-packs/README.md](packs/README.md)를 참고하세요. 새 팩/한자 데이터 생성 스크립트는 [scripts/](scripts/)에 있습니다.

## 데이터 생성 스크립트

- [scripts/build-hanja-pack.py](scripts/build-hanja-pack.py) — 한국어문회 배정한자 `.xls` → 급수별 한자 팩(레벨=급수, 라벨=급수명, 힌트=뜻·음).
- [scripts/classify-math.py](scripts/classify-math.py) — 수학 공식을 교육과정 과목별(중등·공통수학·수학Ⅰ·수학Ⅱ·미적분·기하·확률과통계)로 재분류.
