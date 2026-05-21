/* ============================================================
   SPYRO HEARDLE — db.js
   Supabase API layer. Loaded by game.js, leaderboard.js, admin.js
   ============================================================ */

const DB = (() => {
  let _url = null;
  let _key = null;

  function init(url, key) {
    _url = url.replace(/\/$/, '');
    _key = key;
  }

  function headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      'apikey': _key,
      'Authorization': `Bearer ${_key}`,
      ...extra,
    };
  }

  const PAGE_SIZE = 1000;

  async function get(table, params = '') {
    const res = await fetch(`${_url}/rest/v1/${table}?${params}`, {
      headers: headers({ 'Accept': 'application/json' }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return text ? JSON.parse(text) : null;
  }

  /** Fetch all rows; Supabase caps each response at PAGE_SIZE (default 1000). */
  async function getAll(table, params = '') {
    const all = [];
    let offset = 0;

    while (true) {
      const qs = params ? `${params}&` : '';
      const res = await fetch(
        `${_url}/rest/v1/${table}?${qs}limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: headers({ 'Accept': 'application/json', 'Prefer': 'count=exact' }) },
      );
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      const batch = text ? JSON.parse(text) : [];
      all.push(...batch);

      const total = parseInt((res.headers.get('Content-Range') || '').split('/')[1], 10);
      if (!batch.length || batch.length < PAGE_SIZE || (total && all.length >= total)) break;
      offset += PAGE_SIZE;
    }

    return all;
  }

  async function post(table, body, params = '', prefer = 'return=representation') {
    const query = params ? `?${params}` : '';
    const res = await fetch(`${_url}/rest/v1/${table}${query}`, {
      method: 'POST',
      headers: headers({ 'Prefer': prefer }),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return text ? JSON.parse(text) : null;
  }

  async function patch(table, params, body) {
    const res = await fetch(`${_url}/rest/v1/${table}?${params}`, {
      method: 'PATCH',
      headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function del(table, params) {
    const res = await fetch(`${_url}/rest/v1/${table}?${params}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return true;
  }

  // Player identity hashing
  // Device secret hashing. Stored in the legacy pin_hash column.
  async function hashDeviceSecret(secret, salt) {
    const data = new TextEncoder().encode(salt + secret + 'spyro-heardle-salt');
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Generate a random local ID
  function generateLocalId() {
    return 'local_' + crypto.randomUUID();
  }

  // ── Player operations ───────────────────────────────────────

  async function checkNickname(nickname) {
    // Returns player row if exists, null if free
    const rows = await get('players', `nickname=ilike.${encodeURIComponent(nickname)}&select=id,nickname,is_banned`);
    return rows.length ? rows[0] : null;
  }

  async function registerPlayer(nickname) {
    const localId = generateLocalId();
    const salt    = nickname.toLowerCase();
    const deviceSecret = crypto.randomUUID();
    const pinHash = await hashDeviceSecret(deviceSecret, salt);
    const rows    = await post('players', { nickname, pin_hash: pinHash, local_id: localId });
    return { ...rows[0], localId };
  }

  // ── Score operations ────────────────────────────────────────

  async function submitScore({ playerId, day, attemptsUsed, maxAttempts, won, timeMs, playedOnDay }) {
    // Upsert — if score for this day already exists, skip
    const body = {
      player_id:     playerId,
      day,
      attempts_used: attemptsUsed,
      max_attempts:  maxAttempts,
      won,
      time_ms:       timeMs || null,
      played_on_day: playedOnDay,
    };

    try {
      await post('scores', body, 'on_conflict=player_id,day', 'resolution=merge-duplicates,return=minimal');
      return true;
    } catch {
      try {
        await post('scores', body, '', 'return=minimal');
        return true;
      } catch (insertErr) {
        const msg = insertErr.message || '';
        if (msg.includes('duplicate') || msg.includes('unique')) return false;
        throw insertErr;
      }
    }
  }

  async function getLeaderboard(totalPuzzles) {
    const rows = await get('leaderboard_stats', 'order=total_points.desc,total_time_ms.asc&limit=100');
    // Normalize: score = total_points / totalPuzzles * 100
    return rows.map((r, i) => ({
      rank:         i + 1,
      id:           r.id,
      nickname:     r.nickname,
      daysPlayed:   parseInt(r.days_played) || 0,
      totalPoints:  parseInt(r.total_points) || 0,
      normalizedScore: totalPuzzles > 0
        ? Math.round((parseInt(r.total_points) || 0) / totalPuzzles * 100) / 100
        : 0,
      totalTimeMs:  parseInt(r.total_time_ms) || 0,
      totalWins:    parseInt(r.total_wins) || 0,
    }));
  }

  async function getLeaderboardPlayers() {
    return getAll('players', 'select=id,nickname,is_banned&is_banned=eq.false&order=nickname.asc');
  }

  async function getLeaderboardScores() {
    return getAll(
      'scores',
      'select=player_id,day,attempts_used,max_attempts,won,time_ms,played_on_day&order=day.asc,player_id.asc',
    );
  }

  async function getTodayCount() {
    const rows = await get('today_player_count', '');
    return rows.length ? (parseInt(rows[0].count) || 0) : 0;
  }

  // ── Admin operations ────────────────────────────────────────

  async function banPlayer(playerId) {
    return patch('players', `id=eq.${playerId}`, { is_banned: true });
  }

  async function unbanPlayer(playerId) {
    return patch('players', `id=eq.${playerId}`, { is_banned: false });
  }

  async function deletePlayer(playerId) {
    // Cascade deletes scores too (set up in SQL)
    return del('players', `id=eq.${playerId}`);
  }

  async function getAllPlayers() {
    return get('players', 'select=id,nickname,created_at,is_banned&order=created_at.desc');
  }

  async function getPlayerScores(playerId) {
    return get('scores', `player_id=eq.${playerId}&order=day.asc`);
  }

  return {
    init,
    hashDeviceSecret,
    generateLocalId,
    checkNickname,
    registerPlayer,
    submitScore,
    getLeaderboard,
    getLeaderboardPlayers,
    getLeaderboardScores,
    getTodayCount,
    banPlayer,
    unbanPlayer,
    deletePlayer,
    getAllPlayers,
    getPlayerScores,
  };
})();
