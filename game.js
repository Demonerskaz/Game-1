'use strict';
/* Brick LCD — "Стройка": монохромная игра с падающими блоками в стиле карманной LCD-консоли. */

const COLS = 10, ROWS = 20;
const C = 24;                       // логический размер клетки
const W = 17.6 * C, H = 21 * C;     // логический размер экрана
const LINES_PER_SPEED = 20;  // линий до следующей скорости (как в китайских Brick Game)
const MAX_SPEED = 10;        // скорость не выше 10, как на табло консоли

const canvas = document.getElementById('lcd');

const led = document.getElementById('led');

/* ---------- Фигуры ---------- */
const SHAPES = [
  [[1, 1, 1, 1]],             // I
  [[1, 1], [1, 1]],           // O
  [[0, 1, 0], [1, 1, 1]],     // T
  [[1, 0, 0], [1, 1, 1]],     // J
  [[0, 0, 1], [1, 1, 1]],     // L
  [[0, 1, 1], [1, 1, 0]],     // S
  [[1, 1, 0], [0, 1, 1]],     // Z
];
const rotate = m => m[0].map((_, i) => m.map(r => r[i]).reverse());

/* ---------- Хранилище ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('brick.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('brick.' + k, JSON.stringify(v)); } catch {} },
};

/* ---------- Звук ---------- */
const Sound = {
  ac: null, on: store.get('sound', true),
  init() { if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (this.ac && this.ac.state === 'suspended') this.ac.resume(); },
  beep(freq, dur = 0.05, when = 0, vol = 0.08) {
    if (!this.on || !this.ac) return;
    const ac = this.ac, t = ac.currentTime + when;
    const piezo = theme().piezo, weak = FX.battery;
    if (weak) { freq *= 0.92 + Math.random() * 0.05; vol *= 0.45; }
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = freq;
    if (weak) o.detune.setValueAtTime(-30 + Math.random() * 60, t);
    g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(0, t + dur);
    let node = o;
    if (piezo) {
      // пьезопищалка: срезаны низы, резонанс около 3 кГц — тонкий «жестяной» писк
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
      const pk = ac.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 3100; pk.Q.value = 3; pk.gain.value = 12;
      node = node.connect(hp).connect(pk);
      g.gain.setValueAtTime(vol * 0.7, t);
    }
    if (weak) {
      // «хрип» севшей батарейки — грубое ограничение формы
      const ws = ac.createWaveShaper(), curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.max(-0.35, Math.min(0.35, x * 3)) + (Math.random() - 0.5) * 0.08; }
      ws.curve = curve; node = node.connect(ws);
    }
    node.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  seq(notes, step = 0.08) { notes.forEach((f, i) => f && this.beep(f, step * 0.9, i * step)); },
  move() { this.beep(1400, 0.015, 0, 0.04); },
  rotate() { this.beep(1800, 0.02, 0, 0.05); },
  land() { this.beep(300, 0.04); },
  clear(n) { this.seq([880, 1175, 1568, 2093].slice(0, n + 1), 0.06); },
  over() { this.seq([784, 659, 523, 392, 330, 262], 0.14); },
  start() { this.seq([523, 659, 784, 1046], 0.07); },
};
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

/* ---------- Состояние ---------- */
const S = {
  mode: 'boot',          // boot | menu | play | pause | clear | over
  board: null, piece: null, next: null,
  score: 0, hi: store.get('hi', 0), lines: 0,
  speed: store.get('speed', 1), level: store.get('level', 0),
  dropAcc: 0, anim: 0, clearRows: [], blink: 0,
  soft: false,
};

const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
const randShape = () => SHAPES[(Math.random() * SHAPES.length) | 0].map(r => r.slice());
const interval = () => Math.max(60, 850 * Math.pow(0.8, S.speed - 1));

function collides(m, x, y) {
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
    if (!m[r][c]) continue;
    const bx = x + c, by = y + r;
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
    if (by >= 0 && S.board[by][bx]) return true;
  }
  return false;
}

