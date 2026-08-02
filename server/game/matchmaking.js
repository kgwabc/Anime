/** 인메모리 자동 매칭 큐. 서버 재시작시 초기화되지만, 매치 자체가 짧은 세션이라 MVP에서는 허용. */
class Matchmaker {
  constructor() {
    this.waitingQueue = [];
  }

  addToQueue(playerId) {
    if (!this.waitingQueue.includes(playerId)) {
      this.waitingQueue.push(playerId);
    }
  }

  removeFromQueue(playerId) {
    this.waitingQueue = this.waitingQueue.filter((id) => id !== playerId);
  }

  /** 대기열에 2명 이상이면 앞의 두 명을 매칭 페어로 반환, 아니면 null */
  tryMatch() {
    if (this.waitingQueue.length < 2) return null;
    const [playerA, playerB] = this.waitingQueue.splice(0, 2);
    return [playerA, playerB];
  }
}

module.exports = { Matchmaker };
