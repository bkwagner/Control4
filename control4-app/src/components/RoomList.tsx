import type { Room } from "@/lib/types";

interface Props {
  rooms: Room[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onRoomOff: (id: number) => void;
  onWholeHome: () => void;
  hasActiveAv: boolean;
  isWholeHomeSelected: boolean;
}

export function RoomList({ rooms, selectedId, onSelect, onRoomOff, onWholeHome, hasActiveAv, isWholeHomeSelected }: Props) {
  const byFloor = new Map<string, Room[]>();
  for (const r of rooms) {
    const key = r.floorName ?? "Other";
    if (!byFloor.has(key)) byFloor.set(key, []);
    byFloor.get(key)!.push(r);
  }

  return (
    <nav className="flex h-full flex-col overflow-y-auto border-r border-neutral-800 bg-neutral-950/60 backdrop-blur">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-800 bg-neutral-950/80 px-5 py-4 backdrop-blur">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Rooms
        </h2>
        <span className="text-xs text-neutral-600">{rooms.length}</span>
      </div>
      <div className="flex flex-col gap-6 px-3 py-4">
        <button
          onClick={onWholeHome}
          className={[
            "group flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
            isWholeHomeSelected
              ? "bg-accent-500/15 text-white ring-1 ring-accent-500/40"
              : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100",
          ].join(" ")}
          title="Whole Home Audio"
        >
          <span className="truncate">Whole Home</span>
          <span
            className={[
              "ml-2 text-lg transition-colors",
              hasActiveAv ? "text-accent-400" : "text-neutral-700",
            ].join(" ")}
          >
            ♪
          </span>
        </button>
        {[...byFloor.entries()].map(([floor, roomsOnFloor]) => (
          <div key={floor}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-600">
              {floor}
            </div>
            <ul className="flex flex-col gap-0.5">
              {roomsOnFloor.map((room) => {
                const active = room.id === selectedId;
                return (
                  <li key={room.id}>
                    <button
                      onClick={() => onSelect(room.id)}
                      onDoubleClick={() => onRoomOff(room.id)}
                      className={[
                        "group flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-accent-500/15 text-white ring-1 ring-accent-500/40"
                          : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100",
                      ].join(" ")}
                      title="Double-click to turn room off"
                    >
                      <span className="truncate">{room.name}</span>
                      <span
                        className={[
                          "ml-2 h-1.5 w-1.5 rounded-full transition-colors",
                          active ? "bg-accent-400" : "bg-transparent",
                        ].join(" ")}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