function spawn() {
  const m = S.next || randShape();
  S.next = randShape();
  const x = ((COLS - m[0].length) / 2) | 0;
  S.piece = { m, x, y: -m.length + 1 };
  if (collides(m, x, S.piece.y)) gameOver();
}

function newGame() {
  S.board = emptyBoard();
  // Уровень = количество заранее заполненных «мусорных» рядов снизу
  for (let i = 0; i < S.level; i++) {
    const row = S.board[ROWS - 1 - i];
    for (let c = 0; c < COLS; c++) row[c] = Math.random() < 0.5 ? 1 : 0;
    row[(Math.random() * COLS) | 0] = 0;
  }
  S.score = 0; S.lines = 0; S.dropAcc = 0; S.next = null; S.soft = false;
  S.startSpeed = S.speed;
  spawn();
  S.mode = 'play';
  Sound.start();
}

function lock() {
  const { m, x, y } = S.piece;
  let above = false;
  m.forEach((row, r) => row.forEach((v, c) => {
    if (!v) return;
    if (y + r < 0) above = true; else S.board[y + r][x + c] = 1;
  }));
  S.piece = null;
  if (above) return gameOver();
  const full = [];
  S.board.forEach((row, i) => { if (row.every(Boolean)) full.push(i); });
  if (full.length) {
    S.clearRows = full; S.mode = 'clear'; S.anim = 0;
    Sound.clear(full.length); buzz(full.length * 15);
  } else { Sound.land(); spawn(); }
}

function finishClear() {
  const n = S.clearRows.length;
  S.board = S.board.filter((_, i) => !S.clearRows.includes(i));
  while (S.board.length < ROWS) S.board.unshift(Array(COLS).fill(0));
  S.score += [0, 100, 300, 700, 1500][n] * (1 + (S.speed - 1) * 0.1) | 0;
  S.lines += n;
  // Как в Brick Game: +1 к скорости каждые 20 линий, независимо от стартового выбора
  const sp = Math.min(MAX_SPEED, S.startSpeed + Math.floor(S.lines / LINES_PER_SPEED));
  if (sp > S.speed) { S.speed = sp; Sound.seq([1046, 1318], 0.06); }
  if (S.score > S.hi) { S.hi = S.score; store.set('hi', S.hi); }
  S.clearRows = [];
  S.mode = 'play';
  spawn();
}

function gameOver() {
  S.piece = null;
  S.mode = 'over'; S.anim = 0;
  if (S.score > S.hi) { S.hi = S.score; store.set('hi', S.hi); }
  S.speed = S.startSpeed ?? S.speed;
  Sound.over(); buzz([60, 40, 60]);
}

function tryMove(dx, dy) {
  const p = S.piece;
  if (!p || collides(p.m, p.x + dx, p.y + dy)) return false;
  p.x += dx; p.y += dy; return true;
}

function tryRotate() {
  const p = S.piece; if (!p) return;
  const m = rotate(p.m);
  for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
    for (const dy of [0, -1]) {
      if (!collides(m, p.x + dx, p.y + dy)) { p.m = m; p.x += dx; p.y += dy; Sound.rotate(); return; }
    }
  }
}

function stepDown() {
  if (!tryMove(0, 1)) lock();
}

/* ---------- Ввод ---------- */
function press(key) {
  Sound.init();
  if (key === 'sound') { Sound.on = !Sound.on; store.set('sound', Sound.on); Sound.beep(1200, 0.05); return; }
  if (key === 'reset') { S.mode = 'menu'; S.piece = null; S.board = null; return; }

  switch (S.mode) {
    case 'boot': S.mode = 'menu'; break;
    case 'menu':
      if (key === 'start' || key === 'rotate') newGame();
      else if (key === 'right') S.speed = Math.min(10, S.speed + 1);
      else if (key === 'left') S.speed = Math.max(1, S.speed - 1);
      else if (key === 'up') S.level = Math.min(10, S.level + 1);
      else if (key === 'down') S.level = Math.max(0, S.level - 1);
      store.set('speed', S.speed); store.set('level', S.level);
      Sound.move();
      break;
    case 'play':
      if (key === 'start') { S.mode = 'pause'; S.soft = false; break; }
      if (key === 'left') { if (tryMove(-1, 0)) Sound.move(); }
      else if (key === 'right') { if (tryMove(1, 0)) Sound.move(); }
      else if (key === 'rotate' || key === 'up') tryRotate();
      else if (key === 'down') { S.soft = true; stepDown(); S.dropAcc = 0; }
      break;
    case 'pause':
      if (key === 'start' || key === 'rotate') S.mode = 'play';
      break;
    case 'over':
      if (S.anim > 1.2 && (key === 'start' || key === 'rotate')) S.mode = 'menu';
      break;
  }
}
function release(key) { if (key === 'down') S.soft = false; }

