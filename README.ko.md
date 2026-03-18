<div align="center">

# webpty

**브라우저에서 동작하는 Rust 기반 Windows Terminal 호환 터미널 셸**

[English README](./README.md)

</div>

`webpty`는 터미널이 화면 대부분을 차지하도록 설계된 프로젝트입니다.
세션은 우측 좁은 레일에 배치되고, WT 호환 `settings.json`이 프로필,
테마, 단축키를 구동합니다. 배포용 실행 경로는 Rust 단일 바이너리이며
`webpty up`으로 UI와 PTY 런타임을 함께 올립니다.

이제 더 이상 mock transcript 프로토타입이 아니라, Rust PTY 백엔드 위에서
실제 셸 세션을 스트리밍합니다. 시작 직후 인위적인 배너 없이 바로 셸
프롬프트로 진입하며, 비Windows 환경에서도 프로필별 문구와 위치가 드러나는
fallback 프롬프트를 유지합니다.

설정 파일 해석 순서는 다음과 같습니다.

1. `webpty up --settings <path>` 또는 `WEBPTY_SETTINGS_PATH=<path>`
2. 현재 작업 디렉터리에 `./config/webpty.settings.json`이 있으면 그 파일
3. 그 외에는 플랫폼별 사용자 전역 경로

레포에 포함된 `config/webpty.settings.json`은 개발, 스크린샷, 그리고
평면적인 기본 테마 기준점으로 계속 사용할 수 있습니다.

## 미리보기

![webpty preview](./docs/assets/webpty-preview.png)

![webpty settings panel](./docs/assets/webpty-studio.png)

## 현재 상태

현재 구현된 것:

- Rust/Axum 서버 기반 PTY 세션 생성과 WebSocket 스트리밍
- Rust 바이너리에서 직접 서빙되는 임베디드 프로덕션 UI
- `webpty up` CLI 진입점
- `webpty up --funnel` 외부 접속용 Tailscale Funnel
- 상단 툴바 없이 검은 터미널이 화면 대부분을 차지하고, 우측에는 흰색 기반의 좁은 세션 레일 배치
- 활성 탭 내부의 단일 split pane 워크스페이스
- 셸 프롬프트 앞에 붙던 인위적인 시작 배너 제거
- WT 호환 `settings.json` 로드, 정규화, 저장, 미지원 키 round-trip 보존
- 우측 기준 Windows 11 스타일 설정 패널에서 프로필 실행, 기본 프로필 변경, 테마 전환, JSON 편집
- 비Windows 호스트에서도 Windows 대상 프로필이 `bash-5.2$`로 무너지는 대신 프로필에 맞는 fallback 프롬프트 사용
- PTY 입력, 리사이즈, 출력 스트림 처리

아직 없는 것:

- 더 깊은 pane graph, 드래그 재배치, 영속 pane 레이아웃
- command palette / search
- 탭 드래그 정렬
- 더 넓은 Windows Terminal action object 패리티
- 모든 Windows Terminal icon URI 형식에 대한 완전한 자산 렌더링
- 앱 재시작 후 세션 복원

## 제품 방향

기준 레퍼런스는 [microsoft/terminal](https://github.com/microsoft/terminal)입니다.

목표는 완전한 기능 복제가 아니라 다음입니다.

- 터미널 앱다운 밀도와 집중도
- 유용한 Windows Terminal 설정 subset과의 호환성
- PTY 수명주기와 스트리밍을 Rust 런타임이 직접 관리하는 구조
- 상단 툴바를 고정하지 않는 터미널 중심 셸

## 빠른 시작

### 요구사항

- Rust 1.94+
- Node.js 24+ / npm 11+는 프런트 번들을 다시 빌드하거나 UI를 개발할 때만 필요

### 글로벌 설치

```bash
cargo install --git https://github.com/smturtle2/webpty --bin webpty --locked
```

로컬 체크아웃에서는 아래 한 줄로도 설치할 수 있습니다.

```bash
cargo install --path apps/server --bin webpty --locked
```

### 실행

```bash
webpty up
```

레포 샘플 설정으로 바로 확인하려면:

```bash
webpty up --settings ./config/webpty.settings.json
```

### 외부 접속 포함 실행

```bash
webpty up --funnel
```

`--funnel`은 로컬 `tailscale` CLI를 이용해 내장 웹 UI를 Tailscale Funnel로
외부 공개합니다. 먼저 `tailscale up`을 실행하고, 현재 노드에 Funnel 권한이
있는지 확인해야 합니다.

### 설정 파일 위치

해석 순서:

- `webpty up --settings <path>`
- `WEBPTY_SETTINGS_PATH=<path>`
- 현재 작업 디렉터리의 `./config/webpty.settings.json`이 있으면 우선 사용
- 그 외에는 사용자 전역 경로

사용자 전역 경로:

- Linux/macOS: `~/.config/webpty/settings.json`
- Windows: `%APPDATA%\\webpty\\settings.json`

### 개발 모드

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

Vite 개발 서버는 `/api`, `/ws` 요청을 `http://127.0.0.1:3001`로 프록시하고,
프로덕션 빌드는 `apps/server/ui`로 출력되어 Rust 바이너리에서 직접 서빙됩니다.

## 검증

```bash
npm run build:web
cargo test --manifest-path apps/server/Cargo.toml
cargo check
```

`npm run lint:web`는 현재도 이 워크스페이스에서 멈추는 문제가 있어 별도
조사가 필요합니다.

## 디렉터리 구조

```text
.
├── apps/
│   ├── server/   # Axum PTY 런타임과 WT 호환 설정 계약
│   └── web/      # React/Vite 터미널 셸 UI
├── config/
│   └── webpty.settings.json
├── docs/
│   ├── compatibility.md
│   ├── research-spec.md
│   ├── runtime-contracts.md
│   └── assets/
└── README.md
```

## 문서

- [Compatibility notes](./docs/compatibility.md)
- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)

## 로드맵

- [x] mock transport를 PTY 세션 계층으로 교체
- [x] 우측 세션 레일 기반의 터미널 중심 레이아웃 적용
- [x] WT 호환 테마/프로필 편집 유지
- [ ] 현재 split layout을 넘어서는 pane 관리 확장
- [ ] search / command palette 재도입
- [ ] WT 설정 및 action 호환 범위 확대
