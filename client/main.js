const SERVER_URL = "https://animepsykongroo.onrender.com";
const ADMIN_USERNAME = "kgwabc";

let socket = null;
let lastState = null;
let selectedAttackerId = null;
let selectedSpellCardId = null;
let selectedEquipmentCardId = null;
let currentAdminToken = null;

const TRIGGER_LABELS = {
  ON_PLAY: "출격시(ON_PLAY)",
  ON_DEATH: "파괴시(ON_DEATH)",
  IMMEDIATE: "사용즉시(IMMEDIATE)",
  ON_EQUIP: "장착시(ON_EQUIP)",
};

const ALLOWED_TRIGGERS_BY_TYPE = {
  character: ["ON_PLAY", "ON_DEATH"],
  spell: ["IMMEDIATE"],
  equipment: ["ON_EQUIP"],
};

const ACTION_LABELS = {
  DAMAGE: "피해",
  HEAL: "회복",
  DRAW: "카드뽑기",
  BUFF: "스탯부여",
};

const TARGET_LABELS = {
  ENEMY_HERO: "적 영웅",
  ALL_ENEMIES: "적 전체",
  TARGET_CHARACTER: "지정 캐릭터",
  SELF: "자신",
};

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
      currentAdminToken = token;
      loadAdminUsers(token);
      loadAdminCards(token);
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

function populateTriggerOptions(selectEl, type) {
  const allowed = ALLOWED_TRIGGERS_BY_TYPE[type] || [];
  const previousValue = selectEl.value;
  selectEl.innerHTML = '<option value="">없음</option>';
  for (const trigger of allowed) {
    const option = document.createElement("option");
    option.value = trigger;
    option.textContent = TRIGGER_LABELS[trigger];
    selectEl.appendChild(option);
  }
  if (allowed.includes(previousValue)) selectEl.value = previousValue;
}

function updateNewCardFieldVisibility() {
  const type = document.getElementById("new-card-type").value;
  for (const group of document.querySelectorAll("#form-new-card [data-type-group]")) {
    group.classList.toggle("hidden", group.dataset.typeGroup !== type);
  }
  populateTriggerOptions(document.getElementById("new-card-trigger"), type);
}

document.getElementById("new-card-type").addEventListener("change", updateNewCardFieldVisibility);
updateNewCardFieldVisibility();

