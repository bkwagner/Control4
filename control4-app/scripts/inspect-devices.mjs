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
  const s = JSON.parse(await fs.readFile(SETTINGS_PATH, "utf8"));
  const tok = await auth(s);
  console.log("✓ Authenticated");

  const items = await dget(s.directorIp, tok, "/api/v1/items");
  console.log(`✓ Fetched ${items.length} items\n`);

  // Look for blinds
  const blindsProxies = new Set(["blind", "shade", "motorized_shade", "window_covering"]);
  const blinds = items.filter(i => blindsProxies.has(String(i.proxy || "")));
  console.log(`Blinds (proxy in ${JSON.stringify([...blindsProxies])}):`);
  for (const b of blinds) {
    const vars = await dget(s.directorIp, tok, `/api/v1/items/${b.id}/variables`);
    const cmds = await dget(s.directorIp, tok, `/api/v1/items/${b.id}/commands`);
    console.log(`  ID=${b.id} name="${b.name}" proxy="${b.proxy}" roomId=${b.roomId}`);
    console.log(`    Variables: ${vars.map(v => v.varName).join(", ")}`);
    console.log(`    Commands: ${cmds.map(c => c.name).join(", ")}\n`);
  }

  // Look for locks
  const lockProxies = new Set(["lock", "door_lock", "yale_lock", "schlage"]);
  const locks = items.filter(i => lockProxies.has(String(i.proxy || "").toLowerCase()));
  console.log(`Locks (proxy in ${JSON.stringify([...lockProxies])}):`);
  if (locks.length === 0) {
    const potentialLocks = items.filter(i => String(i.name || "").toLowerCase().includes("lock"));
    if (potentialLocks.length > 0) {
      console.log(`  No matching proxy, but found items with "lock" in name:`);
      for (const l of potentialLocks.slice(0, 5)) {
        console.log(`    ID=${l.id} name="${l.name}" proxy="${l.proxy}"`);
      }
    } else {
      console.log(`  None found\n`);
    }
  } else {
    for (const l of locks) {
      try {
        const vars = await dget(s.directorIp, tok, `/api/v1/items/${l.id}/variables`);
        const cmds = await dget(s.directorIp, tok, `/api/v1/items/${l.id}/commands`);
        console.log(`  ID=${l.id} name="${l.name}" proxy="${l.proxy}" roomId=${l.roomId}`);
        console.log(`    Variables: ${vars.map(v => v.varName).join(", ")}`);
        console.log(`    Commands: ${cmds.filter(c => c.name).map(c => c.name).join(", ")}\n`);
      } catch (e) {
        console.log(`  ID=${l.id} name="${l.name}" proxy="${l.proxy}" - Error: ${e.message}\n`);
      }
    }
  }

  // Look for security
  const secProxies = new Set(["security_panel", "security", "alarm_panel", "alarm"]);
  const security = items.filter(i => secProxies.has(String(i.proxy || "").toLowerCase()));
  console.log(`Security Panels (proxy in ${JSON.stringify([...secProxies])}):`);
  if (security.length === 0) {
    console.log(`  None found (this may require special permissions)\n`);
  } else {
    for (const sec of security) {
      try {
        const vars = await dget(s.directorIp, tok, `/api/v1/items/${sec.id}/variables`);
        const cmds = await dget(s.directorIp, tok, `/api/v1/items/${sec.id}/commands`);
        console.log(`  ID=${sec.id} name="${sec.name}" proxy="${sec.proxy}" roomId=${sec.roomId}`);
        console.log(`    Variables: ${vars.map(v => v.varName).join(", ")}`);
        console.log(`    Commands: ${cmds.filter(c => c.name).map(c => c.name).join(", ")}\n`);
      } catch (e) {
        console.log(`  ID=${sec.id} name="${sec.name}" proxy="${sec.proxy}" - Error: ${e.message}\n`);
      }
    }
  }

  // Look for scenes/macros
  const sceneProxies = new Set(["macro", "scene", "lightingscene"]);
  const scenes = items.filter(i => sceneProxies.has(String(i.proxy || "")));
  console.log(`Scenes/Macros (proxy in ${JSON.stringify([...sceneProxies])}):`);
  for (const sc of scenes.slice(0, 10)) { // Limit to first 10
    const cmds = await dget(s.directorIp, tok, `/api/v1/items/${sc.id}/commands`);
    console.log(`  ID=${sc.id} name="${sc.name}" proxy="${sc.proxy}" roomId=${sc.roomId || "null"}`);
    console.log(`    Commands: ${cmds.map(c => c.name).join(", ")}\n`);
  }
  if (scenes.length > 10) console.log(`... and ${scenes.length - 10} more scenes\n`);

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Blinds found: ${blinds.length}`);
  console.log(`Locks found: ${locks.length}`);
  console.log(`Security panels found: ${security.length}`);
  console.log(`Scenes/Macros found: ${scenes.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
