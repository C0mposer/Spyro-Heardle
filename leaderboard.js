/* ============================================================
   SPYRO HEARDLE - leaderboard.js
   ============================================================ */

const LB_SCOPES = {
  today: 'today',
  all: 'all',
  month: 'month',
};

let lbScope = LB_SCOPES.all;
let lbData = [];
let lbConfig = null;
let myPlayerId = null;
let refreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  spawnParticles();

  try {
    const res = await fetch('config.json?v=' + Date.now());
    lbConfig = await res.json();
  } catch {
    renderTableMessage('Failed to load config.');
    return;
  }

  if (!lbConfig.supabase) {
    renderTableMessage('Leaderboard is not configured yet.');
    return;
  }

  DB.init(lbConfig.supabase.url, lbConfig.supabase.anonKey);
  myPlayerId = Identity.getPlayerId();

  bindControls();
  updateIdentityPanel();
  await loadLeaderboard();

  refreshTimer = setInterval(loadLeaderboard, 30000);
});

function bindControls() {
  document.getElementById('lbRefreshBtn')?.addEventListener('click', loadLeaderboard);

  document.querySelectorAll('.lb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      lbScope = btn.dataset.scope;
      document.querySelectorAll('.lb-tab').forEach(tab => {
        tab.classList.toggle('active', tab === btn);
        tab.setAttribute('aria-selected', tab === btn ? 'true' : 'false');
      });
      renderLeaderboard();
    });
  });

  document.getElementById('lbJoinBtn')?.addEventListener('click', () => {
    Identity.clear();
    myPlayerId = null;
    initIdentityModal(async () => {
      myPlayerId = Identity.getPlayerId();
      updateIdentityPanel();
      await submitPastScoresFromLeaderboard();
      await loadLeaderboard();
    });
  });
}

async function loadLeaderboard() {
  try {
    const [players, scores] = await Promise.all([
      DB.getLeaderboardPlayers(),
      DB.getLeaderboardScores(),
    ]);

    lbData = buildLeaderboardData(lbConfig, players, scores);
    renderLeaderboard();
    document.getElementById('lbUpdateTime').textContent =
      'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('lbUpdateTime').textContent = 'Failed to load - retrying...';
  }
}

function buildLeaderboardData(cfg, players, scores) {
  const scoreMap = new Map();
  scores.forEach(score => {
    const day = parseInt(score.day, 10);
    if (!score.player_id || !day) return;
    scoreMap.set(`${score.player_id}:${day}`, score);
  });

  return players
    .filter(player => !player.is_banned)
    .map(player => ({
      id: player.id,
      nickname: player.nickname,
      scopes: {
        today: rankPlayerInScope(player, getScopePuzzles(cfg, LB_SCOPES.today), scoreMap),
        all: rankPlayerInScope(player, getScopePuzzles(cfg, LB_SCOPES.all), scoreMap),
        month: rankPlayerInScope(player, getScopePuzzles(cfg, LB_SCOPES.month), scoreMap),
      },
    }));
}

function rankPlayerInScope(player, puzzles, scoreMap) {
  let guesses = 0;
  let wins = 0;
  let played = 0;
  let totalTimeMs = 0;
  let attemptsOnWins = 0;
  let firstTryWins = 0;
  let todayScore = null;

  puzzles.forEach(puzzle => {
    const score = scoreMap.get(`${player.id}:${puzzle.day}`);
    const maxAttempts = parseInt(score?.max_attempts || puzzle.maxAttempts, 10);

    if (!score) {
      guesses += maxAttempts + 1;
      return;
    }

    played++;
    totalTimeMs += parseInt(score.time_ms, 10) || 0;
    if (puzzles.length === 1) todayScore = score;

    if (score.won) {
      const attempts = clamp(parseInt(score.attempts_used, 10) || maxAttempts, 1, maxAttempts);
      guesses += attempts;
      wins++;
      attemptsOnWins += attempts;
      if (attempts === 1) firstTryWins++;
    } else {
      guesses += maxAttempts + 1;
    }
  });

  return {
    puzzleCount: puzzles.length,
    guesses,
    wins,
    played,
    firstTryWins,
    totalTimeMs,
    avgGuesses: wins ? attemptsOnWins / wins : null,
    todayScore,
  };
}

