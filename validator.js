/* ============================================================
   SPYRO HEARDLE — validator.js
   Comprehensive config + audio file validator
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  spawnParticles();
  document.getElementById('btnRun').addEventListener('click', runValidation);
});

// ── Severity levels ──────────────────────────────────────────
const SEV = {
  OK:   'ok',
  WARN: 'warn',
  ERR:  'err',
  INFO: 'info',
};

const ICON = {
  ok:   '✅',
  warn: '⚠️',
  err:  '❌',
  info: 'ℹ️',
};

// ── Check if a file exists by fetching it ────────────────────
async function fileExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

// Same but for audio — tries HEAD, falls back to GET range
async function audioExists(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

// ── Main validation runner ────────────────────────────────────
async function runValidation() {
  const btn       = document.getElementById('btnRun');
  const btnIcon   = document.getElementById('btnRunIcon');
  const btnLabel  = document.getElementById('btnRunLabel');
  const results   = document.getElementById('results');

  btn.disabled    = true;
  btnIcon.innerHTML = '<span class="spin">◈</span>';
  btnLabel.textContent = 'Validating…';
  results.innerHTML = '';

  // ── Load config ──
  let cfg;
  try {
    const res = await fetch('config.json?v=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cfg = await res.json();
  } catch (e) {
    results.innerHTML = renderFatalError(`Failed to load config.json: ${e.message}`);
    resetButton();
    return;
  }

  const todayDay = getDayNumberForToday(cfg);
  const sections = [];

  // ═══════════════════════════════════════════════
  // SECTION 1 — Config structure
  // ═══════════════════════════════════════════════
  {
    const checks = [];

    // Required top-level fields
    for (const field of ['gameTitle', 'startDate', 'timezone', 'songs', 'puzzles']) {
      if (cfg[field] === undefined || cfg[field] === null) {
        checks.push({ sev: SEV.ERR, msg: `Missing required field: <code>${field}</code>` });
      } else {
        checks.push({ sev: SEV.OK, msg: `Field <code>${field}</code> is present` });
      }
    }

    // startDate format
    if (cfg.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(cfg.startDate)) {
      checks.push({ sev: SEV.ERR, msg: `<code>startDate</code> must be in <code>YYYY-MM-DD</code> format — got <strong>${cfg.startDate}</strong>` });
    }

    // songs is a non-empty array
    if (Array.isArray(cfg.songs)) {
      if (cfg.songs.length === 0) {
        checks.push({ sev: SEV.ERR, msg: `<code>songs</code> array is empty — autocomplete will have nothing to show` });
      } else {
        checks.push({ sev: SEV.OK, msg: `<code>songs</code> list has <strong>${cfg.songs.length}</strong> entries` });
      }
    }

    // puzzles is a non-empty array
    if (Array.isArray(cfg.puzzles)) {
      if (cfg.puzzles.length === 0) {
        checks.push({ sev: SEV.WARN, msg: `<code>puzzles</code> array is empty — no days configured yet` });
      } else {
        checks.push({ sev: SEV.OK, msg: `<code>puzzles</code> array has <strong>${cfg.puzzles.length}</strong> day(s) configured` });
      }
    }

    // Duplicate song names in songs list
    const songSet = new Set();
    const dupSongs = [];
    cfg.songs?.forEach(s => {
      if (songSet.has(s.toLowerCase())) dupSongs.push(s);
      else songSet.add(s.toLowerCase());
    });
    if (dupSongs.length) {
      dupSongs.forEach(s => checks.push({ sev: SEV.WARN, msg: `Duplicate song in <code>songs</code> list: <strong>${s}</strong>` }));
    }

    sections.push({ title: 'Config Structure', checks });
  }

  // ═══════════════════════════════════════════════
  // SECTION 2 — Today's puzzle
  // ═══════════════════════════════════════════════
  {
    const checks = [];
    const todayPuzzle = cfg.puzzles?.find(p => p.day === todayDay);
    const todayDate = getTodayPST();

    if (!todayPuzzle) {
      checks.push({
        sev: SEV.ERR,
        msg: `<strong>No puzzle configured for today (Day ${todayDay}, ${formatDate(todayDate)})</strong> — players will see the "not updated" message`,
      });
    } else {
      checks.push({ sev: SEV.OK, msg: `Puzzle for today exists: <strong>Day ${todayDay}</strong> — <strong>${todayPuzzle.answer}</strong>` });

      // Also check tomorrow
      const tomorrowPuzzle = cfg.puzzles?.find(p => p.day === todayDay + 1);
      if (!tomorrowPuzzle) {
        checks.push({ sev: SEV.WARN, msg: `No puzzle configured for <strong>tomorrow (Day ${todayDay + 1})</strong> — remember to add it soon` });
      } else {
        checks.push({ sev: SEV.OK, msg: `Tomorrow's puzzle exists: Day ${todayDay + 1} — <strong>${tomorrowPuzzle.answer}</strong>` });
      }
    }

    // Any gaps in day sequence?
    if (cfg.puzzles?.length > 0) {
      const days = cfg.puzzles.map(p => p.day).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 0; i < days.length - 1; i++) {
        if (days[i + 1] !== days[i] + 1) {
          for (let d = days[i] + 1; d < days[i + 1]; d++) gaps.push(d);
        }
      }
      if (gaps.length) {
        checks.push({ sev: SEV.WARN, msg: `Missing days in sequence: <strong>${gaps.join(', ')}</strong> — players on those days will see "not updated"` });
      } else {
        checks.push({ sev: SEV.OK, msg: `Day sequence is continuous (Day ${days[0]} → Day ${days[days.length - 1]})` });
      }
    }

    sections.push({ title: "Today's Puzzle", checks });
  }

  // ═══════════════════════════════════════════════
  // SECTION 3 — Puzzle integrity (all days)
  // ═══════════════════════════════════════════════
  {
    const checks = [];
    const songSet = new Set((cfg.songs || []).map(s => s.toLowerCase()));
    const dayNums = [];

    for (const puzzle of (cfg.puzzles || [])) {
      const tag = `Day ${puzzle.day}`;

      // Day number is a positive integer
      if (!Number.isInteger(puzzle.day) || puzzle.day < 1) {
        checks.push({ sev: SEV.ERR, msg: `${tag}: <code>day</code> must be a positive integer — got <strong>${puzzle.day}</strong>` });
      } else {
        dayNums.push(puzzle.day);
      }

      // answer field
      if (!puzzle.answer) {
        checks.push({ sev: SEV.ERR, msg: `${tag}: Missing <code>answer</code> field` });
      } else if (!songSet.has(puzzle.answer.toLowerCase())) {
        checks.push({ sev: SEV.ERR, msg: `${tag}: Answer <strong>"${puzzle.answer}"</strong> is not in the <code>songs</code> list — it won't appear in autocomplete` });
      }

      // alsoAccept entries must also be in songs list
      if (Array.isArray(puzzle.alsoAccept) && puzzle.alsoAccept.length > 0) {
        puzzle.alsoAccept.forEach(alt => {
          if (!songSet.has(alt.toLowerCase())) {
            checks.push({ sev: SEV.ERR, msg: `${tag}: <code>alsoAccept</code> entry <strong>"${alt}"</strong> is not in the <code>songs</code> list — players won't be able to type it` });
          } else {
            checks.push({ sev: SEV.OK, msg: `${tag}: Also accepts <strong>"${alt}"</strong> ✓` });
          }
        });
      }

      // audioFolder
      if (!puzzle.audioFolder) {
        checks.push({ sev: SEV.ERR, msg: `${tag}: Missing <code>audioFolder</code> field` });
      }

      // stems array
      if (!Array.isArray(puzzle.stems) || puzzle.stems.length === 0) {
        checks.push({ sev: SEV.ERR, msg: `${tag}: <code>stems</code> must be a non-empty array` });
      } else {
        // Each stem has label and file
        puzzle.stems.forEach((stem, i) => {
          if (!stem.label) checks.push({ sev: SEV.WARN, msg: `${tag}: Stem ${i + 1} is missing a <code>label</code>` });
          if (!stem.file)  checks.push({ sev: SEV.ERR,  msg: `${tag}: Stem ${i + 1} is missing a <code>file</code>` });
        });

        // Last stem should be FULL
        const lastFile = puzzle.stems[puzzle.stems.length - 1]?.file || '';
        if (!lastFile.toUpperCase().includes('FULL')) {
          checks.push({ sev: SEV.WARN, msg: `${tag}: Last stem file is <code>${lastFile}</code> — expected it to be the FULL mix (name should include "FULL")` });
        }

        // maxAttempts must equal stem count exactly
        if (!puzzle.maxAttempts) {
          checks.push({ sev: SEV.WARN, msg: `${tag}: Missing <code>maxAttempts</code>` });
        } else if (puzzle.maxAttempts < 1) {
          checks.push({ sev: SEV.ERR, msg: `${tag}: <code>maxAttempts</code> must be at least 1` });
        } else if (puzzle.maxAttempts !== puzzle.stems.length) {
          checks.push({ sev: SEV.ERR, msg: `${tag}: <code>maxAttempts</code> is <strong>${puzzle.maxAttempts}</strong> but there are <strong>${puzzle.stems.length}</strong> stems — these must be equal` });
        } else {
          checks.push({ sev: SEV.OK, msg: `${tag}: <code>maxAttempts</code> (${puzzle.maxAttempts}) matches stem count ✓` });
        }
      }
    }

    // Duplicate day numbers
    const dupes = dayNums.filter((d, i) => dayNums.indexOf(d) !== i);
    if (dupes.length) {
      [...new Set(dupes)].forEach(d =>
        checks.push({ sev: SEV.ERR, msg: `Duplicate <code>day</code> number: <strong>${d}</strong> — only one puzzle can exist per day` })
      );
    }

    // Duplicate answers (same song used on multiple days)
    const answerMap = {}; // answer.toLowerCase() → [day numbers]
    for (const puzzle of (cfg.puzzles || [])) {
      const allAnswers = [puzzle.answer, ...(puzzle.alsoAccept || [])].filter(Boolean);
      allAnswers.forEach(ans => {
        const key = ans.toLowerCase();
        if (!answerMap[key]) answerMap[key] = [];
        answerMap[key].push(puzzle.day);
      });
    }
    const dupAnswers = Object.entries(answerMap).filter(([, days]) => days.length > 1);
    if (dupAnswers.length) {
      dupAnswers.forEach(([answer, days]) => {
        const original = cfg.puzzles.flatMap(p => [p.answer, ...(p.alsoAccept||[])]).find(a => a?.toLowerCase() === answer) || answer;
        checks.push({ sev: SEV.WARN, msg: `<strong>"${original}"</strong> is used as the answer on multiple days: <strong>Day ${days.join(', Day ')}</strong>` });
      });
    }

    if (!checks.length) {
      checks.push({ sev: SEV.OK, msg: 'All puzzle definitions look structurally valid' });
    }

    sections.push({ title: 'Puzzle Integrity', checks });
  }

  // ═══════════════════════════════════════════════
  // SECTION — Song Coverage
  // ═══════════════════════════════════════════════
  {
    const checks = [];
    const usedAnswers = new Set();
    for (const p of (cfg.puzzles || [])) {
      if (p.answer) usedAnswers.add(p.answer.toLowerCase());
      if (Array.isArray(p.alsoAccept)) p.alsoAccept.forEach(a => usedAnswers.add(a.toLowerCase()));
    }
    const used   = (cfg.songs || []).filter(s => usedAnswers.has(s.toLowerCase()));
    const unused = (cfg.songs || []).filter(s => !usedAnswers.has(s.toLowerCase()));

    checks.push({
      sev: SEV.INFO,
      msg: `<strong>${used.length}</strong> of <strong>${cfg.songs?.length || 0}</strong> songs have been used as puzzle answers. <strong>${unused.length}</strong> remaining.`,
    });

    if (used.length > 0) {
      checks.push({
        sev: SEV.INFO,
        msg: `<strong>Used (${used.length}):</strong> ${used.map(s => `<code>${escapeHtml(s)}</code>`).join(', ')}`,
      });
    }

    if (unused.length > 0) {
      checks.push({
        sev: SEV.INFO,
        msg: `<strong>Not yet used (${unused.length}):</strong> ${unused.map(s => `<code>${escapeHtml(s)}</code>`).join(', ')}`,
      });
    } else {
      checks.push({ sev: SEV.WARN, msg: 'All songs in the list have been used! Add more songs to <code>config.json</code> to continue.' });
    }

    sections.push({ title: 'Song Coverage', checks });
  }

  // ═══════════════════════════════════════════════
  // SECTION 4 — Audio file existence (per puzzle)
  // ═══════════════════════════════════════════════
  // Run all audio checks concurrently for speed
  {
    const audioSections = [];

    await Promise.all((cfg.puzzles || []).map(async puzzle => {
      const checks = [];
      const tag = `Day ${puzzle.day} — ${puzzle.answer}`;

      if (!puzzle.audioFolder || !Array.isArray(puzzle.stems)) {
        checks.push({ sev: SEV.WARN, msg: 'Skipped audio checks due to missing folder or stems definition' });
        audioSections.push({ day: puzzle.day, title: tag, checks });
        return;
      }

      // Check each stem file
      await Promise.all(puzzle.stems.map(async (stem, i) => {
        const url = `${puzzle.audioFolder}/${stem.file}`;
        const exists = await audioExists(url);
        if (exists) {
          checks.push({ sev: SEV.OK, msg: `Stem ${i + 1} (<strong>${stem.label}</strong>): <code>${url}</code> ✓` });
        } else {
          checks.push({ sev: SEV.ERR, msg: `Stem ${i + 1} (<strong>${stem.label}</strong>): <code>${url}</code> — file not found` });
        }
      }));

      audioSections.push({ day: puzzle.day, title: tag, checks });
    }));

    // Sort by day number
    audioSections.sort((a, b) => a.day - b.day);
    audioSections.forEach(s => sections.push({ ...s, isAudio: true }));
  }

  // ═══════════════════════════════════════════════
  // Render results
  // ═══════════════════════════════════════════════

  // Count totals
  let totalOk = 0, totalWarn = 0, totalErr = 0;
  sections.forEach(s => s.checks.forEach(c => {
    if (c.sev === SEV.OK)   totalOk++;
    if (c.sev === SEV.WARN) totalWarn++;
    if (c.sev === SEV.ERR)  totalErr++;
  }));
  const totalPuzzles = cfg.puzzles?.length || 0;

  // Today banner
  const todayDay2 = getDayNumberForToday(cfg);
  const todayPuzzle = cfg.puzzles?.find(p => p.day === todayDay2);
  const banner = document.getElementById('todayBanner');
  const bannerText = document.getElementById('todayBannerText');
  banner.classList.remove('hidden');
  if (todayPuzzle) {
    bannerText.innerHTML = `📅 Today is <strong>Day ${todayDay2}</strong> (${formatDate(getTodayPST())}) — puzzle: <strong>${todayPuzzle.answer}</strong>`;
  } else {
    bannerText.innerHTML = `📅 Today is <strong>Day ${todayDay2}</strong> (${formatDate(getTodayPST())}) — <strong style="color:var(--fire-bright)">No puzzle configured for today!</strong>`;
  }

  // Summary pills
  const sumBar = document.getElementById('summaryBar');
  sumBar.classList.remove('hidden');
  document.getElementById('sumTotal').textContent = totalPuzzles;
  document.getElementById('sumOk').textContent    = totalOk;
  document.getElementById('sumWarn').textContent  = totalWarn;
  document.getElementById('sumErr').textContent   = totalErr;
  document.getElementById('sumOkPill').className   = 'summary-pill ' + (totalErr === 0 && totalWarn === 0 ? 'pill--ok' : 'pill--info');
  document.getElementById('sumWarnPill').className = 'summary-pill ' + (totalWarn > 0 ? 'pill--warn' : 'pill--info');
  document.getElementById('sumErrPill').className  = 'summary-pill ' + (totalErr > 0  ? 'pill--error' : 'pill--info');

  // Render sections
  results.innerHTML = sections.map((section, idx) => {
    const errCount  = section.checks.filter(c => c.sev === SEV.ERR).length;
    const warnCount = section.checks.filter(c => c.sev === SEV.WARN).length;
    const okCount   = section.checks.filter(c => c.sev === SEV.OK).length;

    let badgeClass, badgeText, statusIcon;
    if (errCount > 0) {
      badgeClass = 'badge-error'; badgeText = `${errCount} error${errCount > 1 ? 's' : ''}`; statusIcon = '❌';
    } else if (warnCount > 0) {
      badgeClass = 'badge-warn'; badgeText = `${warnCount} warning${warnCount > 1 ? 's' : ''}`; statusIcon = '⚠️';
    } else {
      badgeClass = 'badge-ok'; badgeText = 'All clear'; statusIcon = '✅';
    }

    // Auto-expand sections with errors; collapse clean audio sections
    const shouldExpand = errCount > 0 || warnCount > 0 || !section.isAudio;

    return `
      <div class="check-section ${shouldExpand ? 'expanded' : ''}" id="section-${idx}">
        <div class="check-section-header" onclick="toggleSection('section-${idx}')">
          <div class="check-section-title">
            <span class="section-status">${statusIcon}</span>
            ${escapeHtml(section.title)}
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <span class="section-badge ${badgeClass}">${badgeText}</span>
            <span class="section-chevron">▼</span>
          </div>
        </div>
        <div class="check-section-body">
          ${section.checks.map(c => `
            <div class="check-row check-row--${c.sev}">
              <span class="check-icon">${ICON[c.sev]}</span>
              <span class="check-msg">${c.msg}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  resetButton(totalErr, totalWarn);
}

function toggleSection(id) {
  document.getElementById(id)?.classList.toggle('expanded');
}

function resetButton(errors = 0, warns = 0) {
  const btn = document.getElementById('btnRun');
  const icon = document.getElementById('btnRunIcon');
  const label = document.getElementById('btnRunLabel');
  btn.disabled = false;
  icon.innerHTML = errors > 0 ? '❌' : warns > 0 ? '⚠️' : '✅';
  label.textContent = errors > 0
    ? `${errors} error${errors > 1 ? 's' : ''} found — fix and re-run`
    : warns > 0
    ? `${warns} warning${warns > 1 ? 's' : ''} — re-run to check`
    : 'All clear — re-run anytime';
}

function renderFatalError(msg) {
  return `
    <div class="check-section expanded">
      <div class="check-section-header">
        <div class="check-section-title"><span class="section-status">❌</span> Fatal Error</div>
        <span class="section-badge badge-error">blocked</span>
      </div>
      <div class="check-section-body">
        <div class="check-row check-row--err">
          <span class="check-icon">❌</span>
          <span class="check-msg">${msg}</span>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}