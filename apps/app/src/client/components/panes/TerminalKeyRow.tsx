import { Button } from "@/components/ui/button";
import { KEY_DATA, type Modifiers } from "@/lib/terminalKeys";
import { cn } from "@/lib/utils";

const KEYS: { label: string; data: string; aria?: string }[] = [
  { label: "Esc", data: KEY_DATA.esc },
  { label: "Tab", data: KEY_DATA.tab },
  { label: "←", data: KEY_DATA.left, aria: "Left arrow" },
  { label: "↓", data: KEY_DATA.down, aria: "Down arrow" },
  { label: "↑", data: KEY_DATA.up, aria: "Up arrow" },
  { label: "→", data: KEY_DATA.right, aria: "Right arrow" },
  { label: "Home", data: KEY_DATA.home },
  { label: "End", data: KEY_DATA.end },
  { label: "PgUp", data: KEY_DATA.pageUp, aria: "Page up" },
  { label: "PgDn", data: KEY_DATA.pageDown, aria: "Page down" },
  { label: "|", data: "|" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
  { label: "~", data: "~" },
];

interface TerminalKeyRowProps {
  mods: Modifiers;
  onToggle: (mod: keyof Modifiers) => void;
  /** Send key data; modifiers are applied by the caller. */
  onKey: (data: string) => void;
}

/**
 * The keys a phone keyboard lacks, as in the app's key row: sticky Ctrl/Alt
 * (one key), Esc, Tab, arrows, Home/End/PgUp/PgDn and common shell symbols.
 * Buttons keep focus off themselves so the soft keyboard stays up.
 */
export function TerminalKeyRow({ mods, onToggle, onKey }: TerminalKeyRowProps) {
  const keep = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault();
  return (
    <div
      className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1.5"
      role="toolbar"
      aria-label="Terminal keys"
    >
      {(["ctrl", "alt"] as const).map((mod) => (
        <Button
          key={mod}
          type="button"
          size="sm"
          variant={mods[mod] ? "default" : "secondary"}
          className="h-10 min-w-11 shrink-0 font-mono"
          aria-pressed={mods[mod]}
          onPointerDown={keep}
          onMouseDown={keep}
          onClick={() => onToggle(mod)}
        >
          {mod === "ctrl" ? "Ctrl" : "Alt"}
        </Button>
      ))}
      {KEYS.map((key) => (
        <Button
          key={key.label}
          type="button"
          size="sm"
          variant="secondary"
          className={cn("h-10 min-w-11 shrink-0 font-mono")}
          aria-label={key.aria ?? key.label}
          onPointerDown={keep}
          onMouseDown={keep}
          onClick={() => onKey(key.data)}
        >
          {key.label}
        </Button>
      ))}
    </div>
  );
}
