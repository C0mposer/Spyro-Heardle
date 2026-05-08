/* ============================================================
   SPYRO HEARDLE — game.js
   Core game logic, audio, autocomplete, sharing
   ============================================================ */

// ── Constants ──────────────────────────────────────────────
const CONFIG_URL  = 'config.json';
const STORAGE_KEY = 'spyro-heardle-state';

// Emoji scheme
const EMOJI = {
  prefix:  '🔈',
  skip:    '⬛',
  wrong:   '🟥',
  correct: '🟩',
  dragon:  '🐉',   // correct on first guess, no skips
};

// ── State ──────────────────────────────────────────────────
let config       = null;
let puzzle       = null;
let dayNumber    = null;
let currentStem  = 0;
let attempts     = [];
let gameOver     = false;
let audio        = new Audio();
let waveformBars = [];

// ── Speedrun timer ──
let timerStart    = null;   // timestamp of first play press
let timerEnd      = null;   // timestamp of game end
let timerInterval = null;   // live tick interval
let timerFinalMs  = null;   // saved final elapsed ms

// ── Utility ────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showToast(msg, duration = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), duration);
}

function formatDate(dateStr) {
  // dateStr: 'YYYY-MM-DD'
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ── Gem particles ──────────────────────────────────────────

// Scans the particles/ folder by attempting to load images named
// spyro1.png, spyro2.png … up to a reasonable max, collecting
// whichever ones actually exist, then uses that pool when spawning.
let spyroParticleImages = null;

async function loadSpyroParticleImages() {
  const found = [];
  // Try up to 20 candidate images: particles/spyro1.png … spyro20.png
  const checks = Array.from({ length: 20 }, (_, i) => {
    return new Promise(resolve => {
      const img = new Image();
      const src = `particles/spyro${i + 1}.png`;
      img.onload  = () => resolve(src);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  });
  const results = await Promise.all(checks);
  results.forEach(src => { if (src) found.push(src); });
  return found;
}

async function spawnParticles() {
  const container = $('gemParticles');
  if (!container) return;

  // Load available Spyro images (once)
  if (spyroParticleImages === null) {
    spyroParticleImages = await loadSpyroParticleImages();
  }

  const colors = [
    'var(--purple-glow)', 'var(--gold-bright)',
    'var(--fire-bright)', 'var(--purple-light)',
  ];

  const SPYRO_CHANCE = 0.005; // 0.5% per particle

  for (let i = 0; i < 22; i++) {
    const isSpyro = spyroParticleImages.length > 0 && Math.random() < SPYRO_CHANCE;

    if (isSpyro) {
      const src = spyroParticleImages[Math.floor(Math.random() * spyroParticleImages.length)];
      const el = document.createElement('img');
      el.className = 'gem-particle spyro-particle';
      el.src = src;
      el.alt = '';
      el.draggable = false;
      const size = 18 + Math.random() * 14; // a little bigger than gems so it's visible
      el.style.cssText = `
        left: ${Math.random() * 100}%;
        width: ${size}px;
        height: ${size}px;
        animation-duration: ${16 + Math.random() * 20}s;
        animation-delay: ${Math.random() * 15}s;
      `;
      container.appendChild(el);
    } else {
      const el = document.createElement('div');
      el.className = 'gem-particle';
      const size = 3 + Math.random() * 5;
      el.style.cssText = `
        left: ${Math.random() * 100}%;
        width: ${size}px;
        height: ${size}px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        animation-duration: ${12 + Math.random() * 20}s;
        animation-delay: ${Math.random() * 15}s;
      `;
      container.appendChild(el);
    }
  }
}

// ── Speedrun timer ─────────────────────────────────────────

// ── Speedrun timer ─────────────────────────────────────────
// timerStart is kept in sessionStorage so a hard refresh resets it.
// timerFinalMs is kept in localStorage (via saveState) for the result display.

function timerTick() {
  const el = $('speedrunTimer');
  if (!el) return;
  const start = getTimerStart();
  if (start === null) return;
  el.textContent = formatElapsed(Date.now() - start);
}

function getTimerStart() {
  const v = sessionStorage.getItem('spyro-heardle-timer-start');
  return v ? parseInt(v, 10) : null;
}

function startTimer() {
  if (getTimerStart() !== null) return; // already running
  const now = Date.now();
  sessionStorage.setItem('spyro-heardle-timer-start', String(now));
  timerStart = now;
  const el = $('speedrunTimer');
  if (el) el.classList.remove('hidden');
  timerInterval = setInterval(timerTick, 100);
}

function stopTimer() {
  const start = getTimerStart();
  if (start === null) return;
  timerFinalMs = Date.now() - start;
  timerStart = start;
  sessionStorage.removeItem('spyro-heardle-timer-start');
  clearInterval(timerInterval);
  timerInterval = null;
  // Freeze display
  const el = $('speedrunTimer');
  if (el) {
    el.textContent = formatElapsed(timerFinalMs);
    el.style.animation = 'none'; // stop pulsing when frozen
  }
}

function formatElapsed(ms) {
  if (ms === null || isNaN(ms)) return '0.0s';
  const totalSecs = ms / 1000;
  if (totalSecs < 60) {
    return totalSecs.toFixed(1) + 's';
  }
  const m = Math.floor(totalSecs / 60);
  const s = (totalSecs % 60).toFixed(1).padStart(4, '0');
  return `${m}m ${s}s`;
}

function formatElapsedForShare(ms) {
  if (!ms) return null;
  const totalSecs = ms / 1000;
  if (totalSecs < 60) return totalSecs.toFixed(1) + 's';
  const m = Math.floor(totalSecs / 60);
  const s = (totalSecs % 60).toFixed(1).padStart(4, '0');
  return `${m}m ${s}s`;
}

// ── PST date helpers ───────────────────────────────────────

/**
 * Returns current date string in PST as 'YYYY-MM-DD'.
 * Uses Intl API to get the time in America/Los_Angeles.
 */
function getTodayPST() {
  const now = new Date();
  const pst = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return pst; // 'YYYY-MM-DD'
}

/**
 * Given the config start date and a puzzle day number,
 * return the calendar date string ('YYYY-MM-DD') for that puzzle.
 */
function dateForDay(startDateStr, dayNum) {
  const [y, m, d] = startDateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  start.setDate(start.getDate() + (dayNum - 1));
  const yy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, '0');
  const dd = String(start.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Given config, return the day number for today (PST).
 * Returns null if today is before startDate.
 */
function getDayNumberForToday(cfg) {
  const today = getTodayPST();
  const [sy, sm, sd] = cfg.startDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const todayD = new Date(ty, tm - 1, td);
  const diff = Math.floor((todayD - start) / 86400000);
  return diff + 1; // day 1-based
}

/**
 * Given config and a day number, return the puzzle (or null).
 */
function getPuzzleForDay(cfg, day) {
  return cfg.puzzles.find(p => p.day === day) || null;
}

// ── Waveform ────────────────────────────────────────────────

function buildWaveform(barCount = 60) {
  const container = $('waveformBars');
  if (!container) return;
  container.innerHTML = '';
  waveformBars = [];
  for (let i = 0; i < barCount; i++) {
    const bar = document.createElement('div');
    bar.className = 'waveform-bar';
    // Random height for visual interest
    const h = 15 + Math.random() * 70;
    bar.style.height = h + '%';
    container.appendChild(bar);
    waveformBars.push(bar);
  }
}

function updateWaveform(progress) {
  // progress: 0.0 – 1.0
  const playedIdx = Math.floor(progress * waveformBars.length);
  waveformBars.forEach((bar, i) => {
    bar.classList.remove('played', 'active-bar');
    if (i < playedIdx)       bar.classList.add('played');
    else if (i === playedIdx) bar.classList.add('active-bar');
  });
}

// ── Audio ──────────────────────────────────────────────────

function loadStem(stemIdx) {
  const stem = puzzle.stems[stemIdx];
  const src = `${puzzle.audioFolder}/${stem.file}`;
  audio.src = src;
  audio.load();
  updatePlayButton(false);
  $('timeDisplay').textContent = '0:00';
  $('progressFill').style.width = '0%';
  updateWaveform(0);
  updateStemBar();
}

function playAudio() {
  audio.play().catch(() => {});
  updatePlayButton(true);
}

function pauseAudio() {
  audio.pause();
  updatePlayButton(false);
}

function updatePlayButton(playing) {
  const btn = $('btnPlay');
  if (!btn) return;
  btn.classList.toggle('playing', playing);
}

function formatTime(secs) {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function bindAudioEvents() {
  audio.volume = 1;

  audio.addEventListener('timeupdate', () => {
    const pct = audio.duration ? audio.currentTime / audio.duration : 0;
    $('progressFill').style.width = (pct * 100) + '%';
    $('timeDisplay').textContent = formatTime(audio.currentTime);
    updateWaveform(pct);
    // Keep seek slider in sync while playing
    const seek = $('seekSlider');
    if (seek && !seek.classList.contains('hidden') && !seek._seeking) {
      seek.value = Math.round(pct * 1000);
    }
  });

  audio.addEventListener('ended', () => {
    updatePlayButton(false);
    updateWaveform(0);
    $('progressFill').style.width = '0%';
    $('timeDisplay').textContent = '0:00';
    const seek = $('seekSlider');
    if (seek) seek.value = 0;
  });

  audio.addEventListener('play',  () => updatePlayButton(true));
  audio.addEventListener('pause', () => updatePlayButton(false));

  const slider = $('volumeSlider');
  if (slider) {
    slider.addEventListener('input', () => {
      audio.volume = parseFloat(slider.value);
      updateVolumeTrack(slider);
    });
    updateVolumeTrack(slider);
  }
}

function enableSeeking() {
  const seek = $('seekSlider');
  const track = document.querySelector('.progress-track');
  if (!seek || !track) return;

  seek.classList.remove('hidden');
  track.classList.add('seekable');

  // While dragging — pause updates from timeupdate and scrub visually
  seek.addEventListener('mousedown',  () => { seek._seeking = true; });
  seek.addEventListener('touchstart', () => { seek._seeking = true; }, { passive: true });

  seek.addEventListener('input', () => {
    const pct = parseInt(seek.value) / 1000;
    $('progressFill').style.width = (pct * 100) + '%';
    updateWaveform(pct);
    if (audio.duration) {
      $('timeDisplay').textContent = formatTime(audio.duration * pct);
    }
  });

  seek.addEventListener('change', () => {
    const pct = parseInt(seek.value) / 1000;
    if (audio.duration) {
      audio.currentTime = audio.duration * pct;
    }
    seek._seeking = false;
  });

  seek.addEventListener('mouseup',  () => { seek._seeking = false; });
  seek.addEventListener('touchend', () => { seek._seeking = false; });
}

function updateVolumeTrack(slider) {
  // Fill the track up to the thumb position with a purple gradient
  const pct = parseFloat(slider.value) * 100;
  slider.style.background = `linear-gradient(to right, var(--purple-bright) 0%, var(--purple-glow) ${pct}%, var(--surface-2) ${pct}%)`;
}

// ── Stems bar ──────────────────────────────────────────────

function buildStemBar() {
  const bar = $('stemsBar');
  if (!bar) return;
  bar.innerHTML = '';
  puzzle.stems.forEach((stem, i) => {
    const chip = document.createElement('div');
    chip.className = 'stem-chip';
    chip.textContent = stem.label;
    chip.id = `stem-chip-${i}`;
    bar.appendChild(chip);
  });
  updateStemBar();
}

function updateStemBar() {
  puzzle.stems.forEach((_, i) => {
    const chip = $(`stem-chip-${i}`);
    if (!chip) return;
    chip.classList.remove('active', 'current');
    if (i < currentStem)    chip.classList.add('active');
    else if (i === currentStem) chip.classList.add('current');
  });
}

// ── Autocomplete ────────────────────────────────────────────

function scoreMatch(query, candidate) {
  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase();
  if (!q) return 0;

  // Split "Game Title - Song Name" into two parts
  const dashIdx = candidate.indexOf(' - ');
  const gamePart = dashIdx >= 0 ? c.slice(0, dashIdx).toLowerCase() : '';
  const songPart = dashIdx >= 0 ? c.slice(dashIdx + 3).toLowerCase() : c;

  // Score a single string against the query (returns 0–1)
  function scorePart(part) {
    if (part === q)           return 1.0;
    if (part.startsWith(q))  return 0.95;
    if (part.includes(' ' + q)) return 0.9;  // word boundary match
    if (part.includes(q))    return 0.75;
    // Subsequence: check if all query chars appear in order
    let qi = 0;
    let consecutive = 0, lastMatch = -1;
    for (let ci = 0; ci < part.length && qi < q.length; ci++) {
      if (part[ci] === q[qi]) {
        // Bonus for consecutive chars and word-start matches
        if (ci === lastMatch + 1) consecutive++;
        qi++;
        lastMatch = ci;
      }
    }
    if (qi < q.length) return 0; // not all chars found
    // Score based on how tight the match is
    return 0.1 + (consecutive / q.length) * 0.4 + (q.length / part.length) * 0.2;
  }

  const songScore = scorePart(songPart);
  const gameScore = scorePart(gamePart);

  // Song title match is weighted 3x over game title match.
  // A double match (both game + song contain the query) gets a strong bonus.
  const doubleMatchBonus = (songScore > 0 && gameScore > 0) ? 0.25 : 0;
  const raw = (songScore * 0.65) + (gameScore * 0.2) + doubleMatchBonus;

  return raw > 0 ? raw * 100 : 0;
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);

  const dashIdx = text.indexOf(' - ');
  if (dashIdx < 0) {
    // No separator — just highlight the whole string as one part
    return highlightPart(text, query);
  }

  const gamePart = text.slice(0, dashIdx);
  const sep      = ' - ';
  const songPart = text.slice(dashIdx + 3);

  return highlightPart(gamePart, query) + escapeHtml(sep) + highlightPart(songPart, query);
}

// Highlight all subsequence-matched characters within a single string segment
function highlightPart(text, query) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Find subsequence match positions
  const matchPositions = new Set();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { matchPositions.add(i); qi++; }
  }
  // Only highlight if all query chars were found
  if (qi < q.length) return escapeHtml(text);
  return text.split('').map((ch, i) =>
    matchPositions.has(i)
      ? `<span class="match-highlight">${escapeHtml(ch)}</span>`
      : escapeHtml(ch)
  ).join('');
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let highlightedIdx = -1;

function showAutocomplete(query) {
  const list = $('autocompleteList');
  if (!query.trim()) { list.classList.add('hidden'); return; }

  const results = config.songs
    .map(s => ({ song: s, score: scoreMatch(query, s) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!results.length) { list.classList.add('hidden'); return; }

  list.innerHTML = '';
  highlightedIdx = -1;
  results.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.innerHTML = highlightMatch(r.song, query);
    item.dataset.value = r.song;
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      selectSong(r.song);
    });
    list.appendChild(item);
  });

  list.classList.remove('hidden');
}

function moveHighlight(dir) {
  const list = $('autocompleteList');
  const items = list.querySelectorAll('.autocomplete-item');
  if (!items.length) return;
  items[highlightedIdx]?.classList.remove('highlighted');
  highlightedIdx = (highlightedIdx + dir + items.length) % items.length;
  items[highlightedIdx].classList.add('highlighted');
  items[highlightedIdx].scrollIntoView({ block: 'nearest' });
}

function selectSong(name) {
  $('guessInput').value = name;
  $('autocompleteList').classList.add('hidden');
  $('btnSubmit').disabled = false;
}

// ── Persistence ─────────────────────────────────────────────

function saveState() {
  const saved = loadAllState();
  saved[dayNumber] = { attempts, gameOver, currentStem, timerFinalMs };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

function loadAllState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function loadStateForDay(day) {
  const all = loadAllState();
  return all[day] || null;
}

// ── Streak tracking ────────────────────────────────────────

const STREAK_KEY = 'spyro-heardle-streak';

function loadStreak() {
  try { return JSON.parse(localStorage.getItem(STREAK_KEY)) || { current: 0, best: 0, lastWonDay: null }; }
  catch { return { current: 0, best: 0, lastWonDay: null }; }
}

function saveStreak(data) {
  localStorage.setItem(STREAK_KEY, JSON.stringify(data));
}

function updateStreak(won) {
  const streak = loadStreak();
  if (won) {
    const prevDay = dayNumber - 1;
    if (streak.lastWonDay === prevDay || streak.lastWonDay === null) {
      streak.current += 1;
    } else if (streak.lastWonDay === dayNumber) {
      // Already recorded for today, don't double-count
    } else {
      streak.current = 1;
    }
    streak.lastWonDay = dayNumber;
    streak.best = Math.max(streak.best || 0, streak.current);
  } else {
    if (streak.lastWonDay !== dayNumber) {
      streak.current = 0;
    }
  }
  saveStreak(streak);
  return streak;
}

// ── Confetti ───────────────────────────────────────────────

function launchConfetti(isDragon) {
  const canvas = $('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = isDragon
    ? ['#f0b429', '#ff6a1a', '#ffd97a', '#ff9a55', '#c8820a']  // gold/fire for dragon
    : ['#9b59f5', '#6b35c8', '#f0b429', '#c99ef7', '#ff6a1a', '#a855f7']; // purple/gold normally

  const pieces = Array.from({ length: isDragon ? 160 : 100 }, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 200,
    w: 6 + Math.random() * 8,
    h: 3 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.2,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 3,
    opacity: 1,
  }));

  let frame;
  let startTime = null;
  const DURATION = isDragon ? 3200 : 2200;

  function draw(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let alive = false;
    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.vy += 0.06; // gravity
      p.opacity = Math.max(0, 1 - (elapsed / DURATION));

      if (p.y < canvas.height + 20) alive = true;

      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    if (alive && elapsed < DURATION + 1000) {
      frame = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(frame);
    }
  }

  frame = requestAnimationFrame(draw);
}

// ── Game flow ───────────────────────────────────────────────

function handleSkip() {
  if (gameOver) return;
  attempts.push({ type: 'skip', value: '' });
  advanceOrEnd(false);
}

function isCorrectAnswer(val) {
  const v = val.toLowerCase();
  if (v === puzzle.answer.toLowerCase()) return true;
  if (Array.isArray(puzzle.alsoAccept)) {
    return puzzle.alsoAccept.some(a => a.toLowerCase() === v);
  }
  return false;
}

function handleGuess() {
  if (gameOver) return;
  const val = $('guessInput').value.trim();
  if (!val) return;

  if (isCorrectAnswer(val)) {
    attempts.push({ type: 'correct', value: val });
    endGame(true);
  } else {
    attempts.push({ type: 'wrong', value: val });
    // Shake the input box
    const input = $('guessInput');
    input.classList.remove('shake');
    void input.offsetWidth; // force reflow to restart animation
    input.classList.add('shake');
    input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
    advanceOrEnd(false);
  }

  $('guessInput').value = '';
  $('btnSubmit').disabled = true;
  $('autocompleteList').classList.add('hidden');
}

function advanceOrEnd(won) {
  const maxAttempts = puzzle.maxAttempts;
  const stemsAvailable = puzzle.stems.length;

  // If we've exhausted attempts or used all stems → game over
  if (attempts.length >= maxAttempts || currentStem >= stemsAvailable - 1) {
    endGame(false);
    return;
  }

  currentStem++;
  loadStem(currentStem);
  playAudio();
  // Pop the newly revealed stem chip
  const chip = $(`stem-chip-${currentStem}`);
  if (chip) {
    chip.classList.remove('pop');
    void chip.offsetWidth;
    chip.classList.add('pop');
    chip.addEventListener('animationend', () => chip.classList.remove('pop'), { once: true });
  }
  saveState();
}

function renderResultSongs() {
  const el = $('resultSong');
  const allAnswers = [puzzle.answer, ...(puzzle.alsoAccept || [])];
  if (allAnswers.length === 1) {
    // Simple case — no alsoAccept
    el.innerHTML = escapeHtml(puzzle.answer);
    el.classList.remove('result-song--multi');
  } else {
    el.classList.add('result-song--multi');
    el.innerHTML = allAnswers
      .map((a, i) => `<span class="result-song-entry">${i === 0 ? '🎵' : '🎵'} ${escapeHtml(a)}</span>`)
      .join('');
  }
}

function endGame(won) {
  gameOver = true;
  stopTimer();
  saveState();

  // Hide guess area, show result
  $('guessArea').classList.add('hidden');
  const panel = $('resultPanel');
  panel.classList.remove('hidden');

  // Emoji / result text
  const emojiStr = buildEmojiString(won);
  const isDragon = won && attempts.length === 1 && attempts[0].type === 'correct';
  $('resultEmoji').textContent = isDragon ? '🐉' : (won ? '🎉' : '💀');
  $('resultTitle').textContent = isDragon ? 'First Try. Too easy.' : won ? 'GG' : 'L + Ratio';
  renderResultSongs();
  $('resultAttempts').textContent = emojiStr;

  // Show final time if timer was used
  if (timerFinalMs !== null) {
    const rt = $('resultTime');
    rt.classList.remove('hidden');
    $('resultTimeValue').textContent = formatElapsed(timerFinalMs);
  }

  // Streak
  const streak = updateStreak(won);
  if (won && streak.current >= 2) {
    const sd = $('streakDisplay');
    sd.classList.remove('hidden');
    $('streakCount').textContent = streak.current;
  }

  // Countdown to next puzzle
  startCountdown();

  // Confetti on win
  if (won) {
    launchConfetti(isDragon);
  }

  // Make all stem chips clickable
  makeChipsClickable();
  enableSeeking();

  // Submit score to leaderboard (silent, background)
  submitCurrentScore();
  if (isTodayPuzzle()) {
    revealTodayCountFallback();
    loadTodayCount();
  }

  // If we're already playing the last stem (full mix), just let it keep going.
  // Otherwise load and autoplay the full mix from the start.
  const isAlreadyOnFullMix = currentStem === puzzle.stems.length - 1;
  if (!isAlreadyOnFullMix) {
    loadFullMix(true);
  } else {
    // Just update the chip highlight to reflect post-game state
    puzzle.stems.forEach((_, i) => {
      const chip = $(`stem-chip-${i}`);
      if (!chip) return;
      chip.classList.toggle('current', i === puzzle.stems.length - 1);
    });
  }
}

function loadFullMix(autoplay) {
  const fullStem = puzzle.stems[puzzle.stems.length - 1];
  loadStemByIndex(puzzle.stems.length - 1, autoplay);
}

// Load any stem by index; optionally autoplay when ready
function loadStemByIndex(idx, autoplay) {
  const stem = puzzle.stems[idx];
  const src = `${puzzle.audioFolder}/${stem.file}`;

  // Mark which chip is "current" in post-game mode
  puzzle.stems.forEach((_, i) => {
    const chip = $(`stem-chip-${i}`);
    if (!chip) return;
    chip.classList.toggle('current', i === idx);
  });

  audio.pause();
  audio.src = src;
  audio.load();

  // Reset seek slider position
  const seek = $('seekSlider');
  if (seek) seek.value = 0;

  if (autoplay) {
    // Use canplay so it fires once the browser has enough data
    const onCanPlay = () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.play().catch(() => {});
    };
    audio.addEventListener('canplay', onCanPlay);
  } else {
    updatePlayButton(false);
    $('timeDisplay').textContent = '0:00';
    $('progressFill').style.width = '0%';
    updateWaveform(0);
  }
}

