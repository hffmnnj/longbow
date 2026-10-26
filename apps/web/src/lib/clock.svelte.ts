/** One shared 1 Hz clock for countdowns; start it once from the page shell. */
export const clock = $state({ now: Date.now() });

export function startClock(): () => void {
  clock.now = Date.now();
  const id = setInterval(() => (clock.now = Date.now()), 1000);
  return () => clearInterval(id);
}
