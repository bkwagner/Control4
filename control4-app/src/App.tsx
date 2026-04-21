import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Light, Room } from "@/lib/types";
import { RoomList } from "@/components/RoomList";
import { LightsGrid } from "@/components/LightsGrid";

const REFRESH_MS = 5000;

export default function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [lights, setLights] = useState<Light[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick(initial: boolean): Promise<void> {
      try {
        const [roomsData, lightsData] = await Promise.all([
          api.listRooms(),
          api.listLights(),
        ]);
        if (cancelled) return;
        setRooms(roomsData);
        setLights(lightsData);
        setError(null);
        if (initial && roomsData.length > 0 && selectedRoomId === null) {
          setSelectedRoomId(roomsData[0].id);
        }
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
  }, []);

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  const lightsInRoom = useMemo(
    () => lights.filter((l) => l.roomId === selectedRoomId),
    [lights, selectedRoomId],
  );

  const onCount = lightsInRoom.filter(
    (l) => (l.level ?? 0) > 0 || (l.state ?? 0) > 0,
  ).length;

  async function handleSetLevel(itemId: number, level: number): Promise<void> {
    setLights((prev) =>
      prev.map((l) => (l.id === itemId ? { ...l, level, state: level > 0 ? 1 : 0 } : l)),
    );
    try {
      await api.setLightLevel(itemId, level);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRoomOff(roomId: number): Promise<void> {
    try {
      await api.roomOff(roomId);
      setLights((prev) =>
        prev.map((l) =>
          l.roomId === roomId ? { ...l, level: 0, state: 0 } : l,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <aside className="w-64 shrink-0">
        <RoomList
          rooms={rooms}
          selectedId={selectedRoomId}
          onSelect={setSelectedRoomId}
          onRoomOff={handleRoomOff}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 px-8 py-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              {selectedRoom?.floorName ?? ""}
            </div>
            <h1 className="mt-1 text-2xl font-semibold">
              {selectedRoom?.name ?? (loading ? "Loading..." : "Select a room")}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {lightsInRoom.length > 0 && (
              <div className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
                <span className="text-accent-400">{onCount}</span>
                <span className="mx-1 text-neutral-600">/</span>
                <span>{lightsInRoom.length}</span>
                <span className="ml-1 text-neutral-500">on</span>
              </div>
            )}
            {selectedRoom && (
              <button
                onClick={() => void handleRoomOff(selectedRoom.id)}
                className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
              >
                All off
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="mx-8 mt-4 rounded-md border border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <section className="flex-1 overflow-y-auto p-8">
          {selectedRoom ? (
            <LightsGrid lights={lightsInRoom} onSetLevel={handleSetLevel} />
          ) : loading ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">
              Connecting to Control4…
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