function makeChipsClickable() {
  puzzle.stems.forEach((stem, i) => {
    const chip = $(`stem-chip-${i}`);
    if (!chip) return;
    chip.classList.add('clickable');
    chip.title = `Listen to: ${stem.label}`;
    chip.addEventListener('click', () => {
      loadStemByIndex(i, true);
    });
  });
}

function buildEmojiString(won) {
  const isDragon = won && attempts.length === 1 && attempts[0].type === 'correct';
  const squares = attempts.map((a, i) => {
    if (a.type === 'correct') return isDragon ? EMOJI.dragon : EMOJI.correct;
    if (a.type === 'wrong')   return EMOJI.wrong;
    return EMOJI.skip;
  }).join('');
  return EMOJI.prefix + squares;
}

function buildShareText() {
  const emojiStr = buildEmojiString(attempts.some(a => a.type === 'correct'));
  const url = buildShareUrl(dayNumber);
  const timePart = timerFinalMs !== null ? `⏱ ${formatElapsedForShare(timerFinalMs)}` : null;
  return [`Spyro Heardle #${dayNumber}`, emojiStr, timePart, url].filter(Boolean).join('\n');
}

function buildShareUrl(day) {
  const base = window.location.origin + window.location.pathname.replace('index.html', '');
  const todayDay = getDayNumberForToday(config);
  // Only include ?day= for archive days — today's link should be clean
  if (day !== todayDay) return `${base}?day=${day}`;
  return base;
}

