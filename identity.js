/* ============================================================
   SPYRO HEARDLE - identity.js
   Unique leaderboard names, saved per device.
   ============================================================ */

const IDENTITY_KEY = 'spyro-heardle-identity';

const Identity = (() => {
  function load() {
    try { return JSON.parse(localStorage.getItem(IDENTITY_KEY)) || null; }
    catch { return null; }
  }

  function save(data) {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(data));
  }

  function clear() {
    localStorage.removeItem(IDENTITY_KEY);
  }

  function isLocal() {
    const d = load();
    return d && d.local === true;
  }

  function getPlayerId() {
    const d = load();
    return d && !d.local ? d.playerId : null;
  }

  function getNickname() {
    const d = load();
    return d ? d.nickname : null;
  }

  function setLocal() {
    save({ local: true, nickname: 'Local Player' });
  }

  function setPlayer(playerId, nickname) {
    save({ local: false, playerId, nickname });
  }

  return { load, save, clear, isLocal, getPlayerId, getNickname, setLocal, setPlayer };
})();

function initIdentityModal(onComplete) {
  if (Identity.load()) { onComplete(); return; }

  injectModalStyles();
  const modal = buildModal();
  document.body.appendChild(modal);
  showStep(modal, 'step-name');

  modal.querySelector('#idNicknameSubmit').addEventListener('click', async () => {
    const input = modal.querySelector('#idNicknameInput');
    const nickname = normalizeNickname(input.value);
    const err = modal.querySelector('#idNameError');
    err.textContent = '';

    if (!nickname || nickname.length < 2) {
      err.textContent = 'Please enter a name with at least 2 characters.';
      return;
    }
    if (nickname.length > 20) {
      err.textContent = 'Name must be 20 characters or less.';
      return;
    }

    setLoading(modal, '#idNicknameSubmit', true);
    try {
      const existing = await DB.checkNickname(nickname);
      if (existing) {
        err.textContent = 'That name is already taken. Try another one.';
        return;
      }

      const result = await DB.registerPlayer(nickname);
      Identity.setPlayer(result.id, nickname);
      closeModal(modal);
      onComplete();
    } catch {
      err.textContent = 'Could not save that name. Please try again.';
    } finally {
      setLoading(modal, '#idNicknameSubmit', false);
    }
  });

  modal.querySelector('#idPlayLocal').addEventListener('click', () => {
    Identity.setLocal();
    closeModal(modal);
    onComplete();
  });

  modal.querySelector('#idNicknameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      modal.querySelector('#idNicknameSubmit')?.click();
    }
  });
}

function normalizeNickname(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function buildModal() {
  const overlay = document.createElement('div');
  overlay.className = 'id-overlay';
  overlay.innerHTML = `
    <div class="id-modal">
      <div class="id-modal-header">
        <div class="id-title-spyro">Spyro</div>
        <div class="id-title-heardle">Heardle</div>
      </div>

      <div class="step" id="step-name">
        <h3 class="id-step-title">Choose a leaderboard name</h3>
        <p class="id-step-sub">Your name is saved on this device.</p>
        <input type="text" id="idNicknameInput" class="id-input" placeholder="Your name..." maxlength="20" autocomplete="off" />
        <p class="id-error" id="idNameError"></p>
        <button class="id-btn id-primary-btn" id="idNicknameSubmit">Join Leaderboard</button>
        <button class="id-btn id-local-btn" id="idPlayLocal">Play Locally</button>
      </div>
    </div>
  `;
  return overlay;
}

function showStep(modal, stepId) {
  modal.querySelectorAll('.step').forEach(s => s.classList.add('hidden'));
  modal.querySelector(`#${stepId}`)?.classList.remove('hidden');
}

function closeModal(modal) {
  modal.style.opacity = '0';
  setTimeout(() => modal.remove(), 300);
}

function setLoading(modal, btnSelector, loading) {
  const btn = modal.querySelector(btnSelector);
  if (!btn) return;
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.disabled = loading;
  btn.textContent = loading ? '...' : btn.dataset.label;
}

function injectModalStyles() {
  if (document.getElementById('id-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'id-modal-styles';
  style.textContent = `
    .id-overlay {
      position: fixed;
      inset: 0;
      background: rgba(13, 7, 24, 0.92);
      backdrop-filter: blur(12px);
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      transition: opacity 0.3s ease;
    }

    .id-modal {
      background: linear-gradient(160deg, rgba(26,13,46,0.98) 0%, rgba(46,16,96,0.6) 100%);
      border: 1px solid rgba(155, 89, 245, 0.4);
      border-radius: 20px;
      padding: 2.25rem 2rem;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(107,53,200,0.2);
    }

    .id-modal-header {
      text-align: center;
      margin-bottom: 1.75rem;
    }

    .id-title-spyro {
      font-family: 'Cinzel', serif;
      font-size: 0.7rem;
      letter-spacing: 0.35em;
      color: #f0b429;
      text-transform: uppercase;
      margin-bottom: 0.1em;
    }

    .id-title-heardle {
      font-family: 'Cinzel', serif;
      font-size: 2rem;
      font-weight: 900;
      background: linear-gradient(135deg, #c99ef7 0%, #ffd97a 60%, #ff9a55 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .id-step-title {
      font-family: 'Cinzel', serif;
      font-size: 1rem;
      font-weight: 700;
      color: #f0e8ff;
      margin-bottom: 0.4rem;
      line-height: 1.4;
    }

    .id-step-sub {
      font-family: 'Crimson Pro', serif;
      font-size: 0.9rem;
      color: #b89fdc;
      font-style: italic;
      margin-bottom: 1.25rem;
    }

    .id-input {
      width: 100%;
      padding: 0.8rem 1rem;
      margin-bottom: 0.5rem;
      background: rgba(26,13,46,0.8);
      border: 1px solid rgba(155, 89, 245, 0.3);
      border-radius: 10px;
      color: #f0e8ff;
      font-family: 'Crimson Pro', serif;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
      display: block;
    }

    .id-input:focus {
      border-color: #6b35c8;
      box-shadow: 0 0 0 3px rgba(107,53,200,0.2);
    }

    .id-error {
      font-family: 'Crimson Pro', serif;
      font-size: 0.85rem;
      color: #ff6a1a;
      min-height: 1.2em;
      margin-bottom: 0.5rem;
      font-style: italic;
    }

    .id-btn {
      width: 100%;
      padding: 0.85rem;
      border: none;
      border-radius: 10px;
      font-family: 'Cinzel', serif;
      font-size: 0.78rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 700;
      cursor: pointer;
      margin-top: 0.5rem;
      transition: all 0.2s;
    }

    .id-primary-btn {
      background: linear-gradient(135deg, #2e1060, #6b35c8);
      color: #f0e8ff;
      box-shadow: 0 4px 20px rgba(107,53,200,0.35);
    }

    .id-primary-btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #6b35c8, #9b59f5);
      transform: translateY(-1px);
      box-shadow: 0 6px 28px rgba(155,89,245,0.5);
    }

    .id-local-btn {
      background: transparent;
      color: #b89fdc;
      font-size: 0.68rem;
      letter-spacing: 0.08em;
      border: 1px solid rgba(107,53,200,0.18);
    }

    .id-local-btn:hover {
      color: #f0e8ff;
      border-color: rgba(155,89,245,0.35);
    }

    .step.hidden { display: none; }
  `;
  document.head.appendChild(style);
}
