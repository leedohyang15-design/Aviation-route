# 전시 배포 가이드 (Windows)

과학관 키오스크(듀얼 모니터: 컨트롤 = 주모니터, 디스플레이 = 프로젝터 풀스크린)로
배포하는 방법. **실행파일 빌드는 반드시 Windows PC에서** 한다(코드 서명·아이콘
임베딩이 Windows 네이티브 도구를 쓰기 때문. Linux에서는 win-unpacked까지는 만들어지지만
서명 단계에서 wine이 필요해 멈춘다).

## 1. 준비 (Windows, 최초 1회)

```powershell
git clone <이 저장소>
cd Aviation-route
npm install
```

- **지구 텍스처**를 `public/` 에 넣는다(빌드 시 번들됨):
  - `public/earth_equirect.jpg` (2:1 equirectangular, 필수)
  - `public/earth_night.jpg` (야간 도시 불빛, 선택)

## 2. 실행파일 만들기

```powershell
npm run pack:win
```

→ `dist/win-unpacked/Aviation Route.exe` (설치 불필요, 폴더째 복사해서 실행).

설치 마법사(NSIS)가 필요하면:

```powershell
npm run dist:win
```

→ `dist/Aviation Route Setup <버전>.exe`.

> 코드 서명 인증서가 없으면 "알 수 없는 게시자" 경고가 뜰 수 있다(정상). 서명하려면
> 인증서를 준비해 `CSC_LINK`/`CSC_KEY_PASSWORD` 환경변수로 넣는다.

## 3. OpenSky 자격증명 (.env)

실데이터를 쓰려면 `.env` 파일을 **`Aviation Route.exe` 와 같은 폴더**에 둔다
(없으면 시뮬레이션 데이터로 동작):

```
OPENSKY_CLIENT_ID=your-id
OPENSKY_CLIENT_SECRET=your-secret
```

- 자격증명 발급: https://opensky-network.org/ (계정 → **API client**. 로그인 아이디/비번이
  아니라 client id/secret 을 따로 발급받아야 한다. 잘못 넣으면 로그에 `invalid_client`.)
- 폴링 간격은 기본 90초. 바꾸려면 `.env` 에 `OPENSKY_POLL_INTERVAL_MS=90000` 추가.
- 시뮬레이션 비행기 수는 기본 6000대. `.env` 에 `MOCK_AIRCRAFT_COUNT=6000` 으로 조절.

### 문제 진단 로그

exe 옆에 **`aviation-route.log`** 가 자동으로 생긴다. 실데이터가 안 붙을 때 이 파일부터 본다.

| 로그 내용 | 원인 | 해결 |
|---|---|---|
| `[env] no .env found` | 위치/이름 문제 | `.env` 를 **exe 와 같은 폴더**에 (`.env.txt` 도 인식) |
| `credentials: NO` | 키 형식 문제 | `OPENSKY_CLIENT_ID=...` / `OPENSKY_CLIENT_SECRET=...` 두 줄인지 확인 |
| `invalid_client` | 자격증명 오류 | OpenSky **API client** id/secret 재확인 |
| `429 ... credits` | 크레딧 소진 | 하루 지나면 자동 복구(그동안 시뮬레이션이 화면을 채움) |

## 3-1. 다른 PC로 옮기기 (배포)

소스 폴더를 통째로 압축해 보내면 안 된다(Node·npm 설치 후 빌드해야 함). **빌드 결과물만**
보내면 받는 쪽은 아무것도 설치할 필요가 없다.

**방법 A — 폴더 복사(간단):** `dist\win-unpacked\` 폴더를 통째로 zip 해서 전달(약 200~300MB).
받은 PC에서 압축 풀고 `Aviation Route.exe` 실행. 지구 텍스처·공항 한글표는 exe 안에 포함돼 있다.

**방법 B — 설치 파일:** `npm run dist:win` 으로 만든 `dist\Aviation Route Setup <버전>.exe`
한 개만 전달.

주의:
- 실데이터를 쓰려면 **`.env` 를 exe 와 같은 폴더에 함께** 넣어 보낸다. `.env` 에는 OpenSky
  **비밀키가 들어있으니** 외부에 배포할 때는 제외한다(빼면 시뮬레이션으로 동작).
- 서명이 없어 첫 실행 시 SmartScreen "알 수 없는 게시자" 경고가 뜬다 →
  **추가 정보 → 실행** (또는 exe 우클릭 → 속성 → **차단 해제**).
- **지구 텍스처는 빌드 시점에 exe 안으로 들어간다.** `public/` 에 이미지를 나중에 넣었다면
  반드시 **다시 빌드**해야 반영된다.

## 4. 전시 PC 세팅 (무인 운영)

1. **모니터 배치** — 컨트롤 화면을 **주모니터**, 프로젝터를 **보조 모니터**로 설정하면
   앱이 자동으로 프로젝터에 풀스크린 키오스크로 띄운다.
2. **자동 시작** — `Aviation Route.exe` 바로가기를 `shell:startup`(시작프로그램) 폴더에
   넣거나 작업 스케줄러 "로그온 시 실행"으로 등록. 바로가기의 **[시작 위치]** 를 exe가
   있는 폴더로 지정(.env 를 찾도록).
3. **자동 재시작** — 아래 `run-exhibit.bat` 같은 워치독으로 앱이 죽어도 다시 띄운다.
4. **절전/화면보호기 끄기**, **Windows 업데이트 자동 재부팅 끄기**, **알림 끄기**,
   **자동 로그인** 설정.

### 워치독 배치 파일 예시 (`run-exhibit.bat`)

```bat
@echo off
cd /d "%~dp0"
:loop
start /wait "" "Aviation Route.exe"
timeout /t 3 >nul
goto loop
```

exe 와 `.env` 가 있는 폴더에 두고, 이 `.bat` 의 바로가기를 시작프로그램에 등록한다.

## 참고

- 렌더러(창)가 크래시하면 앱이 자동으로 리로드한다. 전체 프로세스가 죽는 경우만 위
  워치독이 커버한다.
- 도시명은 내장된 IATA 표(약 5,200개)로 한국어 표시된다. 드물게 영어로 남는 공항이
  있으면 허브 콘솔에 `[city] no Korean for XXX` 로 찍힌다.
