/** 투기장 티어 정의. entryCost는 입장시 즉시 차감되는 코인, winReward는 승리시 지급되는 코인. */
const ARENA_TIERS = {
  free: { id: "free", label: "0원 투기장", entryCost: 0, winReward: 1000 },
  t5000: { id: "t5000", label: "5천원 투기장", entryCost: 2500, winReward: 5000 },
  t10000: { id: "t10000", label: "1만원 투기장", entryCost: 5000, winReward: 10000 },
  t20000: { id: "t20000", label: "2만원 투기장", entryCost: 10000, winReward: 20000 },
  t50000: { id: "t50000", label: "5만원 투기장", entryCost: 25000, winReward: 50000 },
  t100000: { id: "t100000", label: "10만원 투기장", entryCost: 50000, winReward: 100000 },
};

function getArenaTier(tierId) {
  return ARENA_TIERS[tierId] || null;
}

module.exports = { ARENA_TIERS, getArenaTier };
