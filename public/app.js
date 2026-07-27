const app = document.querySelector("#app");

const stats = [
  ["strong", "Strong", "Force, toughness, fighting"],
  ["quick", "Quick", "Speed, dodging, sneaking"],
  ["clever", "Clever", "Noticing, solving, tricks"],
  ["cool", "Cool", "Talking, nerve, charm"]
];

const avatars = ["spark", "bolt", "star", "moon"];
const avatarText = { spark: "✦", bolt: "!", star: "*", moon: "C" };
const colors = ["#1f9d92", "#ee6c4d", "#6957d6", "#f3b33d", "#2f4858", "#8a5a44", "#2574a9", "#5a8f48"];

function makeClientId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function blankDraft() {
  return {
    name: "",
    color: colors[0],
    avatar: avatars[0],
    special: { name: "", stat: "cool", usedSceneId: null },
    stats: { strong: 0, quick: 0, clever: 0, cool: 0 }
  };
}

function normalizeSpecial(special) {
  if (typeof special === "string") return { name: special, stat: "cool", usedSceneId: null };
  return {
    name: special?.name || "",
    stat: stats.some(([key]) => key === special?.stat) ? special.stat : "cool",
    usedSceneId: special?.usedSceneId || null
  };
}

function statLabel(key) {
  return stats.find(([statKey]) => statKey === key)?.[1] || "Cool";
}

function toRoman(value) {
  const roman = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];
  let number = Math.max(1, Math.min(3999, Number(value) || 1));
  let output = "";
  for (const [amount, symbol] of roman) {
    while (number >= amount) {
      output += symbol;
      number -= amount;
    }
  }
  return output;
}

function specialRollLabel(statKey, statValue) {
  return `${statLabel(statKey)} +${statValue}, special +2`;
}

function displaySceneName(room) {
  if (!room?.scene || room.scene === "Scene") return room?.sceneNumber ? "Untitled Scene" : "First Scene";
  return room.scene;
}

function draftFromCharacter(character) {
  const special = normalizeSpecial(character.special);
  return {
    name: character.name,
    color: character.color,
    avatar: character.avatar,
    special,
    stats: { ...character.stats }
  };
}

let state = {
  room: null,
  clientId: localStorage.getItem("tqtClientId") || makeClientId(),
  guideToken: localStorage.getItem("tqtGuideToken") || "",
  tab: "play",
  draft: blankDraft(),
  newSceneDifficulty: null,
  error: "",
  poll: null
};

localStorage.setItem("tqtClientId", state.clientId);

const pathRoom = location.pathname.match(/^\/r\/([^/]+)/)?.[1]?.toUpperCase();
if (pathRoom) {
  state.guideToken = new URLSearchParams(location.search).get("guide") || state.guideToken;
  if (state.guideToken) {
    localStorage.setItem("tqtGuideToken", state.guideToken);
    sessionStorage.setItem(`tqtGuide:${pathRoom}`, state.guideToken);
  }
  loadRoom(pathRoom);
} else {
  renderHome();
}

