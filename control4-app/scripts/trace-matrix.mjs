// Trace the matrix-audio routing topology: which sources feed the amp,
// which rooms the amp feeds, and how DIGITAL_AUDIO_SERVER services reach
// the matrix. Goal is to derive a structural routing check so source
// visibility doesn't depend on roomName == "Channels".

import * as https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SETTINGS_PATH = path.join(os.homedir(), "AppData/Roaming/control4-app/settings.json");

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}
async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}
async function auth(settings) {
  const a = await postJson("https://apis.control4.com/authentication/v1/rest", {
    clientInfo: {
      device: { deviceName: "control4-app", deviceUUID: "0000000000000000", make: "control4-app", model: "control4-app", os: "Electron", osVersion: "33" },
      userInfo: { applicationKey: "78f6791373d61bea49fdb9fb8897f1f3af193f11", password: settings.password, userName: settings.username },
    },
  });
  const ctrls = await getJson("https://apis.control4.com/account/v3/rest/accounts", { Authorization: `Bearer ${a.authToken.token}` });
  const cn = settings.controllerCommonName ?? (Array.isArray(ctrls.account) ? ctrls.account[0] : ctrls.account).controllerCommonName;
  const d = await postJson("https://apis.control4.com/authentication/v1/rest/authorization",
    { serviceInfo: { commonName: cn, services: "director" } },
    { Authorization: `Bearer ${a.authToken.token}` });
  return d.authToken.token;
}
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
function dget(ip, tok, p) {
  return new Promise((resolve, reject) => {
    const r = https.request({ hostname: ip, port: 443, path: p, agent, headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" }, timeout: 10000 },
      (res) => {
        const c = [];
        res.on("data", (x) => c.push(x));
        res.on("end", () => {
          const t = Buffer.concat(c).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`${p} -> ${res.statusCode}`));
          resolve(t ? JSON.parse(t) : undefined);
        });
      });
    r.on("error", reject);
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.end();
  });
}

function printBindings(title, bindings) {
  console.log(`\n=== ${title} ===`);
  for (const b of bindings ?? []) {
    const dir = b.inputoutput;
    const h = b.hidden ? "H" : " ";
    const conns = (b.connections ?? []).map((c) => `${c.id}/${c.name}(room ${c.roomId})`).join(", ");
    console.log(`  [${dir[0]}${h}] ${b.bindingClass.padEnd(25)} id=${b.bindingId}  -> ${conns || "(unconnected)"}`);
  }
}

async function main() {
  const settings = JSON.parse(await fs.readFile(SETTINGS_PATH, "utf-8"));
  const tok = await auth(settings);
  const ip = settings.directorIp;

  // Amp
  const amp = await dget(ip, tok, "/api/v1/items/96/bindings");
  printBindings("Amplifier (96)", amp);

  // A few key sources — show what their outputs CONNECT TO
  const keyIds = [
    [1126, "SiriusXM"],
    [1118, "Amazon Music"],
    [704,  "My Music (Gym)"],
    [1439, "Master Bath (ShairBridge)"],
    [1008, "Family Room (ShairBridge)"],
    [708,  "Stations (aggregator)"],
    [840,  "My Movies (aggregator)"],
    [1321, "Manage Music"],
    [1162, "DVR"],
    [1313, "Spotify Connect"],
  ];
  for (const [id, label] of keyIds) {
    const b = await dget(ip, tok, `/api/v1/items/${id}/bindings`);
    printBindings(`${label} (${id})`, b);
  }

  // Rooms we care about — what they're wired to
  const roomIds = [
    [99,  "Master Bath"],
    [11,  "Family Room"],
    [201, "Backyard"],
    [44,  "Billiard Room"],
    [653, "Office"],
  ];
  for (const [id, label] of roomIds) {
    const b = await dget(ip, tok, `/api/v1/items/${id}/bindings`);
    printBindings(`Room ${label} (${id})`, b);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
