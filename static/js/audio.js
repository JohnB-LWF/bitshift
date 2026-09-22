let ctx;
export let muted = localStorage.getItem('bitshift-muted') === 'true';
export function toggleSound() { muted = !muted; localStorage.setItem('bitshift-muted', muted); return muted; }
export function sound(kind) {
  if (muted) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const frequencies = { key: [700], correct: [880, 1175], wrong: [130], clear: [660, 880, 1320], tick: [440], go: [660, 990] }[kind];
    frequencies.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * .07;
      o.type = kind === 'wrong' ? 'triangle' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(kind === 'key' ? .025 : .065, t);
      g.gain.exponentialRampToValueAtTime(.001, t + (kind === 'key' ? .025 : .16));
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + .18);
    });
  } catch { /* Sound is optional when the browser blocks audio. */ }
}
