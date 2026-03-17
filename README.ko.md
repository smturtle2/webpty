<div align="center">

# webpty

**Rust 기반 웹 터미널 워크스페이스**

[English README](./README.md)

</div>

`webpty`는 Windows Terminal의 강한 워크플로를 참고해, 브라우저 환경에 맞게
다시 설계한 **UI/UX 중심 터미널 프로젝트**입니다.

핵심 목표는 단순한 텍스트 렌더링이 아니라 다음 경험을 만드는 것입니다.

- 상태가 잘 보이는 탭 UI
- 여러 작업을 동시에 다루는 pane 레이아웃
- command palette와 tab switcher를 하나의 상호작용 체계로 통합
- 활성 pane 기준 검색
- JSON 편집기보다 탐색형에 가까운 settings studio

## 미리보기

![webpty preview](./docs/assets/webpty-preview.png)

## 현재 상태

현재 저장소에는 다음이 포함되어 있습니다.

- React/Vite 기반 UI 프로토타입
- Axum 기반 Rust 서버 스켈레톤
- 리서치 문서와 런타임 계약 문서

구현된 항목:

- 커스텀 앱 셸과 상단 chrome
- 상태가 보이는 탭 열
- split-pane 작업영역
- command palette / MRU tab switcher
- 검색 오버레이
- settings studio 프로토타입
- `xterm.js` 기반 읽기 전용 터미널 뷰
- 세션 생성과 WebSocket IO 계약이 보이는 Rust 서버

아직 남아 있는 항목:

- 실제 PTY 연동
- 설정 저장과 profile import
- broadcast input
- native window / quake mode
- 멀티 윈도우 관리

## 빠른 시작

### 요구사항

- Node.js 24+
- npm 11+
- Rust 1.94+

### 설치

```bash
npm install
```

### 프런트엔드 실행

```bash
npm run dev:web
```

### Rust 서버 실행

```bash
cargo run --manifest-path apps/server/Cargo.toml
```

## 검증

```bash
npm run lint:web
npm run build:web
cargo check --manifest-path apps/server/Cargo.toml
```

## 디렉터리 구조

```text
.
├── apps/
│   ├── server/   # Axum 계약 서버와 WebSocket mock transport
│   └── web/      # React/Vite UI 프로토타입
├── docs/
│   ├── research-spec.md
│   ├── runtime-contracts.md
│   └── assets/
└── README.md
```

## 문서

- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)

## 로드맵

- [ ] mock transport를 실제 PTY 세션 계층으로 교체
- [ ] WebSocket 기반 실시간 터미널 IO 연결
- [ ] 탭, pane, profile 상태 저장
- [ ] Windows Terminal 설정 일부 import
- [ ] palette/settings UI code splitting
- [ ] 탭 및 pane 드래그 인터랙션

## 설계 원칙

- **키보드 우선**: 주요 기능은 키보드로 빠르게 접근할 수 있어야 합니다.
- **상태 가시성**: 탭과 pane은 추가 UI 없이도 상태를 보여줘야 합니다.
- **오버레이 일관성**: palette, tab switcher, search는 하나의 시스템처럼 느껴져야 합니다.
- **설정 탐색성**: 값 편집만이 아니라, 구조를 이해하기 쉬운 설정 경험이 중요합니다.

## 영감

- [microsoft/terminal](https://github.com/microsoft/terminal)
- Windows Terminal의 command palette / advanced tab switcher 설계
- 레이아웃과 명령 탐색을 제품 중심으로 다루는 터미널 도구들

---

`webpty`는 브라우저 환경에서도 “터미널 자체”보다 “터미널 워크스페이스”가 더
중요하다고 보는 프로젝트입니다.
