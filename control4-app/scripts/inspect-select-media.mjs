// Diagnose Family Room (roomId=11) SELECT_*_MEDIA command descriptors so we
// can see the exact param name/shape Director expects.
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

  const roomId = Number(process.argv[2] ?? 11);
  const cmds = await dget(ip, tok, `/api/v1/items/${roomId}/commands`);
  const selectMedia = cmds.filter((c) => /^SELECT_(AUDIO|VIDEO)_MEDIA/.test(String(c.command ?? "")));
  console.log(`room ${roomId}: ${selectMedia.length} SELECT_*_MEDIA command(s)`);
  for (const c of selectMedia) {
    console.log("\n-----");
    console.log(JSON.stringify(c, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