function h(strings, ...values) {
  return strings.reduce((out, string, i) => out + string + (values[i] ?? ""), "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ownCharacter() {
  return state.room?.characters.find((character) => character.id === state.clientId);
}

function isGuideForRoom() {
  return Boolean(state.guideToken && sessionStorage.getItem(`tqtGuide:${state.room?.id}`) === state.guideToken);
}

function scrollToTop() {
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function syncDraftFromForm() {
  const name = document.querySelector("#hero-name");
  const special = document.querySelector("#special");
  if (name) state.draft.name = name.value;
  if (special) state.draft.special.name = special.value;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function setRoom(room) {
  state.room = room;
  renderTable();
}

function setError(error) {
  state.error = error?.message || String(error || "");
  renderTable();
}

async function startRoom() {
  try {
    const data = await api("/api/rooms", { method: "POST", body: "{}" });
    state.guideToken = data.guideToken;
    state.tab = "qr";
    localStorage.setItem("tqtGuideToken", state.guideToken);
    sessionStorage.setItem(`tqtGuide:${data.room.id}`, state.guideToken);
    history.replaceState(null, "", `/r/${data.room.id}?guide=${state.guideToken}`);
    setRoom(data.room);
    startPolling();
  } catch (error) {
    state.error = error.message;
    renderHome();
  }
}

async function loadRoom(roomId) {
  try {
    const data = await api(`/api/rooms?id=${encodeURIComponent(roomId)}`);
    setRoom(data.room);
    startPolling();
  } catch (error) {
    state.error = error.message;
    renderHome();
  }
}

function startPolling() {
  if (state.poll) clearInterval(state.poll);
  state.poll = setInterval(async () => {
      if (!state.room?.id) return;
    try {
      const data = await api(`/api/rooms?id=${encodeURIComponent(state.room.id)}`);
      if (data.room.updatedAt !== state.room.updatedAt) {
        state.room = data.room;
        renderTable();
      }
    } catch {
      clearInterval(state.poll);
    }
  }, 2000);
}

function renderHome() {
  app.className = "app-shell hero screen";
  app.innerHTML = h`
    <section class="screen">
      <div>
        <p class="eyebrow">QR-first tabletop play</p>
        <h1 class="title">Tiny Quest Table</h1>
        <p class="subtitle">Start a no-login table, let players scan in, make tiny heroes, and roll through fights, talks, escapes, and weird ideas.</p>
      </div>
      ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
      <div class="button-row">
        <button class="button" data-action="start">Start as GM</button>
        <form class="panel screen" data-action="join">
          <div class="field">
            <label for="room-code">Room code</label>
            <input class="input" id="room-code" name="code" autocomplete="off" inputmode="latin" placeholder="AB12CD" />
          </div>
          <button class="button secondary">Join as Player</button>
        </form>
      </div>
    </section>
  `;
  app.querySelector("[data-action='start']").addEventListener("click", startRoom);
  app.querySelector("[data-action='join']").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code").toString().trim().toUpperCase();
    if (code) location.href = `/r/${code}`;
  });
}

function renderTable() {
  if (!state.room) return renderHome();
  const character = ownCharacter();
  const isGuide = isGuideForRoom();
  app.className = "app-shell screen";
  app.innerHTML = h`
    <header class="topbar">
      <div class="brand">
        <h1>${escapeHtml(displaySceneName(state.room))}</h1>
        <span>Room ${escapeHtml(state.room.id)} · ${state.room.difficulty}+</span>
      </div>
      <button class="icon-button" title="Show QR" data-tab="qr">QR</button>
    </header>
    ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
    ${state.tab === "qr" ? renderQr() : ""}
    ${state.tab === "make" ? renderBuilder(character) : ""}
    ${state.tab === "play" ? renderPlay(character) : ""}
    ${state.tab === "guide" ? renderGm(isGuide) : ""}
    <nav class="tabs" aria-label="Table sections">
      <button class="${state.tab === "play" ? "active" : ""}" data-tab="play">Play</button>
      <button class="${state.tab === "make" ? "active" : ""}" data-tab="make">${character ? "Hero" : "Make"}</button>
      <button class="${state.tab === (isGuide ? "guide" : "qr") ? "active" : ""}" data-tab="${isGuide ? "guide" : "qr"}">${isGuide ? "GM" : "QR"}</button>
    </nav>
  `;

  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.tab === "make") state.draft = character ? draftFromCharacter(character) : state.draft;
      state.tab = button.dataset.tab;
      state.error = "";
      renderTable();
      scrollToTop();
    });
  });
  wireCurrentTab(character, isGuide);
}

function renderQr() {
  const qr = `/api/rooms?id=${encodeURIComponent(state.room.id)}&action=qr.svg`;
  return h`
    <section class="panel qr-wrap">
      <img alt="QR code for room ${escapeHtml(state.room.id)}" src="${qr}" />
      <div class="code">${escapeHtml(state.room.id)}</div>
      <p class="hint">Players scan this to join. The room code is backup.</p>
      <button class="button secondary" data-action="copy-url">Copy Join Link</button>
    </section>
  `;
}

