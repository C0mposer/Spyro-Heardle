const CONFIG_URL  = 'config.json';
const STORAGE_KEY = 'spyro-heardle-state';

const EMOJI = {
  skip:    '⚪',
  wrong:   '🟥',
  correct: '🟣',
  dragon:  '🐉',   // correct on first guess, no skips
};

// ── State ──────────────────────────────────────────────────
let config       = null;
let puzzle       = null;
let dayNumber    = null;
let currentStem  = 0;   // index into puzzle.stems (0 = first stem shown)
let attempts     = [];  // array of { type: 'skip'|'wrong'|'correct', value: string }
let gameOver     = false;
let audio        = new Audio();
let waveformBars = [];

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
  });

  audio.addEventListener('ended', () => {
    updatePlayButton(false);
    updateWaveform(0);
    $('progressFill').style.width = '0%';
    $('timeDisplay').textContent = '0:00';
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
  // Returns a score 0-100; higher = better match
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (c === q) return 100;
  if (c.startsWith(q)) return 90;
  if (c.includes(q)) return 70;
  // subsequence scoring
  let qi = 0;
  let score = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) { score += 1; qi++; }
  }
  return qi === q.length ? (score / c.length) * 50 : 0;
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Find subsequence positions and wrap each matching char
  const result = [];
  let qi = 0;
  for (let i = 0; i < text.length; i++) {
    if (qi < q.length && t[i] === q[qi]) {
      result.push(`<span class="match-highlight">${escapeHtml(text[i])}</span>`);
      qi++;
    } else {
      result.push(escapeHtml(text[i]));
    }
  }
  return result.join('');
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
  saved[dayNumber] = { attempts, gameOver, currentStem };
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

// ── Game flow ───────────────────────────────────────────────

function handleSkip() {
  if (gameOver) return;
  attempts.push({ type: 'skip', value: '' });
  advanceOrEnd(false);
}

function handleGuess() {
  if (gameOver) return;
  const val = $('guessInput').value.trim();
  if (!val) return;

  if (val.toLowerCase() === puzzle.answer.toLowerCase()) {
    attempts.push({ type: 'correct', value: val });
    endGame(true);
  } else {
    attempts.push({ type: 'wrong', value: val });
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
  saveState();
}

function endGame(won) {
  gameOver = true;
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
  $('resultSong').textContent = puzzle.answer;
  $('resultAttempts').textContent = emojiStr;

  // Make all revealed stem chips clickable
  makeChipsClickable();

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
  return attempts.map((a, i) => {
    if (a.type === 'correct') {
      // Dragon only if first attempt
      return (i === 0) ? EMOJI.dragon : EMOJI.correct;
    }
    if (a.type === 'wrong') return EMOJI.wrong;
    return EMOJI.skip;
  }).join('');
}

function buildShareText() {
  const emojiStr = buildEmojiString(attempts.some(a => a.type === 'correct'));
  const url = buildShareUrl(dayNumber);
  return `Spyro Heardle #${dayNumber}\n${emojiStr}\n${url}`;
}

function buildShareUrl(day) {
  const base = window.location.origin + window.location.pathname.replace('index.html', '');
  return `${base}?day=${day}`;
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
  attempts    = saved.attempts;
  currentStem = saved.currentStem;
  gameOver    = saved.gameOver;

  if (gameOver) {
    $('guessArea').classList.add('hidden');
    const won = attempts.some(a => a.type === 'correct');
    const emojiStr = buildEmojiString(won);
    const isDragon = won && attempts.length === 1 && attempts[0].type === 'correct';
    const panel = $('resultPanel');
    panel.classList.remove('hidden');
    $('resultEmoji').textContent = isDragon ? '🐉' : (won ? '🎉' : '💀');
    $('resultTitle').textContent = isDragon ? 'First Try. Too easy.' : won ? 'GG' : 'L + Ratio';
    $('resultSong').textContent = puzzle.answer;
    $('resultAttempts').textContent = emojiStr;
    // Load full mix (no autoplay on restore — user can press play)
    loadStemByIndex(puzzle.stems.length - 1, false);
    makeChipsClickable();
  } else {
    updateStemBar();
    loadStem(currentStem);
  }
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
      `The heardle for ${formatDate(today)} hasn't been set up yet! Message @Composer to remind them :)`;
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
    if (audio.paused) playAudio(); else pauseAudio();
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
}

// Only run init on the game page (not archive)
if (document.getElementById('gamePanel')) {
  document.addEventListener('DOMContentLoaded', init);
}