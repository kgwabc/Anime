# 프로젝트 컨텍스트

크로스오버 1대1 턴제 카드게임 (하스스톤+포켓몬카드+유희왕 요소 조합). 유지비 0원 제약,
무료 스택(Node.js/Express/Socket.IO + Render + Vercel)으로 운영.

## 배포 구조와 이유
- `server/` → **Render** 배포. Socket.IO는 연결을 계속 열어두는 상시 프로세스가 필요한데,
  Vercel은 서버리스(요청마다 짧게 실행) 구조라 WebSocket 서버에 안 맞음. Render는 일반
  Node 프로세스를 그대로 띄워주므로 이 역할에 적합.
- `client/` → **Vercel** 배포. 정적 HTML/CSS/JS라 빌드 불필요, CDN으로 빠르게 서빙됨.
  Render 하나로 합칠 수도 있지만, 그러면 게임 화면 자체가 Render의 슬립/콜드스타트 영향을
  받게 되어 분리함.
- 즉 Vercel(화면)과 Render(실시간 게임 로직)는 역할이 분리되어 있고, 실제 매칭/턴/카드
  처리는 전부 Render 서버(`server/game/GameRoom.js`)의 메모리에서 일어남.

## 현재 배포 상태
- GitHub: https://github.com/kgwabc/Anime (branch: `main`)
- Render 서버: https://animepsykongroo.onrender.com
- Vercel 게임 화면: https://anime-coral-kappa-15.vercel.app/ (프로젝트명 변경 관련 이슈는 해결됨)
- `client/main.js`의 `SERVER_URL`은 위 Render 주소를 가리키도록 설정되어 있음. Render
  URL이 바뀌면 이 값도 같이 갱신하고 재배포해야 함.

## 인증 시스템
- 이메일+비밀번호 자체 구현 (bcrypt 해싱 + JWT). 계정은 MongoDB Atlas에 저장
  (`server/models/User.js`).
- `server/auth/authRoutes.js` — REST: `POST /auth/signup`, `POST /auth/login`
- `server/auth/socketAuth.js` — `io.use()` 미들웨어로 소켓 연결 자체를 JWT로 게이트.
  클라이언트는 `io(url, { auth: { token } })` 형태로 연결해야 함, 토큰 없거나 유효하지
  않으면 연결 거부됨.
- 기존 게임 로직(`GameRoom`, `Matchmaker`)은 여전히 `socket.id`를 플레이어 식별자로 사용 —
  인증은 그 위에 얹은 게이트일 뿐, 로그인한 유저의 `username`만 `GameRoom`에 전달해 표시용으로 씀.
- 클라이언트(`client/main.js`)는 로그인 성공시 JWT를 `localStorage`에 저장해 재접속시
  자동 로그인 처리.
- Render에 배포하려면 `MONGODB_URI`, `JWT_SECRET` 환경변수가 필수 (README 참고).

## 알려진 제약사항
- Render 무료 플랜은 15분 미사용시 슬립 → 재시작시 인메모리 매칭 큐/진행중 매치 상태 유실
  (감수하기로 한 제약, DB 미사용). `cards.json`은 코드에 포함되어 재시작해도 항상 동일하게 로드됨.
- 카드 효과(전투의 함성, 주문 효과 등)는 `server/game/GameRoom.js`의 `resolveEffect()`에
  키만 연결되어 있고 실제 로직은 미구현 (다음 단계 작업 대상).
- 덱 빌딩, 랭킹 시스템, 비밀번호 찾기/이메일 인증은 범위 밖.

## 로컬 개발 환경
- 이 저장소는 로컬 전용 git 사용자(`user.name`/`user.email`)로 커밋함 — 전역 git config는
  건드리지 않음.