function renderBuilder(character) {
  const draft = state.draft;
  draft.special = normalizeSpecial(draft.special);
  const spent = Object.values(draft.stats).reduce((sum, value) => sum + value, 0);
  return h`
    <form class="screen" data-action="save-character">
      <section class="panel screen">
        <div class="field">
          <label for="hero-name">Hero name</label>
          <input class="input" id="hero-name" name="name" maxlength="28" value="${escapeHtml(draft.name)}" placeholder="Mira" />
        </div>
        <div class="field">
          <label>Color</label>
          <div class="color-grid">
            ${colors.map((color) => `<button type="button" class="swatch ${draft.color === color ? "active" : ""}" style="background:${color}" data-color="${color}" title="${color}"></button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label>Avatar</label>
          <div class="avatar-grid">
            ${avatars.map((avatar) => `<button type="button" class="choice ${draft.avatar === avatar ? "active" : ""}" data-avatar="${avatar}">${avatarText[avatar]}</button>`).join("")}
          </div>
        </div>
      </section>
      <section class="panel screen">
        <div>
          <strong>Stats</strong>
          <p class="hint">${spent}/6 points spent. Max 3 in one stat.</p>
        </div>
        <div class="stat-builder">
          ${stats.map(([key, label, help]) => renderStatBuilder(key, label, help, draft.stats[key], spent)).join("")}
        </div>
      </section>
      <section class="panel screen">
        <div class="field">
          <label for="special">Special thing</label>
          <input class="input" id="special" name="special" maxlength="44" value="${escapeHtml(draft.special.name)}" placeholder="Glowing shield" />
        </div>
        <div class="field">
          <label>Attached stat</label>
          <div class="compact-grid">
            ${stats.map(([key, label]) => `<button type="button" class="difficulty ${draft.special.stat === key ? "active" : ""}" data-special-stat="${key}">${label}</button>`).join("")}
          </div>
          <p class="hint">Once per scene, use it for +2 on one roll with this stat.</p>
        </div>
        <button class="button">Save Hero</button>
      </section>
    </form>
  `;
}

function renderStatBuilder(key, label, help, value, spent) {
  const plusDisabled = value >= 3 || spent >= 6 ? "disabled" : "";
  const minusDisabled = value <= 0 ? "disabled" : "";
  return h`
    <div class="stat-row">
      <div class="stat-name">
        ${label}
        <span class="hint">${help}</span>
      </div>
      <div class="stepper">
        <button type="button" data-stat-minus="${key}" ${minusDisabled}>−</button>
        <output>${value}</output>
        <button type="button" data-stat-plus="${key}" ${plusDisabled}>+</button>
      </div>
    </div>
  `;
}

function renderPlay(character) {
  if (!character) {
    return h`
      <section class="panel screen">
        <h2>Make a Hero</h2>
        <p class="hint">One quick hero is all you need before rolling.</p>
        <button class="button" data-tab="make">Make Hero</button>
      </section>
      ${renderTableLog()}
    `;
  }
  const special = normalizeSpecial(character.special);
  const specialUsed = special.usedSceneId === state.room.sceneId;
  const specialStatValue = character.stats[special.stat] || 0;
  return h`
    <div class="play-layout">
      <section class="panel screen">
        <div class="character-head">
          <div class="avatar" style="background:${escapeHtml(character.color)}">${avatarText[character.avatar] || "*"}</div>
          <div>
            <h2>${escapeHtml(character.name)}</h2>
            <p class="hint">${escapeHtml(special.name)} · ${statLabel(special.stat)} +2 once per scene</p>
          </div>
        </div>
        <div class="hearts">
          ${[1, 2, 3].map((heart) => `<button class="heart ${heart > character.hearts ? "empty" : ""}" data-heart="${heart}">♥</button>`).join("")}
        </div>
        <div class="roll-grid">
          ${stats.map(([key, label, help]) => `<button class="roll-button ${key}" data-roll="${key}"><strong>${label} +${character.stats[key]}</strong><span>${help}</span></button>`).join("")}
        </div>
        <button class="special-action" data-special-roll="${special.stat}" ${specialUsed ? "disabled" : ""}>
          <strong>${specialUsed ? "Special used" : `Use ${escapeHtml(special.name)}`}</strong>
          <span>${specialUsed ? "Available next scene" : specialRollLabel(special.stat, specialStatValue)}</span>
        </button>
      </section>
      ${renderTableLog()}
    </div>
  `;
}

function renderTableLog() {
  const entries = [...state.room.log].reverse();
  return h`
    <section class="panel screen">
      <div>
        <strong>Table Log</strong>
        <p class="hint">Newest first</p>
      </div>
      <div class="list">
        ${entries.length ? entries.map(renderLogEntry).join("") : `<p class="empty">No rolls yet.</p>`}
      </div>
    </section>
  `;
}

function logEntryClass(entry) {
  if (entry.type === "roll") return "roll player";
  if (entry.type === "note" || entry.type === "gm") return "gm";
  if (entry.type === "scene") return "scene";
  if (entry.type === "heart") return "heart";
  return "system";
}

function logEntryLabel(entry) {
  if (entry.type === "roll") return entry.characterName ? `${entry.characterName} roll` : "Player roll";
  if (entry.type === "note" || entry.type === "gm") return "GM";
  if (entry.type === "scene") return "New scene";
  if (entry.type === "heart") return "Hero";
  return "System";
}

function renderLogEntry(entry) {
  if (entry.type === "scene") {
    const title = entry.scene
      ? `Chapter ${toRoman(entry.sceneNumber || 1)}: ${entry.scene}`
      : entry.text?.split("\n")[0] || "New scene";
    const refresh = entry.text?.split("\n")[1] || "-Special Things refreshed!-";
    return `<article class="log-item scene"><strong>${escapeHtml(title)}</strong><span class="scene-refresh">${escapeHtml(refresh)}</span></article>`;
  }
  return `<article class="log-item ${logEntryClass(entry)}"><strong>${escapeHtml(logEntryLabel(entry))}</strong><span>${escapeHtml(entry.text)}</span></article>`;
}

function renderGm(isGuide) {
  if (!isGuide) return renderQr();
  const newSceneDifficulty = state.newSceneDifficulty ?? state.room.difficulty;
  const sceneName = displaySceneName(state.room);
  return h`
    <section class="panel screen">
      <div class="gm-current">
        <p class="eyebrow">Now playing</p>
        <h2>${escapeHtml(sceneName)}</h2>
        <p class="hint">Difficulty ${state.room.difficulty}+. Specials refresh when the GM starts the next chapter.</p>
      </div>
      <div class="field">
        <label for="new-scene">Next chapter</label>
        <input class="input" id="new-scene" maxlength="44" placeholder="The bridge starts to crack" />
      </div>
      <div>
        <strong>Next difficulty</strong>
        <div class="compact-grid">
          ${[4, 5, 6].map((value) => `<button class="difficulty ${newSceneDifficulty === value ? "active" : ""}" data-scene-difficulty="${value}">${value}+</button>`).join("")}
        </div>
        <p class="hint">Takes effect when the chapter starts.</p>
      </div>
      <button class="button" data-action="new-scene">Start Chapter</button>
    </section>
    <section class="panel screen">
      <div class="field">
        <label for="gm-note">GM note</label>
        <textarea class="textarea" id="gm-note" maxlength="120" placeholder="The lock clicks open."></textarea>
      </div>
      <button class="button secondary" data-action="gm-note">Add GM Note</button>
    </section>
    <section class="panel screen">
      <strong>Players</strong>
      <div class="list">
        ${state.room.characters.length ? state.room.characters.map((character) => `<div class="mini-card">${escapeHtml(character.name)} · ${character.hearts} hearts</div>`).join("") : `<p class="empty">No players yet.</p>`}
      </div>
    </section>
    ${renderTableLog()}
  `;
}

function wireCurrentTab(character, isGuide) {
  app.querySelector("[data-action='copy-url']")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(`${location.origin}/r/${state.room.id}`);
  });

  app.querySelector("[data-action='save-character']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    state.draft.name = form.get("name").toString();
    state.draft.special.name = form.get("special").toString();
    try {
      const data = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ roomId: state.room.id, action: "character", clientId: state.clientId, character: state.draft })
      });
      state.tab = "play";
      setRoom(data.room);
      scrollToTop();
    } catch (error) {
      setError(error);
    }
  });

  app.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      syncDraftFromForm();
      state.draft.color = button.dataset.color;
      renderTable();
    });
  });

  app.querySelectorAll("[data-avatar]").forEach((button) => {
    button.addEventListener("click", () => {
      syncDraftFromForm();
      state.draft.avatar = button.dataset.avatar;
      renderTable();
    });
  });

  app.querySelectorAll("[data-special-stat]").forEach((button) => {
    button.addEventListener("click", () => {
      syncDraftFromForm();
      state.draft.special.stat = button.dataset.specialStat;
      renderTable();
    });
  });

  app.querySelectorAll("[data-stat-plus]").forEach((button) => {
    button.addEventListener("click", () => {
      syncDraftFromForm();
      const key = button.dataset.statPlus;
      state.draft.stats[key] += 1;
      renderTable();
    });
  });

  app.querySelectorAll("[data-stat-minus]").forEach((button) => {
    button.addEventListener("click", () => {
      syncDraftFromForm();
      const key = button.dataset.statMinus;
      state.draft.stats[key] -= 1;
      renderTable();
    });
  });

  app.querySelectorAll("[data-roll]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const data = await api("/api/rooms", {
          method: "POST",
          body: JSON.stringify({ roomId: state.room.id, action: "roll", clientId: state.clientId, stat: button.dataset.roll })
        });
        setRoom(data.room);
      } catch (error) {
        setError(error);
      }
    });
  });

  app.querySelector("[data-special-roll]")?.addEventListener("click", async (event) => {
    try {
      const data = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          roomId: state.room.id,
          action: "roll",
          clientId: state.clientId,
          stat: event.currentTarget.dataset.specialRoll,
          useSpecial: true
        })
      });
      setRoom(data.room);
    } catch (error) {
      setError(error);
    }
  });

  app.querySelectorAll("[data-heart]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!character) return;
      const target = Number(button.dataset.heart);
      const hearts = character.hearts === target ? target - 1 : target;
      try {
        const data = await api("/api/rooms", {
          method: "POST",
          body: JSON.stringify({ roomId: state.room.id, action: "heart", clientId: state.clientId, hearts })
        });
        setRoom(data.room);
      } catch (error) {
        setError(error);
      }
    });
  });

  app.querySelector("[data-action='new-scene']")?.addEventListener("click", async () => {
    if (!isGuide) return;
    const scene = document.querySelector("#new-scene").value.trim();
    if (!scene) return setError(new Error("Name the next chapter first."));
    try {
      const data = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          roomId: state.room.id,
          action: "guide",
          guideToken: state.guideToken,
          scene,
          difficulty: state.newSceneDifficulty ?? state.room.difficulty
        })
      });
      state.newSceneDifficulty = null;
      setRoom(data.room);
    } catch (error) {
      setError(error);
    }
  });

  app.querySelector("[data-action='gm-note']")?.addEventListener("click", async () => {
    if (!isGuide) return;
    try {
      const data = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          roomId: state.room.id,
          action: "guide",
          guideToken: state.guideToken,
          note: document.querySelector("#gm-note").value
        })
      });
      setRoom(data.room);
    } catch (error) {
      setError(error);
    }
  });

  app.querySelectorAll("[data-scene-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      state.newSceneDifficulty = Number(button.dataset.sceneDifficulty);
      state.error = "";
      renderTable();
    });
  });
}
