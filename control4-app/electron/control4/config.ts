// Persisted app settings. Stored in app.getPath("userData") as plain JSON
// (Electron's recommended location — %APPDATA% on Windows).

import { app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

export interface Settings {
  username: string;
  password: string;
  directorIp: string;
  controllerCommonName: string | null;
}

const EMPTY: Settings = {
  username: "",
  password: "",
  directorIp: "",
  controllerCommonName: null,
};

function configPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export async function loadSettings(): Promise<Settings | null> {
  try {
    const raw = await fs.readFile(configPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (!parsed.username || !parsed.password || !parsed.directorIp) {
      return null;
    }
    return {
      username: parsed.username,
      password: parsed.password,
      directorIp: parsed.directorIp,
      controllerCommonName: parsed.controllerCommonName ?? null,
    };
  } catch {
    return null;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const p = configPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(s, null, 2), "utf-8");
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
