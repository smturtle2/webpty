<div align="center">

# webpty

**공유 프로필/테마 설정을 사용하는 Rust 기반 브라우저 터미널 셸**

[![GitHub stars](https://img.shields.io/github/stars/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/smturtle2/webpty?style=for-the-badge)](https://github.com/smturtle2/webpty/issues)
[![Rust](https://img.shields.io/badge/Rust-1.94+-000000?style=for-the-badge&logo=rust)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react)](https://react.dev/)

[English README](./README.md)

</div>

`webpty`는 셸이 화면의 주인공이 되도록 설계되어 있습니다.
터미널은 검은색으로 화면 대부분을 차지하고, 우측에는 얇은 세션 레일이
붙어 있으며, 설정 워크스페이스는 별도 탭으로 그 레일에서 바로 열립니다. 실행 경로는 Rust 단일
바이너리이고 `webpty up` 한 번으로 UI와 PTY 런타임을 함께 올립니다.

프로필, 테마, 색상표, 액션, 기본값은 공유 가능한 데스크톱 터미널용
`settings.json`의 지원 subset을 사용합니다. 저장 시 알 수 없는 키는 그대로
보존되고, 디스크에서 읽을 때는 JSONC 스타일 주석과 trailing comma도
허용합니다.

## 미리보기

![webpty preview](./docs/assets/webpty-preview.png)

![webpty theme studio](./docs/assets/webpty-studio.png)

![webpty profile studio](./docs/assets/webpty-profile-studio.png)

![webpty language studio](./docs/assets/webpty-language-studio.png)

![webpty settings json](./docs/assets/webpty-settings-json.png)

![webpty collapsed rail](./docs/assets/webpty-collapsed-rail.png)

![webpty mobile settings](./docs/assets/webpty-mobile-settings.png)

## 현재 상태

현재 제공 범위:

- Rust PTY 런타임, 임베디드 프로덕션 UI, `webpty up` 원커맨드 실행
- 얇은 우측 레일, 전용 설정 탭, 검은 터미널 중심 레이아웃, 활성 탭 내부 split pane
- Theme Studio, Profile Studio, Language, JSON, Shortcut 편집 화면
- Bash, Zsh, Fish, PowerShell, WSL 계열을 포함한 프로필 인식 프롬프트 셰이핑
- 실행 OS를 따르는 첫 실행 기본값과 OS별 설정 경로
- 프로필/테마/스킴/액션 호환 설정, JSONC 주석, trailing comma, 미지원 키 round-trip
- 크롬/셸 색상용 color picker와 직접 입력 편집
- 프롬프트 템플릿, 폰트 페이스, 폰트 크기, 폰트 굵기, 셀 높이, 줄 높이, 패딩, 셸 색상을 다루는 실시간 프로필 편집
- 저장 전 Profile Studio 초안도 바로 실행해볼 수 있는 transient draft launch
- 지원 호스트에서 Tailscale 부트스트랩까지 연결되는 `webpty up --funnel`

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
- Python 3.10+는 문서 스크린샷 생성 또는 `ui:smoke` 실행 시에만 필요

문서 스크린샷 도구 의존성:

```bash
python -m pip install -r requirements-docs.txt
python -m playwright install chromium
```

### 글로벌 설치

```bash
cargo install --git https://github.com/smturtle2/webpty --bin webpty --locked
```

현재 워크스페이스 구조에서 레포 루트 기준 글로벌 설치가 가능합니다.

설치 뒤 `webpty`가 보이지 않으면 Cargo bin 디렉터리
(`$HOME/.cargo/bin`)를 `PATH`에 추가하세요.

로컬 체크아웃 설치:

```bash
cargo install --path apps/server --bin webpty --locked
```

### 실행

```bash
webpty up
```

기본 로컬 주소는 `http://127.0.0.1:3001`입니다.

레포 샘플 설정으로 실행:

```bash
webpty up --settings ./config/webpty.settings.json
```

`./config/webpty.settings.json`은 스크린샷과 수동 QA를 위한 고정 데모
카탈로그입니다. 실제 설치 후 첫 기본값은 여전히 실행 환경을 따릅니다.

### 외부 접속

```bash
webpty up --funnel
```

`--funnel`은 로컬 `tailscale` CLI를 이용해 내장 웹 UI를 외부에 공개합니다.
지원되는 호스트에서 CLI가 없으면 `webpty`가 먼저 설치를 시도하고, 그 다음
`tailscale up`을 자동으로 실행한 뒤 Funnel을 붙입니다. 헤드리스 환경에서는
`WEBPTY_TAILSCALE_AUTH_KEY`, `TS_AUTHKEY`, `TS_AUTH_KEY`도 사용할 수 있습니다.
여전히 대화형 로그인이 필요하면 `webpty`가 Tailscale 로그인 URL을 출력하고
정상적으로 종료합니다. Funnel은 셸 화면 자체를 외부에 공개하므로, 신뢰 가능한
장비와 네트워크 정책 뒤에서만 사용하는 것이 좋습니다.
`--funnel` 사용 시 `--host`는 loopback 또는 all-interface 범위로 유지해야 하며 `::1`도 허용됩니다.

## 설정 파일 위치

해석 순서:

1. `webpty up --settings <path>`
2. `WEBPTY_SETTINGS_PATH=<path>`
3. 사용자 전역 경로
4. 사용자 전역 경로를 전혀 만들 수 없을 때만 로컬 `./settings.json`

레포 샘플 설정은 다음처럼 명시적으로 지정할 때만 사용됩니다:

```bash
webpty up --settings ./config/webpty.settings.json
```

사용자 전역 경로:

- Linux: `~/.config/webpty/settings.json`
- macOS: `~/Library/Application Support/webpty/settings.json`
- Windows: `%APPDATA%\\webpty\\settings.json`

파일이 없으면 기본 설정이 생성됩니다.
기존 파일이 잘못되어 있으면 덮어쓰지 않고 에러로 종료합니다.
생성되는 기본 프로필 카탈로그는 실행 환경을 따릅니다:

- Windows: PowerShell 중심 + WSL 계열 프로필
- Linux/macOS: 로컬 셸 중심 프로필

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
서빙됩니다. Rust 빌드는 `apps/server/ui` 변경을 감시하므로, 백엔드
재빌드 시 최신 프런트 자산이 자동으로 다시 임베드됩니다.

## 검증

```bash
npm run build:web
cargo test --manifest-path apps/server/Cargo.toml
cargo check
npm run ui:smoke
npm run docs:shots
```

## 배포 반영

```bash
git status --short
npm run build:web
cargo test --manifest-path apps/server/Cargo.toml
git add -A
git commit -m "Refine shell runtime and settings studio"
git push origin main
```

## 아키텍처

```text
React shell
  ├─ terminal stage
  ├─ right-side session rail
  └─ settings workspace tab
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

- [Implementation audit](./docs/implementation-audit.md)
- [Development plan](./docs/development-plan.md)
- [Compatibility notes](./docs/compatibility.md)
- [Localization notes](./docs/localization.md)
- [Research spec](./docs/research-spec.md)
- [Runtime contracts](./docs/runtime-contracts.md)
