# Aviation Route — 실시간 항공 경로 전시 UI

과학관 전시용 애플리케이션. **실시간 전 세계 비행기 위치**를 구/돔 프로젝션용
**Equirectangular 2:1 화면**에 띄우고, 별도의 **2D 조작 화면(듀얼 모니터)** 으로
비행기 선택·필터·회전·오버레이를 제어한다.

## 아키텍처

```
[OpenSky API] ──OAuth2 폴링──► [백엔드 허브 (WebSocket)]
                                  │  presentationState(선택/필터/회전/오버레이) + 항공기 캐시
                    ┌─────────────┴──────────────┐
        [컨트롤 창: MapLibre 2D]        [디스플레이 창: three.js Equirectangular]
```

허브가 **유일한 진실의 원천**이다. 데이터도, 조작 명령도 모두 허브를 통과하며,
허브는 상태를 보관·재브로드캐스트하므로 두 창(과 늦게 연결된 창)이 항상 동기화된다.

- 허브는 Electron **메인 프로세스 안에서** 실행된다(단일 상류 폴러).
- 디스플레이 창은 `frame:false / kiosk / fullscreen`으로 두 번째 모니터(프로젝터)에 배치된다.
- 좌우 회전(경도)만 지원 — Equirectangular에서는 가로 오프셋만으로 충분하며 3축 재투영이 없다.

## 실행

```bash
npm install
npm run dev        # Electron: 컨트롤 창 + 디스플레이 창을 각 모니터에 표시
```

계정 없이도 **mock(시뮬레이션) 피드**로 400대의 비행기가 실제 대권 항로를 따라 움직인다.

### OpenSky 실데이터 연결

[OpenSky](https://opensky-network.org/) 계정에서 API 클라이언트를 만들고 환경변수로 주입:

```bash
export OPENSKY_CLIENT_ID=...
export OPENSKY_CLIENT_SECRET=...
npm run dev
```

자격증명이 있으면 자동으로 OpenSky를 폴링한다. `FEED=mock` 을 주면 강제로 mock을 쓴다.

### 허브만 단독 실행 (개발/디버깅)

```bash
npm run hub            # ws://127.0.0.1:8787
FEED=mock npm run hub
```

## 디스플레이(구면) 배경 텍스처

기본은 절차적 바다 + 위경도 격자다. 사진 지구를 원하면 **2:1 equirectangular** 이미지를
`public/earth_equirect.jpg` 로 넣으면 자동 적용된다(자세한 내용은 `public/README.md`).

## 조작 기능

- **비행기 선택/강조** — 컨트롤 지도에서 클릭 → 양쪽 창에 강조 + 상세정보 + 대권 항로
- **필터링** — 비행 중만/국적/항공사(편명 접두)/최소 고도
- **좌우 회전** — 경도 오프셋 슬라이더(배경·비행기·항로가 함께 이동)
- **오버레이** — 낮/밤 경계, 위경도 격자, 통계 표시

## 검증

```bash
npm run typecheck          # 타입 검사
npm run test:projection    # 투영 수학(대권/날짜변경선/경도오프셋) 단위 검증
npm run build              # 프로덕션 번들
```

## 프로젝트 구조

```
electron/         Electron 메인(창·모니터 배치·워치독) + preload
server/           WebSocket 허브, OpenSky 피드, mock 피드
src/shared/       공용 타입, 투영 수학, WebSocket 클라이언트, 설정
src/common/       React 훅(useHub), 필터 유틸
src/display/      디스플레이 창(three.js equirectangular 엔진 + HUD)
src/control/      컨트롤 창(MapLibre 지도 + 조작 패널)
```

## 향후 확장 (이번 범위 아님)

- **행성 모드**: 배경 텍스처를 화성/목성 등으로 교체 + 비행기 레이어 off + 행성 자전.
  디스플레이 엔진이 "회전하는 equirectangular 텍스처" 구조라 텍스처 교체만으로 재사용 가능.
- **비행기 상세 보강**: OpenSky states에는 기종/출도착이 없다. `adsbdb.com`·`hexdb.io` 등으로
  편명→항로, ICAO24→기종을 보강.
