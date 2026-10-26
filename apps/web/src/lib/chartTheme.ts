let ctx: CanvasRenderingContext2D | null = null;

/** Resolve a CSS custom property (oklch or anything the browser parses) to an rgba() string the chart canvas understands. */
export function cssColor(name: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  ctx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx || !raw) return `rgba(128,128,128,${alpha})`;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#808080";
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 128, g = 128, b = 128, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${(a / 255) * alpha})`;
}
