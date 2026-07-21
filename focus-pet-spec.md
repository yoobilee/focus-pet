# FocusPet — 설계 스펙 (Claude Code 핸드오프용)

## 목적
작업/공부 중 컴퓨터 화면 한쪽에 떠 있다가, 정해진 방식으로 "집중하세요" 알림을 주는 개인용 데스크탑 펫.
포트폴리오용 아님 — 일상 사용 목적. 브라우저 안이 아니라 **다른 어떤 프로그램을 켜놔도** 위에 떠 있어야 해서 웹앱이 아닌 Electron 데스크탑 앱으로 선택함.

## 핵심 요구사항 (바뀌면 안 되는 것)
1. 다른 프로그램(전체화면 강의 영상 포함) 위에 항상 표시되어야 함
2. 캐릭터는 여러 종류 중 사용자가 설정에서 선택
3. 알림 트리거 방식이 설정 가능해야 함
   - 고정 간격 (강의 시청처럼 입력이 적은 상황용)
   - 활동(키보드/마우스) 감지 — 입력이 끊기면 알림 (문서 작업 중 딴짓 감지용)
   - 위 두 개 동시 사용도 가능해야 함

## 현재 구현 방식
- **메인 프로세스** (`main.js`): 트레이 아이콘, 펫 창 생성, 타이머/idle 폴링, 설정 파일 저장/로드
  - `petWindow.setAlwaysOnTop(true, 'screen-saver')` + `setVisibleOnAllWorkspaces({visibleOnFullScreen:true})`로 전체화면 위 표시 구현
  - 고정 간격: `setInterval`
  - 활동 감지: `powerMonitor.getSystemIdleTime()`을 5초마다 폴링, threshold 넘으면 1회 알림 (재알림은 다시 활동 후 idle 재진입 시)
  - `both` 모드는 두 타이머를 동시에 돌림
- **설정 저장**: `electron-store` 같은 외부 라이브러리 없이 `app.getPath('userData')/settings.json`에 직접 JSON 읽기/쓰기 (`settingsStore.js`)
- **펫 창** (`windows/pet/`): frameless, transparent, `focusable:false`, 이모지 기반 캐릭터 (이미지 에셋 없이 가볍게). 말풍선은 CSS opacity transition, 효과음은 외부 mp3 없이 Web Audio API 오실레이터로 생성
- **설정 창** (`windows/settings/`): 캐릭터 선택 그리드, 모드 라디오 버튼, 간격/threshold 입력, 위치 select, 메시지 textarea

## 알려진 한계 / 다음에 다듬을 것
- 다중 모니터 처리 안 됨 (항상 `getPrimaryDisplay()` 기준)
- 펫 창 위치가 화면 크기 바뀌거나 모니터 구성 바뀔 때 재계산 안 됨
- 캐릭터가 이모지라 OS/폰트에 따라 렌더링이 조금씩 다르게 보일 수 있음 → 실제 스프라이트/GIF로 바꾸려면 `#pet-char`를 `<img>`로 교체하고 애니메이션 프레임 로직 추가 필요
- 시작 프로그램 자동 등록 기능 없음 (수동으로 `npm start` 또는 빌드 후 실행)
- 펫 창이 `focusable:false`라 드래그 이동이 잘 안 될 수 있음 (프레임리스+투명 창의 드래그 리전 이슈는 OS별로 다르게 동작하는 경우가 많음 — 테스트 필요)
- idle 감지에서 화면보호기/잠금 상태와의 상호작용 미검증

## 파일 구조
```
focus-pet/
├── main.js
├── preload.js
├── settingsStore.js
├── package.json
├── assets/ (tray-icon.png, app-icon.png)
└── windows/
    ├── pet/ (index.html, pet.css, pet.js)
    └── settings/ (index.html, settings.css, settings.js)
```
