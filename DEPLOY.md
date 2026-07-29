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

- 자격증명 발급: https://opensky-network.org/ (계정 → API client)
- 폴링 간격은 기본 90초. 바꾸려면 `.env` 에 `OPENSKY_POLL_INTERVAL_MS=90000` 추가.

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
