// One-off diagnostic. Authenticates, pulls every audio_video item and its
// bindings, and prints how the Phase 1 classifier would tag each — plus the
// raw output-binding classes so we can see which rows Navigator hides.
//
// Run: node scripts/inspect-sources.mjs

import * as https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SETTINGS_PATH = path.join(
  os.homedir(),
  "AppData/Roaming/control4-app/settings.json",
);

const VIDEO_OUTPUT_CLASSES = new Set([
  "VIDEO_OUT", "HDMI_OUT", "COMPONENT_VIDEO_OUT", "COMPOSITE_VIDEO_OUT",
  "S_VIDEO_OUT", "DVI_OUT", "DISPLAYPORT_OUT", "HDMI", "VIDEO",
]);
const AUDIO_OUTPUT_CLASSES = new Set([
  "STEREO_AUDIO_OUT", "DIGITAL_AUDIO_OUT", "ANALOG_AUDIO_OUT", "AUDIO_OUT",
  "OPTICAL_OUT", "COAX_OUT", "AUDIO", "DIGITAL_AUDIO", "DIGITAL_AUDIO_SERVER",
]);
const FALLBACK_PROXIES = new Set([
  "media_service", "media_player", "tv", "cable", "cd", "dvd",
  "control4_network_mediastorage",
]);

function looksLikeFallback(proxy) {
  if (FALLBACK_PROXIES.has(proxy)) return true;
  return proxy.startsWith("rf_");
}

function classify(bindings, proxy) {
  let video = false, audio = false;
  for (const b of bindings ?? []) {
    if (b.inputoutput !== "Output") continue;
    if (b.hidden) continue;
    const cls = b.bindingClass ?? "";
    if (VIDEO_OUTPUT_CLASSES.has(cls)) video = true;
    if (AUDIO_OUTPUT_CLASSES.has(cls)) audio = true;
  }
  if (video && audio) return "both";
  if (video) return "video";
  if (audio) return "audio";
  if (proxy === "media_service") return "audio";
  if (proxy === "tv" || proxy === "cable" || proxy === "dvd") return "video";
  if (proxy === "media_player") return "video";
  return null;
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getJson(url, headers) {
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getAccountToken(username, password) {
  const data = await postJson(
    "https://apis.control4.com/authentication/v1/rest",
    {
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
    },
  );
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
      {
        hostname: ip, port: 443, path, method: "GET", agent,
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${path} -> ${res.statusCode}: ${text.slice(0, 200)}`));
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
  console.log(`Director IP: ${settings.directorIp}`);

  const accountToken = await getAccountToken(settings.username, settings.password);
  const controllers = await getControllers(accountToken);
  const commonName = settings.controllerCommonName ?? controllers[0].controllerCommonName;
  const directorToken = await getDirectorToken(accountToken, commonName);
  console.log(`Controller: ${commonName}`);

  const items = await directorGet(settings.directorIp, directorToken, "/api/v1/items");
  const av = items.filter((it) =>
    (it.categories ?? []).includes("audio_video") || String(it.proxy ?? "").length > 0,
  );

  const candidates = av.filter((it) => {
    const proxy = String(it.proxy ?? "");
    return looksLikeFallback(proxy);
  });

  // Keep leaves only (items that aren't parents of any other candidate).
  const parentIds = new Set(candidates.map((it) => it.parentId).filter((v) => typeof v === "number"));
  const leaves = candidates.filter((it) => !parentIds.has(it.id));

  console.log(`\n${leaves.length} candidate items after proxy+leaf filter\n`);

  const rows = [];
  for (const it of leaves) {
    const proxy = String(it.proxy ?? "");
    let bindings = [];
    try {
      bindings = await directorGet(settings.directorIp, directorToken, `/api/v1/items/${it.id}/bindings`);
    } catch {}
    const outputs = (bindings ?? []).filter((b) => b.inputoutput === "Output");
    const visibleOutputs = outputs.filter((b) => !b.hidden);
    const kind = classify(bindings, proxy);
    const outputClasses = outputs.map((b) => `${b.hidden ? "H:" : ""}${b.bindingClass}`).join(",");
    rows.push({
      id: it.id,
      name: it.name,
      proxy,
      roomName: it.roomName ?? "",
      kind,
      visibleOutputs: visibleOutputs.length,
      totalOutputs: outputs.length,
      outputClasses,
    });
  }

  rows.sort((a, b) => (a.roomName || "").localeCompare(b.roomName || "") || a.name.localeCompare(b.name));

  console.log("KIND   VIS/TOT  ID   PROXY                              ROOM            NAME");
  console.log("------------------------------------------------------------------------------");
  for (const r of rows) {
    const k = (r.kind ?? "null").padEnd(6);
    const vt = `${r.visibleOutputs}/${r.totalOutputs}`.padEnd(8);
    const id = String(r.id).padStart(4);
    const p = r.proxy.padEnd(34);
    const room = (r.roomName || "").padEnd(15);
    console.log(`${k} ${vt} ${id} ${p} ${room} ${r.name}`);
  }

  console.log("\nOutput binding classes per item (H: = hidden):");
  for (const r of rows) {
    console.log(`  ${r.id} ${r.name}: ${r.outputClasses || "(none)"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