// ── Share button ────────────────────────────────────────────

function initShareButton() {
  $('btnShare')?.addEventListener('click', () => {
    const text = buildShareText();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
    } else {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied to clipboard!');
    }
  });
}

// ── Restore state (for returning players) ──────────────────

function restoreGameState(saved) {
  attempts     = saved.attempts;
  currentStem  = saved.currentStem;
  gameOver     = saved.gameOver;
  timerFinalMs = saved.timerFinalMs || null;

  if (gameOver) {
    $('guessArea').classList.add('hidden');
    const won = attempts.some(a => a.type === 'correct');
    const emojiStr = buildEmojiString(won);
    const isDragon = won && attempts.length === 1 && attempts[0].type === 'correct';
    const panel = $('resultPanel');
    panel.classList.remove('hidden');
    $('resultEmoji').textContent = isDragon ? '🐉' : (won ? '🎉' : '💀');
    $('resultTitle').textContent = isDragon ? 'First Try. Too easy.' : won ? 'GG' : 'L + Ratio';
    renderResultSongs();
    $('resultAttempts').textContent = emojiStr;
    // Show saved time if available
    if (timerFinalMs !== null) {
      const rt = $('resultTime');
      rt.classList.remove('hidden');
      $('resultTimeValue').textContent = formatElapsed(timerFinalMs);
    }
    // Restore streak display if applicable
    const streak = loadStreak();
    if (won && streak.current >= 2 && streak.lastWonDay === dayNumber) {
      const sd = $('streakDisplay');
      sd.classList.remove('hidden');
      $('streakCount').textContent = streak.current;
    }
    // Countdown
    startCountdown();
    // Load full mix (no autoplay on restore — user can press play)
    loadStemByIndex(puzzle.stems.length - 1, false);
    makeChipsClickable();
    enableSeeking();
  } else {
    updateStemBar();
    loadStem(currentStem);
    // Resume live timer if session still has a start (mid-game refresh)
    const existingStart = getTimerStart();
    if (existingStart !== null) {
      timerStart = existingStart;
      const el = $('speedrunTimer');
      if (el) el.classList.remove('hidden');
      timerInterval = setInterval(timerTick, 100);
    }
  }
}