function getScopePuzzles(cfg, scope) {
  const todayDay = getDayNumberForToday(cfg);
  const released = cfg.puzzles
    .filter(p => p.day <= todayDay)
    .sort((a, b) => a.day - b.day);

  if (scope === LB_SCOPES.today) {
    return released.filter(p => p.day === todayDay);
  }

  if (scope === LB_SCOPES.month) {
    const monthKey = getTodayPST().slice(0, 7);
    return released.filter(p => dateForDay(cfg.startDate, p.day).slice(0, 7) === monthKey);
  }

  return released;
}

function renderLeaderboard() {
  const rows = getRowsForScope(lbScope);
  renderScopeSummary(rows);
  renderPodium(rows.slice(0, 3));
  renderTableHeader();
  renderTable(rows);
  renderYourRank(rows);
}

function getRowsForScope(scope) {
  return lbData
    .map(player => ({ ...player, ...player.scopes[scope] }))
    .filter(row => row.puzzleCount > 0 && row.played > 0)
    .sort(compareRows)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

function compareRows(a, b) {
  if (lbScope === LB_SCOPES.today) {
    return Number(!b.todayScore?.won) - Number(!a.todayScore?.won)
      || (a.guesses - b.guesses)
      || (a.totalTimeMs - b.totalTimeMs)
      || a.nickname.localeCompare(b.nickname);
  }

  return (a.guesses - b.guesses)
    || (a.totalTimeMs - b.totalTimeMs)
    || (b.wins - a.wins)
    || (b.firstTryWins - a.firstTryWins)
    || a.nickname.localeCompare(b.nickname);
}

function renderTableHeader() {
  const headRow = document.querySelector('#lbTable thead tr');
  if (!headRow) return;

  if (lbScope === LB_SCOPES.today) {
    headRow.innerHTML = `
      <th class="col-rank">Rank</th>
      <th class="col-name">Player</th>
      <th class="col-result">Guess Number</th>
      <th class="col-time">Guess Time</th>
    `;
    return;
  }

  headRow.innerHTML = `
    <th class="col-rank">Rank</th>
    <th class="col-name">Player</th>
    <th class="col-first">First Tries</th>
    <th class="col-wins">Wins</th>
    <th class="col-played">Played</th>
    <th class="col-avg">Avg</th>
    <th class="col-time">Total Time</th>
  `;
}

function renderScopeSummary(rows) {
  const sub = document.getElementById('lbSub');
  if (!sub) return;
  sub.textContent = 'Ranked by fewest guesses';
}

function renderPodium(top3) {
  const el = document.getElementById('lbPodium');
  if (!top3.length) { el.innerHTML = ''; return; }

  const slots = [
    { data: top3[1], cls: 'podium-silver', height: 'podium-h2', label: '2nd', medal: '2' },
    { data: top3[0], cls: 'podium-gold', height: 'podium-h1', label: '1st', medal: '1' },
    { data: top3[2], cls: 'podium-bronze', height: 'podium-h3', label: '3rd', medal: '3' },
  ].filter(s => s.data);

  el.innerHTML = slots.map(slot => {
    const isMe = slot.data.id === myPlayerId;
    return `
      <div class="podium-slot ${slot.cls} ${isMe ? 'podium-me' : ''}">
        <div class="podium-medal">${slot.medal}</div>
        <div class="podium-nickname">${escapeHtml(slot.data.nickname)}${isMe ? ' <span class="you-badge">You</span>' : ''}</div>
        <div class="podium-score">${slot.data.wins}</div>
        <div class="podium-score-label">wins</div>
        <div class="podium-platform ${slot.height}">
          <div class="podium-rank-label">${slot.label}</div>
          <div class="podium-first">${slot.data.firstTryWins} first ${slot.data.firstTryWins === 1 ? 'try' : 'tries'}</div>
          <div class="podium-days">${slot.data.played}/${slot.data.puzzleCount} played</div>
          <div class="podium-time">${formatTotalTime(slot.data.totalTimeMs)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTable(rows) {
  const tbody = document.getElementById('lbTableBody');
  if (!rows.length) {
    renderTableMessage('No scores yet - be the first!');
    return;
  }

  if (lbScope === LB_SCOPES.today) {
    renderTodayTable(rows);
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const isMe = r.id === myPlayerId;
    const isTop = r.rank <= 3;
    return `
      <tr class="lb-row ${isMe ? 'lb-row-me' : ''} ${isTop ? 'lb-row-top' : ''}">
        <td class="col-rank">
          <span class="rank-badge ${getRankClass(r.rank)}">${r.rank}</span>
        </td>
        <td class="col-name">
          <span class="player-name">${escapeHtml(r.nickname)}</span>
          ${isMe ? '<span class="you-badge">You</span>' : ''}
        </td>
        <td class="col-first">${r.firstTryWins}</td>
        <td class="col-wins">${r.wins}/${r.puzzleCount}</td>
        <td class="col-played">${r.played}</td>
        <td class="col-avg">${formatAvgGuesses(r.avgGuesses)}</td>
        <td class="col-time">${formatTotalTime(r.totalTimeMs)}</td>
      </tr>
    `;
  }).join('');
}

function renderTodayTable(rows) {
  const tbody = document.getElementById('lbTableBody');
  tbody.innerHTML = rows.map(r => {
    const isMe = r.id === myPlayerId;
    const isTop = r.rank <= 3;
    return `
      <tr class="lb-row ${isMe ? 'lb-row-me' : ''} ${isTop ? 'lb-row-top' : ''}">
        <td class="col-rank">
          <span class="rank-badge ${getRankClass(r.rank)}">${r.rank}</span>
        </td>
        <td class="col-name">
          <span class="player-name">${escapeHtml(r.nickname)}</span>
          ${isMe ? '<span class="you-badge">You</span>' : ''}
        </td>
        <td class="col-result"><span class="today-guess-pattern">${formatTodayGuessPattern(r)}</span></td>
        <td class="col-time">${formatTotalTime(r.totalTimeMs)}</td>
      </tr>
    `;
  }).join('');
}

function renderTableMessage(message) {
  document.getElementById('lbTableBody').innerHTML =
    `<tr><td colspan="${lbScope === LB_SCOPES.today ? 4 : 7}" class="lb-loading">${escapeHtml(message)}</td></tr>`;
}

function renderYourRank(rows) {
  const el = document.getElementById('lbYourRank');
  if (!myPlayerId) { el.classList.add('hidden'); return; }

  const me = rows.find(r => r.id === myPlayerId);
  if (!me || me.rank <= 10) { el.classList.add('hidden'); return; }

  el.classList.remove('hidden');
  el.innerHTML = `
    <span class="your-rank-label">Your rank:</span>
    <span class="your-rank-num">#${me.rank}</span>
    <span class="your-rank-score">${me.wins}/${me.puzzleCount} wins</span>
  `;
}

function updateIdentityPanel() {
  const panel = document.getElementById('lbJoinPanel');
  const label = document.getElementById('lbIdentityLabel');
  if (!panel || !label) return;

  const identity = Identity.load();
  const nickname = Identity.getNickname();

  if (myPlayerId) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  label.textContent = identity?.local
    ? 'You are playing locally on this device. Join when you want your results ranked.'
    : 'Choose a unique name to rank this device on the leaderboard.';
}

async function submitPastScoresFromLeaderboard() {
  if (!myPlayerId || typeof loadAllState !== 'function') return;

  const allState = loadAllState();
  const todayDay = getDayNumberForToday(lbConfig);

  for (const [dayStr, state] of Object.entries(allState)) {
    const day = parseInt(dayStr, 10);
    if (!state.gameOver || day > todayDay) continue;

    const puzzle = lbConfig.puzzles.find(p => p.day === day);
    if (!puzzle) continue;

    try {
      await DB.submitScore({
        playerId: myPlayerId,
        day,
        attemptsUsed: state.attempts.length,
        maxAttempts: puzzle.maxAttempts,
        won: state.attempts.some(a => a.type === 'correct'),
        timeMs: state.timerFinalMs || null,
        playedOnDay: true,
      });
    } catch { /* duplicate or offline - skip */ }
  }
}

function getRankClass(rank) {
  if (rank === 1) return 'rank-gold';
  if (rank === 2) return 'rank-silver';
  if (rank === 3) return 'rank-bronze';
  return '';
}

function formatAvgGuesses(value) {
  return value === null ? '-' : value.toFixed(2);
}

function formatTodayGuessPattern(row) {
  const score = row.todayScore;
  if (!score) return '-';
  const maxAttempts = parseInt(score.max_attempts, 10) || row.puzzleCount || 6;
  const attempts = clamp(parseInt(score.attempts_used, 10) || maxAttempts, 1, maxAttempts);
  if (!score.won) return '⬛'.repeat(Math.max(0, maxAttempts - 1)) + '🟥';
  if (attempts === 1) return '🐉';
  return '⬛'.repeat(attempts - 1) + '🟩';
}

function formatTotalTime(ms) {
  if (!ms) return '-';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
