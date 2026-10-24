/** True at the md breakpoint (768px) and wider. Client-only; the app is a non-SSR SPA. */
export const viewport = $state({ desktop: true });

export function watchViewport(): () => void {
  const mq = window.matchMedia("(min-width: 768px)");
  const update = () => (viewport.desktop = mq.matches);
  update();
  mq.addEventListener("change", update);
  return () => mq.removeEventListener("change", update);
}