// ── Countdown to next puzzle ────────────────────────────────

let countdownInterval = null;

function getMsUntilMidnightPST() {
  const tz = (config && config.timezone) ? config.timezone : 'America/Los_Angeles';
  const now = new Date();

  // Find what "now" looks like in the target timezone as a plain date string
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));

  // Build next midnight by zeroing out h/m/s and adding one day
  const nextMidnight = new Date(tzDate);
  nextMidnight.setHours(24, 0, 0, 0);

  // The difference between tzDate and now tells us the tz offset
  const tzOffset = tzDate - now;

  // nextMidnight is expressed in local browser time, so adjust back
  return (nextMidnight - tzOffset) - now;
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startCountdown() {
  const el = $('countdownTimer');
  if (!el) return;
  if (countdownInterval) clearInterval(countdownInterval);

  function tick() {
    const ms = getMsUntilMidnightPST();
    el.textContent = formatCountdown(ms);
    if (ms <= 1000) {
      // Puzzle rolled over — reload the page
      clearInterval(countdownInterval);
      setTimeout(() => location.reload(), 1200);
    }
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ── Init ───────────────────────────────────────────────────

async function init() {
  spawnParticles();

  // Load config
  try {
    const res = await fetch(CONFIG_URL + '?v=' + Date.now());
    config = await res.json();
  } catch (e) {
    showToast('Failed to load config.json');
    return;
  }

  // Determine which day to show
  // ?day=N in query string overrides to allow archive play
  const params = new URLSearchParams(window.location.search);
  const dayParam = params.get('day');

  if (dayParam) {
    dayNumber = parseInt(dayParam, 10);
  } else {
    dayNumber = getDayNumberForToday(config);
  }

  $('dayBadge').textContent = `#${dayNumber}`;

  puzzle = getPuzzleForDay(config, dayNumber);

  // No puzzle configured for today
  if (!puzzle) {
    const today = getTodayPST();
    $('notUpdatedMsg').textContent =
      `The puzzle for ${formatDate(today)} hasn't been set up yet! Message @Composer to remind them :)`;
    $('notUpdated').classList.remove('hidden');
    $('gamePanel').classList.add('hidden');
    return;
  }

  // Build UI
  buildWaveform();
  buildStemBar();
  bindAudioEvents();
  initShareButton();

  // Bind controls
  $('btnPlay').addEventListener('click', () => {
    if (audio.paused) {
      playAudio();
      if (!gameOver) startTimer();
    } else {
      pauseAudio();
    }
  });

  $('btnSkip').addEventListener('click', handleSkip);
  $('btnSubmit').addEventListener('click', handleGuess);

  const input = $('guessInput');
  input.addEventListener('input', () => {
    showAutocomplete(input.value);
    $('btnSubmit').disabled = !input.value.trim();
  });

  input.addEventListener('keydown', e => {
    const list = $('autocompleteList');
    if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const hi = list.querySelector('.highlighted');
      if (hi) selectSong(hi.dataset.value);
      else if (input.value.trim()) handleGuess();
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
    }
  });

  document.addEventListener('click', e => {
    if (!$('autocompleteList').contains(e.target) && e.target !== input) {
      $('autocompleteList').classList.add('hidden');
    }
  });

  // Restore or start fresh
  const saved = loadStateForDay(dayNumber);
  if (saved) {
    restoreGameState(saved);
  } else {
    loadStem(0);
  }

  // Init leaderboard features if supabase is configured
  if (config.supabase) {
    DB.init(config.supabase.url, config.supabase.anonKey);
    if (saved?.gameOver && isTodayPuzzle()) {
      revealTodayCountFallback();
      loadTodayCount();
    }
    // Show identity modal on first visit
    initIdentityModal(() => {
      // After identity is set, silently submit any unsubmitted scores from the past 5 days
      submitPastScores();
    });
  }
}

// ── Today count ─────────────────────────────────────────────

async function loadTodayCount() {
  if (!isTodayPuzzle()) return;
  try {
    const count = await DB.getTodayCount();
    const badge = ensureTodayCountBadge();
    const text  = $('todayCountText');
    if (!badge || !text) return;
    text.innerHTML = `<span class="count-num">${count}</span> ${count === 1 ? 'person has' : 'people have'} played today`;
    showTodayCountBadge(badge);
  } catch { /* silent fail */ }
}

function revealTodayCountFallback() {
  const badge = ensureTodayCountBadge();
  const text = $('todayCountText');
  if (text && !text.querySelector('.count-num')) {
    text.textContent = 'Loading today\'s play count...';
  }
  showTodayCountBadge(badge);
}

function ensureTodayCountBadge() {
  let badge = $('todayCountBadge');
  const panel = $('resultPanel');
  if (!panel) return badge;

  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'today-count-badge hidden';
    badge.id = 'todayCountBadge';
    badge.innerHTML = `<span>♫</span><span id="todayCountText">Loading today's play count...</span>`;
  }

  if (badge.parentElement !== panel) {
    const anchor = $('streakDisplay') || $('next-puzzle-countdown');
    panel.insertBefore(badge, anchor);
  }

  return badge;
}

