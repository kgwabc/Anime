# 애니프사이콩그루 (Kingdom's Edge류 아님 — 별도 프로젝트)

하스스톤 + 포켓몬카드 + 유희왕의 재미 요소를 섞은 애니프사이콩그루 1대1 턴제 카드게임.
카드를 내고, 다음 턴부터 그 캐릭터로 상대를 공격하는 기본 전투 루프가 동작합니다.

## 🎮 게임 플레이
아래 URL로 접속해서 플레이하세요 (탭 2개 또는 다른 브라우저로 각각 접속하면 매칭됨):
**https://anime-coral-kappa-15.vercel.app/**

## 폴더 구조
- `server/` — Node.js + Express + Socket.IO 게임 서버 (Render 배포 대상)
- `client/` — 정적 HTML/JS/CSS 클라이언트 (Vercel 배포 대상)

## 회원가입/로그인
게임 시작 전에 닉네임/비밀번호로 회원가입 또는 로그인해야 합니다 (JWT 기반, Turso(libSQL)에
계정 저장). 로그인 토큰은 브라우저 `localStorage`에 저장되어 재접속시 자동 로그인됩니다.

## 로컬 실행
```bash
cd server
npm install
cp .env.example .env   # TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, JWT_SECRET 값을 채워넣기
                        # (Turso 계정 없이 테스트만 하려면 TURSO_DATABASE_URL=file:local.db 로도 가능)
npm start
# -> Turso connected
# -> Enif Psycongroo server listening on port 3001
```
그 다음 `client/index.html`을 브라우저에서 직접 열거나 정적 서버로 서빙합니다.
같은 페이지를 탭 2개(또는 시크릿 창)로 열고 각각 회원가입/로그인 후 "매칭 시작"을 누르면
서로 매칭됩니다.

## 배포
### 서버 (Render 무료 플랜) — 배포 완료
- 저장소: https://github.com/kgwabc/Anime (Root Directory: `server`)
- Build Command: `npm install`, Start Command: `npm start`
- 배포 URL: https://animepsykongroo.onrender.com
- **필요한 환경변수** (Render 대시보드 → Environment): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET`
  (Turso 무료 DB의 연결 URL/인증 토큰과, 임의의 긴 랜덤 문자열)

### 클라이언트 (Vercel 무료 플랜) — 배포 완료
- 저장소: https://github.com/kgwabc/Anime (Root Directory: `client`)
- 배포 URL(게임 접속 주소): https://anime-coral-kappa-15.vercel.app/
- `client/main.js`의 `SERVER_URL`은 위 Render URL로 설정되어 있음

## 알려진 제약사항
- **Render 무료 플랜은 일정 시간 미사용시 슬립되며, 서버가 재시작되면 진행중인 매치 상태가
  초기화**됩니다 (계정 정보는 Turso에 영속 저장되므로 영향 없음). 카드 정의 데이터
  (`server/data/cards.json`)는 코드에 포함되어 재시작해도 항상 동일하게 로드됩니다.
- 브라우저 탭 전환/백그라운드 전환처럼 **소켓 연결만 잠깐 끊기는 경우**는 30초(환경변수
  `RECONNECT_GRACE_MS`로 조절 가능) 안에 재접속하면 자동으로 게임에 복귀합니다. 유예 시간을
  넘기면 상대에게 "상대가 접속을 종료했습니다"가 표시됩니다.
- 덱 빌딩, 랭킹, 비밀번호 찾기, 미니언 간 전투 외 카드 효과(주문/장비) 등은 범위 밖입니다.

## 카드 데이터 확장
`server/data/cards.json`에 카드를 추가하면 됩니다 (`id/name/series/type/cost/atk/hp/
synergyTags` 필드). 첫 세트는 귀멸의 칼날 실제 캐릭터 이름을 그대로 사용했는데, 개인/비상업
프로젝트 단계라 진행한 결정이며 공개 배포/상업화시 저작권 이슈가 될 수 있으니 참고하세요.
