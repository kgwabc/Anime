// 배포시 Render 서버 URL로 교체 (예: "https://your-app.onrender.com")
const SERVER_URL = "http://localhost:3001";

const socket = io(SERVER_URL);

const screens = {
  lobby: document.getElementById("screen-lobby"),
  waiting: document.getElementById("screen-waiting"),
  game: document.getElementById("screen-game"),
  result: document.getElementById("screen-result"),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("hidden", key !== name);
  }
}

document.getElementById("btn-join-queue").addEventListener("click", () => {
  socket.emit("join_queue");
  showScreen("waiting");
});

document.getElementById("btn-end-turn").addEventListener("click", () => {
  socket.emit("end_turn");
});

socket.on("match_found", (state) => {
  showScreen("game");
  renderState(state);
});

socket.on("game_state_update", (state) => {
  renderState(state);
});

socket.on("action_error", (reason) => {
  console.warn("action_error:", reason);
});

socket.on("opponent_disconnected", () => {
  document.getElementById("result-text").textContent = "상대가 접속을 종료했습니다.";
  showScreen("result");
});

socket.on("game_over", ({ result }) => {
  document.getElementById("result-text").textContent =
    result === "win" ? "승리했습니다!" : "패배했습니다.";
  showScreen("result");
});

function renderCard(card, isMine) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <div class="name">${card.name}</div>
    <div class="cost">코스트 ${card.cost}</div>
    ${
      card.type === "character"
        ? `<div class="atk-hp"><span>⚔${card.atk}</span><span>❤${card.hp}</span></div>`
        : `<div class="atk-hp"><span>${card.type}</span></div>`
    }
  `;
  if (isMine) {
    el.addEventListener("click", () => {
      socket.emit("play_card", { cardId: card.id });
    });
  }
  return el;
}

function renderState(state) {
  document.getElementById("my-hp").textContent = state.me.hp;
  document.getElementById("my-mana").textContent = state.me.mana;
  document.getElementById("my-max-mana").textContent = state.me.maxMana;
  document.getElementById("my-deck-count").textContent = state.me.deckCount;

  document.getElementById("opp-hp").textContent = state.opponent.hp;
  document.getElementById("opp-mana").textContent = state.opponent.mana;
  document.getElementById("opp-max-mana").textContent = state.opponent.maxMana;
  document.getElementById("opp-hand-count").textContent = state.opponent.handCount;
  document.getElementById("opp-deck-count").textContent = state.opponent.deckCount;

  const isMyTurn = state.currentPlayerId === socket.id;
  document.getElementById("turn-indicator").textContent = isMyTurn
    ? `▶ 내 턴 (턴 ${state.turnNumber})`
    : `상대 턴 (턴 ${state.turnNumber})`;
  document.getElementById("btn-end-turn").disabled = !isMyTurn;

  const myHandEl = document.getElementById("my-hand");
  myHandEl.innerHTML = "";
  for (const card of state.me.hand) {
    myHandEl.appendChild(renderCard(card, true));
  }

  const myBoardEl = document.getElementById("my-board");
  myBoardEl.innerHTML = "";
  for (const card of state.me.board) {
    myBoardEl.appendChild(renderCard(card, false));
  }

  const oppBoardEl = document.getElementById("opp-board");
  oppBoardEl.innerHTML = "";
  for (const card of state.opponent.board) {
    oppBoardEl.appendChild(renderCard(card, false));
  }
}
