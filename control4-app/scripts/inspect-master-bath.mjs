// Focused diagnostic: what fields distinguish items that should show in
// Master Bath from items that shouldn't. Prints full item objects for a
// curated comparison set.

import * as https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SETTINGS_PATH = path.join(
  os.homedir(),
  "AppData/Roaming/control4-app/settings.json",
);

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
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function getAccountToken(username, password) {
  const data = await postJson("https://apis.control4.com/authentication/v1/rest", {
    clientInfo: {
      device: {
        deviceName: "control4-app", deviceUUID: "0000000000000000",
        make: "control4-app", model: "control4-app",
        os: "Electron", osVersion: "33",
      },
      userInfo: {
        applicationKey: "78f6791373d61bea49fdb9fb8897f1f3af193f11",
        password, userName: username,
      },
    },
  });
  return data.authToken?.token;
}

async function getControllers(accountToken) {
  const data = await getJson(
    "https://apis.control4.com/account/v3/rest/accounts",
    { Authorization: `Bearer ${accountToken}` },
  );
  const acct = data.account;
  return Array.isArray(acct) ? acct : [acct];
}

async function getDirectorToken(accountToken, commonName) {
  const data = await postJson(
    "https://apis.control4.com/authentication/v1/rest/authorization",
    { serviceInfo: { commonName, services: "director" } },
    { Authorization: `Bearer ${accountToken}` },
  );
  return data.authToken?.token;
}

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
function directorGet(ip, bearer, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: ip, port: 443, path, method: "GET", agent,
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
        timeout: 10000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${path} -> ${res.statusCode}`));
            return;
          }
          resolve(text ? JSON.parse(text) : undefined);
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function main() {
  const settings = JSON.parse(await fs.readFile(SETTINGS_PATH, "utf-8"));
  const accountToken = await getAccountToken(settings.username, settings.password);
  const controllers = await getControllers(accountToken);
  const commonName = settings.controllerCommonName ?? controllers[0].controllerCommonName;
  const directorToken = await getDirectorToken(accountToken, commonName);

  // Get Master Bath (99) bindings to understand matrix wiring.
  console.log("=== Master Bath (99) Input bindings ===");
  const mbBindings = await directorGet(settings.directorIp, directorToken, "/api/v1/items/99/bindings");
  for (const b of mbBindings) {
    if (b.inputoutput !== "Input") continue;
    console.log(`  ${b.bindingClass} (id=${b.bindingId}) -> connections:`);
    for (const c of b.connections ?? []) {
      console.log(`      → item ${c.id} "${c.name}" (room ${c.roomId} "${c.roomName}") bindingId=${c.bindingId}`);
    }
  }

  // Now enrich with compare set: items the user expects vs items that shouldn't show.
  console.log("\n=== Full item records ===");
  const items = await directorGet(settings.directorIp, directorToken, "/api/v1/items");
  const byId = new Map(items.map((it) => [it.id, it]));
  const compareIds = [
    708,  // Stations (expected)
    840,  // My Movies (NOT expected, same H:MediaService shape)
    52,   // NAS Music (NOT expected)
    704,  // My Music (expected, roomName=Gym)
    1321, // Manage Music (expected per user)
    1162, // DVR (expected, cable Family Room)
    1439, // Master Bath source (expected)
    1008, // Family Room source (NOT expected for Master Bath — hmm)
    96,   // Amplifier
  ];
  for (const id of compareIds) {
    const it = byId.get(id);
    if (!it) { console.log(`  (no item ${id})`); continue; }
    console.log(`\n  ${id} ${it.name} -- proxy=${it.proxy} room=${it.roomName} type=${it.typeName}`);
    console.log("    categories:", JSON.stringify(it.categories));
    // Dump any interesting-looking fields.
    for (const [k, v] of Object.entries(it)) {
      if (["id","name","proxy","roomName","roomId","floorName","floorId","parentId","typeName","categories"].includes(k)) continue;
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (s.length < 120) console.log(`    ${k}: ${s}`);
    }
  }

  // Finally: per-category membership to see what Director says "audio" means.
  console.log("\n=== Items in category audio_sources (if exists) ===");
  try {
    const audioSources = await directorGet(settings.directorIp, directorToken, "/api/v1/categories/audio_sources");
    for (const it of audioSources) {
      console.log(`  ${it.id} ${it.name} (room=${it.roomName}, proxy=${it.proxy})`);
    }
  } catch (e) {
    console.log("  (category audio_sources not available:", e.message, ")");
  }

  console.log("\n=== Items in category video_sources (if exists) ===");
  try {
    const videoSources = await directorGet(settings.directorIp, directorToken, "/api/v1/categories/video_sources");
    for (const it of videoSources) {
      console.log(`  ${it.id} ${it.name} (room=${it.roomName}, proxy=${it.proxy})`);
    }
  } catch (e) {
    console.log("  (category video_sources not available:", e.message, ")");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
