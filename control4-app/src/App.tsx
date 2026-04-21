import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AppSettings } from "@/lib/control4";
import type { BlindDevice, ClimateDevice, Light, LockDevice, MediaSource, Room, SecurityDevice } from "@/lib/types";
import { RoomList } from "@/components/RoomList";
import { LightsGrid } from "@/components/LightsGrid";
import { AudioPanel } from "@/components/AudioPanel";
import { ClimatePanel } from "@/components/ClimatePanel";
import { BlindsPanel } from "@/components/BlindsPanel";
import { LocksPanel } from "@/components/LocksPanel";
import { SecurityPanel } from "@/components/SecurityPanel";
import { AvOverviewPage } from "@/components/AvOverviewPage";
import { SetupScreen } from "@/components/SetupScreen";
import { UpdateIndicator } from "@/components/UpdateIndicator";

const REFRESH_MS = 5000;
// Director takes a moment to reflect a SET_LEVEL in GET queries. During that
// window, /items still reports the old level, so the next poll would overwrite
// our optimistic update and the bulb appears to "bounce" off then back on.
const LIGHT_PENDING_MS = 4000;

type Tab = "lights" | "audio" | "climate" | "blinds" | "locks" | "security";
type View = "rooms" | "av";
type ConfigState =
  | { status: "loading" }
  | { status: "needs-setup"; initial: AppSettings | null }
  | { status: "ready"; settings: AppSettings };

