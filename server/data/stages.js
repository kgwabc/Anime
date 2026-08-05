// 어드벤처(스테이지) 모드 AI 상대 정의. 스테이지가 올라갈수록 비싼 카드 비중이 늘어남.
// deckCardIds는 server/data/cards.json에 있는 캐릭터 카드 id를 참조 (관리자가 해당 카드를
// 삭제하면 덱 조립 시 그 id만 자동으로 걸러짐 — server.js의 start_stage_match 참고).
const STAGES = [
  {
    id: 1,
    name: "1스테이지",
    aiName: "AI 견습생",
    deckCardIds: [
      ...Array(6).fill("char_zenitsu"),
      ...Array(4).fill("char_tanjiro"),
      ...Array(2).fill("char_shinobu"),
    ],
  },
  {
    id: 2,
    name: "2스테이지",
    aiName: "AI 귀살대원",
    deckCardIds: [
      ...Array(4).fill("char_tanjiro"),
      ...Array(4).fill("char_nezuko"),
      ...Array(4).fill("char_shinobu"),
      ...Array(2).fill("char_zenitsu"),
    ],
  },
  {
    id: 3,
    name: "3스테이지",
    aiName: "AI 상급 대원",
    deckCardIds: [
      ...Array(4).fill("char_nezuko"),
      ...Array(4).fill("char_inosuke"),
      ...Array(3).fill("char_shinobu"),
      ...Array(3).fill("char_tanjiro"),
    ],
  },
  {
    id: 4,
    name: "4스테이지",
    aiName: "AI 하시라 후보",
    deckCardIds: [
      ...Array(4).fill("char_inosuke"),
      ...Array(4).fill("char_giyu"),
      ...Array(3).fill("char_nezuko"),
      ...Array(3).fill("char_shinobu"),
    ],
  },
  {
    id: 5,
    name: "5스테이지 (최종 보스)",
    aiName: "키부츠지 무잔",
    deckCardIds: [
      ...Array(3).fill("char_rengoku"),
      ...Array(3).fill("char_giyu"),
      ...Array(2).fill("char_muzan"),
      ...Array(3).fill("char_inosuke"),
      ...Array(3).fill("char_nezuko"),
    ],
  },
];

module.exports = { STAGES };
