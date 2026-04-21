// Auto-update wiring. Queries GitHub Releases for a newer tagged version
// than what's baked into the running app, downloads in the background, and
// prompts the user to restart when ready. Silently does nothing during
// development (no packaged app to replace) and on the first-ever launch
// (autoUpdater will see the same version as the binary).
//
// Publish flow (for reference):
//   GH_TOKEN=ghp_... npm run release
// which runs `electron-builder --win --publish always` and uploads the
// NSIS .exe + latest.yml to the GitHub release matching the current
// package.json version.

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import log from "node:console";
import { autoUpdater } from "electron-updater";

// How long to wait after launch before checking. Small delay so we don't
// block the initial render, and so the user sees the window first.
const CHECK_DELAY_MS = 5_000;
// Recheck periodically in case the app stays open for days.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "not-available" }
  | { status: "downloading"; version: string; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

let state: UpdateState = { status: "idle" };
let checkTimer: NodeJS.Timeout | null = null;
let promptShown = false;

function broadcast(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send("updater:state", state);
}

function install(): void {
  // quitAndInstall quits this process and runs the NSIS installer's
  // silent/update path. The installer re-launches the new binary.
  setImmediate(() => autoUpdater.quitAndInstall());
}

async function promptRestart(window: BrowserWindow): Promise<void> {
  if (promptShown) return;
  promptShown = true;
  const version =
    state.status === "downloaded" ? state.version : "a new version";
  const result = await dialog.showMessageBox(window, {
    type: "info",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update ready",
    message: `Control4 ${version} is ready to install.`,
    detail:
      "Restart now to apply the update, or choose Later and it will apply next time you quit Control4.",
  });
  if (result.response === 0) install();
}

export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    // electron-updater throws "dev app update config" without a
    // dev-app-update.yml. Skip the whole subsystem in dev builds.
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    state = { status: "checking" };
    broadcast(getWindow());
  });
  autoUpdater.on("update-available", (info) => {
    state = { status: "available", version: info.version };
    broadcast(getWindow());
  });
  autoUpdater.on("update-not-available", () => {
    state = { status: "not-available" };
    broadcast(getWindow());
  });
  autoUpdater.on("download-progress", (p) => {
    const version =
      state.status === "available" || state.status === "downloading"
        ? state.version
        : "";
    state = {
      status: "downloading",
      version,
      percent: Math.round(p.percent),
    };
    broadcast(getWindow());
  });
  autoUpdater.on("update-downloaded", (info) => {
    state = { status: "downloaded", version: info.version };
    broadcast(getWindow());
    const window = getWindow();
    if (window) void promptRestart(window);
  });
  autoUpdater.on("error", (err) => {
    state = { status: "error", message: err?.message ?? String(err) };
    broadcast(getWindow());
    log.warn("[updater]", err);
  });

  ipcMain.handle("updater:getState", () => state);
  ipcMain.handle("updater:check", async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      state = {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    return state;
  });
  ipcMain.handle("updater:installNow", () => {
    if (state.status === "downloaded") install();
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_DELAY_MS);

  checkTimer = setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => {});
  }, RECHECK_INTERVAL_MS);
  app.on("before-quit", () => {
    if (checkTimer) clearInterval(checkTimer);
  });
}
