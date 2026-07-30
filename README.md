# 🐾 FocusPet

컴퓨터로 작업하거나 공부할 때, 화면 한쪽 구석에 앉아 있다가 정해진 방식대로 집중하라고 알려주는 데스크탑 펫 앱입니다.
브라우저 탭이 아니라 **어떤 프로그램을 켜놓고 있어도** (강의 영상 전체화면 포함) 항상 화면 위에 떠 있습니다.

## 특징

- **캐릭터 선택**: 고양이 / 강아지 / 토끼 / 판다 / 햄스터 중 선택
- **알림 방식 2가지 + 혼합**
  - 고정 간격: N분마다 무조건 알림 (강의처럼 입력이 적은 작업에 적합)
  - 활동 감지: 키보드/마우스 입력이 없을 때만 알림 (문서·엑셀 작업 중 딴짓 감지)
  - 둘 다 동시에 사용 가능
- 전체화면 위에도 항상 표시 (`screen-saver` 레벨 always-on-top)
- 트레이 아이콘으로 일시정지 / 펫 숨기기 / 설정 / 종료
- 말풍선 알림 + 효과음 (선택)
- 펫 위치(네 모서리 중 선택) 변경 가능

## 실행 방법

```bash
cd focus-pet
npm install
npm start
```

실행하면 화면 모서리에 펫이 뜨고, 시스템 트레이에 아이콘이 생깁니다.
펫 위에 마우스를 올리면 우측 상단에 톱니바퀴(⚙️) 버튼이 나타나요 — 클릭하면 설정 창이 열립니다.

## 배포용 설치파일 만들기 (로컬에서 직접, 선택)

평소에 이 프로젝트 폴더를 열어서 `npm start` 하는 대신, 더블클릭으로 실행되는 설치파일을 만들고 싶다면:

```bash
npm run build
```

`electron-builder`가 지금 빌드를 돌리는 OS에 맞는 설치파일(Windows는 `.exe`, Mac은 `.dmg`)을 `dist/` 폴더에 만들어줍니다.
Mac용 빌드는 macOS에서만 만들 수 있으니, Windows 개발 환경에서 두 OS를 모두 배포하려면 아래 GitHub Actions 자동 빌드를 쓰세요.
설정 창의 "Windows 시작 시 자동 실행" 토글을 켜면 부팅 시 자동 실행되게 할 수 있어요.

## 새 버전 배포하기 (GitHub Releases, 자동 빌드)

`main.js`/`package.json` 등을 수정한 뒤 새 버전을 배포하고 싶으면, 버전 태그를 push하기만 하면 됩니다 — Windows/Mac 빌드가 `.github/workflows/release.yml`(GitHub Actions)을 통해 각각 `windows-latest`/`macos-latest` 러너에서 자동으로, 서로 독립적으로(병렬로) 만들어져서 같은 GitHub Release에 자동으로 첨부됩니다. Mac 빌드는 이 저장소에 서명(코드사인) 인증서가 없어서 서명 없이(unsigned) 만들어집니다 — 아래 "Mac에서 처음 실행할 때" 안내를 참고하세요.

```bash
# 1. package.json의 "version" 필드를 새 버전으로 올리고 커밋
git add package.json
git commit -m "v1.0.1"

# 2. 그 버전에 해당하는 태그를 만들어서 push (태그는 반드시 v로 시작해야 트리거됨)
git tag v1.0.1
git push origin v1.0.1
```

태그를 push하면 GitHub Actions가 자동으로 시작되고, 두 OS 빌드가 모두 끝나면 저장소의 **Releases** 페이지에 `.exe`(Windows)와 `.dmg`(Mac) 파일이 함께 올라옵니다. 별도로 로그인 토큰을 준비할 필요는 없어요 — GitHub Actions가 실행마다 자동으로 발급하는 토큰을 그대로 씁니다.

### Windows에서 처음 실행할 때

설치파일을 실행하면 "Windows가 PC를 보호했습니다"라는 SmartScreen 경고가 뜰 수 있어요(서명 인증서 없이 배포되는 앱이라 나오는 정상적인 경고입니다) — **추가 정보**를 클릭한 뒤 **실행** 버튼을 누르면 정상적으로 설치/실행됩니다.

### Mac에서 처음 실행할 때

이 앱은 애플 개발자 서명 없이 빌드돼서, 다운로드 후 처음 열 때 "손상되었기 때문에 열 수 없습니다"라는 경고가 뜰 수 있어요. 터미널에서 아래 명령을 한 번 실행하면 해결됩니다 (Finder에서 더블클릭이 아니라 설치 위치를 직접 지정해야 하니, 보통 설치되는 경로 그대로 사용하세요):

```bash
xattr -cr /Applications/FocusPet.app
```

## 폴더 구조

```
focus-pet/
├── main.js                 # Electron 메인 프로세스 (트레이, 타이머, 창 관리)
├── preload.js              # 렌더러에 안전하게 IPC 노출
├── settingsStore.js        # 설정 파일 읽기/쓰기 (userData/settings.json)
├── assets/                 # 트레이/앱 아이콘
└── windows/
    ├── pet/                # 펫 오버레이 창 (투명, 항상 위, 클릭 통과 없음)
    └── settings/           # 설정 창
```

## 커스터마이징 아이디어

- `windows/pet/pet.js`의 `CHARACTERS` 객체에 이모지를 추가하면 캐릭터 종류를 늘릴 수 있어요.
- 지금은 이모지 기반이라 별도 이미지 없이 가볍게 동작하는데, 나중에 실제 스프라이트/GIF 캐릭터로 바꾸고 싶으면 `#pet-char`를 `<img>` 태그로 바꾸고 애니메이션 프레임을 교체하면 됩니다.
- 효과음은 Web Audio API로 생성한 "삐" 소리 하나뿐이라, 원하는 mp3 파일을 넣고 `Audio` 객체로 재생하도록 바꿔도 좋아요.
