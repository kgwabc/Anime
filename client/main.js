const SERVER_URL = "https://animepsykongroo.onrender.com";
const ADMIN_USERNAME = "kgwabc";

let socket = null;
let lastState = null;
let selectedAttackerId = null;

const screens = {
  auth: document.getElementById("screen-auth"),
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

// ---------- 인증 ----------

const formLogin = document.getElementById("form-login");
const formSignup = document.getElementById("form-signup");

document.getElementById("link-to-signup").addEventListener("click", (e) => {
  e.preventDefault();
  formLogin.classList.add("hidden");
  formSignup.classList.remove("hidden");
});

document.getElementById("link-to-login").addEventListener("click", (e) => {
  e.preventDefault();
  formSignup.classList.add("hidden");
  formLogin.classList.remove("hidden");
});

formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  try {
    const res = await fetch(`${SERVER_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
    onAuthenticated(data.token, data.username);
  } catch (err) {
    errorEl.textContent = "서버에 연결할 수 없습니다.";
  }
});

formSignup.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("signup-username").value;
  const password = document.getElementById("signup-password").value;
  const errorEl = document.getElementById("signup-error");
  errorEl.textContent = "";

  try {
    const res = await fetch(`${SERVER_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
    onAuthenticated(data.token, data.username);
  } catch (err) {
    errorEl.textContent = "서버에 연결할 수 없습니다.";
  }
});

document.getElementById("btn-logout").addEventListener("click", () => {
  logout();
});

function onAuthenticated(token, username) {
  localStorage.setItem("tcg_token", token);
  localStorage.setItem("tcg_username", username);
  connectSocket(token, username);
}

function logout() {
  localStorage.removeItem("tcg_token");
  localStorage.removeItem("tcg_username");
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  showScreen("auth");
}

function connectSocket(token, username) {
  socket = io(SERVER_URL, { auth: { token } });
  registerSocketHandlers();

  socket.on("connect", () => {
    document.getElementById("lobby-username").textContent = username;
    showScreen("lobby");

    const adminPanel = document.getElementById("admin-panel");
    if (username === ADMIN_USERNAME) {
      adminPanel.classList.remove("hidden");
      loadAdminUsers(token);
    } else {
      adminPanel.classList.add("hidden");
    }
  });

  socket.on("connect_error", (err) => {
    console.warn("connect_error:", err.message);
    logout();
  });
}

// ---------- 관리자 패널 ----------

async function loadAdminUsers(token) {
  const listEl = document.getElementById("admin-user-list");
  listEl.textContent = "불러오는 중...";

  try {
    const res = await fetch(`${SERVER_URL}/auth/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      listEl.textContent = data.message;
      return;
    }
    renderAdminUsers(data.users, token);
  } catch (err) {
    listEl.textContent = "유저 목록을 불러올 수 없습니다.";
  }
}

function renderAdminUsers(users, token) {
  const listEl = document.getElementById("admin-user-list");
  listEl.innerHTML = "";

  for (const user of users) {
    const row = document.createElement("div");
    row.className = "admin-user-row";

    const label = document.createElement("span");
    label.textContent = user.username;
    row.appendChild(label);

    if (user.username !== ADMIN_USERNAME) {
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "삭제";
      deleteBtn.addEventListener("click", () => deleteAdminUser(user.username, token));
      row.appendChild(deleteBtn);
    }

    listEl.appendChild(row);
  }
}

async function deleteAdminUser(username, token) {
  if (!confirm(`"${username}" 계정을 삭제하시겠습니까?`)) return;

  try {
    const res = await fetch(`${SERVER_URL}/auth/users/${encodeURIComponent(username)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.message);
      return;
    }
    loadAdminUsers(token);
  } catch (err) {
    alert("계정 삭제 중 오류가 발생했습니다.");
  }
}

// 페이지 로드시 저장된 토큰이 있으면 자동 로그인
const savedToken = localStorage.getItem("tcg_token");
const savedUsername = localStorage.getItem("tcg_username");
if (savedToken && savedUsername) {
  connectSocket(savedToken, savedUsername);
} else {
  showScreen("auth");
}

// ---------- 게임 ----------

document.getElementById("btn-join-queue").addEventListener("click", () => {
  socket.emit("join_queue");
  showScreen("waiting");
});

document.getElementById("btn-end-turn").addEventListener("click", () => {
  socket.emit("end_turn");
});

function registerSocketHandlers() {
  socket.on("match_found", (state) => {
    showScreen("game");
    renderState(state);
  });

  socket.on("game_state_update", (state) => {
    renderState(state);
  });

  socket.on("action_error", (reason) => {
    console.warn("action_error:", reason);
    selectedAttackerId = null;
    if (lastState) renderState(lastState);
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
}

function renderCard(card, role, isMyTurn) {
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

  if (role === "hand") {
    el.addEventListener("click", () => {
      socket.emit("play_card", { cardId: card.id });
    });
  } else if (role === "my-board") {
    const canSelect = isMyTurn && card.canAttack && !card.hasAttacked;
    if (canSelect) {
      el.classList.add("attackable");
      if (selectedAttackerId === card.id) el.classList.add("selected-attacker");
      el.addEventListener("click", () => {
        selectedAttackerId = selectedAttackerId === card.id ? null : card.id;
        renderState(lastState);
      });
    } else {
      el.classList.add("cannot-attack");
    }
  } else if (role === "opp-board") {
    if (selectedAttackerId) el.classList.add("attack-target");
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!selectedAttackerId) return;
      socket.emit("attack_card", {
        attackerCardId: selectedAttackerId,
        target: { type: "character", cardId: card.id },
      });
      selectedAttackerId = null;
    });
  }

  return el;
}

function renderState(state) {
  lastState = state;
  document.getElementById("my-name").textContent = state.me.username || "나";
  document.getElementById("my-hp").textContent = state.me.hp;
  document.getElementById("my-mana").textContent = state.me.mana;
  document.getElementById("my-max-mana").textContent = state.me.maxMana;
  document.getElementById("my-deck-count").textContent = state.me.deckCount;

  document.getElementById("opp-name").textContent = state.opponent.username || "상대";
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
    myHandEl.appendChild(renderCard(card, "hand"));
  }

  const myBoardEl = document.getElementById("my-board");
  myBoardEl.innerHTML = "";
  for (const card of state.me.board) {
    myBoardEl.appendChild(renderCard(card, "my-board", isMyTurn));
  }

  const oppBoardEl = document.getElementById("opp-board");
  oppBoardEl.innerHTML = "";
  for (const card of state.opponent.board) {
    oppBoardEl.appendChild(renderCard(card, "opp-board"));
  }

  const opponentAreaEl = document.getElementById("opponent-area");
  opponentAreaEl.classList.toggle(
    "hero-target",
    Boolean(selectedAttackerId) && state.opponent.board.length === 0
  );
}

document.getElementById("opponent-area").addEventListener("click", (e) => {
  if (!selectedAttackerId || !lastState) return;
  if (e.target.closest("#opp-board")) return;
  if (lastState.opponent.board.length > 0) return;

  socket.emit("attack_card", {
    attackerCardId: selectedAttackerId,
    target: { type: "hero" },
  });
  selectedAttackerId = null;
});
