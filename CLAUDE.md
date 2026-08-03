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
- 닉네임+비밀번호 자체 구현 (bcryptjs 해싱 + JWT, 이메일 필드 없음). 계정은
  **Turso(libSQL, SQLite 기반)**의 `users` 테이블에 저장 (`server/db.js`가 테이블 생성,
  `server/models/User.js`가 쿼리 함수).
  - MongoDB Atlas로 시작했다가 사용자가 이미 Turso 경험이 있어서 전환함. 향후 덱/매치기록/
    랭킹처럼 관계형 데이터가 늘어날 걸 감안해도 SQL(Turso) 쪽이 더 적합하다고 판단.
  - 로컬 개발/테스트는 실제 Turso 계정 없이 `TURSO_DATABASE_URL=file:local.db`로 대체 가능
    (libSQL 클라이언트가 로컬 SQLite 파일도 지원함).
- `server/auth/authRoutes.js` — REST: `POST /auth/signup`, `POST /auth/login`
- `server/auth/socketAuth.js` — `io.use()` 미들웨어로 소켓 연결 자체를 JWT로 게이트.
  클라이언트는 `io(url, { auth: { token } })` 형태로 연결해야 함, 토큰 없거나 유효하지
  않으면 연결 거부됨.
- 기존 게임 로직(`GameRoom`, `Matchmaker`)은 여전히 `socket.id`를 플레이어 식별자로 사용 —
  인증은 그 위에 얹은 게이트일 뿐, 로그인한 유저의 `username`만 `GameRoom`에 전달해 표시용으로 씀.
- 클라이언트(`client/main.js`)는 로그인 성공시 JWT를 `localStorage`에 저장해 재접속시
  자동 로그인 처리.
- Render에 배포하려면 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET` 환경변수가 필수
  (README 참고).

## 관리자 계정
- 닉네임이 정확히 `kgwabc`인 계정이 관리자로 하드코딩되어 있음 (`server/auth/middleware.js`의
  `ADMIN_USERNAME`, `client/main.js`의 동일 상수). 별도 role 컬럼/권한 테이블 없이 최소 구현.
- `GET /auth/users`, `DELETE /auth/users/:username` — `requireAuth`+`requireAdmin` 미들웨어로
  보호됨 (REST용 JWT 검증은 소켓 인증과 별개로 `Authorization: Bearer` 헤더 기반).
- 관리자 본인(`kgwabc`) 계정은 삭제 요청 자체가 서버에서 거부됨.
- 클라이언트: `kgwabc`로 로그인시 로비 화면에 유저 목록/삭제 버튼이 있는 관리자 패널이 표시됨.

## 카드 데이터와 저작권
- 첫 카드 세트(`server/data/cards.json`)는 **귀멸의 칼날 실제 캐릭터 이름**을 그대로 사용함
  (탄지로, 네즈코, 젠이츠 등). 원래 이 프로젝트는 저작권 대응을 위해 "패러디/오마주 자작
  캐릭터"로 설계하기로 했었는데, 사용자가 실제 이름 사용을 명시적으로 선택해서 이 세트만
  예외로 진행함. 개인/비상업 프로젝트 단계라 진행했지만, 나중에 공개 배포/상업화(Vercel
  Commercial 전환 등)를 고려할 때는 저작권 이슈가 될 수 있다는 점을 유의.
- 카드 효과는 `effects` 필드에 `{type, amount, ...}` 형태의 구조화된 객체로 정의하고,
  `server/game/GameRoom.js`의 `GameRoom.prototype.resolveEffect()`가 실제로 처리함
  (`damage_enemy_hero`, `heal_self`, `draw_card`, `buff_last_character` 구현됨).
- **구조적 제약**: 게임에는 아직 "공격(attack)" 액션이나 보드 위 미니언 간 전투, 타겟 선택
  UI가 없음. 그래서 지금 카드 효과들은 전부 타겟 선택이 필요 없는 형태(상대 영웅에게 직접
  데미지, 자신 회복/드로우, 자신 보드의 마지막 카드 버프)로만 설계되어 있음. 미니언 전투
  시스템은 다음 단계 과제.

## 알려진 제약사항
- Render 무료 플랜은 15분 미사용시 슬립 → 재시작시 인메모리 매칭 큐/진행중 매치 상태 유실
  (감수하기로 한 제약, DB 미사용). `cards.json`은 코드에 포함되어 재시작해도 항상 동일하게 로드됨.
- 덱이 바닥나도 피로(fatigue) 데미지 같은 페널티가 없어 무한 턴이 가능함 (다음 단계 과제).
- 덱 빌딩, 랭킹 시스템, 비밀번호 찾기는 범위 밖.

## 로컬 개발 환경
- 이 저장소는 로컬 전용 git 사용자(`user.name`/`user.email`)로 커밋함 — 전역 git config는
  건드리지 않음.