// Автоповтор при удержании (как у настоящей консоли)
const REPEAT = { left: [170, 55], right: [170, 55], down: [0, 40] };
const timers = {};
function holdStart(key) {
  if (timers[key]) return;
  press(key);
  const rep = REPEAT[key];
  if (!rep || !(S.mode === 'play' || S.mode === 'menu')) { timers[key] = 'held'; return; }
  const [delay, rate] = rep;
  timers[key] = setTimeout(function loop() {
    if (key === 'down' && S.mode === 'play') { if (S.piece) { stepDown(); S.dropAcc = 0; } }
    else if (S.mode === 'play' || (S.mode === 'menu' && key !== 'down')) press(key);
    timers[key] = setTimeout(loop, rate);
  }, delay || rate);
}
function holdEnd(key) {
  if (timers[key] && timers[key] !== 'held') clearTimeout(timers[key]);
  delete timers[key];
  release(key);
}

document.querySelectorAll('[data-key]').forEach(el => {
  const key = el.dataset.key;
  const down = e => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.classList.add('pressed'); buzz(8); holdStart(key); };
  const up = e => { e.preventDefault(); el.classList.remove('pressed'); holdEnd(key); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
});

const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'up',
  ' ': 'rotate', x: 'rotate', z: 'rotate', Enter: 'start', p: 'start', s: 'sound', r: 'reset',
};
addEventListener('keydown', e => {
  const k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase?.()];
  if (!k) return; e.preventDefault();
  if (e.repeat) return; holdStart(k);
});
addEventListener('keyup', e => { const k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase?.()]; if (k) holdEnd(k); });
document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'play') S.mode = 'pause'; });

/* ---------- Темы экрана ----------
 * Чтобы добавить новую схему — допишите объект в THEMES. Кнопка «ЭКРАН» перебирает их по кругу.
 *  lcd      — цвет стекла/подложки        ink      — цвет «чернил» горящих пикселей
 *  inkAlpha — плотность чернил (1 = сплошные, меньше — сквозь них видна подложка)
 *  ghost    — насколько видны негорящие пиксели и сегменты
 *  shadow   — сила тени пикселей на подложке (0 — без тени)
 *  tauOn/tauOff — инерция пикселя при зажигании/гашении, мс (0 — мгновенно, шлейф от падающих фигур)
 *  grain, glare, vignette — зерно подложки, блик стекла, затемнение к краям (0..1)
 *  piezo    — «жестяной» звук пьезопищалки вместо чистого тона
 *  tilt     — сила эффекта угла обзора при наклоне телефона (0 — нет)
 */
const THEMES = [
  { id: 'clean', name: 'КАК БЫЛО', lcd: '#c3c8b4', ink: '#151a12', inkAlpha: 1, ghost: 0.09,
    shadow: 0, tauOn: 0, tauOff: 0, grain: 0, glare: 0, vignette: 0, piezo: false, tilt: 0 },
  { id: 'stn', name: 'СТАРЫЙ LCD', lcd: '#b4bba0', ink: '#1e2a2b', inkAlpha: 0.95, ghost: 0.045,
    shadow: 0.13, tauOn: 25, tauOff: 55, grain: 0.35, glare: 0.9, vignette: 0.85, piezo: true, tilt: 1 },
  { id: 'olive', name: 'ЖЁЛТО-ЗЕЛЁНЫЙ', lcd: '#a9ae6c', ink: '#262d16', inkAlpha: 0.94, ghost: 0.05,
    shadow: 0.12, tauOn: 28, tauOff: 65, grain: 0.4, glare: 0.8, vignette: 0.9, piezo: true, tilt: 1 },
  { id: 'grey', name: 'ХОЛОДНЫЙ СЕРЫЙ', lcd: '#b3b9b8', ink: '#1b2231', inkAlpha: 0.95, ghost: 0.042,
    shadow: 0.14, tauOn: 22, tauOff: 50, grain: 0.3, glare: 1, vignette: 0.8, piezo: true, tilt: 1 },
];
const FX = {
  theme: Math.max(0, THEMES.findIndex(t => t.id === store.get('theme', 'stn'))),
  contrast: store.get('contrast', 0.5),   // 0..1, колёсико контрастности
  battery: store.get('battery', false),   // режим «садятся батарейки»
};
const theme = () => THEMES[FX.theme];