async function loadAdminCards(token) {
  const listEl = document.getElementById("admin-card-list");
  listEl.textContent = "불러오는 중...";

  try {
    const res = await fetch(`${SERVER_URL}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      listEl.textContent = data.message;
      return;
    }
    renderAdminCards(data.cards, token);
  } catch (err) {
    listEl.textContent = "카드 목록을 불러올 수 없습니다.";
  }
}

function createOptionSelect(options, selectedValue) {
  const select = document.createElement("select");
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = selectedValue;
  return select;
}

function renderAdminCards(cards, token) {
  const listEl = document.getElementById("admin-card-list");
  listEl.innerHTML = "";

  let lastSeries = null;
  for (const card of cards) {
    if (card.series !== lastSeries) {
      const header = document.createElement("h4");
      header.className = "admin-series-header";
      header.textContent = `계열: ${card.series}`;
      listEl.appendChild(header);
      lastSeries = card.series;
    }

    const row = document.createElement("div");
    row.className = "admin-card-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = card.name;

    const seriesInput = document.createElement("input");
    seriesInput.type = "text";
    seriesInput.value = card.series;

    const typeSelect = createOptionSelect(
      [
        ["character", "캐릭터"],
        ["spell", "스펠"],
        ["equipment", "장비"],
      ],
      card.type
    );

    const costInput = document.createElement("input");
    costInput.type = "number";
    costInput.min = "0";
    costInput.value = card.cost;

    const tagsInput = document.createElement("input");
    tagsInput.type = "text";
    tagsInput.value = (card.synergyTags || []).join(", ");

    const descriptionInput = document.createElement("textarea");
    descriptionInput.placeholder = "카드 설명 (선택)";
    descriptionInput.value = card.description || "";

    const atkInput = document.createElement("input");
    atkInput.type = "number";
    atkInput.min = "0";
    atkInput.value = card.atk;
    atkInput.placeholder = "공격력";

    const hpInput = document.createElement("input");
    hpInput.type = "number";
    hpInput.min = "0";
    hpInput.value = card.hp;
    hpInput.placeholder = "체력";

    const equipAtkInput = document.createElement("input");
    equipAtkInput.type = "number";
    equipAtkInput.min = "0";
    equipAtkInput.value = card.equipAtkBonus || 0;
    equipAtkInput.placeholder = "장착 공격력 보너스";

    const equipHpInput = document.createElement("input");
    equipHpInput.type = "number";
    equipHpInput.min = "0";
    equipHpInput.value = card.equipHpBonus || 0;
    equipHpInput.placeholder = "장착 체력 보너스";

    const existingEffect = (card.effects || [])[0];
    const triggerSelect = document.createElement("select");
    const actionSelect = createOptionSelect(
      Object.entries(ACTION_LABELS),
      existingEffect?.action || "DAMAGE"
    );
    const targetSelect = createOptionSelect(
      Object.entries(TARGET_LABELS),
      existingEffect?.target || "ENEMY_HERO"
    );
    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.placeholder = "수치";
    valueInput.value = existingEffect?.value ?? "";

    function refreshFieldVisibility() {
      const type = typeSelect.value;
      atkInput.classList.toggle("hidden", type !== "character");
      hpInput.classList.toggle("hidden", type !== "character");
      equipAtkInput.classList.toggle("hidden", type !== "equipment");
      equipHpInput.classList.toggle("hidden", type !== "equipment");
      populateTriggerOptions(triggerSelect, type);
    }
    triggerSelect.value = existingEffect?.trigger || "";
    typeSelect.addEventListener("change", refreshFieldVisibility);
    refreshFieldVisibility();

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "저장";
    saveBtn.addEventListener("click", () => {
      const type = typeSelect.value;
      const fields = {
        name: nameInput.value,
        series: seriesInput.value,
        type,
        cost: Number(costInput.value),
        synergyTags: tagsInput.value
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        description: descriptionInput.value,
        effects: triggerSelect.value
          ? [
              {
                trigger: triggerSelect.value,
                action: actionSelect.value,
                target: targetSelect.value,
                value: Number(valueInput.value),
              },
            ]
          : [],
      };
      if (type === "character") {
        fields.atk = Number(atkInput.value);
        fields.hp = Number(hpInput.value);
      }
      if (type === "equipment") {
        fields.equipAtkBonus = Number(equipAtkInput.value) || 0;
        fields.equipHpBonus = Number(equipHpInput.value) || 0;
      }
      updateAdminCard(card.id, fields, token);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", () => deleteAdminCard(card.id, token));

    row.append(
      nameInput,
      seriesInput,
      typeSelect,
      costInput,
      tagsInput,
      descriptionInput,
      atkInput,
      hpInput,
      equipAtkInput,
      equipHpInput,
      triggerSelect,
      actionSelect,
      targetSelect,
      valueInput,
      saveBtn,
      deleteBtn
    );
    listEl.appendChild(row);
  }
}

async function updateAdminCard(id, fields, token) {
  try {
    const res = await fetch(`${SERVER_URL}/cards/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.message);
      return;
    }
    loadAdminCards(token);
  } catch (err) {
    alert("카드 수정 중 오류가 발생했습니다.");
  }
}

