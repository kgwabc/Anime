# 크로스오버 카드게임 (Kingdom's Edge류 아님 — 별도 프로젝트)

하스스톤 + 포켓몬카드 + 유희왕의 재미 요소를 섞은 크로스오버 1대1 턴제 카드게임.
이 저장소는 **뼈대(스켈레톤) 단계**로, 카드 효과의 실제 로직은 아직 자리표시자만 있음.

## 폴더 구조
- `server/` — Node.js + Express + Socket.IO 게임 서버 (Render 배포 대상)
- `client/` — 정적 HTML/JS/CSS 클라이언트 (Vercel 배포 대상)

## 로컬 실행
```bash
cd server
npm install
npm start
# -> Crossover TCG server listening on port 3001
```
그 다음 `client/index.html`을 브라우저에서 직접 열거나 정적 서버로 서빙합니다.
같은 페이지를 탭 2개(또는 시크릿 창)로 열고 각각 "매칭 시작"을 누르면 서로 매칭됩니다.

## 배포
### 서버 (Render 무료 플랜)
1. 이 저장소를 GitHub에 푸시
2. Render에서 New Web Service → 이 repo 연결, Root Directory를 `server`로 설정
3. Build Command: `npm install`, Start Command: `npm start`
4. 배포 후 발급되는 URL(`https://xxx.onrender.com`)을 클라이언트 `SERVER_URL`에 반영

### 클라이언트 (Vercel 무료 플랜)
1. `client` 폴더를 Vercel에 정적 사이트로 배포 (Root Directory: `client`)
2. `client/main.js`의 `SERVER_URL`을 Render 서버 URL로 교체 후 재배포

## 알려진 제약사항
- **Render 무료 플랜은 일정 시간 미사용시 슬립되며, 재시작되면 서버 메모리에 있던 매칭 큐/
  진행중인 매치 상태가 초기화**됩니다. 카드 정의 데이터(`server/data/cards.json`)는 코드에
  포함되어 있어 재시작해도 항상 동일하게 로드되므로 문제 없지만, 게임 도중 서버가 재시작되면
  그 매치는 유실됩니다. MVP 단계에서는 감수하는 제약이며, 필요시 무료 DB(Supabase 등) 연동이나
  클라이언트 재연결 로직으로 개선할 수 있습니다.
- 카드 효과(전투의 함성, 주문 효과 등)는 `server/game/GameRoom.js`의 `resolveEffect()`에
  키 이름만 연결되어 있고 실제 로직은 미구현 상태입니다 (다음 단계 작업).
- 덱 빌딩, 로그인/계정, 랭킹 등은 이번 스켈레톤 범위에 포함되지 않습니다.

## 카드 데이터 확장 (저작권 대응)
`server/data/cards.json`에 카드를 추가하면 됩니다. 각 카드는 `series`(패러디 세력 그룹)와
`synergyTags`(시너지 카테고리)를 가지므로, 실존 IP를 직접 참조하지 않는 자체 오마주 캐릭터를
자유롭게 확장할 수 있습니다.