function showTodayCountBadge(badge) {
  if (!badge) return;
  badge.classList.remove('hidden');
  void badge.offsetWidth;
  badge.classList.add('show');
}

function isTodayPuzzle() {
  return config && dayNumber === getDayNumberForToday(config);
}

// ── Score submission ─────────────────────────────────────────

async function submitCurrentScore() {
  if (!config.supabase) return;
  const playerId = Identity.getPlayerId();
  if (!playerId) return; // local player

  const state = loadStateForDay(dayNumber);
  if (!state || !state.gameOver) return;

  // Only submit if this is actually today's puzzle
  const todayDay = getDayNumberForToday(config);
  const playedOnDay = dayNumber === todayDay;

  try {
    await DB.submitScore({
      playerId,
      day:          dayNumber,
      attemptsUsed: state.attempts.length,
      maxAttempts:  puzzle.maxAttempts,
      won:          state.attempts.some(a => a.type === 'correct'),
      timeMs:       state.timerFinalMs || null,
      playedOnDay,
    });
    // Refresh today count after submission
    loadTodayCount();
  } catch { /* silent fail */ }
}

async function submitPastScores() {
  if (!config.supabase) return;
  const playerId = Identity.getPlayerId();
  if (!playerId) return;

  const allState = loadAllState();
  const todayDay = getDayNumberForToday(config);

  for (const [dayStr, state] of Object.entries(allState)) {
    const day = parseInt(dayStr);
    if (!state.gameOver) continue;

    // For past days before leaderboard was added, assume played on day
    // For current and future days, only count if it's today's puzzle
    const playedOnDay = day <= todayDay;

    const p = config.puzzles.find(p => p.day === day);
    if (!p) continue;

    try {
      await DB.submitScore({
        playerId,
        day,
        attemptsUsed: state.attempts.length,
        maxAttempts:  p.maxAttempts,
        won:          state.attempts.some(a => a.type === 'correct'),
        timeMs:       state.timerFinalMs || null,
        playedOnDay:  day < todayDay ? true : (day === todayDay), // assume all past days were on-day
      });
    } catch { /* duplicate or error — skip */ }
  }
}

// Only run init on the game page (not archive)
if (document.getElementById('gamePanel')) {
  document.addEventListener('DOMContentLoaded', init);
}
