import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import QRCode from "qrcode";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 8787);

const rooms = new Map();
const ttlMs = 1000 * 60 * 60 * 24;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function makeId(bytes = 4) {
  return crypto.randomBytes(bytes).toString("base64url").toUpperCase();
}

function now() {
  return Date.now();
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

function publicRoom(room) {
  return {
    id: room.id,
    guideToken: undefined,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    sceneId: room.sceneId,
    sceneNumber: room.sceneNumber ?? 0,
    characters: Object.values(room.characters),
    npcs: Object.values(room.npcs),
    log: room.log.slice(-80),
    scene: room.scene,
    difficulty: room.difficulty
  };
}

function createRoom() {
  const id = makeId(4);
  const room = {
    id,
    guideToken: makeId(12),
    createdAt: now(),
    updatedAt: now(),
    accessedAt: now(),
    characters: {},
    npcs: {},
    log: [
      {
        id: makeId(6),
        type: "system",
        text: "Table started.",
        at: now()
      }
    ],
    sceneId: makeId(6),
    sceneNumber: 0,
    scene: "First Scene",
    difficulty: 4
  };
  rooms.set(id, room);
  return room;
}

function getRoom(id) {
  const room = rooms.get(id);
  if (!room) return undefined;
  if (room.sceneNumber === undefined) room.sceneNumber = 0;
  room.accessedAt = now();
  return room;
}

function cleanRooms() {
  const cutoff = now() - ttlMs;
  for (const [id, room] of rooms.entries()) {
    if (room.accessedAt < cutoff) rooms.delete(id);
  }
}

setInterval(cleanRooms, 1000 * 60 * 15).unref();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cleanText(value, fallback, max = 40) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, max);
}

function cleanStat(value) {
  return ["strong", "quick", "clever", "cool"].includes(value) ? value : "cool";
}

function normalizeSpecial(input) {
  if (typeof input === "string") {
    return {
      name: cleanText(input, "Lucky charm", 44),
      stat: "cool",
      usedSceneId: null
    };
  }

  return {
    name: cleanText(input?.name, "Lucky charm", 44),
    stat: cleanStat(input?.stat),
    usedSceneId: input?.usedSceneId || null
  };
}

function validateCharacter(input, clientId) {
  const stats = {
    strong: clamp(input.stats?.strong, 0, 3),
    quick: clamp(input.stats?.quick, 0, 3),
    clever: clamp(input.stats?.clever, 0, 3),
    cool: clamp(input.stats?.cool, 0, 3)
  };
  const total = Object.values(stats).reduce((sum, stat) => sum + stat, 0);
  if (total > 6) throw new Error("Characters can spend at most 6 points.");

  return {
    id: cleanText(clientId, makeId(8), 80),
    name: cleanText(input.name, "New Hero", 28),
    color: cleanText(input.color, "#20a39e", 16),
    avatar: cleanText(input.avatar, "spark", 20),
    special: normalizeSpecial(input.special),
    hearts: clamp(input.hearts ?? 3, 0, 3),
    stats,
    updatedAt: now()
  };
}

function addLog(room, entry) {
  room.log.push({ id: makeId(6), at: now(), ...entry });
  room.log = room.log.slice(-100);
  room.updatedAt = now();
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const input = await readJson(req);
    if (!input.roomId && !input.action) {
      const room = createRoom();
      return sendJson(res, 201, {
        room: publicRoom(room),
        guideToken: room.guideToken
      });
    }
    const room = getRoom(cleanText(input.roomId, "", 20).toUpperCase());
    if (!room) return sendJson(res, 404, { error: "Room not found" });
    return handleRoomAction(req, res, url, room, input.action, input);
  }

  if (req.method === "GET" && url.pathname === "/api/rooms") {
    const room = getRoom(cleanText(url.searchParams.get("id"), "", 20).toUpperCase());
    if (!room) return sendJson(res, 404, { error: "Room not found" });
    return handleRoomAction(req, res, url, room, url.searchParams.get("action"), {});
  }

  const match = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return sendJson(res, 404, { error: "Not found" });

  const [, roomId, action] = match;
  const room = getRoom(roomId.toUpperCase());
  if (!room) return sendJson(res, 404, { error: "Room not found" });

  const input = await readJson(req);
  return handleRoomAction(req, res, url, room, action, input);
}

