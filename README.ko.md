<div align="center">

# webpty

**브라우저용 심플한 Rust 기반 터미널 앱**

[English README](./README.md)

</div>

`webpty`는 Windows Terminal의 톤과 밀도를 참고해, 웹 환경에서 단순한
터미널 앱으로 시작하는 프로젝트입니다.

현재 프로토타입은 의도적으로 범위를 좁혔습니다.

- 큰 단일 터미널 영역
- 얇은 상단 chrome
- 우측 세션 전환 바
- Rust HTTP/WebSocket 계약 서버

## 미리보기

![webpty preview](./docs/assets/webpty-preview.png)

## 현재 상태

현재 구현된 것:

- 다크 톤의 단순한 터미널 앱 셸
- `xterm.js` 기반 활성 터미널 뷰포트 1개
- 우측 세션 리스트를 통한 세션 전환
- 새 세션 / 세션 닫기 / 세션 순환 단축키
- health, session 생성, WebSocket IO를 가진 Rust/Axum 서버

아직 없는 것:

- 실제 PTY 연결
- 탭 드래그/정렬
- Windows Terminal 스타일 설정 UI
- 검색, palette, pane 관리

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
│   ├── server/   # Axum 계약 서버와 mock session transport
│   └── web/      # React/Vite 터미널 UI
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

- [ ] mock transport를 PTY 세션 계층으로 교체
- [ ] WebSocket을 통한 실시간 셸 출력 연결
- [ ] 세션 상태 저장
- [ ] 나중에 Windows Terminal에 더 가까운 설정 UI 재도입

## 참고

- [microsoft/terminal](https://github.com/microsoft/terminal)

현재 앱은 Windows Terminal보다 훨씬 단순합니다. 지금 단계의 참고점은
기능 수보다 **터미널 앱다운 톤과 밀도**입니다.
