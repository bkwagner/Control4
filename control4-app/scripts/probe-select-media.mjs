// Probe different tParams shapes for SELECT_AUDIO_MEDIA to find what Director
// actually wants. Targets a safe kind (STATION) — picks the first station
// returned by the browse path so the mediaid is known-valid. You can pass a
// different kind via CLI: node scripts/probe-select-media.mjs PLAYLIST
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

function dreq(ip, tok, method, p, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const r = https.request({
      hostname: ip, port: 443, path: p, method, agent,
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 15000,
    }, (res) => {
      const c = [];
      res.on("data", (x) => c.push(x));
      res.on("end", () => {
        const t = Buffer.concat(c).toString("utf8");
        resolve({ status: res.statusCode, body: t });
      });
    });
    r.on("error", (e) => resolve({ status: 0, body: String(e) }));
    r.on("timeout", () => { r.destroy(); resolve({ status: 0, body: "timeout" }); });
    if (payload) r.write(payload);
    r.end();
  });
}

async function main() {
  const settings = JSON.parse(await fs.readFile(SETTINGS_PATH, "utf-8"));
  const tok = await auth(settings);
  const ip = settings.directorIp;
  const kind = (process.argv[2] ?? "STATION").toUpperCase();
  const roomId = Number(process.argv[3] ?? 11);

  // Look up the command descriptor to get the browse path & current-kind item
  const cmds = await dreq(ip, tok, "GET", `/api/v1/items/${roomId}/commands`);
  const descriptors = JSON.parse(cmds.body);
  const desc = descriptors.find((c) => c.command === `SELECT_AUDIO_MEDIA:${kind}`);
  if (!desc) {
    console.error(`No SELECT_AUDIO_MEDIA:${kind} on room ${roomId}`);
    process.exit(1);
  }
  const browsePath = desc.params[0]?.valueSrc?.path;
  const browse = await dreq(ip, tok, "GET", browsePath);
  const rows = JSON.parse(browse.body);
  if (!rows.length) {
    console.error(`No media rows at ${browsePath}`);
    process.exit(1);
  }
  const mediaId = Number(rows[0].id);
  console.log(`using kind=${kind} mediaId=${mediaId} (${rows[0].name ?? rows[0].title ?? "?"})`);
  console.log();

  const command = `SELECT_AUDIO_MEDIA:${kind}`;
  const variants = [
    { label: "A: dict tParams {mediaid} async=true", body: { async: true, command, tParams: { mediaid: mediaId } } },
    { label: "B: dict tParams {mediaid} async=false", body: { async: false, command, tParams: { mediaid: mediaId } } },
    { label: "C: dict tParams {mediaid: str} async=true", body: { async: true, command, tParams: { mediaid: String(mediaId) } } },
    { label: "D: array tParams [{name,value}] async=true", body: { async: true, command, tParams: [{ name: "mediaid", value: mediaId }] } },
    { label: "E: array params [{name,value}] async=true", body: { async: true, command, params: [{ name: "mediaid", value: mediaId }] } },
    { label: "F: dict params {mediaid} async=true", body: { async: true, command, params: { mediaid: mediaId } } },
    { label: "G: nested tParams {params:[{name,value}]}", body: { async: true, command, tParams: { params: [{ name: "mediaid", value: mediaId }] } } },
  ];

  for (const v of variants) {
    const r = await dreq(ip, tok, "POST", `/api/v1/items/${roomId}/commands`, v.body);
    const shortBody = r.body.length > 200 ? r.body.slice(0, 200) + "…" : r.body;
    console.log(`${v.label}\n  -> ${r.status}: ${shortBody}\n`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
