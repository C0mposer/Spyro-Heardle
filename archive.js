document.addEventListener('DOMContentLoaded', async () => {
  // spawnParticles is defined in game.js, loaded before archive.js
  spawnParticles();

  let cfg;
  try {
    const res = await fetch('config.json?v=' + Date.now());
    cfg = await res.json();
  } catch {
    document.getElementById('archiveGrid').innerHTML =
      '<p class="loading-text">Failed to load puzzle data.</p>';
    return;
  }

  const todayDay  = getDayNumberForToday(cfg);
  const savedAll  = loadAllState();
  const grid      = document.getElementById('archiveGrid');
  grid.innerHTML  = '';

  // Show days from 1 up to todayDay
  const maxDay = Math.max(todayDay, 1);

  if (maxDay < 1) {
    grid.innerHTML = '<p class="loading-text">No puzzles yet!</p>';
    return;
  }

  // Most recent first
  for (let d = maxDay; d >= 1; d--) {
    const puzzle  = cfg.puzzles.find(p => p.day === d);
    const dateStr = dateForDay(cfg.startDate, d);
    const state   = savedAll[d] || null;
    const isToday = (d === todayDay);

    const card = document.createElement('a');
    card.className = 'archive-card';
    if (isToday) card.classList.add('today');
    if (state)   card.classList.add('played');

    // Link: today goes to index, others go with ?day=N
    card.href = isToday ? 'index.html' : `index.html?day=${d}`;

    const dayLabel = document.createElement('div');
    dayLabel.className = 'card-day';
    dayLabel.textContent = isToday ? 'Today' : 'Day';

    const numEl = document.createElement('div');
    numEl.className = 'card-num';
    numEl.textContent = `#${d}`;

    const dateEl = document.createElement('div');
    dateEl.className = 'card-date';
    dateEl.textContent = formatDate(dateStr);

    card.appendChild(dayLabel);
    card.appendChild(numEl);
    card.appendChild(dateEl);

    // Show result if played
    if (state && state.attempts && state.attempts.length) {
      const resultEl = document.createElement('div');
      resultEl.className = 'card-result';
      const emojiStr = state.attempts.map((a, i) => {
        if (a.type === 'correct') return (i === 0 ? '🐉' : '🟣');
        if (a.type === 'wrong')   return '🔴';
        return '⚪';
      }).join('');
      resultEl.textContent = emojiStr;
      card.appendChild(resultEl);
    } else if (!puzzle) {
      // Puzzle not configured for this day
      const missingEl = document.createElement('div');
      missingEl.className = 'card-date';
      missingEl.style.color = 'var(--fire-bright)';
      missingEl.textContent = 'Not set up';
      card.appendChild(missingEl);
    }

    grid.appendChild(card);
  }
});
