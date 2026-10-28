# iPad Display Server

Windows에 가상 확장 모니터를 만들고 같은 로컬 네트워크의 iPad Safari로 전송하는 WebRTC 기반 프로그램입니다. Windows 호스트에서 Electron/Chromium의 데스크톱 캡처와 하드웨어 비디오 인코딩을 사용하고, iPad에는 별도 앱을 설치하지 않습니다.

## 현재 구현 범위

- Windows 디스플레이 선택 및 미리보기
- 1280×800, 1920×1200, 2048×1536 / 최대 60fps 캡처 요청
- Safari 수신 페이지와 H.264 우선 WebRTC 협상
- 같은 LAN 안에서 동작하는 내장 HTTP 시그널링 서버
- 매 실행 시 변경되는 6자리 페어링 PIN
- iPad 터치 이벤트용 WebRTC 데이터 채널(Windows 입력 주입은 다음 단계)
- Apple/Samsung 태블릿 내장 해상도 DB와 가로·세로 방향 전환
- 사용자 지정 해상도 프로필 저장 및 삭제
- 서명된 간접 디스플레이 드라이버를 이용한 Windows 가상 모니터 생성·제거
- 가상 모니터 생성 후 Windows 표시 모드를 자동으로 `확장`으로 전환
- 기기별 해상도와 Windows 배율 100%, 125%, 150%, 175%, 200%, 250%, 300% 적용
- 초저지연·균형·화질 우선 스트리밍 모드와 실시간 FPS/RTT/버퍼/디코딩 통계
- 창 닫기 시 알림 영역으로 숨기기 및 트레이 메뉴에서 완전 종료
- Windows 로그인 자동 실행과 고정 6자리 마스터 코드

터치 입력의 Windows 주입은 아직 포함하지 않습니다. iPad 터치 이벤트용 데이터 채널까지만 준비되어 있습니다.

## 개발 실행

Node.js 22 이상과 .NET 9 SDK가 필요합니다.

```powershell
npm install
npm start
```

호스트 창에서 기기·방향·배율을 고른 뒤 **가상 확장 화면 만들기**를 누릅니다. Windows 관리자 승인 후 새 화면이 생기며, 앱이 새 디스플레이를 자동으로 선택합니다. **화면 전송 시작**을 누르고 같은 Wi-Fi의 iPad Safari에서 표시된 주소와 PIN으로 접속합니다.

기본 스트리밍 모드는 **초저지연 · 게임 우선**입니다. iPad 화면 왼쪽 아래와 Windows 호스트에 수신 FPS, 네트워크 왕복 시간(RTT), 지터 버퍼 및 디코딩 시간이 표시됩니다. 최저 지연을 위해 Windows PC는 공유기에 유선으로 연결하고 태블릿은 전용 5GHz/6GHz Wi-Fi를 사용하는 것을 권장합니다. Safari를 유지하는 웹 모드의 한계와 Moonlight급 네이티브 모드 계획은 [`docs/latency-roadmap.md`](docs/latency-roadmap.md)에 정리했습니다.

앱 창의 X 버튼은 프로그램을 종료하지 않고 Windows 알림 영역으로 숨깁니다. 트레이 아이콘을 클릭하면 다시 열리고, 우클릭 메뉴의 **완전히 종료**로 서버를 끝낼 수 있습니다. 설정에서는 Windows 자동 실행을 켜고, 실행할 때마다 바뀌는 PIN 대신 함께 사용할 고정 6자리 마스터 코드를 저장할 수 있습니다.

가상 디스플레이 드라이버는 [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver)의 서명된 x64 릴리스(25.7.23, MIT)를 포함합니다. 드라이버 설치·변경·제거 시에만 Windows 관리자 승인을 요청하며, 실행 전 포함 파일의 SHA-256을 확인합니다. Windows 버전이나 디스플레이 드라이버 조합에 따라 배율 적용이 거부되면 Windows **설정 → 시스템 → 디스플레이**에서 같은 값을 직접 선택할 수 있습니다.

Windows 방화벽이 묻는 경우 사설 네트워크에서 Node/Electron의 인바운드 연결을 허용해야 합니다. 게스트 Wi-Fi나 AP 격리가 켜진 공유기에서는 기기 간 통신이 차단될 수 있습니다.

## 테스트와 패키징

```powershell
npm test
npm run dist
```

패키징 결과는 `dist` 폴더에 생성됩니다.

### GitHub Release

`v`로 시작하는 태그를 푸시하면 GitHub Actions가 Windows에서 테스트와 NSIS 빌드를 실행하고 설치 파일을 Release에 첨부합니다.

```powershell
git tag v0.1.0
git push origin v0.1.0
```

내장 기기 DB는 `public/device-profiles.json`에 있습니다. 공식 Apple 및 Samsung 사양 링크를 각 프로필에 함께 기록했습니다. 사용자 프로필은 Windows 앱의 로컬 저장소에 보관되므로 업데이트 후에도 유지됩니다.

## 성능 메모

1920×1200 60fps를 기본 목표로 삼습니다. 실제 프레임률과 지연은 GPU 인코더 지원, Wi-Fi 혼잡도, 공유기 지연, Safari 디코더 상태에 따라 달라집니다. 5GHz 또는 6GHz Wi-Fi와 유선 연결된 Windows PC 조합이 유리합니다.