async function handleRoomAction(req, res, url, room, action, input) {
  if (req.method === "GET" && action === "qr.svg") {
    const joinUrl = `${url.protocol}//${req.headers.host}/r/${room.id}`;
    const svg = await QRCode.toString(joinUrl, {
      type: "svg",
      margin: 2,
      width: 420,
      color: {
        dark: "#17201f",
        light: "#ffffff"
      }
    });
    res.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store"
    });
    return res.end(svg);
  }

  if (req.method === "GET" && !action) {
    return sendJson(res, 200, { room: publicRoom(room) });
  }

  const clientId = cleanText(input.clientId, makeId(8), 80);

  if (req.method === "POST" && action === "character") {
    try {
      const character = validateCharacter(input.character || {}, clientId);
      const existed = Boolean(room.characters[character.id]);
      room.characters[character.id] = character;
      addLog(room, {
        type: "system",
        text: `${character.name} ${existed ? "updated" : "joined"} the table.`
      });
      return sendJson(res, 200, { room: publicRoom(room), character });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && action === "roll") {
    const character = room.characters[clientId];
    if (!character) return sendJson(res, 400, { error: "Make a character first." });
    character.special = normalizeSpecial(character.special);
    if (!room.sceneId) room.sceneId = "first-scene";
    const statKey = cleanStat(input.stat);
    const useSpecial = Boolean(input.useSpecial);
    if (useSpecial && character.special.stat !== statKey) {
      return sendJson(res, 400, { error: "That Special Thing is attached to a different stat." });
    }
    if (useSpecial && character.special.usedSceneId === room.sceneId) {
      return sendJson(res, 400, { error: "Special Thing already used this scene." });
    }
    const die = crypto.randomInt(1, 7);
    const specialBonus = useSpecial ? 2 : 0;
    const total = die + character.stats[statKey] + specialBonus;
    const outcome = total >= 6 ? "strong success" : total >= room.difficulty ? "success" : "trouble";
    if (useSpecial) character.special.usedSceneId = room.sceneId;
    addLog(room, {
      type: "roll",
      characterId: character.id,
      characterName: character.name,
      stat: statKey,
      die,
      bonus: character.stats[statKey],
      specialBonus,
      total,
      outcome,
      text: `${character.name} rolled ${statKey}${useSpecial ? ` with ${character.special.name}` : ""}: ${die}+${character.stats[statKey]}${specialBonus ? `+${specialBonus}` : ""} = ${total} (${outcome}).`
    });
    return sendJson(res, 200, { room: publicRoom(room) });
  }

  if (req.method === "POST" && action === "heart") {
    const character = room.characters[clientId];
    if (!character) return sendJson(res, 400, { error: "Make a character first." });
    character.hearts = clamp(input.hearts, 0, 3);
    character.updatedAt = now();
    addLog(room, {
      type: "heart",
      characterId: character.id,
      characterName: character.name,
      text: `${character.name} now has ${character.hearts} heart${character.hearts === 1 ? "" : "s"}.`
    });
    return sendJson(res, 200, { room: publicRoom(room) });
  }

  if (req.method === "POST" && action === "guide") {
    if (input.guideToken !== room.guideToken) return sendJson(res, 403, { error: "GM access required." });
    if (input.scene !== undefined) {
      const nextScene = cleanText(input.scene, "Scene", 44);
      if (nextScene !== room.scene) {
        room.sceneId = makeId(6);
        room.sceneNumber = (room.sceneNumber ?? 0) + 1;
        room.scene = nextScene;
        if (input.difficulty !== undefined) room.difficulty = clamp(input.difficulty, 3, 6);
        addLog(room, {
          type: "scene",
          sceneNumber: room.sceneNumber,
          scene: room.scene,
          difficulty: room.difficulty,
          text: `Chapter ${toRoman(room.sceneNumber)}: ${room.scene}\n-Special Things refreshed!-`
        });
      }
    } else if (input.difficulty !== undefined) {
      return sendJson(res, 400, { error: "Start a new scene to change difficulty." });
    }
    if (input.note) addLog(room, { type: "gm", text: cleanText(input.note, "GM note", 120) });
    return sendJson(res, 200, { room: publicRoom(room) });
  }

  if (req.method === "POST" && action === "npc") {
    if (input.guideToken !== room.guideToken) return sendJson(res, 403, { error: "GM access required." });
    const id = cleanText(input.npc?.id, makeId(5), 40);
    const npc = {
      id,
      name: cleanText(input.npc?.name, "New Face", 28),
      goal: cleanText(input.npc?.goal, "Wants something", 60),
      mood: cleanText(input.npc?.mood, "Curious", 24),
      hearts: clamp(input.npc?.hearts ?? 2, 0, 6)
    };
    room.npcs[id] = npc;
    addLog(room, { type: "system", text: `${npc.name} is in the scene.` });
    return sendJson(res, 200, { room: publicRoom(room), npc });
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname.startsWith("/r/")) pathname = "/index.html";
  const filePath = join(publicDir, pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mime[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Tiny Quest Table listening on http://localhost:${port}`);
});
