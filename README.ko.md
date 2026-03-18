<div align="center">

# webpty

**공유 프로필/테마 설정을 사용하는 Rust 기반 브라우저 터미널 셸**

[English README](./README.md)

</div>

`webpty`는 셸이 화면의 주인공이 되도록 설계되어 있습니다.
터미널은 검은색으로 화면 대부분을 차지하고, 우측에는 얇고 밝은 세션 레일이
붙어 있으며, 설정 패널은 그 레일에서 바로 열립니다. 실행 경로는 Rust 단일
바이너리이고 `webpty up` 한 번으로 UI와 PTY 런타임을 함께 올립니다.

프로필, 테마, 색상표, 액션, 기본값은 공유 가능한 데스크톱 터미널용
`settings.json` 형태를 사용합니다. 저장 시 알 수 없는 키는 그대로
보존되고, 디스크에서 읽을 때는 JSONC 스타일 주석과 trailing comma도
허용합니다.

## 미리보기

![webpty preview](./docs/assets/webpty-preview.png)

![webpty settings panel](./docs/assets/webpty-studio.png)

## 현재 상태

구현됨:

- Rust/Axum 서버 기반 PTY 세션 생성과 WebSocket 스트리밍
- Rust 바이너리에서 직접 서빙되는 임베디드 프로덕션 UI
- `webpty up` CLI 진입점
- `webpty up --funnel` 외부 접속용 Tailscale Funnel
- 상단 툴바 없이 검은 터미널 스테이지가 중심인 레이아웃
- show/hide 가능한 우측 세션 레일
- 흰색 플랫 탭과 섹션형 우측 고정 설정 드로어
- schema 호환 `settings.json` 로드, 정규화, 저장, 미지원 키 round-trip 보존
- 디스크 기준 JSONC 스타일 설정 파일 로딩
- 앱 내 `settings.json` 패널에서 JSONC 스타일 편집 지원
- `{ "command": { "action": "newTab" } }` 같은 문자열/객체형 액션 바인딩 지원
- 비Windows fallback에서도 `bash-5.2$` 대신 프로필별 문구가 드러나는 프롬프트
- 활성 탭 안에서 수직/수평 split 생성
- PTY 입력, 리사이즈, 출력 스트림 처리
- 브라우저에서 접근 가능한 프로필 아이콘 소스를 레일과 설정 패널에 렌더링

알려진 공백:

- 더 깊은 pane graph, 드래그 재배치, 영속 pane 레이아웃
- 탭 드래그 정렬
- 현재 탭/설정 subset을 넘는 더 넓은 action object 지원
- 모든 프로필 아이콘 URI 형식에 대한 완전한 호스트 자산 파리티
- 앱 재시작 후 세션 복원

## 빠른 시작

### 요구사항

- Rust 1.94+
- Node.js 24+ / npm 11+는 프런트 번들을 다시 빌드하거나 UI를 개발할 때만 필요

### 글로벌 설치

```bash
cargo install --git https://github.com/smturtle2/webpty --bin webpty --locked
```

로컬 체크아웃 설치:

```bash
cargo install --path apps/server --bin webpty --locked
```

### 실행

```bash
webpty up
```

레포 샘플 설정으로 실행:

```bash
webpty up --settings ./config/webpty.settings.json
```

### 외부 접속

```bash
webpty up --funnel
```

`--funnel`은 로컬 `tailscale` CLI를 이용해 내장 웹 UI를 외부에 공개합니다.
먼저 `tailscale up`을 실행하고 현재 노드에 Funnel 권한이 있는지 확인해야
합니다.

## 설정 파일 위치

해석 순서:

1. `webpty up --settings <path>`
2. `WEBPTY_SETTINGS_PATH=<path>`
3. 현재 작업 디렉터리의 `./config/webpty.settings.json`이 있으면 우선 사용
4. 그 외에는 사용자 전역 경로

사용자 전역 경로:

- Linux/macOS: `~/.config/webpty/settings.json`
- Windows: `%APPDATA%\\webpty\\settings.json`

파일이 없으면 기본 설정이 생성됩니다.
기존 파일이 잘못되어 있으면 덮어쓰지 않고 에러로 종료합니다.

## 개발

워크스페이스 의존성 설치:

```bash
npm install
```

프런트 개발 서버:

```bash
npm run dev:web
```

Rust 런타임:

```bash
cargo run -- up
```

Vite 개발 서버는 `/api`와 `/ws` 요청을 `http://127.0.0.1:3001`로 프록시하고,
프로덕션 빌드는 `apps/server/ui`로 출력되어 Rust 바이너리에서 직접
서빙됩니다.

## 검증

```bash
npm run build:web
cargo test --manifest-path apps/server/Cargo.toml
cargo check
```

## 아키텍처

```text
React shell
  ├─ terminal stage
  ├─ right-side session rail
  └─ right-anchored settings drawer
       ↓
Rust runtime
  ├─ embedded asset serving
  ├─ settings load/save
  ├─ PTY session lifecycle
  ├─ input / resize / output streaming
  ├─ session creation and deletion
  └─ optional Tailscale Funnel
```

## 문서

- [Compatibility notes](./docs/compatibility.md)
- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)
