// Persisted app settings. Stored in app.getPath("userData") as JSON
// (Electron's recommended location — %APPDATA% on Windows). The password is
// encrypted with safeStorage (DPAPI on Windows, Keychain on macOS) whenever
// the OS supports it; legacy plaintext files are migrated on first load.

import { app, safeStorage } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

export interface Settings {
  username: string;
  password: string;
  directorIp: string;
  controllerCommonName: string | null;
  // PEM of the director's self-signed certificate, pinned on first connect
  // (trust on first use). Cleared whenever the user re-saves settings.
  directorCertPem: string | null;
}

interface StoredSettings {
  username?: string;
  password?: string;
  passwordEnc?: string;
  directorIp?: string;
  controllerCommonName?: string | null;
  directorCertPem?: string | null;
}

const EMPTY: Settings = {
  username: "",
  password: "",
  directorIp: "",
  controllerCommonName: null,
  directorCertPem: null,
};

function configPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function decryptPassword(stored: StoredSettings): string | null {
  if (stored.passwordEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.passwordEnc, "base64"));
    } catch {
      return null;
    }
  }
  return stored.password || null;
}

export async function loadSettings(): Promise<Settings | null> {
  let parsed: StoredSettings;
  try {
    parsed = JSON.parse(await fs.readFile(configPath(), "utf-8")) as StoredSettings;
  } catch {
    return null;
  }
  const password = decryptPassword(parsed);
  if (!parsed.username || !password || !parsed.directorIp) {
    return null;
  }
  const settings: Settings = {
    username: parsed.username,
    password,
    directorIp: parsed.directorIp,
    controllerCommonName: parsed.controllerCommonName ?? null,
    directorCertPem: parsed.directorCertPem ?? null,
  };
  // Migrate legacy plaintext passwords.
  if (parsed.password && safeStorage.isEncryptionAvailable()) {
    await saveSettings(settings);
  }
  return settings;
}

export async function saveSettings(s: Settings): Promise<void> {
  const p = configPath();
  const { password, ...rest } = s;
  const stored: StoredSettings = safeStorage.isEncryptionAvailable()
    ? { ...rest, passwordEnc: safeStorage.encryptString(password).toString("base64") }
    : { ...rest, password };
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(stored, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export async function clearSettings(): Promise<void> {
  try {
    await fs.unlink(configPath());
  } catch {
    // already gone — fine
  }
}

export function emptySettings(): Settings {
  return { ...EMPTY };
}
