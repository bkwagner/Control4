// Dump the Family Room's variables while audio is playing so we can see what
// Director exposes for now-playing (station name, track title, artist, etc).
import * as https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SETTINGS_PATH = path.join(os.homedir(), "AppData/Roaming/control4-app/settings.json");

async function postJson(url, body, headers = {}) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function getJson(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function auth(s) {
  const a = await postJson("https://apis.control4.com/authentication/v1/rest", {
    clientInfo: { device: { deviceName: "control4-app", deviceUUID: "0".repeat(16), make: "x", model: "x", os: "e", osVersion: "1" },
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
  return new Promise((rs, rj) => {
    const r = https.request({ hostname: ip, port: 443, path: p, agent, headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" } },
      (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => {
        const t = Buffer.concat(c).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) return rj(new Error(`${p} -> ${res.statusCode}: ${t}`));
        rs(JSON.parse(t));
      }); });
    r.on("error", rj); r.end();
  });
}

async function main() {
  const settings = JSON.parse(await fs.readFile(SETTINGS_PATH, "utf-8"));
  const tok = await auth(settings);
  const ip = settings.directorIp;
  const roomId = Number(process.argv[2] ?? 11);

  console.log(`\n==== room ${roomId} variables ====`);
  const roomVars = await dget(ip, tok, `/api/v1/items/${roomId}/variables`);
  const set = roomVars
    .filter((v) => v.value !== "Undefined" && v.value !== undefined && v.value !== "" && v.value !== null)
    .sort((a, b) => a.varName.localeCompare(b.varName));
  for (const v of set) {
    console.log(`  ${v.varName} = ${JSON.stringify(v.value)}`);
  }

  // If CURRENT_AUDIO_DEVICE is set, dump that device's variables too — that's
  // where stream metadata tends to live (SiriusXM channel name, track, etc).
  const cad = roomVars.find((v) => v.varName === "CURRENT_AUDIO_DEVICE");
  const cadId = Number(cad?.value);
  if (cadId) {
    console.log(`\n==== CURRENT_AUDIO_DEVICE ${cadId} variables ====`);
    const devVars = await dget(ip, tok, `/api/v1/items/${cadId}/variables`);
    for (const v of devVars.filter((v) => v.value !== "Undefined" && v.value !== "" && v.value != null).sort((a, b) => a.varName.localeCompare(b.varName))) {
      const s = String(v.value);
      console.log(`  ${v.varName} = ${s.length > 120 ? s.slice(0, 120) + "…" : JSON.stringify(v.value)}`);
    }
    const item = (await dget(ip, tok, `/api/v1/items`)).find((i) => i.id === cadId);
    console.log(`\n  (device: name="${item?.name}" proxy="${item?.proxy}" typeName="${item?.typeName}")`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