async function deleteAdminCard(id, token) {
  if (!confirm("이 카드를 삭제하시겠습니까?")) return;

  try {
    const res = await fetch(`${SERVER_URL}/cards/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.message);
      return;
    }
    loadAdminCards(token);
  } catch (err) {
    alert("카드 삭제 중 오류가 발생했습니다.");
  }
}

function buildEffectsFromEditor(triggerId, actionId, targetId, valueId) {
  const trigger = document.getElementById(triggerId).value;
  if (!trigger) return [];
  const value = Number(document.getElementById(valueId).value);
  return [
    {
      trigger,
      action: document.getElementById(actionId).value,
      target: document.getElementById(targetId).value,
      value,
    },
  ];
}

document.getElementById("form-new-card").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("new-card-error");
  errorEl.textContent = "";

  if (!currentAdminToken) return;

  const type = document.getElementById("new-card-type").value;
  const fields = {
    name: document.getElementById("new-card-name").value,
    series: document.getElementById("new-card-series").value,
    type,
    cost: Number(document.getElementById("new-card-cost").value),
    synergyTags: document
      .getElementById("new-card-tags")
      .value.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    effects: buildEffectsFromEditor("new-card-trigger", "new-card-action", "new-card-target", "new-card-value"),
    description: document.getElementById("new-card-description").value,
  };

  if (type === "character") {
    fields.atk = Number(document.getElementById("new-card-atk").value);
    fields.hp = Number(document.getElementById("new-card-hp").value);
  }
  if (type === "equipment") {
    fields.equipAtkBonus = Number(document.getElementById("new-card-equip-atk").value) || 0;
    fields.equipHpBonus = Number(document.getElementById("new-card-equip-hp").value) || 0;
  }

  try {
    const res = await fetch(`${SERVER_URL}/cards`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentAdminToken}`,
      },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
    e.target.reset();
    document.getElementById("new-card-type").value = "character";
    updateNewCardFieldVisibility();
    loadAdminCards(currentAdminToken);
  } catch (err) {
    errorEl.textContent = "카드 생성 중 오류가 발생했습니다.";
  }
});

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
    selectedSpellCardId = null;
    selectedEquipmentCardId = null;
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

function describeEffect(effect) {
  if (!effect) return "";
  return `${ACTION_LABELS[effect.action] || effect.action} ${effect.value} (${TARGET_LABELS[effect.target] || effect.target})`;
}

function cardNeedsTargetCharacter(card) {
  return (card.effects || []).some((effect) => effect.target === "TARGET_CHARACTER");
}

function renderCard(card, role, isMyTurn) {
  const el = document.createElement("div");
  el.className = "card";
  if (card.description) el.title = card.description;

  let bodyHtml;
  if (card.type === "character") {
    bodyHtml = `<div class="atk-hp"><span>⚔${card.atk}</span><span>❤${card.hp}</span></div>`;
    if (card.effects?.length) bodyHtml += `<div class="effect-summary">${describeEffect(card.effects[0])}</div>`;
  } else if (card.type === "spell") {
    bodyHtml = `<div class="effect-summary">${describeEffect(card.effects?.[0])}</div>`;
  } else {
    bodyHtml = `<div class="atk-hp"><span>+${card.equipAtkBonus || 0}</span><span>+${card.equipHpBonus || 0}</span></div>`;
    if (card.effects?.length) bodyHtml += `<div class="effect-summary">${describeEffect(card.effects[0])}</div>`;
  }

  el.innerHTML = `
    <div class="name">${card.name}</div>
    <div class="cost">코스트 ${card.cost}</div>
    ${bodyHtml}
  `;

  if (role === "hand") {
    if (selectedSpellCardId === card.id || selectedEquipmentCardId === card.id) {
      el.classList.add("selected-attacker");
    }
    el.addEventListener("click", () => {
      if (card.type === "equipment") {
        selectedSpellCardId = null;
        selectedEquipmentCardId = selectedEquipmentCardId === card.id ? null : card.id;
        renderState(lastState);
        return;
      }
      if (card.type === "spell" && cardNeedsTargetCharacter(card)) {
        selectedEquipmentCardId = null;
        selectedSpellCardId = selectedSpellCardId === card.id ? null : card.id;
        renderState(lastState);
        return;
      }
      socket.emit("play_card", { cardId: card.id });
    });
  } else if (role === "my-board") {
    if (selectedEquipmentCardId) {
      el.classList.add("attack-target");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        socket.emit("equip_card", { equipmentCardId: selectedEquipmentCardId, targetCharacterId: card.id });
        selectedEquipmentCardId = null;
      });
    } else if (selectedSpellCardId) {
      el.classList.add("attack-target");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        socket.emit("play_card", { cardId: selectedSpellCardId, target: { cardId: card.id } });
        selectedSpellCardId = null;
      });
    } else {
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
    }
  } else if (role === "opp-board") {
    if (selectedSpellCardId) {
      el.classList.add("attack-target");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        socket.emit("play_card", { cardId: selectedSpellCardId, target: { cardId: card.id } });
        selectedSpellCardId = null;
      });
    } else {
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
