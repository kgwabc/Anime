const SERVER_URL = "https://animepsykongroo.onrender.com";
const ADMIN_USERNAME = "kgwabc";
const DEATH_SKILL_DELAY_MS = 1500;
const DEATH_SKILL_REBUILD_BUFFER_MS = 400;

let socket = null;
let lastState = null;
let selectedAttackerId = null;
let dragState = null;
let pendingRenderState = null;
let currentAdminToken = null;
let loadedAdminCards = [];
let currentAuthToken = null;
let deckCatalog = [];
let allowedCardIds = new Set();
let currentDeckCardIds = [];
let lastTurnPlayerId = null;
let resultAutoReturnTimer = null;
let pendingBoardRebuildTimer = null;
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
  KILLER: "나를 파괴한 대상",
};

const screens = {
  loading: document.getElementById("screen-loading"),
  auth: document.getElementById("screen-auth"),
  lobby: document.getElementById("screen-lobby"),
  waiting: document.getElementById("screen-waiting"),
  stageSelect: document.getElementById("screen-stage-select"),
  deckBuilder: document.getElementById("screen-deck-builder"),
  shop: document.getElementById("screen-shop"),
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

  socket.on("connect", async () => {
    document.getElementById("lobby-username").textContent = username;
    currentAuthToken = token;
    showScreen("lobby");
    refreshLobbyCoins();

    const adminPanel = document.getElementById("admin-panel");
    if (username === ADMIN_USERNAME) {
      adminPanel.classList.remove("hidden");
      currentAdminToken = token;
      await loadAdminCards(token);
      loadAdminUsers(token);
      loadAdminStarterCards(token);
      loadAdminStageDecks(token);
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
    label.textContent = `${user.username} (🪙 ${user.coins})`;
    row.appendChild(label);

    const coinInput = document.createElement("input");
    coinInput.type = "number";
    coinInput.placeholder = "±코인";
    coinInput.className = "admin-coin-input";
    row.appendChild(coinInput);

    const coinBtn = document.createElement("button");
    coinBtn.className = "admin-coin-btn";
    coinBtn.textContent = "지급/차감";
    coinBtn.addEventListener("click", () => adjustAdminUserCoins(user.username, coinInput.value, token));
    row.appendChild(coinBtn);

    const cardSelect = document.createElement("select");
    cardSelect.className = "admin-card-select";
    for (const card of loadedAdminCards) {
      const option = document.createElement("option");
      option.value = card.id;
      option.textContent = card.name;
      cardSelect.appendChild(option);
    }
    row.appendChild(cardSelect);

    const grantBtn = document.createElement("button");
    grantBtn.className = "admin-coin-btn";
    grantBtn.textContent = "카드 지급";
    grantBtn.addEventListener("click", () => grantAdminUserCard(user.username, cardSelect.value, token));
    row.appendChild(grantBtn);

    const revokeBtn = document.createElement("button");
    revokeBtn.textContent = "카드 회수";
    revokeBtn.addEventListener("click", () => revokeAdminUserCard(user.username, cardSelect.value, token));
    row.appendChild(revokeBtn);

    if (user.username !== ADMIN_USERNAME) {
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "삭제";
      deleteBtn.addEventListener("click", () => deleteAdminUser(user.username, token));
      row.appendChild(deleteBtn);
    }

    listEl.appendChild(row);
  }
}

async function adjustAdminUserCoins(username, amountStr, token) {
  const amount = parseInt(amountStr, 10);
  if (!Number.isInteger(amount)) {
    alert("코인 수치를 정수로 입력해주세요.");
    return;
  }

  try {
    const res = await fetch(`${SERVER_URL}/auth/users/${encodeURIComponent(username)}/coins`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount }),
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.message);
      return;
    }
    loadAdminUsers(token);
  } catch (err) {
    alert("코인 조정 중 오류가 발생했습니다.");
  }
}

