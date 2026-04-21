// Run the new source-analyzer logic against live data and print what
// Master Bath would show. Mirrors client.ts analyzeSource exactly.

import * as https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SETTINGS_PATH = path.join(os.homedir(), "AppData/Roaming/control4-app/settings.json");

const VIDEO_OUTPUT_CLASSES = new Set([
  "HDMI","COMPONENT","SVIDEO","COMPOSITE","DVI","DISPLAYPORT","VIDEO",
]);
const AUDIO_OUTPUT_CLASSES = new Set([
  "STEREO","DIGITAL_COAX","DIGITAL_OPTICAL","COAX","OPTICAL",
  "ANALOG_AUDIO","AUDIO","DIGITAL_AUDIO","DIGITAL_AUDIO_SERVER",
]);
const CANDIDATE_PROXIES = new Set(["media_service","media_player","tv","cable","cd","dvd"]);
const AUDIO_MATRIX_TARGETS = new Set(["amplifier","control4_digitalaudio","media_server"]);
const VIDEO_MATRIX_TARGETS = new Set(["av_switch","avswitch"]);

function analyze(item, bindings, proxyById, hubRoomId) {
  const roomIds = new Set();
  let visibleAudio = false, visibleVideo = false;
  let hasVisibleOutput = false;
  let matrixAudio = false, matrixVideo = false;

  for (const b of bindings ?? []) {
    if (b.inputoutput !== "Output") continue;
    if (b.hidden) continue;
    hasVisibleOutput = true;
    const cls = b.bindingClass ?? "";
    const isA = AUDIO_OUTPUT_CLASSES.has(cls);
    const isV = VIDEO_OUTPUT_CLASSES.has(cls);
    if (isA) visibleAudio = true;
    if (isV) visibleVideo = true;
    for (const c of b.connections ?? []) {
      if (!c.id || c.id <= 0) continue;
      if (typeof c.roomId === "number" && c.roomId > 0) roomIds.add(c.roomId);
      const p = proxyById.get(c.id) ?? "";
      if (isA && AUDIO_MATRIX_TARGETS.has(p)) matrixAudio = true;
      if (isV && VIDEO_MATRIX_TARGETS.has(p)) matrixVideo = true;
    }
  }

  const aggregator = !hasVisibleOutput;
  const proxy = String(item.proxy ?? "");
  const name = String(item.name ?? "").toLowerCase();

  let kind = null;
  if (visibleAudio && visibleVideo) kind = "both";
  else if (visibleAudio) kind = "audio";
  else if (visibleVideo) kind = "video";

  if (kind === null) {
    if (proxy === "media_service") kind = /movie|film|video|tv/.test(name) ? "video" : "audio";
    else if (proxy === "tv" || proxy === "cable" || proxy === "dvd") kind = "video";
    else if (proxy === "media_player") kind = "video";
  }

  const itemRoomId = item.roomId ?? null;
  const itemRoomName = String(item.roomName ?? "");
  const itemName = String(item.name ?? "");

  if (aggregator) {
    if (hubRoomId !== null && itemRoomId === hubRoomId) {
      if (kind === "audio" || kind === "both") matrixAudio = true;
      if (kind === "video" || kind === "both") matrixVideo = true;
    } else if (itemRoomId !== null) {
      roomIds.add(itemRoomId);
    }
  } else if (
    itemRoomId !== null &&
    itemRoomId !== hubRoomId &&
    itemName !== "" &&
    itemName === itemRoomName
  ) {
    roomIds.clear();
    roomIds.add(itemRoomId);
    matrixAudio = false;
    matrixVideo = false;
  }

  return { kind, roomIds: [...roomIds], matrixAudio, matrixVideo, aggregator };
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}
async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}
async function auth(s) {
  const a = await postJson("https://apis.control4.com/authentication/v1/rest", {
    clientInfo: { device: { deviceName: "control4-app", deviceUUID: "0000000000000000", make: "control4-app", model: "control4-app", os: "Electron", osVersion: "33" },
      userInfo: { applicationKey: "78f6791373d61bea49fdb9fb8897f1f3af193f11", password: s.password, userName: s.username } },
  });
  const ctrls = await getJson("https://apis.control4.com/account/v3/rest/accounts", { Authorization: `Bearer ${a.authToken.token}` });
  const cn = s.controllerCommonName ?? (Array.isArray(ctrls.account) ? ctrls.account[0] : ctrls.account).controllerCommonName;
  const d = await postJson("https://apis.control4.com/authentication/v1/rest/authorization",
    { serviceInfo: { commonName: cn, services: "director" } }, { Authorization: `Bearer ${a.authToken.token}` });
  return d.authToken.token;
}
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
function dget(ip, tok, p) {
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname: ip, port: 443, path: p, agent, headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" }, timeout: 10000 },
      (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => {
        const t = Buffer.concat(c).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`${p} -> ${res.statusCode}`));
        resolve(t ? JSON.parse(t) : undefined); }); });
    r.on("error", reject); r.on("timeout", () => r.destroy(new Error("timeout"))); r.end();
  });
}

