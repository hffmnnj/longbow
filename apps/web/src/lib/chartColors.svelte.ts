import { mode } from "mode-watcher";
import { tick } from "svelte";
import { setPaletteTint } from "./dither-kit/engine/palette";

let ctx: CanvasRenderingContext2D | null = null;

/** A CSS custom property (oklch or anything the browser parses) as #rrggbb, which is what the dither canvases read. */
export function cssHex(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  ctx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx || !raw) return "#808080";
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#808080";
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 128, g = 128, b = 128] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface ChartColors {
  primary: string;
  gain: string;
  loss: string;
  warn: string;
  lab: string;
  muted: string;
}

function read(): ChartColors {
  setPaletteTint(mode.current === "light");
  return {
    primary: cssHex("--primary"),
    gain: cssHex("--gain"),
    loss: cssHex("--loss"),
    warn: cssHex("--warn"),
    lab: cssHex("--lab"),
    muted: cssHex("--muted-foreground"),
  };
}

/**
 * Theme colours for the dither charts, as hex. Re-reads after the theme class has landed on <html>.
 * Call from a component's script; the returned getter is reactive.
 */
export function useChartColors(): { readonly c: ChartColors } {
  let colors = $state<ChartColors>(read());
  $effect(() => {
    void mode.current;
    let live = true;
    void tick().then(() => {
      if (live) colors = read();
    });
    return () => (live = false);
  });
  return {
    get c() {
      return colors;
    },
  };
}
