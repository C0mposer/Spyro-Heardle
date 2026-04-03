/* ============================================================
   SPYRO HEARDLE — stats.js
   Builds the stats page from localStorage data
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  spawnParticles();

  // ── Load config for day/date context ──
  let cfg;
  try {
    const res = await fetch('config.json?v=' + Date.now());
    cfg = await res.json();
  } catch {
    cfg = null;
  }

  const allState  = loadAllState();   // { dayNum: { attempts, gameOver, currentStem } }
  const streakData = loadStreak();

  // Only count days where the game is over (fully played)
  const played = Object.entries(allState)
    .filter(([, s]) => s.gameOver)
    .map(([day, s]) => ({ day: parseInt(day), ...s }))
    .sort((a, b) => b.day - a.day); // most recent first

  if (!played.length) {
    // Show empty state, hide everything else
    document.getElementById('statsEmpty').classList.remove('hidden');
    document.getElementById('statCards').classList.add('hidden');
    document.querySelectorAll('.stats-section').forEach(s => s.classList.add('hidden'));
    return;
  }

  // ── Compute stats ──
  const totalPlayed   = played.length;
  const wins          = played.filter(d => d.attempts.some(a => a.type === 'correct'));
  const losses        = played.filter(d => !d.attempts.some(a => a.type === 'correct'));
  const winPct        = Math.round((wins.length / totalPlayed) * 100);
  const dragonWins    = wins.filter(d => d.attempts.length === 1 && d.attempts[0].type === 'correct');

  // Best streak — scan through days in order
  let bestStreak = streakData.current;
  {
    // Recompute from history for accuracy
    const dayNums = played.map(d => d.day).sort((a, b) => a - b);
    let cur = 0, best = 0;
    dayNums.forEach((day, i) => {
      const won = played.find(d => d.day === day).attempts.some(a => a.type === 'correct');
      if (won) {
        const prevDay = i > 0 ? dayNums[i - 1] : null;
        cur = (prevDay === day - 1) ? cur + 1 : 1;
        best = Math.max(best, cur);
      } else {
        cur = 0;
      }
    });
    bestStreak = best;
  }

  // Guess distribution — which attempt index the win happened on (1-based)
  // We track "stem index when won" (how many stems were heard)
  const distMap = {}; // stemIndex (1-based) → count
  wins.forEach(d => {
    const stemIdx = d.currentStem + 1; // currentStem is 0-based at the time of win
    distMap[stemIdx] = (distMap[stemIdx] || 0) + 1;
  });

  // Attempt type counts across all games
  let totalSkips  = 0;
  let totalWrong  = 0;
  let totalGuesses = 0;
  played.forEach(d => {
    d.attempts.forEach(a => {
      if (a.type === 'skip')    totalSkips++;
      if (a.type === 'wrong')   totalWrong++;
      if (a.type === 'correct') totalGuesses++;
    });
  });

  // ── Render summary cards ──
  animateCount('statPlayed',     totalPlayed);
  animateCount('statWinPct',     winPct, '%');
  animateCount('statStreak',     streakData.current, streakData.current === 1 ? ' day' : ' days');
  animateCount('statBestStreak', bestStreak, bestStreak === 1 ? ' day' : ' days');

  // ── Render distribution chart ──
  const distChart = document.getElementById('distChart');
  distChart.innerHTML = '';
  const maxDist = Math.max(...Object.values(distMap), 1);
  const maxStem = cfg
    ? Math.max(...cfg.puzzles.map(p => p.stems.length))
    : Math.max(...Object.keys(distMap).map(Number), 6);

  for (let i = 1; i <= maxStem; i++) {
    const count = distMap[i] || 0;
    const pct   = (count / maxDist) * 100;

    const row = document.createElement('div');
    row.className = 'dist-row';

    const label = document.createElement('div');
    label.className = 'dist-label';
    label.textContent = `Stem ${i}`;

    const barWrap = document.createElement('div');
    barWrap.className = 'dist-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'dist-bar' + (count > 0 ? ' dist-bar--filled' : '');
    bar.style.setProperty('--target-width', pct + '%');

    const countEl = document.createElement('span');
    countEl.className = 'dist-count';
    countEl.textContent = count;

    bar.appendChild(countEl);
    barWrap.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barWrap);
    distChart.appendChild(row);

    // Animate bar in with a slight delay per row
    setTimeout(() => {
      bar.style.width = pct + '%';
    }, 100 + i * 80);
  }

  // Also add a "Did not get it" row
  if (losses.length > 0) {
    const row = document.createElement('div');
    row.className = 'dist-row';

    const label = document.createElement('div');
    label.className = 'dist-label dist-label--loss';
    label.textContent = '✗ Lost';

    const barWrap = document.createElement('div');
    barWrap.className = 'dist-bar-wrap';

    const pct = (losses.length / maxDist) * 100;
    const bar = document.createElement('div');
    bar.className = 'dist-bar dist-bar--loss';
    bar.style.setProperty('--target-width', pct + '%');

    const countEl = document.createElement('span');
    countEl.className = 'dist-count';
    countEl.textContent = losses.length;

    bar.appendChild(countEl);
    barWrap.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barWrap);
    distChart.appendChild(row);

    setTimeout(() => { bar.style.width = pct + '%'; }, 100 + (maxStem + 1) * 80);
  }

  // ── Dragon wins ──
  animateCount('dragonCount', dragonWins.length);
  if (dragonWins.length === 0) {
    document.getElementById('dragonSection').classList.add('dragon-section--empty');
  }

  // ── Recent results ──
  const recentList = document.getElementById('recentList');
  const recent = played.slice(0, 10);

  recent.forEach(d => {
    const won = d.attempts.some(a => a.type === 'correct');
    const isDragon = won && d.attempts.length === 1 && d.attempts[0].type === 'correct';

    const emojiStr = '🔊' + d.attempts.map((a, i) => {
      if (a.type === 'correct') return isDragon ? '🐉' : '🟩';
      if (a.type === 'wrong')   return '🟥';
      return '⬛';
    }).join('');

    let dateStr = '';
    if (cfg) {
      const ds = dateForDay(cfg.startDate, d.day);
      dateStr = formatDate(ds);
    }

    const puzzle = cfg ? cfg.puzzles.find(p => p.day === d.day) : null;

    const row = document.createElement('a');
    row.className = 'recent-row' + (won ? ' recent-row--win' : ' recent-row--loss');
    row.href = `index.html?day=${d.day}`;

    row.innerHTML = `
      <div class="recent-left">
        <span class="recent-day">#${d.day}</span>
        <span class="recent-date">${dateStr}</span>
      </div>
      <div class="recent-middle">
        <span class="recent-emojis">${emojiStr}</span>
        ${puzzle ? `<span class="recent-song">${puzzle.answer}</span>` : ''}
      </div>
      <div class="recent-right">
        <span class="recent-result-badge ${won ? 'badge--win' : 'badge--loss'}">
          ${won ? (isDragon ? '🐉' : '✓') : '✗'}
        </span>
      </div>
    `;
    recentList.appendChild(row);
  });
});

// ── Animated number counter ──
function animateCount(id, target, suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 900;
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(eased * target) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}