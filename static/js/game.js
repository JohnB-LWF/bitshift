import { $, modal, closeModal, animate, escapeHTML } from './ui.js';
import { award, generateIP } from './scoring.js';
import { sound, muted, toggleSound } from './audio.js';
import { Network } from './network.js';

let mode = 'free', ip = [], score = 0, streak = 0, multiplier = 1, solved = 0, round = 1;
let failures = 0, remaining = 60, active = false, paused = false, busy = false, version = 0, net, players = [], me;
let lastTick = performance.now();
const fields = Array.from({ length: 4 }, (_, i) => {
  const input = document.createElement('input');
  input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = 8; input.placeholder = '00000000';
  input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label', `Binary answer for octet ${i + 1}`);
  input.addEventListener('input', e => {
    input.value = input.value.replace(/[^01]/g, '').slice(0, 8);
    if (/^[01]+$/.test(e.data || '')) sound('key');
    if (input.value.length === 8 && i < 3) fields.slice(i + 1).find(f => !f.readOnly)?.focus();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Backspace' && !input.value && i > 0) fields[i - 1].focus(); });
  $('answers').append(input); return input;
});
$('powers').innerHTML = Array.from({ length: 8 }, (_, i) => `<div><small>2<sup>${7 - i}</sup></small><b>${2 ** (7 - i)}</b></div>`).join('');
function feedback(text) { $('feedback').textContent = text; }
function hud() {
  $('score').textContent = score.toLocaleString(); $('streak').innerHTML = `${streak} <em>in a row</em>`;
  $('multiplier').textContent = `${multiplier}×`;
  if (mode !== 'multi') $('clock').textContent = mode === 'timed' ? `${Math.ceil(remaining)}s` : solved;
  if (mode === 'multi' && net?.session) sessionStorage.setItem('bitshift-stats', JSON.stringify({ room: net.session.room, score, streak, multiplier, solved }));
}
function lock(value) { busy = value; $('submit').disabled = value; fields.forEach(f => f.disabled = value); }
function setIP(next, number = round) {
  version++; ip = next; round = number; failures = 0; $('reveal').hidden = true;
  $('octets').innerHTML = ip.map((n, i) => `<div class="octet drop" style="animation-delay:${i * 45}ms">${n}</div>`).join('');
  fields.forEach(f => { f.value = ''; f.readOnly = false; f.className = ''; });
  $('round-label').textContent = `ADDRESS ${String(round).padStart(2, '0')}`;
  if (mode === 'timed') remaining = 60;
  active = true; lastTick = performance.now(); lock(false); feedback('You’ve got this. One octet at a time.'); hud(); fields[0].focus();
}
function setup(nextMode) {
  version++; mode = nextMode; score = streak = solved = 0; multiplier = 1; round = 1; remaining = 60;
  active = paused = false; lock(true); $('arena').classList.remove('hidden-numbers');
  $('menu').hidden = true; $('game').hidden = false;
  $('mode-label').textContent = { free: 'PRACTICE LAB', timed: 'TIME ATTACK', multi: 'LIVE • FIRST TO FIVE' }[mode];
  $('game-title').textContent = { free: 'Find your flow.', timed: 'Make every bit count.', multi: 'Welcome to the arena.' }[mode];
  $('clock-label').textContent = { free: 'SOLVED', timed: 'TIME LEFT', multi: 'ROUND WINS' }[mode];
  $('clock').textContent = mode === 'multi' ? '0 : 0' : '0'; hud();
}
async function countdown(local = true) {
  const current = version;
  for (const label of ['3', '2', '1', 'GO!']) {
    if (current !== version) return;
    modal(`<div class="countdown">${label}</div>`); sound(label === 'GO!' ? 'go' : 'tick');
    await new Promise(r => setTimeout(r, 800));
  }
  if (current !== version) return;
  closeModal(); if (local) setIP(generateIP(ip));
}
async function result(correct) {
  const current = version;
  if (correct.some(Boolean)) sound('correct');
  if (!correct.every(Boolean)) sound('wrong');
  await Promise.all(fields.map((f, i) => animate(f, correct[i] ? 'chunk--correct' : 'chunk--incorrect')));
  if (version !== current || !active) return;
  if (correct.every(Boolean)) {
    const earned = award(streak, mode === 'timed' ? remaining : null);
    score += earned.points; streak = earned.streak; multiplier = earned.multiplier; solved++; hud();
    feedback(`+${earned.points} points. Beautifully converted!`); sound('clear');
    if (mode !== 'multi') {
      active = false;
      await Promise.all(fields.map(f => animate(f, 'fall')));
      if (version === current) setIP(generateIP(ip), round + 1);
    }
  } else {
    failures++; streak = 0; multiplier = 1; hud();
    fields.forEach((f, i) => { f.readOnly = correct[i]; if (!correct[i]) f.value = ''; });
    $('reveal').hidden = mode === 'multi' || failures < 2;
    feedback('Almost. Your correct octets are saved. Try the others.'); lock(false); fields[correct.indexOf(false)].focus();
  }
}
$('answer-form').addEventListener('submit', async e => {
  e.preventDefault(); if (!active || busy || paused) return;
  if (fields.some(f => f.value.length !== 8)) { feedback('Fill all four octets with exactly 8 binary digits.'); fields.find(f => f.value.length !== 8)?.focus(); return; }
  lock(true);
  if (mode === 'multi') net.send({ type: 'submit_answer', round, octets: fields.map(f => f.value) });
  else await result(ip.map((n, i) => n.toString(2).padStart(8, '0') === fields[i].value));
});
$('reveal').onclick = () => {
  if (mode === 'multi' || busy || !active) return;
  streak = 0; multiplier = 1;
  const answer = ip.map(n => n.toString(2).padStart(8, '0')).join(' . ');
  setIP(generateIP(ip), round + 1); feedback(`Previous answer: ${answer} · skipped for 0 points.`);
};
function menu() { version++; active = false; net?.stop(); net = null; sessionStorage.removeItem('bitshift-stats'); closeModal(); $('menu').hidden = false; $('game').hidden = true; }
function resume() { paused = false; $('arena').classList.remove('hidden-numbers'); closeModal(); fields.find(f => !f.readOnly)?.focus(); }
function pause() {
  if (!active) return;
  if (mode === 'multi') {
    modal('<h2>Leave the match?</h2><p>The race continues while this is open. Leaving awards your opponent a win by forfeit.</p><button class="primary" id="resume">Keep playing</button><button class="text-button" id="leave">Forfeit & leave</button>');
    $('resume').onclick = closeModal; $('leave').onclick = menu;
  } else {
    paused = true; $('arena').classList.add('hidden-numbers');
    modal('<h2>Take a breather.</h2><p>Your progress is saved. The clock is paused.</p><button class="primary" id="resume">Back to the bits</button><button class="text-button" id="leave">Main menu</button>');
    $('resume').onclick = resume; $('leave').onclick = menu;
  }
}
$('pause').onclick = pause; $('quit').onclick = () => mode === 'multi' && active ? pause() : menu();
$('dialog').addEventListener('cancel', e => { e.preventDefault(); if (paused) resume(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode !== 'multi' && active && !paused) pause(); });
function end(title, description) {
  version++; active = false; lock(true);
  modal(`<div class="eyebrow">SESSION COMPLETE</div><h2 style="margin-top:14px">${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p><p><strong>${score.toLocaleString()}</strong> points · ${solved} addresses solved</p><button class="primary" id="again">Play again</button><button class="text-button" id="home">Main menu</button>`);
  $('home').onclick = menu; $('again').onclick = () => { const previous = mode; menu(); launch(previous); };
}
setInterval(() => {
  const now = performance.now(), elapsed = (now - lastTick) / 1000; lastTick = now;
  if (active && !paused && mode === 'timed') { remaining = Math.max(0, remaining - elapsed); hud(); if (remaining <= 0) end('Time’s up.', 'Every attempt makes you faster. Ready for another run?'); }
}, 80);
function wins(data) { if (data.wins) $('clock').textContent = `${data.wins[me] || 0} : ${Object.entries(data.wins).find(([id]) => id !== me)?.[1] || 0}`; }
function onMessage(data, session) {
  me = session?.player_id || me;
  if (data.type === 'state') {
    players = data.players; wins(data);
    const opponent = players.find(p => p.id !== me)?.name || 'opponent';
    $('game-title').textContent = `You vs. ${opponent}`;
    if (data.status === 'playing') { closeModal(); if (round !== data.round || ip.join() !== data.ip.join() || !active) setIP(data.ip, data.round); else lock(false); }
    else if (data.status === 'countdown') { modal('<h2>Get ready…</h2><p>The match is about to begin.</p>'); }
  } else if (data.type === 'countdown_start') { countdown(false); }
  else if (data.type === 'submission_result') { if (data.round === round) result(data.correct); }
  else if (data.type === 'rate_limited') { lock(false); feedback('Take a beat, then try again.'); }
  else if (data.type === 'round_won') {
    wins(data); lock(true); feedback(data.winner === me ? 'Round won! Next address incoming…' : 'Your opponent got there first. Next round, fresh start.');
    const current = version;
    setTimeout(() => { if (version === current && active) fields.forEach(f => animate(f, 'fall')); }, 420);
  }
  else if (data.type === 'match_over') {
    wins(data); net?.ws?.close();
    // Let the final answer feedback settle before showing the match summary.
    const current = version;
    setTimeout(() => { if (version === current) end(data.winner === me ? 'You won the match!' : data.winner ? 'A worthy opponent.' : 'Match ended.', `${data.reason}. Final rounds: ${$('clock').textContent} (you : opponent).`); }, 450);
  } else if (data.type === 'opponent_disconnected') feedback('Opponent disconnected. They have 10 seconds to reconnect.');
  else if (data.type === 'opponent_reconnected') feedback('Connected. Let’s make every bit count.');
  else if (data.type === 'expired') end('Match unavailable.', 'The match ended or your session was replaced. Join a new race.');
}
function connectStatus(message) { feedback(message); if ($('queue-status')) $('queue-status').textContent = message; }
function waiting(name) {
  setup('multi'); ip = []; modal('<div class="eyebrow">MATCHMAKING</div><h2 style="margin-top:16px">Finding your rival…</h2><p id="queue-status">Open this game on another device or browser tab and join Multiplayer to race.</p><button id="cancel-queue" class="text-button">Cancel & return</button>');
  $('cancel-queue').onclick = menu; net = new Network(onMessage, connectStatus); net.queue(name);
}
function launch(nextMode) {
  sound('key');
  if (nextMode === 'multi') {
    modal('<div class="eyebrow">ENTER THE ARENA</div><h2 style="margin-top:16px">Make a name for yourself.</h2><p>Two players. The same IPv4 address. First to five round wins takes the match.</p><form id="name-form"><label for="player-name">Your player name</label><input id="player-name" maxlength="20" required placeholder="PacketPilot" autocomplete="nickname"><button class="primary">Find opponent ↗</button><button type="button" id="cancel-name" class="text-button">Back</button></form>');
    $('player-name').value = localStorage.getItem('bitshift-name') || ''; $('player-name').focus();
    $('cancel-name').onclick = closeModal;
    $('name-form').onsubmit = e => { e.preventDefault(); const name = $('player-name').value.trim() || 'Player'; localStorage.setItem('bitshift-name', name); waiting(name); };
  } else { setup(nextMode); countdown(); }
}
document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => launch(button.dataset.mode));
$('sound').textContent = muted ? 'Sound off' : 'Sound on';
$('sound').onclick = () => { $('sound').textContent = toggleSound() ? 'Sound off' : 'Sound on'; sound('key'); };
$('learn').onclick = () => {
  modal('<div class="eyebrow">A QUICK FIELD GUIDE</div><h2 style="margin-top:15px">Think in powers of two.</h2><p>Each IPv4 address has four decimal octets, from 0 to 255. Convert each into eight binary digits.</p><p><strong>128 · 64 · 32 · 16 · 8 · 4 · 2 · 1</strong></p><p>For 192, use 128 + 64. Turn those bits on:<br><strong style="color:#63a5ff;font:22px monospace">11000000</strong></p><p>Keep leading zeros: 1 is <strong>00000001</strong>. Press Tab to move and Enter to check. Correct octets stay saved when you retry.</p><p>Every five consecutive solves doubles your multiplier (up to 128×) and adds a 250-point bonus. A wrong submission resets your streak. Time attack gives you a fresh 60 seconds for each address.</p><button id="got-it" class="primary">Let’s do this</button>'); $('got-it').onclick = closeModal;
};
try {
  const saved = JSON.parse(sessionStorage.getItem('bitshift-session'));
  if (saved) {
    setup('multi');
    const stats = JSON.parse(sessionStorage.getItem('bitshift-stats'));
    if (stats?.room === saved.room) { score = stats.score; streak = stats.streak; multiplier = stats.multiplier; solved = stats.solved; hud(); }
    modal('<h2>Rejoining your match…</h2><p id="queue-status">Restoring your connection.</p><button id="cancel-queue" class="text-button">Return to menu</button>'); $('cancel-queue').onclick = menu; net = new Network(onMessage, connectStatus); net.session = saved; net.connect();
  }
} catch { sessionStorage.removeItem('bitshift-session'); }
