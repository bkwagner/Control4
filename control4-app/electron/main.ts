import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";

import { Control4Client } from "./control4/client";
import {
  clearSettings,
  loadSettings,
  saveSettings,
  type Settings,
} from "./control4/config";

const isDev = process.env.NODE_ENV === "development";

let client: Control4Client | null = null;
let mainWindow: BrowserWindow | null = null;

function resetClient(settings: Settings | null): void {
  client = settings ? new Control4Client(settings) : null;
}

async function initClient(): Promise<Settings | null> {
  const settings = await loadSettings();
  resetClient(settings);
  return settings;
}

function requireClient(): Control4Client {
  if (!client) {
    throw new Error("Not configured — run setup first.");
  }
  return client;
}

function registerIpc(): void {
  // Config
  ipcMain.handle("config:get", async () => loadSettings());
  ipcMain.handle("config:save", async (_e, next: Settings) => {
    await saveSettings(next);
    resetClient(next);
    // Validate by forcing an auth round-trip.
    await requireClient().healthCheck();
    return true;
  });
  ipcMain.handle("config:clear", async () => {
    await clearSettings();
    resetClient(null);
    return true;
  });

  // Rooms
  ipcMain.handle("rooms:list", async () => requireClient().listRooms());
  ipcMain.handle("rooms:off", async (_e, roomId: number) =>
    requireClient().setRoomOff(roomId),
  );

  // Lights
  ipcMain.handle("lights:list", async () => requireClient().listLights());
  ipcMain.handle(
    "lights:setLevel",
    async (_e, itemId: number, level: number) =>
      requireClient().setLightLevel(itemId, level),
  );

  // Items
  ipcMain.handle("items:variables", async (_e, itemId: number) =>
    requireClient().getItemVariables(itemId),
  );

  // AV
  ipcMain.handle("av:sources", async () => requireClient().listMediaSources());
  ipcMain.handle("av:roomState", async (_e, roomId: number) =>
    requireClient().getRoomAvState(roomId),
  );
  ipcMain.handle("av:volume", async (_e, roomId: number, volume: number) =>
    requireClient().setRoomVolume(roomId, volume),
  );
  ipcMain.handle("av:muteToggle", async (_e, roomId: number) =>
    requireClient().toggleRoomMute(roomId),
  );
  ipcMain.handle(
    "av:audioSource",
    async (_e, roomId: number, sourceId: number) =>
      requireClient().setRoomAudioSource(roomId, sourceId),
  );
  ipcMain.handle(
    "av:videoSource",
    async (_e, roomId: number, sourceId: number) =>
      requireClient().setRoomVideoSource(roomId, sourceId),
  );
  ipcMain.handle("av:play", async (_e, roomId: number) =>
    requireClient().mediaTransport(roomId, "PLAY"),
  );
  ipcMain.handle("av:pause", async (_e, roomId: number) =>
    requireClient().mediaTransport(roomId, "PAUSE"),
  );
  ipcMain.handle("av:stop", async (_e, roomId: number) =>
    requireClient().mediaTransport(roomId, "STOP"),
  );
  ipcMain.handle(
    "av:roomCommand",
    async (
      _e,
      roomId: number,
      command: string,
      params?: Record<string, unknown>,
    ) => requireClient().roomCommand(roomId, command, params ?? {}),
  );
  ipcMain.handle(
    "av:browseSource",
    async (
      _e,
      roomId: number,
      sourceId: number,
      isVideo: boolean,
      aggregator: boolean,
    ) =>
      requireClient().browseSourceMedia(roomId, sourceId, isVideo, aggregator),
  );
  ipcMain.handle(
    "av:selectMedia",
    async (
      _e,
      roomId: number,
      kind: string,
      isVideo: boolean,
      mediaId: number,
    ) => requireClient().selectRoomMedia(roomId, kind, isVideo, mediaId),
  );

  // Climate
  ipcMain.handle("climate:list", async () => requireClient().listClimate());
  ipcMain.handle(
    "climate:set",
    async (
      _e,
      itemId: number,
      payload: {
        heat_setpoint_f?: number;
        cool_setpoint_f?: number;
        hvac_mode?: string;
      },
    ) => requireClient().setClimate(itemId, payload),
  );
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "dist", "index.html"),
    );
  }
}

app.whenReady().then(async () => {
  registerIpc();
  await initClient();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