async function grantAdminUserCard(username, cardId, token) {
  if (!cardId) return;

  try {
    const res = await fetch(`${SERVER_URL}/auth/users/${encodeURIComponent(username)}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cardId }),
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.message);
    }
  } catch (err) {
    alert("카드 지급 중 오류가 발생했습니다.");
  }
}

async function revokeAdminUserCard(username, cardId, token) {
  if (!cardId) return;

  try {
    const res = await fetch(
      `${SERVER_URL}/auth/users/${encodeURIComponent(username)}/cards/${encodeURIComponent(cardId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!data.ok) {
      alert(data.message);
    }
  } catch (err) {
    alert("카드 회수 중 오류가 발생했습니다.");
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

    const overridesAppearanceLabel = document.createElement("label");
    const overridesAppearanceInput = document.createElement("input");
    overridesAppearanceInput.type = "checkbox";
    overridesAppearanceInput.checked = !!card.overridesAppearance;
    overridesAppearanceLabel.append(overridesAppearanceInput, "장착시 외형 교체");

    const attackNameOverrideInput = document.createElement("input");
    attackNameOverrideInput.type = "text";
    attackNameOverrideInput.maxLength = 30;
    attackNameOverrideInput.value = card.attackNameOverride || "";
    attackNameOverrideInput.placeholder = "장착시 공격 이름 교체 (선택)";

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

    const skillNameInput = document.createElement("input");
    skillNameInput.type = "text";
    skillNameInput.maxLength = 30;
    skillNameInput.value = card.skillName || "";
    skillNameInput.placeholder = "기술 이름 (설치시/파괴시, 선택)";

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
      skillNameInput.classList.toggle("hidden", type !== "character");
      equipAtkInput.classList.toggle("hidden", type !== "equipment");
      equipHpInput.classList.toggle("hidden", type !== "equipment");
      overridesAppearanceLabel.classList.toggle("hidden", type !== "equipment");
      attackNameOverrideInput.classList.toggle("hidden", type !== "equipment");
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
        fields.skillName = skillNameInput.value || null;
      }
      if (type === "equipment") {
        fields.equipAtkBonus = Number(equipAtkInput.value) || 0;
        fields.equipHpBonus = Number(equipHpInput.value) || 0;
        fields.overridesAppearance = overridesAppearanceInput.checked;
        fields.attackNameOverride = attackNameOverrideInput.value || null;
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
      skillNameInput,
      equipAtkInput,
      equipHpInput,
      overridesAppearanceLabel,
      attackNameOverrideInput,
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
    fields.skillName = document.getElementById("new-card-skill-name").value || null;
  }
  if (type === "equipment") {
    fields.equipAtkBonus = Number(document.getElementById("new-card-equip-atk").value) || 0;
    fields.equipHpBonus = Number(document.getElementById("new-card-equip-hp").value) || 0;
    fields.overridesAppearance = document.getElementById("new-card-overrides-appearance").checked;
    fields.attackNameOverride = document.getElementById("new-card-attack-name-override").value || null;
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

// ---------- 서버 깨우기(로딩 화면) ----------

const WAKE_RETRY_DELAY_MS = 4000;

function wakeServer() {
  const statusEl = document.getElementById("loading-status");
  const startButton = document.getElementById("btn-start-game");

  fetch(SERVER_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`);
      statusEl.textContent = "준비 완료!";
      startButton.classList.remove("hidden");
    })
    .catch(() => {
      statusEl.textContent = "서버 연결 재시도 중...";
      setTimeout(wakeServer, WAKE_RETRY_DELAY_MS);
    });
}

document.getElementById("btn-start-game").addEventListener("click", () => {
  const savedToken = localStorage.getItem("tcg_token");
  const savedUsername = localStorage.getItem("tcg_username");
  if (savedToken && savedUsername) {
    connectSocket(savedToken, savedUsername);
  } else {
    showScreen("auth");
  }
});

showScreen("loading");
wakeServer();

// ---------- 덱 편집 ----------

const DECK_SIZE = 30;
const MAX_COPIES_COMMON = 2;
const MAX_COPIES_LEGENDARY = 1;
const MAX_LEGENDARY_TOTAL = 2;

document.getElementById("btn-edit-deck").addEventListener("click", async () => {
  showScreen("deckBuilder");
  document.getElementById("deck-error").textContent = "";

  try {
    const [cardsRes, deckRes, collectionRes] = await Promise.all([
      fetch(`${SERVER_URL}/cards`, { headers: { Authorization: `Bearer ${currentAuthToken}` } }),
      fetch(`${SERVER_URL}/decks/mine`, { headers: { Authorization: `Bearer ${currentAuthToken}` } }),
      fetch(`${SERVER_URL}/shop/collection/mine`, { headers: { Authorization: `Bearer ${currentAuthToken}` } }),
    ]);
    const cardsData = await cardsRes.json();
    const deckData = await deckRes.json();
    const collectionData = await collectionRes.json();
    if (!cardsData.ok || !deckData.ok || !collectionData.ok) {
      document.getElementById("deck-error").textContent = cardsData.message || deckData.message || collectionData.message;
      return;
    }
    allowedCardIds = new Set([...collectionData.ownedCardIds, ...collectionData.starterCardIds]);
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
  for (const card of deckCatalog.filter((card) => allowedCardIds.has(card.id))) {
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

// ---------- 코인 ----------

function setCoinDisplays(coins) {
  for (const el of [document.getElementById("lobby-coins"), document.getElementById("shop-coins")]) {
    if (el) el.textContent = `🪙 ${coins}`;
  }
}

async function refreshLobbyCoins() {
  try {
    const res = await fetch(`${SERVER_URL}/shop/collection/mine`, {
      headers: { Authorization: `Bearer ${currentAuthToken}` },
    });
    const data = await res.json();
    if (data.ok) setCoinDisplays(data.coins);
  } catch (err) {
    // 로비 코인 표시는 실패해도 치명적이지 않으므로 조용히 무시
  }
}

// ---------- 어드벤처 모드 ----------

document.getElementById("btn-open-adventure").addEventListener("click", () => {
  showScreen("stageSelect");
  loadStages();
});

document.getElementById("btn-stage-select-back").addEventListener("click", () => {
  showScreen("lobby");
});

async function loadStages() {
  const errorEl = document.getElementById("stage-select-error");
  errorEl.textContent = "";

  try {
    const res = await fetch(`${SERVER_URL}/stages`, {
      headers: { Authorization: `Bearer ${currentAuthToken}` },
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
    renderStageList(data.stages);
  } catch (err) {
    errorEl.textContent = "스테이지 목록을 불러올 수 없습니다.";
  }
}

function renderStageList(stages) {
  const listEl = document.getElementById("stage-list");
  listEl.innerHTML = "";

  for (const stage of stages) {
    const tile = document.createElement("div");
    tile.className = "stage-tile";

    const title = document.createElement("div");
    title.textContent = `${stage.name} — ${stage.aiName}${stage.cleared ? " ✅" : ""}`;
    tile.appendChild(title);

    const challengeBtn = document.createElement("button");
    challengeBtn.textContent = stage.locked ? "잠김" : "도전";
    challengeBtn.disabled = stage.locked;
    challengeBtn.addEventListener("click", () => {
      socket.emit("start_stage_match", { stageId: stage.id });
      showScreen("waiting");
    });
    tile.appendChild(challengeBtn);

    listEl.appendChild(tile);
  }
}

// ---------- 상점 ----------

let shopPacks = [];

document.getElementById("btn-open-shop").addEventListener("click", () => {
  showScreen("shop");
  loadShop();
});

document.getElementById("btn-shop-back").addEventListener("click", () => {
  showScreen("lobby");
});

async function loadShop() {
  const errorEl = document.getElementById("shop-error");
  errorEl.textContent = "";

  try {
    const [packsRes, collectionRes] = await Promise.all([
      fetch(`${SERVER_URL}/shop/packs`, { headers: { Authorization: `Bearer ${currentAuthToken}` } }),
      fetch(`${SERVER_URL}/shop/collection/mine`, { headers: { Authorization: `Bearer ${currentAuthToken}` } }),
    ]);
    const packsData = await packsRes.json();
    const collectionData = await collectionRes.json();
    if (!packsData.ok || !collectionData.ok) {
      errorEl.textContent = packsData.message || collectionData.message;
      return;
    }
    shopPacks = packsData.packs;
    setCoinDisplays(collectionData.coins);
    renderShopPacks();
    await renderShopCollection(collectionData);
  } catch (err) {
    errorEl.textContent = "상점 정보를 불러올 수 없습니다.";
  }
}

function renderShopPacks() {
  const listEl = document.getElementById("shop-pack-list");
  listEl.innerHTML = "";

  for (const pack of shopPacks) {
    const tile = document.createElement("div");
    tile.className = `pack-card pack-card--${pack.id}`;

    const name = document.createElement("div");
    name.className = "pack-card-name";
    name.textContent = pack.name;
    tile.appendChild(name);

    const info = document.createElement("div");
    info.className = "pack-card-info";
    info.textContent = `🪙 ${pack.cost} · 전설 확률 ${Math.round(pack.legendaryChance * 100)}%`;
    tile.appendChild(info);

    const btn = document.createElement("button");
    btn.textContent = "열기";
    btn.addEventListener("click", () => openPack(pack.id));
    tile.appendChild(btn);

    listEl.appendChild(tile);
  }
}

async function renderShopCollection(collectionData) {
  const gridEl = document.getElementById("shop-collection-grid");
  gridEl.innerHTML = "불러오는 중...";

  try {
    const res = await fetch(`${SERVER_URL}/cards`, { headers: { Authorization: `Bearer ${currentAuthToken}` } });
    const data = await res.json();
    if (!data.ok) {
      gridEl.textContent = data.message;
      return;
    }
    const allowedIds = new Set([...collectionData.ownedCardIds, ...collectionData.starterCardIds]);
    const ownedCards = data.cards.filter((card) => allowedIds.has(card.id));

    gridEl.innerHTML = "";
    for (const card of ownedCards) {
      gridEl.appendChild(
        renderCardTile(card, {
          badgeText: collectionData.starterCardIds.includes(card.id) ? "스타터" : "보유중",
          buttonText: "✓ 보유",
          buttonDisabled: true,
          onButtonClick: () => {},
        })
      );
    }
    gridEl.querySelectorAll(".name").forEach(fitCardName);
  } catch (err) {
    gridEl.textContent = "카드 목록을 불러올 수 없습니다.";
  }
}

async function openPack(packId) {
  const errorEl = document.getElementById("shop-error");
  errorEl.textContent = "";

  try {
    const res = await fetch(`${SERVER_URL}/shop/packs/${packId}/open`, {
      method: "POST",
      headers: { Authorization: `Bearer ${currentAuthToken}` },
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
    setCoinDisplays(data.coins);
    showPackReveal(data.card, data.isDuplicate, data.refund);
    const collectionRes = await fetch(`${SERVER_URL}/shop/collection/mine`, {
      headers: { Authorization: `Bearer ${currentAuthToken}` },
    });
    const collectionData = await collectionRes.json();
    if (collectionData.ok) await renderShopCollection(collectionData);
  } catch (err) {
    errorEl.textContent = "카드팩 오픈 중 오류가 발생했습니다.";
  }
}

function showPackReveal(card, isDuplicate, refund) {
  const layer = document.getElementById("pack-reveal-layer");
  const wrapper = document.createElement("div");
  wrapper.className = "pack-reveal-card";

  const cardEl = document.createElement("div");
  cardEl.className = "card card-slam";
  if (card.rarity === "legendary") cardEl.classList.add("legendary");
  if (!card.image) cardEl.classList.add("no-image");
  cardEl.innerHTML = cardFaceHtml(card);
  wrapper.appendChild(cardEl);

  if (isDuplicate) {
    const dupText = document.createElement("div");
    dupText.className = "pack-reveal-duplicate";
    dupText.textContent = `중복! 🪙 ${refund} 환급`;
    wrapper.appendChild(dupText);
  }

  layer.appendChild(wrapper);
  wrapper.querySelectorAll(".name").forEach(fitCardName);
  setTimeout(() => wrapper.remove(), 1600);
}

// ---------- 관리자: 스타터 카드 ----------

let allAdminCardsForStarter = [];

async function loadAdminStarterCards(token) {
  const listEl = document.getElementById("admin-starter-card-list");
  listEl.textContent = "불러오는 중...";

  try {
    const [cardsRes, starterRes] = await Promise.all([
      fetch(`${SERVER_URL}/cards`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${SERVER_URL}/cards/starter`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const cardsData = await cardsRes.json();
    const starterData = await starterRes.json();
    if (!cardsData.ok || !starterData.ok) {
      listEl.textContent = cardsData.message || starterData.message;
      return;
    }
    allAdminCardsForStarter = cardsData.cards;
    renderAdminStarterCards(new Set(starterData.cardIds));
  } catch (err) {
    listEl.textContent = "스타터 카드 목록을 불러올 수 없습니다.";
  }
}

function renderAdminStarterCards(starterCardIds) {
  const listEl = document.getElementById("admin-starter-card-list");
  listEl.innerHTML = "";

  for (const card of allAdminCardsForStarter) {
    const label = document.createElement("label");
    label.className = "admin-starter-card-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.cardId = card.id;
    checkbox.checked = starterCardIds.has(card.id);
    label.appendChild(checkbox);

    const text = document.createElement("span");
    text.textContent = `${card.name} (${card.rarity === "legendary" ? "전설" : "일반"})`;
    label.appendChild(text);

    listEl.appendChild(label);
  }
}

document.getElementById("btn-save-starter-cards").addEventListener("click", async () => {
  const errorEl = document.getElementById("admin-starter-error");
  errorEl.textContent = "";

  const cardIds = Array.from(
    document.querySelectorAll("#admin-starter-card-list input[type=checkbox]:checked")
  ).map((el) => el.dataset.cardId);

  try {
    const res = await fetch(`${SERVER_URL}/cards/starter`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentAdminToken}` },
      body: JSON.stringify({ cardIds }),
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
  } catch (err) {
    errorEl.textContent = "스타터 카드 저장 중 오류가 발생했습니다.";
  }
});

// ---------- 관리자: 스테이지 덱 편집 ----------

async function loadAdminStageDecks(token) {
  const errorEl = document.getElementById("admin-stage-deck-error");
  errorEl.textContent = "";
  const selectEl = document.getElementById("admin-stage-select");

  try {
    const res = await fetch(`${SERVER_URL}/stages`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }

    const previousValue = selectEl.value;
    selectEl.innerHTML = "";
    for (const stage of data.stages) {
      const option = document.createElement("option");
      option.value = stage.id;
      option.textContent = `${stage.name} (${stage.aiName})`;
      selectEl.appendChild(option);
    }
    if (data.stages.some((stage) => String(stage.id) === previousValue)) {
      selectEl.value = previousValue;
    }

    await loadAdminStageDeck(selectEl.value, token);
  } catch (err) {
    errorEl.textContent = "스테이지 목록을 불러올 수 없습니다.";
  }
}

document.getElementById("admin-stage-select").addEventListener("change", (e) => {
  if (currentAdminToken) loadAdminStageDeck(e.target.value, currentAdminToken);
});

async function loadAdminStageDeck(stageId, token) {
  const errorEl = document.getElementById("admin-stage-deck-error");
  errorEl.textContent = "";
  if (!stageId) return;

  try {
    const res = await fetch(`${SERVER_URL}/stages/${encodeURIComponent(stageId)}/deck`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
    renderAdminStageDeck(data.cardIds);
  } catch (err) {
    errorEl.textContent = "스테이지 덱을 불러올 수 없습니다.";
  }
}

function renderAdminStageDeck(cardIds) {
  const listEl = document.getElementById("admin-stage-deck-list");
  listEl.innerHTML = "";

  const counts = new Map();
  for (const cardId of cardIds) {
    counts.set(cardId, (counts.get(cardId) || 0) + 1);
  }

  for (const card of loadedAdminCards) {
    const row = document.createElement("label");
    row.className = "admin-stage-deck-row";

    const text = document.createElement("span");
    text.textContent = `${card.name} (${card.cost}코스트)`;
    row.appendChild(text);

    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "0";
    countInput.value = counts.get(card.id) || 0;
    countInput.dataset.cardId = card.id;
    row.appendChild(countInput);

    listEl.appendChild(row);
  }
}

document.getElementById("btn-save-stage-deck").addEventListener("click", async () => {
  const errorEl = document.getElementById("admin-stage-deck-error");
  errorEl.textContent = "";

  const stageId = document.getElementById("admin-stage-select").value;
  if (!stageId) return;

  const cardIds = Array.from(document.querySelectorAll("#admin-stage-deck-list input[type=number]")).flatMap(
    (el) => Array(Number(el.value) || 0).fill(el.dataset.cardId)
  );

  try {
    const res = await fetch(`${SERVER_URL}/stages/${encodeURIComponent(stageId)}/deck`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentAdminToken}` },
      body: JSON.stringify({ cardIds }),
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
  } catch (err) {
    errorEl.textContent = "스테이지 덱 저장 중 오류가 발생했습니다.";
  }
});

document.getElementById("btn-reset-all-decks").addEventListener("click", async () => {
  const errorEl = document.getElementById("admin-deck-reset-error");
  errorEl.textContent = "";

  if (!confirm("모든 유저의 덱을 초기화하시겠습니까? 각자 다시 덱을 짜야 합니다.")) return;

  try {
    const res = await fetch(`${SERVER_URL}/decks/all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${currentAdminToken}` },
    });
    const data = await res.json();
    if (!data.ok) {
      errorEl.textContent = data.message;
      return;
    }
  } catch (err) {
    errorEl.textContent = "덱 초기화 중 오류가 발생했습니다.";
  }
});

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

  socket.on("stage_error", (message) => {
    document.getElementById("stage-select-error").textContent = message;
    showScreen("stageSelect");
  });

  socket.on("opponent_disconnected", () => {
    document.getElementById("result-text").textContent = "상대가 접속을 종료했습니다.";
    showScreen("result");
    resultAutoReturnTimer = setTimeout(returnToLobby, 15000);
  });

  socket.on("game_over", ({ result, stageId }) => {
    let text;
    if (stageId) {
      text = result === "win" ? `${stageId}스테이지 클리어!` : "패배했습니다. 다시 도전해보세요.";
    } else {
      text = result === "win" ? "승리했습니다!" : "패배했습니다.";
    }
    document.getElementById("result-text").textContent = text;
    showScreen("result");
    resultAutoReturnTimer = setTimeout(returnToLobby, 15000);
  });

  socket.on("card_played", ({ playerId, card, targetCharacterId, effectResults }) => {
    if (card?.type === "spell") {
      showSpellEffect(card);
      return;
    }

    if (card?.type === "equipment") {
      showSpellEffect(card);
    }

    if (targetCharacterId) {
      pendingBuffEffects.set(targetCharacterId, { playerId, effectResults });
      return;
    }

    pendingInstallEffects.set(card.id, { playerId, skillName: card.skillName || null, effectResults });
  });

  socket.on(
    "attack_occurred",
    ({
      attackerId,
      attackerCardId,
      target,
      attackerCard,
      defenderDeathSkillName,
      attackerDeathSkillName,
      heroDamage,
      defenderDamage,
      counterDamage,
      effectResults,
    }) => {
      pendingAttackEffects.push({
        attackerId,
        attackerCardId,
        target,
        attackerCard,
        defenderDeathSkillName,
        attackerDeathSkillName,
        heroDamage,
        defenderDamage,
        counterDamage,
        effectResults,
      });
    }
  );
}

