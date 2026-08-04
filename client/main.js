const SERVER_URL = "https://animepsykongroo.onrender.com";
const ADMIN_USERNAME = "kgwabc";

let socket = null;
let lastState = null;
let selectedAttackerId = null;
let dragState = null;
let pendingRenderState = null;
let currentAdminToken = null;
let loadedAdminCards = [];
let currentAuthToken = null;
let deckCatalog = [];
let currentDeckCardIds = [];
let lastTurnPlayerId = null;
let resultAutoReturnTimer = null;
const pendingInstallEffects = new Map(); // cardId -> { playerId }
const pendingBuffEffects = new Map(); // targetCharacterId -> { playerId }
const pendingAttackEffects = []; // { attackerId, attackerCardId, target }

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
  ALL_ALLIES: "내 캐릭터 전체",
  TARGET_CHARACTER: "지정 캐릭터",
  SELF: "자신",
};

const screens = {
  auth: document.getElementById("screen-auth"),
  lobby: document.getElementById("screen-lobby"),
  waiting: document.getElementById("screen-waiting"),
  deckBuilder: document.getElementById("screen-deck-builder"),
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
    currentAuthToken = token;
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
    group.classList.toggle("hidden", !group.dataset.typeGroup.split(",").includes(type));
  }
  populateTriggerOptions(document.getElementById("new-card-trigger"), type);
}

function populateTagOptions(selectEl, cards, defaultLabel) {
  const previousValue = selectEl.value;
  const tags = [...new Set(cards.flatMap((card) => card.synergyTags || []))].sort();

  selectEl.innerHTML = `<option value="">${defaultLabel}</option>`;
  for (const tag of tags) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    selectEl.appendChild(option);
  }
  if (tags.includes(previousValue)) selectEl.value = previousValue;
}

document.getElementById("new-card-type").addEventListener("change", updateNewCardFieldVisibility);
updateNewCardFieldVisibility();

function readImageAsCompressedDataUrl(file, { maxW = 300, maxH = 400, quality = 0.7 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다."));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

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
    loadedAdminCards = data.cards;
    populateSeriesFilterOptions(loadedAdminCards);
    populateTagOptions(document.getElementById("new-card-matchup-tag"), loadedAdminCards, "상성 없음");
    populateTagOptions(document.getElementById("new-card-required-tag"), loadedAdminCards, "대상 제한 없음");
    renderAdminCards(getFilteredAdminCards(), token);
  } catch (err) {
    listEl.textContent = "카드 목록을 불러올 수 없습니다.";
  }
}

function populateSeriesFilterOptions(cards) {
  const filterEl = document.getElementById("admin-card-series-filter");
  const previousValue = filterEl.value;
  const seriesValues = [...new Set(cards.map((card) => card.series))].sort();

  filterEl.innerHTML = '<option value="">전체 계열</option>';
  for (const series of seriesValues) {
    const option = document.createElement("option");
    option.value = series;
    option.textContent = series;
    filterEl.appendChild(option);
  }
  if (seriesValues.includes(previousValue)) filterEl.value = previousValue;
}

function getFilteredAdminCards() {
  const selected = document.getElementById("admin-card-series-filter").value;
  if (!selected) return loadedAdminCards;
  return loadedAdminCards.filter((card) => card.series === selected);
}

