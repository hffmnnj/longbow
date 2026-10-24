/** True at the md breakpoint (768px) and wider. Client-only; the app is a non-SSR SPA. */
export const viewport = $state({ desktop: true });

/** `ok` is false when the user asks for reduced motion; chart entrance animations read it. */
export const motion = $state({ ok: true });

export function watchViewport(): () => void {
  const mq = window.matchMedia("(min-width: 768px)");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const update = () => {
    viewport.desktop = mq.matches;
    motion.ok = !reduce.matches;
  };
  update();
  mq.addEventListener("change", update);
  reduce.addEventListener("change", update);
  return () => {
    mq.removeEventListener("change", update);
    reduce.removeEventListener("change", update);
  };
}
