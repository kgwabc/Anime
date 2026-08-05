// 스테이지 모드 AI의 의사결정만 담당 — 실제 상태 변경은 호출자가 GameRoom 메서드로 수행한다.

function chooseCardToPlay(room, aiPlayerId) {
  const ai = room.players[aiPlayerId];
  const playable = ai.hand
    .filter((card) => card.cost <= ai.mana && card.type !== "equipment")
    .sort((a, b) => b.cost - a.cost);
  return playable[0] || null;
}

function chooseAttack(room, aiPlayerId) {
  const ai = room.players[aiPlayerId];
  const humanId = room.getOpponentId(aiPlayerId);
  const human = room.players[humanId];
  const attacker = ai.board.find((card) => card.canAttack && !card.hasAttacked);
  if (!attacker) return null;

  if (human.board.length > 0) {
    const weakest = [...human.board].sort((a, b) => a.hp - b.hp)[0];
    return { attackerCardId: attacker.id, target: { type: "character", cardId: weakest.id } };
  }
  return { attackerCardId: attacker.id, target: { type: "hero" } };
}

module.exports = { chooseCardToPlay, chooseAttack };