document.getElementById("admin-card-series-filter").addEventListener("change", () => {
  renderAdminCards(getFilteredAdminCards(), currentAdminToken);
});

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

  for (const card of cards) {
    const row = document.createElement("div");
    row.className = "admin-card-row";

    const thumbImg = document.createElement("img");
    thumbImg.className = "admin-card-thumb";
    thumbImg.src = card.image || "";
    thumbImg.classList.toggle("hidden", !card.image);

    const imageInput = document.createElement("input");
    imageInput.type = "file";
    imageInput.accept = "image/*";

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

    const raritySelect = createOptionSelect(
      [
        ["common", "일반"],
        ["legendary", "전설"],
      ],
      card.rarity || "common"
    );

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

    const matchupTagSelect = document.createElement("select");
    populateTagOptions(matchupTagSelect, loadedAdminCards, "상성 없음");
    matchupTagSelect.value = card.matchupVsTag || "";

    const matchupBonusInput = document.createElement("input");
    matchupBonusInput.type = "number";
    matchupBonusInput.min = "0";
    matchupBonusInput.value = card.matchupAtkBonus || 0;
    matchupBonusInput.placeholder = "상성 공격력 보너스";

    const attackNameInput = document.createElement("input");
    attackNameInput.type = "text";
    attackNameInput.maxLength = 30;
    attackNameInput.value = card.attackName || "";
    attackNameInput.placeholder = "공격 이름 (선택)";

    const requiredTagSelect = document.createElement("select");
    populateTagOptions(requiredTagSelect, loadedAdminCards, "대상 제한 없음");
    requiredTagSelect.value = card.requiredTargetTag || "";

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
      matchupTagSelect.classList.toggle("hidden", type !== "character");
      matchupBonusInput.classList.toggle("hidden", type !== "character");
      attackNameInput.classList.toggle("hidden", type !== "character");
      equipAtkInput.classList.toggle("hidden", type !== "equipment");
      equipHpInput.classList.toggle("hidden", type !== "equipment");
      requiredTagSelect.classList.toggle("hidden", type === "character");
      populateTriggerOptions(triggerSelect, type);
    }
    typeSelect.addEventListener("change", refreshFieldVisibility);
    refreshFieldVisibility();
    triggerSelect.value = existingEffect?.trigger || "";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "저장";
    saveBtn.addEventListener("click", async () => {
      const type = typeSelect.value;
      const fields = {
        name: nameInput.value,
        series: seriesInput.value,
        type,
        cost: Number(costInput.value),
        rarity: raritySelect.value,
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
        fields.matchupVsTag = matchupTagSelect.value || null;
        fields.matchupAtkBonus = Number(matchupBonusInput.value) || 0;
        fields.attackName = attackNameInput.value || null;
      }
      if (type === "equipment") {
        fields.equipAtkBonus = Number(equipAtkInput.value) || 0;
        fields.equipHpBonus = Number(equipHpInput.value) || 0;
      }
      if (type === "spell" || type === "equipment") {
        fields.requiredTargetTag = requiredTagSelect.value || null;
      }
      if (imageInput.files[0]) {
        fields.image = await readImageAsCompressedDataUrl(imageInput.files[0]);
      }
      updateAdminCard(card.id, fields, token);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", () => deleteAdminCard(card.id, token));

    row.append(
      thumbImg,
      imageInput,
      nameInput,
      seriesInput,
      typeSelect,
      costInput,
      raritySelect,
      tagsInput,
      descriptionInput,
      atkInput,
      hpInput,
      matchupTagSelect,
      matchupBonusInput,
      attackNameInput,
      equipAtkInput,
      equipHpInput,
      requiredTagSelect,
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
    rarity: document.getElementById("new-card-rarity").value,
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
    fields.matchupVsTag = document.getElementById("new-card-matchup-tag").value || null;
    fields.matchupAtkBonus = Number(document.getElementById("new-card-matchup-bonus").value) || 0;
    fields.attackName = document.getElementById("new-card-attack-name").value || null;
  }
  if (type === "equipment") {
    fields.equipAtkBonus = Number(document.getElementById("new-card-equip-atk").value) || 0;
    fields.equipHpBonus = Number(document.getElementById("new-card-equip-hp").value) || 0;
  }
  if (type === "spell" || type === "equipment") {
    fields.requiredTargetTag = document.getElementById("new-card-required-tag").value || null;
  }
  const imageFile = document.getElementById("new-card-image").files[0];
  if (imageFile) {
    fields.image = await readImageAsCompressedDataUrl(imageFile);
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

// ---------- 덱 편집 ----------

const DECK_SIZE = 30;
const MAX_COPIES_COMMON = 2;
const MAX_COPIES_LEGENDARY = 1;
const MAX_LEGENDARY_TOTAL = 2;

document.getElementById("btn-edit-deck").addEventListener("click", async () => {
  showScreen("deckBuilder");
  document.getElementById("deck-error").textContent = "";

  try {
    const [cardsRes, deckRes] = await Promise.all([
      fetch(`${SERVER_URL}/cards`, { headers: { Authorization: `Bearer ${currentAuthToken}` } }),
      fetch(`${SERVER_URL}/decks/mine`, { headers: { Authorization: `Bearer ${currentAuthToken}` } }),
    ]);
    const cardsData = await cardsRes.json();
    const deckData = await deckRes.json();
    if (!cardsData.ok || !deckData.ok) {
      document.getElementById("deck-error").textContent = cardsData.message || deckData.message;
      return;
    }
    deckCatalog = cardsData.cards;
    currentDeckCardIds = deckData.cardIds;
    renderDeckBuilder();
  } catch (err) {
    document.getElementById("deck-error").textContent = "덱 정보를 불러올 수 없습니다.";
  }
});

document.getElementById("btn-deck-back").addEventListener("click", () => {
  showScreen("lobby");
});

document.getElementById("btn-deck-save").addEventListener("click", async () => {
  const errorEl = document.getElementById("deck-error");
  errorEl.textContent = "";

  try {
    const res = await fetch(`${SERVER_URL}/decks/mine`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentAuthToken}`,
      },
      body: JSON.stringify({ cardIds: currentDeckCardIds }),
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
    showScreen("lobby");
  } catch (err) {
    errorEl.textContent = "덱 저장 중 오류가 발생했습니다.";
  }
});

function countCopiesInDeck(cardId) {
  return currentDeckCardIds.filter((id) => id === cardId).length;
}

function legendaryCountInDeck() {
  const cardsById = new Map(deckCatalog.map((card) => [card.id, card]));
  return currentDeckCardIds.filter((id) => cardsById.get(id)?.rarity === "legendary").length;
}

function addCardToDeck(card) {
  const maxCopies = card.rarity === "legendary" ? MAX_COPIES_LEGENDARY : MAX_COPIES_COMMON;
  if (currentDeckCardIds.length >= DECK_SIZE) return;
  if (countCopiesInDeck(card.id) >= maxCopies) return;
  if (card.rarity === "legendary" && legendaryCountInDeck() >= MAX_LEGENDARY_TOTAL) return;

  currentDeckCardIds.push(card.id);
  renderDeckBuilder();
}

function removeCardFromDeck(cardId) {
  const index = currentDeckCardIds.indexOf(cardId);
  if (index === -1) return;
  currentDeckCardIds.splice(index, 1);
  renderDeckBuilder();
}

function renderCardTile(card, { badgeText, buttonText, buttonDisabled, onButtonClick }) {
  const wrapper = document.createElement("div");
  wrapper.className = "card-tile";

  const cardEl = document.createElement("div");
  cardEl.className = "card";
  if (card.rarity === "legendary") cardEl.classList.add("legendary");
  if (!card.image) cardEl.classList.add("no-image");
  cardEl.innerHTML = cardFaceHtml(card);
  wrapper.appendChild(cardEl);

  const footer = document.createElement("div");
  footer.className = "card-tile-footer";

  const badge = document.createElement("span");
  badge.className = "card-tile-badge";
  badge.textContent = badgeText;
  footer.appendChild(badge);

  const btn = document.createElement("button");
  btn.textContent = buttonText;
  btn.disabled = Boolean(buttonDisabled);
  btn.addEventListener("click", onButtonClick);
  footer.appendChild(btn);

  wrapper.appendChild(footer);
  return wrapper;
}

function renderDeckBuilder() {
  const cardsById = new Map(deckCatalog.map((card) => [card.id, card]));
  document.getElementById("deck-count").textContent = currentDeckCardIds.length;
  document.getElementById("deck-legendary-count").textContent = legendaryCountInDeck();

  const catalogEl = document.getElementById("deck-catalog-list");
  catalogEl.innerHTML = "";
  for (const card of deckCatalog) {
    const copies = countCopiesInDeck(card.id);
    const maxCopies = card.rarity === "legendary" ? MAX_COPIES_LEGENDARY : MAX_COPIES_COMMON;
    const legendaryBlocked = card.rarity === "legendary" && legendaryCountInDeck() >= MAX_LEGENDARY_TOTAL && copies === 0;

    catalogEl.appendChild(
      renderCardTile(card, {
        badgeText: `${copies}장 보유중`,
        buttonText: "추가",
        buttonDisabled: currentDeckCardIds.length >= DECK_SIZE || copies >= maxCopies || legendaryBlocked,
        onButtonClick: () => addCardToDeck(card),
      })
    );
  }

  const deckEl = document.getElementById("deck-current-list");
  deckEl.innerHTML = "";
  const uniqueDeckCardIds = [...new Set(currentDeckCardIds)];
  for (const cardId of uniqueDeckCardIds) {
    const card = cardsById.get(cardId);
    if (!card) continue;

    deckEl.appendChild(
      renderCardTile(card, {
        badgeText: `x${countCopiesInDeck(cardId)}`,
        buttonText: "제거",
        onButtonClick: () => removeCardFromDeck(cardId),
      })
    );
  }

  catalogEl.querySelectorAll(".name").forEach(fitCardName);
  deckEl.querySelectorAll(".name").forEach(fitCardName);
}

// ---------- 게임 ----------

document.getElementById("btn-join-queue").addEventListener("click", () => {
  socket.emit("join_queue");
  showScreen("waiting");
});

document.getElementById("btn-end-turn").addEventListener("click", () => {
  socket.emit("end_turn");
});

document.getElementById("btn-surrender").addEventListener("click", () => {
  if (confirm("정말 기권하시겠습니까?")) {
    socket.emit("surrender");
  }
});

function registerSocketHandlers() {
  socket.on("match_found", (state) => {
    showScreen("game");
    renderState(state);
  });

  socket.on("game_state_update", (state) => {
    if (dragState) {
      pendingRenderState = state;
      return;
    }
    renderState(state);
  });

  socket.on("action_error", (reason) => {
    console.warn("action_error:", reason);
    selectedAttackerId = null;
    if (lastState) renderState(lastState);
  });

  socket.on("queue_error", (message) => {
    document.getElementById("lobby-status").textContent = message;
    showScreen("lobby");
  });

  socket.on("opponent_disconnected", () => {
    document.getElementById("result-text").textContent = "상대가 접속을 종료했습니다.";
    showScreen("result");
    resultAutoReturnTimer = setTimeout(returnToLobby, 15000);
  });

  socket.on("game_over", ({ result }) => {
    document.getElementById("result-text").textContent =
      result === "win" ? "승리했습니다!" : "패배했습니다.";
    showScreen("result");
    resultAutoReturnTimer = setTimeout(returnToLobby, 15000);
  });

  socket.on("card_played", ({ playerId, card, targetCharacterId }) => {
    if (card?.type === "spell") {
      showSpellEffect(card);
      return;
    }

    if (targetCharacterId) {
      pendingBuffEffects.set(targetCharacterId, { playerId });
      return;
    }

    pendingInstallEffects.set(card.id, { playerId });
  });

  socket.on("attack_occurred", ({ attackerId, attackerCardId, target, attackerCard }) => {
    pendingAttackEffects.push({ attackerId, attackerCardId, target, attackerCard });
  });
}

function returnToLobby() {
  if (resultAutoReturnTimer) {
    clearTimeout(resultAutoReturnTimer);
    resultAutoReturnTimer = null;
  }
  selectedAttackerId = null;
  dragState = null;
  pendingRenderState = null;
  lastState = null;
  lastTurnPlayerId = null;
  pendingInstallEffects.clear();
  pendingBuffEffects.clear();
  pendingAttackEffects.length = 0;
  showScreen("lobby");
}

document.getElementById("btn-back-to-lobby").addEventListener("click", returnToLobby);

function showAttackNamePopup(attackerEl, text) {
  if (!attackerEl || !text) return;
  const rect = attackerEl.getBoundingClientRect();
  const layer = document.getElementById("spell-effect-layer");
  const el = document.createElement("div");
  el.className = "attack-name-popup";
  el.textContent = text;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height / 2}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function showSpellEffect(card) {
  const layer = document.getElementById("spell-effect-layer");
  const el = document.createElement("div");
  el.className = "spell-effect-card";
  if (card.image) el.style.backgroundImage = `url('${card.image}')`;
  el.innerHTML = `<div class="spell-effect-name">${card.name}</div>`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

function describeEffect(effect) {
  if (!effect) return "";
  return `${ACTION_LABELS[effect.action] || effect.action} ${effect.value} (${TARGET_LABELS[effect.target] || effect.target})`;
}

function cardNeedsTargetCharacter(card) {
  return (card.effects || []).some((effect) => effect.target === "TARGET_CHARACTER");
}

function cardStatsHtml(card) {
  if (card.type === "character") {
    return `<div class="atk-hp"><span class="atk">⚔${card.atk}</span><span class="hp">❤${card.hp}</span></div>`;
  }
  if (card.type === "equipment") {
    return `<div class="atk-hp"><span class="atk">+${card.equipAtkBonus || 0}</span><span class="hp">+${card.equipHpBonus || 0}</span></div>`;
  }
  return "";
}

function cardDescHtml(card) {
  let descHtml = "";
  if (card.effects?.length) descHtml += `<div class="effect-summary">${describeEffect(card.effects[0])}</div>`;
  if (card.matchupVsTag) {
    descHtml += `<div class="effect-summary">⚔ ${card.matchupVsTag} 상대 +${card.matchupAtkBonus || 0}</div>`;
  }
  if (card.requiredTargetTag) {
    descHtml += `<div class="effect-summary">🎯 ${card.requiredTargetTag} 전용</div>`;
  }
  if (card.description) descHtml += `<div class="effect-summary">${card.description}</div>`;
  return descHtml;
}

function fitCardName(nameEl) {
  const card = nameEl.closest(".card");
  const cardHeight = card ? card.getBoundingClientRect().height : 0;
  const maxHeight = cardHeight > 0 ? cardHeight * 0.6 : 40;
  nameEl.style.maxHeight = `${maxHeight}px`;
  let size = 12;
  nameEl.style.fontSize = `${size}px`;
  while (nameEl.scrollHeight > nameEl.clientHeight && size > 7) {
    size -= 0.5;
    nameEl.style.fontSize = `${size}px`;
  }
}

function refitAllCardNames() {
  document.querySelectorAll("#screen-game .name").forEach(fitCardName);
}

let resizeFitTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeFitTimer);
  resizeFitTimer = setTimeout(refitAllCardNames, 150);
});
window.addEventListener("orientationchange", () => {
  clearTimeout(resizeFitTimer);
  resizeFitTimer = setTimeout(refitAllCardNames, 150);
});

function cardFaceHtml(card) {
  const artStyle = card.image ? ` style="background-image:url('${card.image}')"` : "";
  return `
    <div class="card-art"${artStyle}></div>
    <div class="card-stats">
      <span class="cost-badge">${card.cost}</span>
      ${cardStatsHtml(card)}
    </div>
    <div class="card-hover-info">
      <div class="name">${card.name}</div>
      ${cardDescHtml(card)}
    </div>
  `;
}

function renderCard(card, role, isMyTurn) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.cardId = card.id;
  if (card.rarity === "legendary") el.classList.add("legendary");
  if (!card.image) el.classList.add("no-image");

  el.innerHTML = cardFaceHtml(card);

  if (role === "hand") {
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => startCardDrag(e, card, el));
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

function findDropTarget(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cardEl = el.closest(".card");
  const myBoardEl = document.getElementById("my-board");
  const oppBoardEl = document.getElementById("opp-board");
  if (cardEl && cardEl.dataset.cardId && (myBoardEl.contains(cardEl) || oppBoardEl.contains(cardEl))) {
    return { boardSide: myBoardEl.contains(cardEl) ? "my" : "opp", cardEl };
  }
  if (el.closest("#my-board")) return { boardSide: "my", cardEl: null };
  if (el.closest("#opp-board")) return { boardSide: "opp", cardEl: null };
  return null;
}

function dropIsValid(card, dropTarget) {
  if (!dropTarget) return false;
  if (card.type === "character") {
    return dropTarget.boardSide === "my";
  }
  if (card.type === "equipment") {
    return dropTarget.boardSide === "my" && Boolean(dropTarget.cardEl);
  }
  if (card.type === "spell") {
    if (cardNeedsTargetCharacter(card)) return Boolean(dropTarget.cardEl);
    return true;
  }
  return false;
}

function clearDropHints() {
  for (const el of document.querySelectorAll(".drop-hint")) {
    el.classList.remove("drop-hint");
  }
}

function updateDropHint(card, x, y) {
  clearDropHints();
  const dropTarget = findDropTarget(x, y);
  if (!dropIsValid(card, dropTarget)) return;
  if (dropTarget.cardEl) {
    dropTarget.cardEl.classList.add("drop-hint");
  } else {
    document.getElementById(dropTarget.boardSide === "my" ? "my-board" : "opp-board").classList.add("drop-hint");
  }
}

function startCardDrag(e, card, el) {
  if (dragState) return;
  e.preventDefault();
  const rect = el.getBoundingClientRect();
  el.setPointerCapture(e.pointerId);
  el.classList.add("dragging");
  el.style.position = "fixed";
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.zIndex = "200";

  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  function onMove(ev) {
    el.style.left = `${ev.clientX - offsetX}px`;
    el.style.top = `${ev.clientY - offsetY}px`;
    updateDropHint(card, ev.clientX, ev.clientY);
  }

  function onUp(ev) {
    const dropTarget = findDropTarget(ev.clientX, ev.clientY);
    if (dropIsValid(card, dropTarget)) {
      if (card.type === "character" || (card.type === "spell" && !cardNeedsTargetCharacter(card))) {
        socket.emit("play_card", { cardId: card.id });
      } else if (card.type === "spell") {
        socket.emit("play_card", { cardId: card.id, target: { cardId: dropTarget.cardEl.dataset.cardId } });
      } else if (card.type === "equipment") {
        socket.emit("equip_card", { equipmentCardId: card.id, targetCharacterId: dropTarget.cardEl.dataset.cardId });
      }
    }
    endCardDrag(el, onMove, onUp);
  }

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  dragState = { card, el };
}

function endCardDrag(el, onMove, onUp) {
  el.removeEventListener("pointermove", onMove);
  el.removeEventListener("pointerup", onUp);
  el.removeEventListener("pointercancel", onUp);
  el.classList.remove("dragging");
  el.style.position = "";
  el.style.left = "";
  el.style.top = "";
  el.style.width = "";
  el.style.height = "";
  el.style.zIndex = "";
  clearDropHints();
  dragState = null;
  if (pendingRenderState) {
    const state = pendingRenderState;
    pendingRenderState = null;
    renderState(state);
  }
}

function flashClass(el, className, durationMs) {
  if (!el) return;
  el.classList.add(className);
  const clear = () => el.classList.remove(className);
  el.addEventListener("animationend", clear, { once: true });
  setTimeout(clear, durationMs);
}

function applyPendingCardEffects(boardEl, role) {
  for (const card of boardEl.querySelectorAll(".card")) {
    const cardId = card.dataset.cardId;
    if (pendingInstallEffects.has(cardId)) {
      pendingInstallEffects.delete(cardId);
      flashClass(card, "card-slam", 500);
    }
    if (pendingBuffEffects.has(cardId)) {
      pendingBuffEffects.delete(cardId);
      flashClass(card, "buff-flash", 600);
    }
  }
}

function applyPendingAttackEffects() {
  while (pendingAttackEffects.length > 0) {
    const { attackerId, attackerCardId, target, attackerCard } = pendingAttackEffects.shift();
    const attackerBoardEl = attackerId === socket.id ? document.getElementById("my-board") : document.getElementById("opp-board");
    const attackerEl = attackerBoardEl.querySelector(`.card[data-card-id="${attackerCardId}"]`);
    flashClass(attackerEl, attackerId === socket.id ? "attack-lunge-up" : "attack-lunge-down", 350);
    if (attackerCard?.attackName) {
      showAttackNamePopup(attackerEl, attackerCard.attackName);
    }

    if (target?.type === "character") {
      const targetBoardEl = attackerId === socket.id ? document.getElementById("opp-board") : document.getElementById("my-board");
      const targetEl = targetBoardEl.querySelector(`.card[data-card-id="${target.cardId}"]`);
      flashClass(targetEl, "impact-flash", 500);
    } else if (target?.type === "hero") {
      const heroAreaEl = attackerId === socket.id ? document.getElementById("opponent-area") : document.getElementById("my-area");
      flashClass(heroAreaEl, "impact-flash", 500);
    }
  }
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

  if (lastTurnPlayerId !== null && lastTurnPlayerId !== state.currentPlayerId) {
    flashClass(document.getElementById("turn-indicator"), "turn-flash", 600);
  }
  lastTurnPlayerId = state.currentPlayerId;

  const myHandEl = document.getElementById("my-hand");
  myHandEl.innerHTML = "";
  for (const card of state.me.hand) {
    myHandEl.appendChild(renderCard(card, "hand"));
  }

  const oppHandEl = document.getElementById("opp-hand");
  oppHandEl.innerHTML = "";
  for (let i = 0; i < state.opponent.handCount; i++) {
    const back = document.createElement("div");
    back.className = "card card-back";
    oppHandEl.appendChild(back);
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

  applyPendingCardEffects(myBoardEl, "my-board");
  applyPendingCardEffects(oppBoardEl, "opp-board");
  applyPendingAttackEffects();

  refitAllCardNames();

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
