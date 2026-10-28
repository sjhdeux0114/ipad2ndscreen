# iPad Display Server

Windows 화면을 같은 로컬 네트워크의 iPad Safari로 전송하는 WebRTC 기반 프로토타입입니다. Windows 호스트에서 Electron/Chromium의 데스크톱 캡처와 하드웨어 비디오 인코딩을 사용하고, iPad에는 별도 앱을 설치하지 않습니다.

## 현재 구현 범위

- Windows 디스플레이 선택 및 미리보기
- 1280×800, 1920×1200, 2048×1536 / 최대 60fps 캡처 요청
- Safari 수신 페이지와 H.264 우선 WebRTC 협상
- 같은 LAN 안에서 동작하는 내장 HTTP 시그널링 서버
- 매 실행 시 변경되는 6자리 페어링 PIN
- iPad 터치 이벤트용 WebRTC 데이터 채널(Windows 입력 주입은 다음 단계)
- Apple/Samsung 태블릿 내장 해상도 DB와 가로·세로 방향 전환
- 사용자 지정 해상도 프로필 저장 및 삭제

아직 Windows에 새 디스플레이를 생성하는 가상 디스플레이 드라이버와 터치 입력 주입은 포함하지 않습니다. 이미 연결된 실제 또는 가상 디스플레이를 선택해 스트리밍하는 MVP입니다.

## 개발 실행

Node.js 22 이상이 필요합니다.

```powershell
npm install
npm start
```

호스트 창에서 전송할 화면과 품질을 선택하고 **화면 전송 시작**을 누릅니다. 같은 Wi-Fi에 연결한 iPad Safari에서 호스트 창에 표시된 주소로 접속한 뒤 PIN을 입력합니다.

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