// Угол обзора: настоящий STN-экран при наклоне то выцветает, то темнеет, а блик и тени смещаются.
// Работает только там, где браузер даёт датчик ориентации (на iPhone — по разрешению, через HTTPS).
const TILT = { on: false, got: false, beta0: null, gamma0: null, tb: 0, tg: 0, b: 0, g: 0 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Отрисовка ---------- */
// Сцена рисуется в два слоя: «призраки» (всё, что может гореть) и «чернила» (что горит сейчас).
// У каждого элемента (клетка, сегмент, надпись) своя яркость, которая тянется к «горит/не горит»
// с инерцией — отсюда шлейф, как у медленной STN-матрицы.
const layer = () => { const c = document.createElement('canvas'); return [c, c.getContext('2d')]; };
const [inkCv, inkCtx] = layer(), [ghostCv, ghostCtx] = layer();
let ctx = inkCtx, PASS = 'ink', SCALE = 1, ghostDirty = true;
const LEVEL = [];            // яркость элементов по порядку отрисовки
let penIdx = 0, kOn = 1, kOff = 1;

function resize() {
  const box = canvas.parentElement.getBoundingClientRect();
  const pad = 12;
  const scale = Math.max(0.1, Math.min((box.width - pad) / W, (box.height - pad) / H));
  const dpr = devicePixelRatio || 1;
  canvas.style.width = W * scale + 'px';
  canvas.style.height = H * scale + 'px';
  const pw = Math.round(W * scale * dpr), ph = Math.round(H * scale * dpr);
  SCALE = scale * dpr;
  for (const cv of [canvas, inkCv, ghostCv]) { cv.width = pw; cv.height = ph; }
  for (const c of [inkCtx, ghostCtx]) c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ghostDirty = true;
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas.parentElement);

// В слое призраков рисуется всё; в слое чернил — только горящее.
function pen(on) {
  if (PASS === 'ghost') { ctx.fillStyle = theme().ink; ctx.globalAlpha = 1; return true; }
  const i = penIdx++, v = LEVEL[i] ?? (on ? 1 : 0), target = on ? 1 : 0;
  const nv = v + (target - v) * (target > v ? kOn : kOff);
  LEVEL[i] = Math.abs(nv - target) < 0.004 ? target : nv;
  if (LEVEL[i] <= 0) return false;
  ctx.fillStyle = theme().ink; ctx.globalAlpha = LEVEL[i];
  return true;
}

// Классический «кирпичный» пиксель: рамка + квадрат внутри
function cell(px, py, on, size = C) {
  if (!pen(on)) return;
  const s = size, b = s * 0.1, g = s * 0.22;
  ctx.fillRect(px + b, py + b, s - 2 * b, b);
  ctx.fillRect(px + b, py + s - 2 * b, s - 2 * b, b);
  ctx.fillRect(px + b, py + 2 * b, b, s - 4 * b);
  ctx.fillRect(px + s - 2 * b, py + 2 * b, b, s - 4 * b);
  ctx.fillRect(px + g + b * 0.4, py + g + b * 0.4, s - 2 * g - b * 0.8, s - 2 * g - b * 0.8);
}

// 7-сегментные цифры
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function digit(x, y, w, h, d) {
  const t = w * 0.2, lit = d == null ? '' : SEG[d];
  const segs = {
    a: [x + t * 0.7, y, w - t * 1.4, t], d: [x + t * 0.7, y + h - t, w - t * 1.4, t],
    g: [x + t * 0.7, y + h / 2 - t / 2, w - t * 1.4, t],
    f: [x, y + t * 0.7, t, h / 2 - t * 1.1], b: [x + w - t, y + t * 0.7, t, h / 2 - t * 1.1],
    e: [x, y + h / 2 + t * 0.4, t, h / 2 - t * 1.1], c: [x + w - t, y + h / 2 + t * 0.4, t, h / 2 - t * 1.1],
  };
  for (const k in segs) if (pen(lit.includes(k))) ctx.fillRect(...segs[k]);
}
function number(x, y, n, len, dw = 0.62 * C, dh = 1.15 * C, gap = 0.24 * C) {
  const s = String(Math.max(0, Math.floor(n))).slice(-len);
  for (let i = 0; i < len; i++) {
    const idx = i - (len - s.length);
    digit(x + i * (dw + gap), y, dw, dh, idx >= 0 ? +s[idx] : null);
  }
}
function label(text, x, y, on = true, size = 0.5) {
  if (!pen(on)) return;
  ctx.font = `700 ${size * C}px ui-monospace,Menlo,Consolas,monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

const GX = 0.5 * C, GY = 0.5 * C;   // начало стакана
const PX = 11.4 * C;                // начало боковой панели

function grid() {
  const g = emptyBoard();
  if (S.board) S.board.forEach((row, r) => row.forEach((v, c) => g[r][c] = v));
  if (S.piece) {
    const { m, x, y } = S.piece;
    m.forEach((row, r) => row.forEach((v, c) => { if (v && y + r >= 0) g[y + r][x + c] = 1; }));
  }
  return g;
}

// Заставка в меню: картинка стройки + мигающая фигура
const MENU_ART = [
  '..........', '..........', '....##....', '...###....', '..........',
  '..........', '..........', '..........', '..........', '..........',
  '..........', '..........', '.........#', '#.......##', '##..#...##',
  '###.##.###', '####.#####', '#####.####', '###.######', '####.#####',
];

function scene(t) {
  if (PASS === 'ink') {
    ctx.globalAlpha = 1; ctx.strokeStyle = theme().ink; ctx.lineWidth = 1.5;
    ctx.strokeRect(GX - 4, GY - 4, COLS * C + 8, ROWS * C + 8);
  }

  let g;
  if (S.mode === 'boot') {
    g = emptyBoard();
    const n = Math.min(400, Math.floor(S.anim * 160));
    const order = spiral();
    const k = n < 200 ? n : 400 - n;
    for (let i = 0; i < k; i++) { const [r, c] = order[i]; g[r][c] = 1; }
  } else if (S.mode === 'menu') {
    g = MENU_ART.map(row => [...row].map(ch => ch === '#' ? 1 : 0));
    if (Math.floor(t / 400) % 2) for (let r = 2; r < 4; r++) for (let c = 0; c < COLS; c++) g[r][c] = 0;
  } else if (S.mode === 'over') {
    g = grid();
    const k = Math.floor(S.anim * 30);
    for (let i = 0; i < Math.min(k, ROWS); i++) g[ROWS - 1 - i].fill(1);
    if (k > ROWS) for (let i = 0; i < Math.min(k - ROWS, ROWS); i++) g[i].fill(0);
  } else {
    g = grid();
    if (S.mode === 'clear' && Math.floor(S.anim / 0.08) % 2 === 0) S.clearRows.forEach(r => g[r].fill(0));
  }

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cell(GX + c * C, GY + r * C, g[r][c]);

  // ---- боковая панель ----
  label('SCORE', PX, 0.5 * C);
  number(PX, 1.15 * C, S.score, 6);
  label('HI-SCORE', PX, 2.8 * C);
  number(PX, 3.45 * C, S.hi, 6);

  label('NEXT', PX, 5.3 * C);
  const ns = 0.95 * C, nx = PX + 0.05 * C, ny = 6 * C;
  const nm = S.mode === 'play' || S.mode === 'clear' || S.mode === 'pause' ? S.next : null;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    let on = 0;
    if (nm) {
      const ox = ((4 - nm[0].length) / 2) | 0, oy = nm.length === 1 ? 1 : 0;
      on = nm[r - oy]?.[c - ox] || 0;
    }
    cell(nx + c * ns, ny + r * ns, on, ns);
  }

  label('SPEED', PX, 8.5 * C);
  number(PX, 9.15 * C, S.speed, 2);
  label('LEVEL', PX + 2.9 * C, 8.5 * C);
  number(PX + 2.9 * C, 9.15 * C, S.level, 2);

  label('LINES', PX, 11 * C);
  number(PX, 11.65 * C, S.mode === 'menu' || S.mode === 'boot' ? 0 : S.lines, 4);

  const paused = S.mode === 'pause' && Math.floor(t / 500) % 2 === 0;
  label('PAUSE', PX, 14 * C, paused, 0.6);
  cup(PX + 3.7 * C, 13.85 * C, paused);
  label('SOUND', PX, 15.4 * C, Sound.on, 0.6);
  note(PX + 3.75 * C, 15.2 * C, Sound.on);

  label('GAME', PX, 17.2 * C, S.mode === 'over', 0.6);
  label('OVER', PX + 2.2 * C, 17.2 * C, S.mode === 'over', 0.6);

  if (PASS === 'ink') {   // подсказки меню — без «призраков», но с тем же затуханием
    const menu = S.mode === 'menu', hint = Math.floor(t / 600) % 2 === 0;
    label('◀▶ SPEED', PX, 18.7 * C, menu, 0.42);
    label('▲▼ LEVEL', PX, 19.3 * C, menu, 0.42);
    label('START', PX, 19.9 * C, menu && hint, 0.42);
  }
}
function cup(x, y, on) {
  if (!pen(on)) return;
  ctx.fillRect(x, y, 0.8 * C, 0.55 * C);
  ctx.fillRect(x + 0.8 * C, y + 0.1 * C, 0.2 * C, 0.3 * C);
  ctx.fillRect(x - 0.1 * C, y + 0.6 * C, 1 * C, 0.1 * C);
}
function note(x, y, on) {
  if (!pen(on)) return;
  ctx.beginPath(); ctx.ellipse(x + 0.25 * C, y + 0.75 * C, 0.25 * C, 0.18 * C, -0.4, 0, 7); ctx.fill();
  ctx.fillRect(x + 0.42 * C, y, 0.08 * C, 0.75 * C);
  ctx.fillRect(x + 0.42 * C, y, 0.4 * C, 0.12 * C);
}
let _spiral;
function spiral() {
  if (_spiral) return _spiral;
  const out = []; let t = 0, b = ROWS - 1, l = 0, r = COLS - 1;
  while (t <= b && l <= r) {
    for (let c = l; c <= r; c++) out.push([b, c]); b--;
    for (let rr = b; rr >= t; rr--) out.push([rr, r]); r--;
    if (t <= b) { for (let c = r; c >= l; c--) out.push([t, c]); t++; }
    if (l <= r) { for (let rr = t; rr <= b; rr++) out.push([rr, l]); l++; }
  }
  return (_spiral = out);
}

// Итоговая яркость с учётом колёсика контрастности и батареек
function levels(t) {
  const th = theme(), c = FX.contrast;
  let ink = th.inkAlpha * (0.4 + 0.6 * Math.min(1, c * 2));
  let ghost = th.ghost * Math.pow(0.3 + 1.4 * c, 2);
  const k = TILT.on ? th.tilt : 0;
  if (k) {
    const v = clamp(TILT.b / 30, -1.5, 1.5);   // вперёд/назад
    const h = Math.min(1, Math.abs(TILT.g) / 40); // вбок
    if (v < 0) { ink *= 1 - 0.55 * k * Math.min(1, -v); ghost *= Math.max(0.1, 1 + 0.8 * v * k); }
    else { ghost *= 1 + 2.4 * v * k; }
    ink *= 1 - 0.25 * k * h;
  }
  if (FX.battery) {
    ink *= 0.5 + 0.04 * Math.sin(t / 900) + 0.03 * Math.sin(t / 137);   // бледно и слегка «гуляет»
    ghost *= 0.45;
  }
  return { ink: Math.min(1, ink), ghost: Math.min(0.6, ghost) };
}

function draw(t, dt) {
  const th = theme();
  if (ghostDirty) {
    ctx = ghostCtx; PASS = 'ghost';
    ghostCtx.save(); ghostCtx.setTransform(1, 0, 0, 1, 0, 0); ghostCtx.clearRect(0, 0, ghostCv.width, ghostCv.height); ghostCtx.restore();
    scene(t);
    ghostDirty = false;
  }
  // Инерция пикселей: гаснут медленнее, чем зажигаются
  kOff = th.tauOff ? 1 - Math.exp(-dt / th.tauOff) : 1;
  kOn = th.tauOn ? 1 - Math.exp(-dt / th.tauOn) : 1;
  ctx = inkCtx; PASS = 'ink'; penIdx = 0;
  inkCtx.save(); inkCtx.setTransform(1, 0, 0, 1, 0, 0); inkCtx.clearRect(0, 0, inkCv.width, inkCv.height); inkCtx.restore();
  scene(t);
  inkCtx.globalAlpha = 1;

  const lv = levels(t);
  const m = canvas.getContext('2d');
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, canvas.width, canvas.height);
  m.globalAlpha = lv.ghost; m.drawImage(ghostCv, 0, 0);
  if (th.shadow) {   // тень пикселей на отражающей подложке: одна, близко и бледно — без ряби
    const o = 0.06 * C * SCALE, k = TILT.on ? th.tilt : 0;
    const ox = Math.round(o * clamp(1 + k * TILT.g / 25, -0.5, 3));
    const oy = Math.round(o * clamp(1 - k * TILT.b / 25, -0.5, 3));
    m.globalAlpha = th.shadow * lv.ink; m.drawImage(inkCv, ox || 1, oy || 1);
  }
  m.globalAlpha = lv.ink; m.drawImage(inkCv, 0, 0);
  m.globalAlpha = 1;
}

/* ---------- Стекло, зерно, кнопки экрана ---------- */
const screenEl = canvas.parentElement;
const captionEl = document.querySelector('.bezel-caption');
(function makeGrain() {   // зерно и неровность отражающей подложки — генерируется один раз
  try {
    const n = 160, cv = document.createElement('canvas'); cv.width = cv.height = n;
    const c = cv.getContext('2d'), img = c.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data.set([v, v, v, Math.random() * 38], i * 4);
    }
    c.putImageData(img, 0, 0);
    for (let i = 0; i < 14; i++) {   // мягкие пятна
      const x = Math.random() * n, y = Math.random() * n, r = 20 + Math.random() * 40;
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      const dark = Math.random() < 0.5;
      gr.addColorStop(0, dark ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr;
      // рисуем пятно со сдвигами на размер плитки — текстура повторяется без швов
      for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) {
        c.save(); c.translate(dx, dy); c.fillRect(-dx, -dy, n, n); c.restore();
      }
    }
    screenEl.style.setProperty('--grain-img', `url(${cv.toDataURL()})`);
  } catch {}
})();

let captionTimer;
function showCaption(text, ms = 1600) {
  captionEl.textContent = text;
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { captionEl.textContent = 'СТРОЙКА'; }, ms);
}
function applyTheme(announce) {
  const th = theme();
  screenEl.style.setProperty('--lcd', th.lcd);
  screenEl.style.setProperty('--grain', th.grain);
  screenEl.style.setProperty('--glare', th.glare);
  screenEl.style.setProperty('--vignette', th.vignette);
  screenEl.classList.toggle('battery', FX.battery);
  document.getElementById('fx-battery').classList.toggle('on', FX.battery);
  document.getElementById('fx-theme-n').textContent = `${FX.theme + 1}/${THEMES.length}`;
  ghostDirty = true;
  if (announce) showCaption(announce);
}
document.getElementById('fx-theme').addEventListener('click', () => {
  FX.theme = (FX.theme + 1) % THEMES.length;
  store.set('theme', theme().id);
  applyTheme(theme().name);
  buzz(8); Sound.init(); Sound.beep(1600, 0.02, 0, 0.04);
});
document.getElementById('fx-battery').addEventListener('click', () => {
  FX.battery = !FX.battery; store.set('battery', FX.battery);
  applyTheme(FX.battery ? 'БАТАРЕЙКИ САДЯТСЯ' : 'НОВЫЕ БАТАРЕЙКИ');
  buzz(8); Sound.init(); Sound.beep(900, 0.04, 0, 0.05);
});
const tiltBtn = document.getElementById('fx-tilt');
function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  if (TILT.beta0 == null) { TILT.beta0 = e.beta; TILT.gamma0 = e.gamma; }   // текущее положение = нейтраль
  TILT.got = true;
  TILT.tb = clamp(e.beta - TILT.beta0, -60, 60);
  TILT.tg = clamp(e.gamma - TILT.gamma0, -60, 60);
}
function setTilt(on, msg) {
  TILT.on = on; TILT.b = TILT.g = TILT.tb = TILT.tg = 0; TILT.beta0 = TILT.gamma0 = null; TILT.got = false;
  if (on) addEventListener('deviceorientation', onOrient); else removeEventListener('deviceorientation', onOrient);
  tiltBtn.classList.toggle('on', on);
  if (msg) showCaption(msg, on ? 1600 : 2600);
}
tiltBtn.addEventListener('click', () => {
  buzz(8); Sound.init(); Sound.beep(1300, 0.02, 0, 0.04);
  if (TILT.on) return setTilt(false, 'НАКЛОН ВЫКЛ');
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return setTilt(false, 'НЕТ ДАТЧИКА');
  const start = () => {
    setTilt(true, 'ДЕРЖИТЕ РОВНО');
    // если за 1,5 с не пришло ни одного показания — датчик здесь заблокирован
    setTimeout(() => { if (TILT.on && !TILT.got) setTilt(false, 'НАКЛОН НЕДОСТУПЕН'); }, 1500);
  };
  if (typeof DOE.requestPermission === 'function') {   // iPhone: спросить разрешение по нажатию
    DOE.requestPermission().then(r => r === 'granted' ? start() : setTilt(false, 'НЕТ РАЗРЕШЕНИЯ'))
      .catch(() => setTilt(false, 'НАКЛОН НЕДОСТУПЕН'));
  } else start();
});

const contrastEl = document.getElementById('fx-contrast');
contrastEl.value = Math.round(FX.contrast * 100);
contrastEl.addEventListener('input', () => {
  FX.contrast = contrastEl.value / 100; store.set('contrast', FX.contrast);
});
for (const el of document.querySelectorAll('.fx button, .fx input')) {
  el.addEventListener('pointerdown', e => e.stopPropagation());
}

/* ---------- Игровой цикл ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(100, now - last); last = now;
  S.anim += dt / 1000;
  if (S.mode === 'boot' && S.anim > 2.6) S.mode = 'menu';
  if (S.mode === 'play' && !S.soft) {
    S.dropAcc += dt;
    if (S.dropAcc >= interval()) { S.dropAcc = 0; stepDown(); }
  }
  if (S.mode === 'clear' && S.anim > 0.48) finishClear();
  led.classList.toggle('on', S.mode !== 'pause');
  led.classList.toggle('weak', FX.battery);
  if (TILT.on) {
    const k = 1 - Math.exp(-dt / 120);
    TILT.b += (TILT.tb - TILT.b) * k; TILT.g += (TILT.tg - TILT.g) * k;
  }
  const gk = TILT.on ? theme().tilt : 0;   // блик «едет» по стеклу при наклоне
  screenEl.style.setProperty('--tx', (gk * clamp(TILT.g, -40, 40) * 1.2).toFixed(1) + 'px');
  screenEl.style.setProperty('--ty', (gk * clamp(-TILT.b, -40, 40) * 1.2).toFixed(1) + 'px');
  draw(now, dt);
  requestAnimationFrame(frame);
}
resize();
applyTheme();
requestAnimationFrame(frame);