function returnToLobby() {
  if (resultAutoReturnTimer) {
    clearTimeout(resultAutoReturnTimer);
    resultAutoReturnTimer = null;
  }
  if (pendingBoardRebuildTimer) {
    clearTimeout(pendingBoardRebuildTimer);
    pendingBoardRebuildTimer = null;
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

function showSkillNamePopup(cardEl, text, kind) {
  if (!cardEl || !text) return;
  const rect = cardEl.getBoundingClientRect();
  const layer = document.getElementById("spell-effect-layer");
  const el = document.createElement("div");
  el.className = `skill-name-popup skill-name-popup--${kind}`;
  el.textContent = text;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height / 2}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function showDamagePopup(el, amount) {
  if (!el || !amount || amount <= 0) return;
  const rect = el.getBoundingClientRect();
  const layer = document.getElementById("spell-effect-layer");
  const popup = document.createElement("div");
  popup.className = "damage-popup";
  popup.textContent = `-${amount}`;
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top}px`;
  layer.appendChild(popup);
  setTimeout(() => popup.remove(), 1400);
}

function showHealPopup(el, amount) {
  if (!el || !amount || amount <= 0) return;
  const rect = el.getBoundingClientRect();
  const layer = document.getElementById("spell-effect-layer");
  const popup = document.createElement("div");
  popup.className = "heal-popup";
  popup.textContent = `+${amount}`;
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top}px`;
  layer.appendChild(popup);
  setTimeout(() => popup.remove(), 1400);
}

function showBuffPopup(el, atk, hp) {
  if (!el) return;
  const parts = [];
  if (atk) parts.push(`⚔+${atk}`);
  if (hp) parts.push(`❤+${hp}`);
  if (!parts.length) return;
  const rect = el.getBoundingClientRect();
  const layer = document.getElementById("spell-effect-layer");
  const popup = document.createElement("div");
  popup.className = "buff-popup";
  popup.textContent = parts.join(" ");
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top}px`;
  layer.appendChild(popup);
  setTimeout(() => popup.remove(), 1400);
}

function findEffectResultEl(result) {
  if (result.kind === "player") {
    return document.getElementById(result.id === socket.id ? "my-hp" : "opp-hp");
  }
  return (
    document.getElementById("my-board").querySelector(`.card[data-card-id="${result.id}"]`) ||
    document.getElementById("opp-board").querySelector(`.card[data-card-id="${result.id}"]`)
  );
}

function showEffectResultPopups(effectResults) {
  for (const result of effectResults || []) {
    const el = findEffectResultEl(result);
    if (!el) continue;
    if (result.action === "DAMAGE") showDamagePopup(el, result.amount);
    else if (result.action === "HEAL") showHealPopup(el, result.amount);
    else if (result.action === "BUFF") showBuffPopup(el, result.atk, result.hp);
  }
}

const SHARD_CLIP_PATHS = [
  "polygon(0% 0%, 58% 0%, 42% 48%, 0% 62%)",
  "polygon(58% 0%, 100% 0%, 100% 42%, 42% 48%)",
  "polygon(0% 62%, 42% 48%, 48% 100%, 0% 100%)",
  "polygon(42% 48%, 100% 42%, 100% 58%, 55% 100%, 48% 100%)",
  "polygon(100% 42%, 100% 100%, 55% 100%, 100% 58%)",
];
const SHARD_FLIGHT_VECTORS = [
  { x: -80, y: -50, r: -50 },
  { x: 70, y: -70, r: 45 },
  { x: -70, y: 90, r: -40 },
  { x: 30, y: 110, r: 25 },
  { x: 90, y: 60, r: 55 },
];

function spawnCardShatter(cardEl) {
  if (!cardEl) return;
  const rect = cardEl.getBoundingClientRect();
  const layer = document.getElementById("spell-effect-layer");
  cardEl.style.visibility = "hidden";

  SHARD_CLIP_PATHS.forEach((clipPath, i) => {
    const shard = cardEl.cloneNode(true);
    shard.removeAttribute("id");
    shard.className = "card card-shard";
    shard.style.visibility = "visible";
    shard.style.position = "fixed";
    shard.style.left = `${rect.left}px`;
    shard.style.top = `${rect.top}px`;
    shard.style.width = `${rect.width}px`;
    shard.style.height = `${rect.height}px`;
    shard.style.margin = "0";
    shard.style.clipPath = clipPath;
    const vector = SHARD_FLIGHT_VECTORS[i % SHARD_FLIGHT_VECTORS.length];
    shard.style.setProperty("--shard-x", `${vector.x}px`);
    shard.style.setProperty("--shard-y", `${vector.y}px`);
    shard.style.setProperty("--shard-r", `${vector.r}deg`);
    layer.appendChild(shard);
    requestAnimationFrame(() => shard.classList.add("card-shard-fly"));
    setTimeout(() => shard.remove(), 650);
  });
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
    const atkBuff = card.buffAtk ? `<span class="buff-amount">+${card.buffAtk}</span>` : "";
    const hpBuff = card.buffHp ? `<span class="buff-amount">+${card.buffHp}</span>` : "";
    return `<div class="atk-hp"><span class="atk">⚔${card.atk}</span>${atkBuff}<span class="hp">❤${card.hp}</span>${hpBuff}</div>`;
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
  const STEP = 0.5;
  const MIN = 5;
  const MAX = 13;
  const steps = Math.round((MAX - MIN) / STEP);

  const fits = (size) => {
    nameEl.style.fontSize = `${size}px`;
    return nameEl.scrollWidth <= nameEl.clientWidth;
  };

  if (fits(MAX)) return;

  let lo = 0;
  let hi = steps;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(MIN + mid * STEP)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  nameEl.style.fontSize = `${MIN + lo * STEP}px`;
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

function equipBadgesHtml(card) {
  if (!card.equippedItems?.length) return "";
  return `<div class="equip-badges">${card.equippedItems
    .map(
      (item) =>
        `<div class="equip-badge"${item.image ? ` style="background-image:url('${item.image}')"` : ""} title="${item.name}"></div>`
    )
    .join("")}</div>`;
}

function cardFaceHtml(card) {
  const artStyle = card.image ? ` style="background-image:url('${card.image}')"` : "";
  return `
    <div class="card-art"${artStyle}></div>
    <div class="card-stats">
      <span class="cost-badge">${card.cost}</span>
      ${cardStatsHtml(card)}
    </div>
    ${equipBadgesHtml(card)}
    <div class="card-hover-info">
      <div class="name">${card.name}</div>
      ${cardDescHtml(card)}
    </div>
  `;
}

const BOARD_GAP_PX = 8;
const BOARD_MIN_HEIGHT_PX = 60;

function computeBoardCardHeight(containerEl, count) {
  const rect = containerEl.getBoundingClientRect();
  const naturalHeight = rect.height;
  if (count <= 0 || naturalHeight <= 0) return naturalHeight;

  const naturalWidth = naturalHeight * (92 / 128);
  const requiredWidth = count * naturalWidth + (count - 1) * BOARD_GAP_PX;
  if (requiredWidth <= rect.width) return naturalHeight;

  // gap은 카드 크기와 무관하게 고정폭이므로 축소 비율 계산에서 분리해야 함
  const widthAvailableForCards = rect.width - (count - 1) * BOARD_GAP_PX;
  const scale = widthAvailableForCards / (count * naturalWidth);
  return Math.max(naturalHeight * scale, BOARD_MIN_HEIGHT_PX);
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
    if (dropTarget.boardSide !== "my" || !dropTarget.cardEl) return false;
    const targetCard = lastState?.me.board.find((c) => c.id === dropTarget.cardEl.dataset.cardId);
    return !targetCard?.equippedItems?.length;
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
  document.body.appendChild(el); // fixed 좌표계가 항상 뷰포트 기준이 되도록 body 직속으로 재부착
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

  // 드래그 시작시 el을 body로 재부착했으므로, 서버 응답 여부와 상관없이 항상 다시
  // 그려서 손패/보드 안에 el을 원래 자리로 복원한다.
  const state = pendingRenderState || lastState;
  pendingRenderState = null;
  if (state) renderState(state);
  el.remove();
}

function flashClass(el, className, durationMs) {
  if (!el) return;
  el.classList.add(className);
  const clear = () => el.classList.remove(className);
  el.addEventListener("animationend", clear, { once: true });
  setTimeout(clear, durationMs);
}

function animateDrawIn(cardEl, fromEl) {
  if (!cardEl || !fromEl) return;
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = cardEl.getBoundingClientRect();
  const layer = document.getElementById("spell-effect-layer");

  cardEl.style.visibility = "hidden";

  const clone = document.createElement("div");
  clone.className = "card card-back card-draw-clone";
  clone.style.position = "fixed";
  clone.style.left = `${fromRect.left}px`;
  clone.style.top = `${fromRect.top}px`;
  clone.style.width = `${fromRect.width}px`;
  clone.style.height = `${fromRect.height}px`;
  clone.style.setProperty("--draw-dx", `${toRect.left - fromRect.left}px`);
  clone.style.setProperty("--draw-dy", `${toRect.top - fromRect.top}px`);
  clone.style.setProperty("--draw-scale-x", `${toRect.width / fromRect.width}`);
  clone.style.setProperty("--draw-scale-y", `${toRect.height / fromRect.height}`);
  layer.appendChild(clone);

  setTimeout(() => {
    clone.remove();
    cardEl.style.visibility = "";
  }, 420);
}

function applyPendingCardEffects(boardEl, role) {
  for (const card of boardEl.querySelectorAll(".card")) {
    const cardId = card.dataset.cardId;
    if (pendingInstallEffects.has(cardId)) {
      const { skillName, effectResults } = pendingInstallEffects.get(cardId);
      pendingInstallEffects.delete(cardId);

      const boardRect = boardEl.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const offsetX = boardRect.left + boardRect.width / 2 - (cardRect.left + cardRect.width / 2);
      card.style.setProperty("--spread-from-x", `${offsetX}px`);
      flashClass(card, "card-spread-in", 450);

      if (skillName) showSkillNamePopup(card, skillName, "play");
      showEffectResultPopups(effectResults);
    }
    if (pendingBuffEffects.has(cardId)) {
      const { effectResults } = pendingBuffEffects.get(cardId);
      pendingBuffEffects.delete(cardId);
      flashClass(card, "buff-flash", 600);
      showEffectResultPopups(effectResults);
    }
  }
}

function applyPendingAttackEffects(state) {
  let deathSkillScheduled = false;

  while (pendingAttackEffects.length > 0) {
    const {
      attackerId,
      attackerCardId,
      target,
      attackerCard,
      defenderDeathSkillName,
      attackerDeathSkillName,
      heroDamage,
      defenderDamage,
      counterDamage,
      effectResults,
    } = pendingAttackEffects.shift();
    // 어느 한쪽 카드에만 ON_DEATH 스킬이 있어도 그 효과가 반대쪽(예: KILLER 대상 피해)에
    // 영향을 줄 수 있으므로, shatter 지연은 "자기 자신의 스킬 유무"가 아니라 이번 공격에서
    // 스킬이 하나라도 발동했는지로 통일해야 스킬 팝업보다 상대가 먼저 부서지지 않는다.
    const hasSkillThisAttack = Boolean(attackerDeathSkillName) || Boolean(defenderDeathSkillName);
    const attackerBoardEl = attackerId === socket.id ? document.getElementById("my-board") : document.getElementById("opp-board");
    const attackerEl = attackerBoardEl.querySelector(`.card[data-card-id="${attackerCardId}"]`);
    flashClass(attackerEl, attackerId === socket.id ? "attack-lunge-up" : "attack-lunge-down", 350);
    if (attackerCard?.attackName) {
      showAttackNamePopup(attackerEl, attackerCard.attackName);
    }
    if (attackerDeathSkillName) {
      setTimeout(() => showSkillNamePopup(attackerEl, attackerDeathSkillName, "death"), DEATH_SKILL_DELAY_MS);
    }

    const attackerOwnerBoard = attackerId === socket.id ? state.me.board : state.opponent.board;
    const attackerDied = !attackerOwnerBoard.some((c) => c.id === attackerCardId);
    if (attackerDied) {
      const hpEl = attackerEl?.querySelector(".hp");
      const setZero = () => { if (hpEl) hpEl.textContent = "❤0"; };
      if (attackerDeathSkillName) {
        setZero();
      } else if (hasSkillThisAttack) {
        setTimeout(setZero, DEATH_SKILL_DELAY_MS);
      } else {
        setZero();
      }
      const shatterDelay = hasSkillThisAttack ? DEATH_SKILL_DELAY_MS : 120;
      setTimeout(() => spawnCardShatter(attackerEl), shatterDelay);
    }

    if (target?.type === "character") {
      const targetBoardEl = attackerId === socket.id ? document.getElementById("opp-board") : document.getElementById("my-board");
      const targetEl = targetBoardEl.querySelector(`.card[data-card-id="${target.cardId}"]`);
      flashClass(targetEl, "impact-flash", 500);
      showDamagePopup(targetEl, defenderDamage);
      showDamagePopup(attackerEl, counterDamage);
      if (defenderDeathSkillName) {
        setTimeout(() => showSkillNamePopup(targetEl, defenderDeathSkillName, "death"), DEATH_SKILL_DELAY_MS);
      }

      const targetOwnerBoard = attackerId === socket.id ? state.opponent.board : state.me.board;
      const defenderDied = !targetOwnerBoard.some((c) => c.id === target.cardId);
      if (defenderDied) {
        const hpEl = targetEl?.querySelector(".hp");
        const setZero = () => { if (hpEl) hpEl.textContent = "❤0"; };
        if (defenderDeathSkillName) {
          setZero();
        } else if (hasSkillThisAttack) {
          setTimeout(setZero, DEATH_SKILL_DELAY_MS);
        } else {
          setZero();
        }
        const shatterDelay = hasSkillThisAttack ? DEATH_SKILL_DELAY_MS : 120;
        setTimeout(() => spawnCardShatter(targetEl), shatterDelay);
      }
    } else if (target?.type === "hero") {
      const heroAreaEl = attackerId === socket.id ? document.getElementById("opponent-area") : document.getElementById("my-area");
      flashClass(heroAreaEl, "impact-flash", 500);
      const heroHpEl = document.getElementById(attackerId === socket.id ? "opp-hp" : "my-hp");
      showDamagePopup(heroHpEl, heroDamage);
    }

    if (hasSkillThisAttack) {
      setTimeout(() => showEffectResultPopups(effectResults), DEATH_SKILL_DELAY_MS);
    } else {
      showEffectResultPopups(effectResults);
    }
    deathSkillScheduled = deathSkillScheduled || hasSkillThisAttack;
  }

  return deathSkillScheduled;
}

function renderState(state) {
  const previousState = lastState;
  lastState = state;
  document.getElementById("my-name").textContent = state.me.username || "나";
  document.getElementById("my-hp").textContent = state.me.hp;
  document.getElementById("my-mana").textContent = state.me.mana;
  document.getElementById("my-max-mana").textContent = state.me.maxMana;
  document.getElementById("my-deck-count").textContent = state.me.deckCount;
  document.getElementById("my-deck-pile").classList.toggle("empty", state.me.deckCount === 0);

  document.getElementById("opp-name").textContent = state.opponent.username || "상대";
  document.getElementById("opp-hp").textContent = state.opponent.hp;
  document.getElementById("opp-mana").textContent = state.opponent.mana;
  document.getElementById("opp-max-mana").textContent = state.opponent.maxMana;
  document.getElementById("opp-hand-count").textContent = state.opponent.handCount;
  document.getElementById("opp-deck-count").textContent = state.opponent.deckCount;
  document.getElementById("opp-deck-pile").classList.toggle("empty", state.opponent.deckCount === 0);

  const previousMyHandIds = new Set((previousState?.me.hand || []).map((c) => c.id));
  const myDrawnCardIds = previousState
    ? state.me.hand.filter((c) => !previousMyHandIds.has(c.id)).map((c) => c.id)
    : [];
  const oppDrawnCount = previousState
    ? Math.max(0, state.opponent.handCount - previousState.opponent.handCount)
    : 0;

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
  const oppHandCount = state.opponent.handCount;
  for (let i = 0; i < oppHandCount; i++) {
    const back = document.createElement("div");
    back.className = "card card-back";
    oppHandEl.appendChild(back);
  }

  const myDeckPileEl = document.getElementById("my-deck-pile");
  for (const cardEl of myHandEl.children) {
    if (myDrawnCardIds.includes(cardEl.dataset.cardId)) animateDrawIn(cardEl, myDeckPileEl);
  }

  const oppDeckPileEl = document.getElementById("opp-deck-pile");
  const oppBackEls = [...oppHandEl.children];
  for (let i = oppBackEls.length - oppDrawnCount; i < oppBackEls.length; i++) {
    if (i >= 0) animateDrawIn(oppBackEls[i], oppDeckPileEl);
  }

  refitAllCardNames();

  const myBoardEl = document.getElementById("my-board");
  const oppBoardEl = document.getElementById("opp-board");

  // 공격/피격 애니메이션은 보드를 새로 그리기 전, 아직 이전 렌더의 카드 엘리먼트가
  // 남아있는 시점에 적용해야 공격/반격으로 죽는 카드에도 모션이 재생된다.
  const hasAttackEffects = pendingAttackEffects.length > 0;
  const hasDeathSkill = applyPendingAttackEffects(state);

  const rebuildBoards = () => {
    const myBoardCardHeight = computeBoardCardHeight(myBoardEl, state.me.board.length);
    myBoardEl.innerHTML = "";
    for (const card of state.me.board) {
      const cardEl = renderCard(card, "my-board", isMyTurn);
      cardEl.style.height = `${myBoardCardHeight}px`;
      myBoardEl.appendChild(cardEl);
    }

    const oppBoardCardHeight = computeBoardCardHeight(oppBoardEl, state.opponent.board.length);
    oppBoardEl.innerHTML = "";
    for (const card of state.opponent.board) {
      const cardEl = renderCard(card, "opp-board");
      cardEl.style.height = `${oppBoardCardHeight}px`;
      oppBoardEl.appendChild(cardEl);
    }

    applyPendingCardEffects(myBoardEl, "my-board");
    applyPendingCardEffects(oppBoardEl, "opp-board");

    refitAllCardNames();

    const opponentAreaEl = document.getElementById("opponent-area");
    opponentAreaEl.classList.toggle(
      "hero-target",
      Boolean(selectedAttackerId) && state.opponent.board.length === 0
    );
  };

  if (pendingBoardRebuildTimer) {
    clearTimeout(pendingBoardRebuildTimer);
    pendingBoardRebuildTimer = null;
  }

  if (hasAttackEffects) {
    const rebuildDelay = hasDeathSkill ? DEATH_SKILL_DELAY_MS + DEATH_SKILL_REBUILD_BUFFER_MS : 500;
    pendingBoardRebuildTimer = setTimeout(() => {
      pendingBoardRebuildTimer = null;
      rebuildBoards();
    }, rebuildDelay);
  } else {
    rebuildBoards();
  }
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