export default function App() {
  const [configState, setConfigState] = useState<ConfigState>({
    status: "loading",
  });
  const [showSettings, setShowSettings] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [lights, setLights] = useState<Light[]>([]);
  const [sources, setSources] = useState<MediaSource[]>([]);
  const [climate, setClimate] = useState<ClimateDevice[]>([]);
  const [blinds, setBlinds] = useState<BlindDevice[]>([]);
  const [locks, setLocks] = useState<LockDevice[]>([]);
  const [security, setSecurity] = useState<SecurityDevice[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("lights");
  const [view, setView] = useState<View>("rooms");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [avActivityActive, setAvActivityActive] = useState(false);
  const pendingLightsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await window.control4.getConfig();
        if (cancelled) return;
        if (existing) {
          setConfigState({ status: "ready", settings: existing });
        } else {
          setConfigState({ status: "needs-setup", initial: null });
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setConfigState({ status: "needs-setup", initial: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = configState.status === "ready";

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: number | undefined;

    async function tick(initial: boolean): Promise<void> {
      try {
        const [roomsData, lightsData, climateData, blindsData, locksData, securityData] = await Promise.all([
          api.listRooms(),
          api.listLights(),
          api.listClimate(),
          api.listBlinds(),
          api.listLocks(),
          api.listSecurity(),
        ]);
        if (cancelled) return;
        setRooms(roomsData);
        setLights((prev) => {
          const now = Date.now();
          const pending = pendingLightsRef.current;
          for (const [id, at] of pending) {
            if (now - at > LIGHT_PENDING_MS) pending.delete(id);
          }
          if (pending.size === 0) return lightsData;
          const prevById = new Map(prev.map((l) => [l.id, l]));
          return lightsData.map((l) =>
            pending.has(l.id) ? prevById.get(l.id) ?? l : l,
          );
        });
        setClimate(climateData);
        setBlinds(blindsData);
        setLocks(locksData);
        setSecurity(securityData);
        if (initial) {
          const sourcesData = await api.listMediaSources();
          if (cancelled) return;
          setSources(sourcesData);
        }
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (initial && !cancelled) setLoading(false);
      }
    }

    void tick(true);
    timer = window.setInterval(() => void tick(false), REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const avRoomIds = rooms.filter((r) => r.hasAv).map((r) => r.id);
    if (avRoomIds.length === 0) {
      setAvActivityActive(false);
      return;
    }
    let cancelled = false;

    async function checkActivity(): Promise<void> {
      try {
        const states = await api.getAllRoomsAvState(avRoomIds);
        if (cancelled) return;
        const hasActive = states.some((s) => s.matrix_source_id != null);
        setAvActivityActive(hasActive);
      } catch (e) {
        // silently fail on connectivity issues
      }
    }

    void checkActivity();
    const timer = window.setInterval(() => void checkActivity(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready, rooms]);

  async function handleSetupSaved(): Promise<void> {
    const next = await window.control4.getConfig();
    if (next) {
      setConfigState({ status: "ready", settings: next });
      setShowSettings(false);
      setLoading(true);
    }
  }

  // Hide rooms that have nothing controllable — no lights, no climate, no AV, no blinds, no locks, no security.
  // Director returns phantom rooms (virtual groupings, dumb zones) that would
  // otherwise show up as empty panes in the sidebar.
  const visibleRooms = useMemo(() => {
    const lightRoomIds = new Set(
      lights
        .map((l) => l.roomId)
        .filter((id): id is number => id != null),
    );
    const climateRoomIds = new Set(
      climate
        .map((c) => c.roomId)
        .filter((id): id is number => id != null),
    );
    const blindRoomIds = new Set(
      blinds
        .map((b) => b.roomId)
        .filter((id): id is number => id != null),
    );
    const lockRoomIds = new Set(
      locks
        .map((l) => l.roomId)
        .filter((id): id is number => id != null),
    );
    const securityRoomIds = new Set(
      security
        .map((s) => s.roomId)
        .filter((id): id is number => id != null),
    );
    return rooms.filter(
      (r) =>
        r.hasAv ||
        lightRoomIds.has(r.id) ||
        climateRoomIds.has(r.id) ||
        blindRoomIds.has(r.id) ||
        lockRoomIds.has(r.id) ||
        securityRoomIds.has(r.id),
    );
  }, [rooms, lights, climate, blinds, locks, security]);

  useEffect(() => {
    if (selectedRoomId === null && visibleRooms.length > 0) {
      setSelectedRoomId(visibleRooms[0].id);
    }
  }, [visibleRooms, selectedRoomId]);

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  const lightsInRoom = useMemo(
    () => lights.filter((l) => l.roomId === selectedRoomId),
    [lights, selectedRoomId],
  );

  const climateInRoom = useMemo(
    () => climate.filter((c) => c.roomId === selectedRoomId),
    [climate, selectedRoomId],
  );

  const blindsInRoom = useMemo(
    () => blinds.filter((b) => b.roomId === selectedRoomId),
    [blinds, selectedRoomId],
  );

  const locksInRoom = useMemo(
    () => locks.filter((l) => l.roomId === selectedRoomId),
    [locks, selectedRoomId],
  );

  const securityInRoom = useMemo(
    () => security.filter((s) => s.roomId === selectedRoomId),
    [security, selectedRoomId],
  );

  const onCount = lightsInRoom.filter(
    (l) => (l.level ?? 0) > 0 || (l.state ?? 0) > 0,
  ).length;

  async function handleSetLevel(itemId: number, level: number): Promise<void> {
    pendingLightsRef.current.set(itemId, Date.now());
    setLights((prev) =>
      prev.map((l) =>
        l.id === itemId ? { ...l, level, state: level > 0 ? 1 : 0 } : l,
      ),
    );
    try {
      await api.setLightLevel(itemId, level);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRoomOff(roomId: number): Promise<void> {
    try {
      // ROOM_OFF only turns off audio/video — lights are untouched by design,
      // so don't optimistically drive their sliders to 0.
      await api.roomOff(roomId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAllOff(): Promise<void> {
    try {
      setError(null);
      const allRooms = [...visibleRooms]; // shallow copy to avoid mutation during iteration
      await Promise.all(allRooms.map((room) => api.roomOff(room.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [];
  if (lightsInRoom.length > 0)
    tabs.push({ id: "lights", label: "Lights", count: lightsInRoom.length });
  if (selectedRoom?.hasAv) tabs.push({ id: "audio", label: "AV" });
  if (climateInRoom.length > 0)
    tabs.push({ id: "climate", label: "Climate", count: climateInRoom.length });
  if (blindsInRoom.length > 0)
    tabs.push({ id: "blinds", label: "Blinds", count: blindsInRoom.length });
  if (locksInRoom.length > 0)
    tabs.push({ id: "locks", label: "Locks", count: locksInRoom.length });
  if (securityInRoom.length > 0)
    tabs.push({ id: "security", label: "Security", count: securityInRoom.length });

  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId, tabs.length]);

  if (configState.status === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        Loading…
      </div>
    );
  }

  if (configState.status === "needs-setup") {
    return (
      <SetupScreen initial={configState.initial} onSaved={handleSetupSaved} />
    );
  }

  if (showSettings) {
    return (
      <SetupScreen
        initial={configState.settings}
        onSaved={handleSetupSaved}
        onCancel={() => setShowSettings(false)}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Draggable chrome strip. Matches titleBarOverlay height on Windows
          (32px) so the native min/max/close buttons sit flush with this bar
          instead of floating over content. */}
      <div
        className="h-8 shrink-0 bg-neutral-950"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0">
          <RoomList
            rooms={visibleRooms}
            selectedId={view === "av" ? null : selectedRoomId}
            onSelect={(id) => {
              setSelectedRoomId(id);
              setView("rooms");
            }}
            onRoomOff={handleRoomOff}
            onWholeHome={() => setView("av")}
            hasActiveAv={avActivityActive}
            isWholeHomeSelected={view === "av"}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-neutral-800 px-8 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                {view === "av" ? "WHOLE HOME" : selectedRoom?.floorName ?? ""}
              </div>
              <h1 className="mt-1 text-2xl font-semibold">
                {view === "av"
                  ? "Audio"
                  : selectedRoom?.name ?? (loading ? "Loading..." : "Select a room")}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {view === "rooms" && tab === "lights" && lightsInRoom.length > 0 && (
                <div className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
                  <span className="text-accent-400">{onCount}</span>
                  <span className="mx-1 text-neutral-600">/</span>
                  <span>{lightsInRoom.length}</span>
                  <span className="ml-1 text-neutral-500">on</span>
                </div>
              )}
              {view === "rooms" && selectedRoom && (
                <button
                  onClick={() => void handleAllOff()}
                  className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
                >
                  All off
                </button>
              )}
              <UpdateIndicator />
              <button
                onClick={() => setShowSettings(true)}
                title="Settings"
                className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
              >
                Settings
              </button>
            </div>
          </div>

          {view === "rooms" && (
            <nav className="mt-5 flex gap-1">
              {tabs.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={[
                      "relative px-4 py-2 text-sm font-medium transition-colors",
                      active
                        ? "text-white"
                        : "text-neutral-500 hover:text-neutral-200",
                    ].join(" ")}
                  >
                    <span>{t.label}</span>
                    {t.count != null && t.count > 0 && (
                      <span className="ml-1.5 text-xs text-neutral-600">
                        {t.count}
                      </span>
                    )}
                    {active && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-500" />
                    )}
                  </button>
                );
              })}
            </nav>
          )}
        </header>

        {error && (
          <div className="mx-8 mt-4 rounded-md border border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <section className="flex-1 overflow-y-auto">
          {view === "av" ? (
            <AvOverviewPage
              rooms={visibleRooms}
              onRoomClick={(roomId) => {
                setSelectedRoomId(roomId);
                setView("rooms");
                setTab("audio");
              }}
            />
          ) : !selectedRoom ? (
            loading ? (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Connecting to Control4…
              </div>
            ) : null
          ) : tabs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">
              No controllable devices in this room.
            </div>
          ) : (
            <div className="p-8">
              {tab === "lights" && tabs.some((t) => t.id === "lights") ? (
                <LightsGrid lights={lightsInRoom} onSetLevel={handleSetLevel} />
              ) : tab === "audio" && tabs.some((t) => t.id === "audio") ? (
                <AudioPanel
                  roomId={selectedRoom.id}
                  roomName={selectedRoom.name}
                  roomHasMatrixAudio={selectedRoom.hasMatrixAudio}
                  sources={sources}
                />
              ) : tab === "climate" && tabs.some((t) => t.id === "climate") ? (
                <ClimatePanel devices={climateInRoom} />
              ) : tab === "blinds" && tabs.some((t) => t.id === "blinds") ? (
                <BlindsPanel devices={blindsInRoom} />
              ) : tab === "locks" && tabs.some((t) => t.id === "locks") ? (
                <LocksPanel devices={locksInRoom} />
              ) : tab === "security" && tabs.some((t) => t.id === "security") ? (
                <SecurityPanel devices={securityInRoom} />
              ) : null}
            </div>
          )}
        </section>
      </main>
      </div>
    </div>
  );
}
