import crypto from "node:crypto";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";

const rooms = globalThis.__tinyQuestRooms || new Map();
globalThis.__tinyQuestRooms = rooms;

const ttlMs = 1000 * 60 * 60 * 24;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

function makeId(bytes = 4) {
  return crypto.randomBytes(bytes).toString("base64url").toUpperCase();
}

function now() {
  return Date.now();
}

function publicRoom(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    characters: Object.values(room.characters),
    npcs: Object.values(room.npcs),
    log: room.log.slice(-80),
    scene: room.scene,
    difficulty: room.difficulty
  };
}

function toRow(room) {
  return {
    id: room.id,
    guide_token: room.guideToken,
    state: room,
    created_at: new Date(room.createdAt).toISOString(),
    updated_at: new Date(room.updatedAt).toISOString(),
    expires_at: new Date((room.accessedAt || room.updatedAt) + ttlMs).toISOString()
  };
}

function fromRow(row) {
  return row?.state ? { ...row.state, guideToken: row.guide_token } : undefined;
}

async function createRoom() {
  const id = makeId(4);
  const room = {
    id,
    guideToken: makeId(12),
    createdAt: now(),
    updatedAt: now(),
    accessedAt: now(),
    characters: {},
    npcs: {},
    log: [{ id: makeId(6), type: "system", text: "Table started.", at: now() }],
    scene: "First Scene",
    difficulty: 4
  };
  if (supabase) {
    const { error } = await supabase.from("rooms").insert(toRow(room));
    if (error) throw error;
  } else {
    rooms.set(id, room);
  }
  return room;
}

async function getRoom(id) {
  if (supabase) {
    const { data, error } = await supabase.from("rooms").select("id, guide_token, state, expires_at").eq("id", id).maybeSingle();
    if (error) throw error;
    const expiresAt = data?.expires_at ? Date.parse(data.expires_at) : 0;
    if (!data || expiresAt <= now()) return undefined;
    const room = fromRow(data);
    room.accessedAt = now();
    await saveRoom(room, { touchOnly: true });
    return room;
  }

  const room = rooms.get(id);
  if (!room) return undefined;
  room.accessedAt = now();
  return room;
}

async function saveRoom(room, options = {}) {
  if (!options.touchOnly) room.updatedAt = now();
  room.accessedAt = now();
  if (supabase) {
    const { error } = await supabase.from("rooms").upsert(toRow(room), { onConflict: "id" });
    if (error) throw error;
  } else {
    rooms.set(room.id, room);
  }
}

async function cleanRooms() {
  if (supabase) {
    await supabase.from("rooms").delete().lt("expires_at", new Date().toISOString());
    return;
  }

  const cutoff = now() - ttlMs;
  for (const [id, room] of rooms.entries()) {
    if (room.accessedAt < cutoff) rooms.delete(id);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function cleanText(value, fallback, max = 40) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, max);
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
    special: cleanText(input.special, "Lucky charm", 60),
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

function send(res, status, payload) {
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  await cleanRooms();

  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
  const parts = Array.isArray(req.query.path)
    ? req.query.path
    : url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "rooms") return send(res, 404, { error: "Not found" });

  if (req.method === "POST" && parts.length === 1) {
    const input = req.body || {};
    if (!input.roomId && !input.action) {
      const room = await createRoom();
      return send(res, 201, { room: publicRoom(room), guideToken: room.guideToken });
    }
  }

  const input = req.body || {};
  const roomId = (parts[1] || url.searchParams.get("id") || input.roomId)?.toUpperCase();
  const action = parts[2] || url.searchParams.get("action") || input.action;
  const room = roomId ? await getRoom(roomId) : undefined;
  if (!room) return send(res, 404, { error: "Room not found" });

  if (req.method === "GET" && !action) {
    return send(res, 200, { room: publicRoom(room) });
  }

  if (req.method === "GET" && action === "qr.svg") {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const joinUrl = `${protocol}://${req.headers.host}/r/${room.id}`;
    const svg = await QRCode.toString(joinUrl, {
      type: "svg",
      margin: 2,
      width: 420,
      color: { dark: "#17201f", light: "#ffffff" }
    });
    res.setHeader("content-type", "image/svg+xml; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    return res.status(200).send(svg);
  }

  const clientId = cleanText(input.clientId, makeId(8), 80);

  if (req.method === "POST" && action === "character") {
    try {
      const character = validateCharacter(input.character || {}, clientId);
      const existed = Boolean(room.characters[character.id]);
      room.characters[character.id] = character;
      addLog(room, { type: "system", text: `${character.name} ${existed ? "updated" : "joined"} the table.` });
      await saveRoom(room);
      return send(res, 200, { room: publicRoom(room), character });
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && action === "roll") {
    const character = room.characters[clientId];
    if (!character) return send(res, 400, { error: "Make a character first." });
    const statKey = ["strong", "quick", "clever", "cool"].includes(input.stat) ? input.stat : "cool";
    const die = crypto.randomInt(1, 7);
    const total = die + character.stats[statKey];
    const outcome = total >= 6 ? "strong success" : total >= room.difficulty ? "success" : "trouble";
    addLog(room, {
      type: "roll",
      characterId: character.id,
      characterName: character.name,
      stat: statKey,
      die,
      bonus: character.stats[statKey],
      total,
      outcome,
      text: `${character.name} rolled ${statKey}: ${die}+${character.stats[statKey]} = ${total} (${outcome}).`
    });
    await saveRoom(room);
    return send(res, 200, { room: publicRoom(room) });
  }

  if (req.method === "POST" && action === "heart") {
    const character = room.characters[clientId];
    if (!character) return send(res, 400, { error: "Make a character first." });
    character.hearts = clamp(input.hearts, 0, 3);
    character.updatedAt = now();
    addLog(room, {
      type: "heart",
      characterId: character.id,
      characterName: character.name,
      text: `${character.name} now has ${character.hearts} heart${character.hearts === 1 ? "" : "s"}.`
    });
    await saveRoom(room);
    return send(res, 200, { room: publicRoom(room) });
  }

  if (req.method === "POST" && action === "guide") {
    if (input.guideToken !== room.guideToken) return send(res, 403, { error: "Guide access required." });
    if (input.scene !== undefined) {
      room.scene = cleanText(input.scene, "Scene", 44);
      addLog(room, { type: "system", text: `Scene: ${room.scene}` });
    }
    if (input.difficulty !== undefined) {
      room.difficulty = clamp(input.difficulty, 3, 6);
      addLog(room, { type: "system", text: `Difficulty set to ${room.difficulty}+.` });
    }
    if (input.note) addLog(room, { type: "note", text: cleanText(input.note, "Guide note", 120) });
    await saveRoom(room);
    return send(res, 200, { room: publicRoom(room) });
  }

  return send(res, 404, { error: "Not found" });
}