function keepLeaves(items) {
  const parentIds = new Set();
  for (const it of items) if (typeof it.parentId === "number") parentIds.add(it.parentId);
  return items.filter((it) => !parentIds.has(it.id));
}

async function main() {
  const settings = JSON.parse(await fs.readFile(SETTINGS_PATH, "utf-8"));
  const tok = await auth(settings);
  const ip = settings.directorIp;

  const items = await dget(ip, tok, "/api/v1/items");
  const proxyById = new Map();
  let hubRoomId = null;
  for (const it of items) {
    const p = String(it.proxy ?? "");
    proxyById.set(it.id, p);
    if ((p === "media_server" || p === "control4_digitalaudio") && hubRoomId === null) hubRoomId = it.roomId ?? null;
  }
  console.log(`Hub room id = ${hubRoomId}`);

  const candidates = keepLeaves(items.filter((it) => (it.categories ?? []).includes("audio_video")))
    .filter((it) => CANDIDATE_PROXIES.has(String(it.proxy ?? "")));

  const bindingsAll = await Promise.all(
    candidates.map((it) => dget(ip, tok, `/api/v1/items/${it.id}/bindings`).catch(() => [])),
  );

  const sources = [];
  candidates.forEach((it, i) => {
    const a = analyze(it, bindingsAll[i], proxyById, hubRoomId);
    if (a.kind === null) return;
    if (a.roomIds.length === 0 && !a.matrixAudio && !a.matrixVideo) return;
    sources.push({ id: it.id, name: it.name, proxy: it.proxy, roomName: it.roomName, ...a });
  });

  // Room 99 Master Bath: has matrix audio? Yes (we determined earlier).
  const ROOM_ID = 99;
  const canRouteMatrix = true;
  const visible = sources.filter((s) =>
    s.roomIds.includes(ROOM_ID) || (s.matrixAudio && canRouteMatrix),
  );

  const audio = visible.filter((s) => s.kind === "audio" || s.kind === "both");
  const video = visible.filter((s) => s.kind === "video" || s.kind === "both");

  console.log(`\n=== MASTER BATH (${ROOM_ID}) — audio section (${audio.length}) ===`);
  for (const s of audio) {
    const flags = [s.aggregator ? "AGG" : "", s.matrixAudio ? "MA" : "", s.matrixVideo ? "MV" : ""].filter(Boolean).join("+");
    console.log(`  ${String(s.id).padStart(5)} ${s.name.padEnd(28)} proxy=${(s.proxy ?? "").padEnd(14)} room=${(s.roomName ?? "").padEnd(15)} [${flags}] rooms=${s.roomIds.join(",")}`);
  }
  console.log(`\n=== MASTER BATH — video section (${video.length}) ===`);
  for (const s of video) {
    const flags = [s.aggregator ? "AGG" : "", s.matrixAudio ? "MA" : "", s.matrixVideo ? "MV" : ""].filter(Boolean).join("+");
    console.log(`  ${String(s.id).padStart(5)} ${s.name.padEnd(28)} proxy=${(s.proxy ?? "").padEnd(14)} room=${(s.roomName ?? "").padEnd(15)} [${flags}]`);
  }

  console.log(`\n=== All sources after analyzer (${sources.length}) ===`);
  for (const s of sources.sort((a, b) => (a.roomName || "").localeCompare(b.roomName || "") || a.name.localeCompare(b.name))) {
    const flags = [s.aggregator ? "AGG" : "", s.matrixAudio ? "MA" : "", s.matrixVideo ? "MV" : ""].filter(Boolean).join("+");
    console.log(`  ${String(s.id).padStart(5)} ${s.kind.padEnd(5)} ${s.name.padEnd(28)} proxy=${(s.proxy ?? "").padEnd(14)} room=${(s.roomName ?? "").padEnd(15)} [${flags}] rooms=${s.roomIds.join(",")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
