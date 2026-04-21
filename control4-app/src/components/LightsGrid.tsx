import type { Light } from "@/lib/types";
import { LightCard } from "./LightCard";

interface Props {
  lights: Light[];
  onSetLevel: (itemId: number, level: number) => Promise<void>;
}

export function LightsGrid({ lights, onSetLevel }: Props) {
  if (lights.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-neutral-500">
        <div className="text-sm">No lights in this room.</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {lights.map((light) => (
        <LightCard
          key={light.id}
          light={light}
          onChange={(level) => onSetLevel(light.id, level)}
        />
      ))}
    </div>
  );
}
