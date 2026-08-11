import { presetIds, presetPresentationV1, type PresetId } from "@studymix/contracts";
import type { ReactNode } from "react";

export const presetPresentation = presetPresentationV1;

export const presetOptions = presetIds.map((id) => ({ id, ...presetPresentation[id] }));

export function PresetIcon({ presetId }: { presetId: PresetId }) {
  switch (presetId) {
    case "soft-piano":
      return (
        <IconBase>
          <path d="M5 10c1-4 4-6 9-6h3v8H5v-2Z" />
          <path d="M5 12h14v4H5zM7 16v4M17 16v4M9 12v4M12 12v4M15 12v4" />
        </IconBase>
      );
    case "music-box":
      return (
        <IconBase>
          <path d="M5 9h14v10H5zM8 6h8l2 3H6l2-3Z" />
          <path d="M9 13h6M12 13v4M16 4c2-2 3-1 3 1v2" />
        </IconBase>
      );
    case "lofi-study":
      return (
        <IconBase>
          <path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h3v7H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 1-2ZM20 13h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2Z" />
        </IconBase>
      );
    case "acoustic-ease":
      return (
        <IconBase>
          <path d="M9.2 11.7c-1.8-1.1-4.1-.7-5.2 1-1.3 2-.5 4.8 1.7 5.9 2.1 1.1 4.7.1 5.6-2l.7-1.5 3.9-3.9-3.1-3.1-3.6 3.6Z" />
          <circle cx="7.2" cy="15.1" r="1.4" />
          <path d="m14 7 4.9-4.9 3 3L17 10M17.3 3.7l2.9 2.9" />
          <path d="M14.4 16.2H21v4.3h-6.6zM16.1 16.2v4.3M18.3 16.2v4.3" />
        </IconBase>
      );
    case "slowwave":
      return (
        <IconBase>
          <path d="M2.5 12h2.2l1.5-4.5 2.3 9 2.2-13 2.5 17 2.2-12.5 1.8 8 1.5-4H22" />
        </IconBase>
      );
    case "kissa-jazzhop":
      return (
        <IconBase>
          <path d="M4 10h12v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4Z" />
          <path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M5 20h13M7 7c-1-1-.8-2 .2-3M11 7c-1-1-.8-2 .2-3" />
          <path d="M17 8V4.5L21 3v3.5" />
          <circle cx="15.7" cy="8.2" r="1.3" />
          <circle cx="19.7" cy="6.7" r="1.3" />
        </IconBase>
      );
  }
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {children}
    </svg>
  );
}
