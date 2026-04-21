import * as https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SETTINGS_PATH = path.join(os.homedir(), "AppData/Roaming/control4-app/settings.json");

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

async function main() {
  const settings = JSON.parse(await fs.readFile(SETTINGS_PATH, "utf-8"));
  const tok = await auth(settings);
  const ip = settings.directorIp;

  const items = await dget(ip, tok, "/api/v1/items");
  console.log(`${items.length} items total`);

  const item100002 = items.find((i) => i.id === 100002);
  console.log("Item 100002:", item100002
    ? JSON.stringify({ id: item100002.id, name: item100002.name, proxy: item100002.proxy, typeName: item100002.typeName, roomId: item100002.roomId, roomName: item100002.roomName, categories: item100002.categories })
    : "NOT IN LIST");

  const proxies = new Map();
  for (const it of items) { const p = String(it.proxy ?? ""); proxies.set(p, (proxies.get(p) || 0) + 1); }
  console.log("\nAll proxies seen:");
  [...proxies.entries()].sort().forEach(([p, c]) => console.log(`  ${(p || "(empty)").padEnd(40)} ${c}`));

  // Any media_server or similar hub items?
  const mss = items.filter((i) => {
    const p = String(i.proxy ?? "");
    return p === "media_server" || p === "digital_media" || /media.?server|digital.?media/i.test(String(i.name ?? ""));
  });
  console.log("\nPossible hub items:", JSON.stringify(mss.map((i) => ({ id: i.id, name: i.name, proxy: i.proxy, typeName: i.typeName, roomId: i.roomId, roomName: i.roomName })), null, 2));

  // Inspect room 1264
  const r1264 = items.find((i) => i.id === 1264);
  console.log("\nItem/room 1264:", r1264
    ? JSON.stringify({ id: r1264.id, name: r1264.name, proxy: r1264.proxy, typeName: r1264.typeName })
    : "NOT FOUND");

  // Rooms list
  const rooms = items.filter((i) => i.typeName === "room");
  console.log("\nAll rooms:");
  for (const r of rooms) {
    console.log(`  ${String(r.id).padStart(5)} ${String(r.name ?? "").padEnd(22)} parent=${r.parentId ?? ""} proxy=${r.proxy ?? ""}`);
  }

  // Items with roomId=1264
  const in1264 = items.filter((i) => i.roomId === 1264);
  console.log(`\nItems with roomId=1264 (${in1264.length}):`);
  for (const i of in1264) {
    console.log(`  ${String(i.id).padStart(5)} ${String(i.name ?? "").padEnd(28)} proxy=${i.proxy ?? ""} typeName=${i.typeName ?? ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
