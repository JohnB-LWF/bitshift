export function award(streak, remaining = null) {
  const next = streak + 1;
  const multiplier = 2 ** Math.min(7, Math.floor(next / 5));
  const speed = remaining === null ? 0 : Math.round(Math.max(0, remaining) / 60 * 100);
  return { streak: next, multiplier, points: (100 + speed + (next % 5 === 0 ? 250 : 0)) * multiplier };
}
export function generateIP(previous = []) {
  let ip;
  do { ip = Array.from(crypto.getRandomValues(new Uint8Array(4))); } while (ip.join() === previous.join());
  return ip;
}
