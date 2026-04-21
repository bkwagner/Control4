import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Room, RoomAvState } from "@/lib/types";

interface Props {
  rooms: Room[];
  onRoomClick?: (roomId: number) => void;
}

const POLL_MS = 3000;

export function AvOverviewPage({ rooms, onRoomClick }: Props) {
  const [states, setStates] = useState<Map<number, RoomAvState>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  // Filter to rooms that can route audio (matrix hardware or IP-volume TVs).
  // Family Room can join matrix audio despite hasMatrixAudio: false because
  // its absolute volume becomes available at runtime. Include all hasAv rooms.
  const avRooms = useMemo(
    () => rooms.filter((r) => r.hasAv),
    [rooms],
  );
  const avRoomIds = useMemo(() => avRooms.map((r) => r.id), [avRooms]);

  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      try {
        const avStates = await api.getAllRoomsAvState(avRoomIds);
        if (cancelled) return;
        const map = new Map<number, RoomAvState>();
        for (const state of avStates) {
          map.set(state.room_id, state);
        }
        setStates(map);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    void refresh();
    timerRef.current = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current !== undefined) window.clearInterval(timerRef.current);
    };
  }, [avRoomIds]);

  // Group rooms by matrix_source_id
  const zones = useMemo(() => {
    const grouped = new Map<string, RoomAvState[]>();
    for (const room of avRooms) {
      const state = states.get(room.id);
      if (!state) continue;
      const key = state.matrix_source_id != null ? String(state.matrix_source_id) : "off";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(state);
    }
    return grouped;
  }, [avRooms, states]);


  // Rooms off the air (matrix_source_id = null)
  const offRooms = useMemo(
    () => zones.get("off") ?? [],
    [zones],
  );

  // Active zones (sorted by matrix_source_id)
  const activeZones = useMemo(
    () => {
      const entries = Array.from(zones.entries()) as [string, RoomAvState[]][];
      return entries
        .filter(([key]) => key !== "off")
        .sort((a, b) => Number(a[0]) - Number(b[0]));
    },
    [zones],
  );

  async function handleAddRoom(
    targetRoomId: number,
    zoneMatrixSourceId: number | null,
    zoneAudioSourceId: number | null,
  ): Promise<void> {
    if (zoneMatrixSourceId == null) {
      setError("Cannot add to inactive zone");
      return;
    }
    setBusy(`add-${targetRoomId}`);
    setError(null);
    try {
      // Route the target room to the same audio source as the zone.
      // zoneAudioSourceId is the real source (Pandora 1359, SiriusXM, etc).
      // zoneMatrixSourceId is the hub (100002) which we log for debugging.
      const sourceToUse = zoneAudioSourceId ?? zoneMatrixSourceId;
      console.log(
        `[AV] Adding room ${targetRoomId} to zone: using source ${sourceToUse} (matrix_hub=${zoneMatrixSourceId}, audio_source=${zoneAudioSourceId})`,
      );
      await api.setRoomAudioSource(targetRoomId, sourceToUse);
      console.log(`[AV] Room added, fetching updated states`);
      // Poll immediately to reflect the change
      const avStates = await api.getAllRoomsAvState(avRoomIds);
      const map = new Map<number, RoomAvState>();
      for (const state of avStates) {
        map.set(state.room_id, state);
      }
      setStates(map);
      console.log(`[AV] States updated, zone should reflect change`);
    } catch (e) {
      console.error(`[AV] Error adding room:`, e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveRoom(roomId: number): Promise<void> {
    setBusy(`remove-${roomId}`);
    setError(null);
    try {
      await api.roomOff(roomId);
      // Poll immediately
      const avStates = await api.getAllRoomsAvState(avRoomIds);
      const map = new Map<number, RoomAvState>();
      for (const state of avStates) {
        map.set(state.room_id, state);
      }
      setStates(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSetVolume(roomId: number, volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    try {
      await api.setRoomVolume(roomId, clamped);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      {error && (
        <div className="rounded-md border border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold">Whole Home Audio</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Manage audio zones across your home
        </p>
      </div>

      {/* Active zones */}
      {activeZones.length > 0 && (
        <div className="space-y-4">
          {activeZones.map(([matrixSourceIdStr, roomsInZone]: [string, RoomAvState[]]) => {
            const matrixSourceId = Number(matrixSourceIdStr);
            const firstRoom = roomsInZone[0];

            return (
              <div
                key={matrixSourceId}
                className="rounded-xl border border-accent-500/40 bg-gradient-to-br from-accent-500/10 to-accent-900/10 p-5"
              >
                {/* Header with source info */}
                <div className="mb-5 flex items-start gap-4">
                  {firstRoom.now_playing?.img_url && (
                    <img
                      src={firstRoom.now_playing.img_url}
                      alt=""
                      className="h-20 w-20 shrink-0 rounded-md border border-neutral-800 object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                      Zone
                    </div>
                    <div className="mt-1 truncate text-lg font-medium">
                      {firstRoom.now_playing?.channel ??
                        firstRoom.now_playing?.title ??
                        "Now playing"}
                    </div>
                    {(firstRoom.now_playing?.artist ?? firstRoom.now_playing?.album) && (
                      <div className="mt-0.5 truncate text-sm text-neutral-400">
                        {[firstRoom.now_playing?.artist, firstRoom.now_playing?.album]
                          .filter(Boolean)
                          .join(" — ")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Rooms in zone */}
                <div className="space-y-3 border-t border-neutral-800 pt-4">
                  {roomsInZone.map((roomState: RoomAvState) => {
                    const roomObj = avRooms.find((r: Room) => r.id === roomState.room_id);
                    const hasVolume = roomState.volume >= 0;

                    return (
                      <div
                        key={roomState.room_id}
                        className="flex items-center gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <button
                            onClick={() => onRoomClick?.(roomState.room_id)}
                            className="text-sm font-medium text-accent-300 hover:text-white transition-colors text-left"
                          >
                            {roomObj?.name ?? `Room ${roomState.room_id}`}
                          </button>
                        </div>

                        {hasVolume && (
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              className="brightness w-32"
                              min={0}
                              max={100}
                              value={roomState.volume}
                              onChange={(e) =>
                                void handleSetVolume(
                                  roomState.room_id,
                                  Number(e.currentTarget.value),
                                )
                              }
                              disabled={busy !== null}
                            />
                            <span className="w-8 text-right text-xs text-neutral-400">
                              {roomState.volume}
                            </span>
                          </div>
                        )}

                        <button
                          onClick={() => void handleRemoveRoom(roomState.room_id)}
                          disabled={busy === `remove-${roomState.room_id}`}
                          className="rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-40"
                        >
                          Turn off
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Add room chips — only show rooms that can join matrix audio */}
                {offRooms.length > 0 && (
                  <div className="mt-4 border-t border-neutral-800 pt-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-600">
                      Add room
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {offRooms
                        .filter((offRoom: RoomAvState) => {
                          const offRoomObj = avRooms.find(
                            (r: Room) => r.id === offRoom.room_id,
                          );
                          // Can only add rooms with matrix audio hardware OR absolute volume
                          return (
                            offRoomObj?.hasMatrixAudio ||
                            offRoom.volume >= 0
                          );
                        })
                        .map((offRoom: RoomAvState) => {
                          const offRoomObj = avRooms.find(
                            (r: Room) => r.id === offRoom.room_id,
                          );
                          return (
                            <button
                              key={offRoom.room_id}
                              onClick={() =>
                                void handleAddRoom(
                                  offRoom.room_id,
                                  matrixSourceId,
                                  firstRoom.audio_source_id,
                                )
                              }
                              disabled={busy === `add-${offRoom.room_id}`}
                              className="rounded-md border border-accent-500/40 bg-accent-500/10 px-3 py-1 text-xs font-medium text-accent-300 transition-colors hover:border-accent-400 hover:bg-accent-500/20 disabled:opacity-40"
                            >
                              + {offRoomObj?.name ?? `Room ${offRoom.room_id}`}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Off section */}
      {offRooms.length > 0 && activeZones.length === 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-600">
            Off
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {offRooms.map((room: RoomAvState) => {
              const roomObj = avRooms.find((r: Room) => r.id === room.room_id);
              return (
                <button
                  key={room.room_id}
                  onClick={() => onRoomClick?.(room.room_id)}
                  className="rounded-md border border-neutral-700 bg-neutral-800/60 px-3 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-800 hover:text-white"
                >
                  {roomObj?.name ?? `Room ${room.room_id}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeZones.length === 0 && offRooms.length === 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 text-center">
          <p className="text-sm text-neutral-500">No matrix audio rooms available</p>
        </div>
      )}
    </div>
  );
}
