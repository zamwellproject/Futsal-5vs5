import { ADMIN_PASSWORD, INITIAL_PLAYERS, TEAMS } from './data.js';
import { InputManager } from './input.js';
import { GameRenderer } from './renderer.js';
import { NetworkManager } from './network.js';
import { MatchEngine } from './engine.js';
import { clamp, resolveUniqueJerseyNumbers } from './utils.js';

class FutsalApp {
  constructor() {
    // Clone database pemain agar Admin bisa mengedit tanpa merusak data awal
    this.playersDB = JSON.parse(JSON.stringify(INITIAL_PLAYERS));
    this.mode = 'AI';
    this.poolFilter = 'ALL';

    // State Skuad Lokal
    this.selectedTeamId = 'EVR';
    this.aiTeamId = 'VDL';
    this.kitPrimary = '#00e5ff';
    this.kitAccent = '#0f172a';
    this.lineup = this._buildDefaultLineup();

    // State Online & Timer 60 Detik
    this.onlineSetupInterval = null;
    this.onlineSetupSeconds = 60;
    this.localReady = false;
    this.remoteSquadData = null;

    this.input = new InputManager();
    this.renderer = new GameRenderer(document.getElementById('game-canvas'));
    this.net = new NetworkManager({
      onStatusChange: (status, msg) => this._onNetStatus(status, msg),
      onRoomCreated: (code) => {
        document.getElementById('room-code-display').classList.remove('hidden');
        document.getElementById('host-room-code').textContent = code;
      },
      onConnected: () => this._enterOnlineSquadSetup(),
      onData: (payload) => this._handleNetworkData(payload),
      onDisconnected: () => {
        if (this.engine.running) {
          this.engine.stop();
          alert('Koneksi dengan lawan terputus. Kembali ke menu utama.');
          this.showScreen('screen-menu');
        }
      }
    });

    this.engine = new MatchEngine(this.renderer, this.input, this.net, this._buildEngineUICallbacks());

    this._initUI();
  }

  _buildDefaultLineup() {
    const gk = this.playersDB.find((p) => p.role === 'GK');
    const outs = this.playersDB.filter((p) => p.role === 'OUTFIELD').slice(0, 4);
    return resolveUniqueJerseyNumbers([
      { ...gk, number: gk.defaultNumber },
      ...outs.map((o) => ({ ...o, number: o.defaultNumber }))
    ]);
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    if (screenId === 'screen-match') this.renderer.resize();
  }

  _initUI() {
    // 1. Menu Utama
    document.getElementById('btn-mode-ai').addEventListener('click', () => {
      this.mode = 'AI';
      document.getElementById('ai-opponent-box').classList.remove('hidden');
      document.getElementById('online-timer-box').classList.add('hidden');
      this._renderSquadScreen();
      this.showScreen('screen-squad');
    });

    document.getElementById('btn-mode-online').addEventListener('click', () => {
      this.mode = 'ONLINE';
      this.showScreen('screen-lobby');
    });

    // 2. Lobby Online
    document.getElementById('btn-lobby-back').addEventListener('click', () => {
      this.net.cleanup();
      this.showScreen('screen-menu');
    });

    document.getElementById('btn-create-room').addEventListener('click', () => {
      document.getElementById('lobby-error-box').classList.add('hidden');
      this.net.createRoom();
    });

    document.getElementById('btn-copy-code').addEventListener('click', () => {
      const code = document.getElementById('host-room-code').textContent;
      navigator.clipboard?.writeText(code);
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
      document.getElementById('lobby-error-box').classList.add('hidden');
      const code = document.getElementById('input-room-code').value;
      this.net.joinRoom(code);
    });

    document.getElementById('btn-retry-net').addEventListener('click', () => {
      document.getElementById('lobby-error-box').classList.add('hidden');
      if (this.net.isHost) this.net.createRoom();
      else this.net.joinRoom(document.getElementById('input-room-code').value);
    });

    // 3. Squad Setup
    this._populateTeamSelects();
    document.getElementById('btn-squad-back').addEventListener('click', () => {
      this._stopOnlineTimer();
      this.net.cleanup();
      this.showScreen('screen-menu');
    });

    document.getElementById('btn-confirm-squad').addEventListener('click', () => this._confirmSquadAndStart());

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.poolFilter = btn.dataset.filter;
        this._renderPlayerPool();
      });
    });

    // 4. Match Controls (Pause, Penalty, Suit, End)
    document.getElementById('btn-pause-match').addEventListener('click', () => {
      if (this.mode === 'ONLINE') return;
      this.engine.paused = true;
      document.getElementById('endmatch-title').textContent = 'PERTANDINGAN DIJEDA';
      document.getElementById('final-score-text').textContent = `${this.engine.score.HOME} - ${this.engine.score.AWAY}`;
      document.getElementById('btn-resume-match').classList.remove('hidden');
      document.getElementById('endmatch-overlay').classList.remove('hidden');
    });

    document.getElementById('btn-resume-match').addEventListener('click', () => {
      this.engine.paused = false;
      document.getElementById('endmatch-overlay').classList.add('hidden');
    });

    document.getElementById('btn-back-to-menu').addEventListener('click', () => {
      this.engine.stop();
      this.net.cleanup();
      document.getElementById('endmatch-overlay').classList.add('hidden');
      this.showScreen('screen-menu');
    });

    document.querySelectorAll('.pen-target').forEach((btn) => {
      btn.addEventListener('click', () => this.engine.submitPenaltyShot(btn.dataset.zone));
    });

    document.querySelectorAll('.suit-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.engine.submitSuitChoice(btn.dataset.suit));
    });

    document.getElementById('btn-choose-kick').addEventListener('click', () => {
      this.engine.resolveGoldenBallShot('HOME');
    });

    document.getElementById('btn-choose-save').addEventListener('click', () => {
      this.engine.resolveGoldenBallShot('AWAY');
    });

    // 5. Admin Modal (Password: azzamkece26)
    this._bindAdminModal();
  }

  _populateTeamSelects() {
    const selTeam = document.getElementById('select-team');
    const selAI = document.getElementById('select-ai-team');
    selTeam.innerHTML = '';
    selAI.innerHTML = '';

    TEAMS.forEach((t) => {
      selTeam.add(new Option(`${t.name} (${t.short})`, t.id));
      selAI.add(new Option(`${t.name} (${t.short})`, t.id));
    });

    selTeam.value = this.selectedTeamId;
    selAI.value = this.aiTeamId;

    const pInput = document.getElementById('color-primary');
    const aInput = document.getElementById('color-accent');

    selTeam.addEventListener('change', () => {
      this.selectedTeamId = selTeam.value;
      const t = TEAMS.find((x) => x.id === this.selectedTeamId);
      if (t) {
        this.kitPrimary = t.primary;
        this.kitAccent = t.accent;
        pInput.value = t.primary;
        aInput.value = t.accent;
        this._updateJerseyPreview();
      }
    });

    selAI.addEventListener('change', () => {
      this.aiTeamId = selAI.value;
    });

    pInput.addEventListener('input', () => {
      this.kitPrimary = pInput.value;
      this._updateJerseyPreview();
    });

    aInput.addEventListener('input', () => {
      this.kitAccent = aInput.value;
      this._updateJerseyPreview();
    });
  }

  _updateJerseyPreview() {
    const t = TEAMS.find((x) => x.id === this.selectedTeamId) || TEAMS[0];
    const card = document.getElementById('jersey-preview');
    const stripe = document.getElementById('jersey-stripe-el');
    card.style.background = this.kitPrimary;
    stripe.style.background = this.kitAccent;
    document.getElementById('jersey-team-code').textContent = t.short;
  }

  _renderSquadScreen() {
    this._updateJerseyPreview();
    this._renderLineupSlots();
    this._renderPlayerPool();
  }

  _renderLineupSlots() {
    const box = document.getElementById('active-lineup-list');
    box.innerHTML = '';

    this.lineup.forEach((member, idx) => {
      const row = document.createElement('div');
      row.className = 'slot-row';
      row.innerHTML = `
        <span class="pos-tag ${member.role === 'GK' ? 'gk' : ''}">${member.role === 'GK' ? 'GK' : `OUT #${idx}`}</span>
        <strong>${member.name}</strong>
        <label style="font-size:0.75rem;color:#94a3b8;">No:
          <input type="number" min="1" max="99" value="${member.number}" class="jersey-num-input" data-idx="${idx}" />
        </label>
      `;
      box.appendChild(row);
    });

    box.querySelectorAll('.jersey-num-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.dataset.idx);
        this.lineup[idx].number = Number(inp.value) || 1;
        this.lineup = resolveUniqueJerseyNumbers(this.lineup);
        this._renderLineupSlots();
      });
    });
  }

  _renderPlayerPool() {
    const box = document.getElementById('player-pool-list');
    box.innerHTML = '';

    const filtered = this.playersDB.filter((p) => {
      if (this.poolFilter === 'ALL') return true;
      return p.role === this.poolFilter;
    });

    filtered.forEach((p) => {
      const inLineup = this.lineup.some((m) => m.id === p.id);
      const row = document.createElement('div');
      row.className = 'pool-row';
      const mainStat = p.role === 'GK' ? `GK:${p.stats.gkHandling}` : `SPD:${p.stats.speed} SHT:${p.stats.shoot}`;
      row.innerHTML = `
        <div>
          <span class="pos-tag ${p.role === 'GK' ? 'gk' : ''}">${p.role}</span>
          <strong style="margin-left:6px;">${p.name}</strong>
          <small class="muted" style="margin-left:6px;">(${mainStat})</small>
        </div>
        <button class="btn-small" ${inLineup ? 'disabled style="opacity:0.45;"' : ''}>
          ${inLineup ? 'Dipilih' : 'Pilih'}
        </button>
      `;

      row.querySelector('button').addEventListener('click', () => {
        if (inLineup) return;
        const freshPlayer = this.playersDB.find((x) => x.id === p.id);
        if (freshPlayer.role === 'GK') {
          this.lineup[0] = { ...freshPlayer, number: freshPlayer.defaultNumber };
        } else {
          // Ganti pemain outfield slot terakhir secara rotasi agar selalu tepat 4 outfield + 1 GK
          this.lineup.splice(1, 1);
          this.lineup.push({ ...freshPlayer, number: freshPlayer.defaultNumber });
        }
        this.lineup = resolveUniqueJerseyNumbers(this.lineup);
        this._renderLineupSlots();
        this._renderPlayerPool();
      });

      box.appendChild(row);
    });
  }

  // ==================== ONLINE TIMER 60 DETIK & SYNC ====================
  _onNetStatus(status, msg) {
    const banner = document.getElementById('net-status-banner');
    banner.className = `status-pill ${status.toLowerCase()}`;
    banner.textContent = `Status: ${msg}`;

    if (status === 'FAILED') {
      document.getElementById('lobby-error-box').classList.remove('hidden');
      document.getElementById('lobby-error-msg').textContent = msg;
    }
  }

  _enterOnlineSquadSetup() {
    this.localReady = false;
    this.remoteSquadData = null;
    document.getElementById('ai-opponent-box').classList.add('hidden');
    document.getElementById('online-timer-box').classList.remove('hidden');
    this._renderSquadScreen();
    this.showScreen('screen-squad');

    this._stopOnlineTimer();
    this.onlineSetupSeconds = 60;
    document.getElementById('online-setup-timer').textContent = '60s';

    this.onlineSetupInterval = setInterval(() => {
      this.onlineSetupSeconds -= 1;
      document.getElementById('online-setup-timer').textContent = `${Math.max(0, this.onlineSetupSeconds)}s`;
      if (this.onlineSetupSeconds <= 0) {
        this._stopOnlineTimer();
        // Otomatis kunci lineup valid & mulai pertandingan tanpa macet
        if (!this.localReady) {
          this._confirmSquadAndStart(true);
        }
      }
    }, 1000);
  }

  _stopOnlineTimer() {
    if (this.onlineSetupInterval) {
      clearInterval(this.onlineSetupInterval);
      this.onlineSetupInterval = null;
    }
  }

  _confirmSquadAndStart(forcedByTimer = false) {
    this.lineup = resolveUniqueJerseyNumbers(this.lineup);
    const myTeamMeta = TEAMS.find((t) => t.id === this.selectedTeamId) || TEAMS[0];
    const myPayload = {
      team: { ...myTeamMeta, primary: this.kitPrimary, accent: this.kitAccent },
      lineup: this.lineup,
      duration: Number(document.getElementById('select-duration').value) || 5
    };

    if (this.mode === 'AI') {
      const oppMeta = TEAMS.find((t) => t.id === this.aiTeamId) || TEAMS[1];
      const oppGK = this.playersDB.filter((p) => p.role === 'GK')[1] || this.playersDB.find((p) => p.role === 'GK');
      const oppOuts = this.playersDB.filter((p) => p.role === 'OUTFIELD').slice(4, 8);
      const oppLineup = resolveUniqueJerseyNumbers([
        { ...oppGK, number: oppGK.defaultNumber },
        ...oppOuts.map((o) => ({ ...o, number: o.defaultNumber }))
      ]);

      this._launchMatch(myPayload.team, myPayload.lineup, oppMeta, oppLineup, myPayload.duration);
      return;
    }

    // Mode ONLINE: kirim kesiapan skuad ke lawan
    this.localReady = true;
    document.getElementById('btn-confirm-squad').textContent = 'Menunggu Lawan...';
    this.net.send('SQUAD_READY', myPayload);

    if (this.remoteSquadData || forcedByTimer) {
      this._tryStartOnlineMatch(myPayload);
    }
  }

  _handleNetworkData(payload) {
    if (payload.type === 'SQUAD_READY') {
      this.remoteSquadData = payload.data;
      if (this.localReady) {
        const myTeamMeta = TEAMS.find((t) => t.id === this.selectedTeamId) || TEAMS[0];
        this._tryStartOnlineMatch({
          team: { ...myTeamMeta, primary: this.kitPrimary, accent: this.kitAccent },
          lineup: this.lineup,
          duration: Number(document.getElementById('select-duration').value) || 5
        });
      }
    } else if (payload.type === 'INPUT' && this.net.isHost) {
      this.engine.remoteInput = payload.data;
    } else if (payload.type === 'STATE' && !this.net.isHost) {
      this.engine.applyRemoteState(payload.data);
    }
  }

  _tryStartOnlineMatch(myPayload) {
    this._stopOnlineTimer();
    document.getElementById('btn-confirm-squad').textContent = 'Siap Bertanding ✔';

    const fallbackTeam = TEAMS[1];
    const fallbackLineup = this._buildDefaultLineup();
    const remote = this.remoteSquadData || { team: fallbackTeam, lineup: fallbackLineup, duration: myPayload.duration };

    const home = this.net.isHost ? myPayload : remote;
    const away = this.net.isHost ? remote : myPayload;

    document.getElementById('hud-net-indicator').classList.remove('hidden');
    this._launchMatch(home.team, home.lineup, away.team, away.lineup, home.duration);
  }

  _launchMatch(homeTeam, homeLineup, awayTeam, awayLineup, totalMinutes) {
    document.getElementById('hud-home-name').textContent = homeTeam.short;
    document.getElementById('hud-away-name').textContent = awayTeam.short;
    document.getElementById('hud-home-dot').style.background = homeTeam.primary;
    document.getElementById('hud-away-dot').style.background = awayTeam.primary;

    this.showScreen('screen-match');
    this.engine.startMatch({
      mode: this.mode,
      isHost: this.net.isHost,
      difficulty: document.getElementById('select-difficulty').value,
      totalMinutes,
      homeTeam,
      awayTeam,
      homeLineup,
      awayLineup
    });
  }

  // ==================== CALLBACKS HUD, PENALTY & SUIT ====================
  _buildEngineUICallbacks() {
    return {
      updateHUD: ({ homeScore, awayScore, clock, period }) => {
        document.getElementById('hud-home-score').textContent = homeScore;
        document.getElementById('hud-away-score').textContent = awayScore;
        document.getElementById('hud-clock').textContent = clock;
        document.getElementById('hud-period').textContent = period;
      },
      updateGauge: (visible, charge, curveBias) => {
        const box = document.getElementById('shot-gauge-container');
        if (!visible) {
          box.classList.add('hidden');
          return;
        }
        box.classList.remove('hidden');
        document.getElementById('shot-power-fill').style.width = `${Math.round(charge * 100)}%`;
        const dirText = curveBias < -0.15 ? 'CURVE: KIRI ↺' : curveBias > 0.15 ? 'CURVE: KANAN ↻' : 'CURVE: LURUS';
        document.getElementById('curve-dir-label').textContent = dirText;
      },
      showBanner: (title, sub) => {
        document.getElementById('match-banner-title').textContent = title;
        document.getElementById('match-banner-sub').textContent = sub;
        document.getElementById('match-banner').classList.remove('hidden');
      },
      hideBanner: () => {
        document.getElementById('match-banner').classList.add('hidden');
      },
      openPenaltyShootout: (penState) => {
        document.getElementById('penalty-overlay').classList.remove('hidden');
        document.getElementById('penalty-scoreboard').textContent = `Ronde ${penState.round} dari 3`;
      },
      updatePenaltyUI: (penState, homeScored, awayScored) => {
        const hStr = penState.homeResults.map((g) => (g ? '⚽' : '❌')).join(' ');
        const aStr = penState.awayResults.map((g) => (g ? '⚽' : '❌')).join(' ');
        document.getElementById('penalty-scoreboard').textContent = `HOME: [${hStr}]  |  AWAY: [${aStr}]`;
        document.getElementById('penalty-status-text').textContent =
          `Tembakanmu ${homeScored ? 'GOL!' : 'Ditepis!'} | Lawan ${awayScored ? 'GOL!' : 'Gagal!'}. Ronde ${penState.round}/3:`;
      },
      closePenaltyShootout: () => {
        document.getElementById('penalty-overlay').classList.add('hidden');
      },
      openGoldenBallSuit: () => {
        document.getElementById('suit-role-choice').classList.add('hidden');
        document.getElementById('suit-choices').classList.remove('hidden');
        document.getElementById('suit-overlay').classList.remove('hidden');
      },
      updateSuitDraw: (u, o) => {
        document.getElementById('suit-instruction').textContent = `Seri (${u} vs ${o})! Pilih suit lagi!`;
      },
      promptSuitWinnerRole: (u, o) => {
        document.getElementById('suit-choices').classList.add('hidden');
        document.getElementById('suit-role-choice').classList.remove('hidden');
        document.getElementById('suit-result-msg').textContent = `Menang Suit (${u} vs ${o})!`;
      },
      closeGoldenBallSuit: () => {
        document.getElementById('suit-overlay').classList.add('hidden');
      },
      showEndMatch: (score, reason) => {
        document.getElementById('btn-resume-match').classList.add('hidden');
        document.getElementById('endmatch-title').textContent = 'PERTANDINGAN SELESAI';
        document.getElementById('final-home-name').textContent = document.getElementById('hud-home-name').textContent;
        document.getElementById('final-away-name').textContent = document.getElementById('hud-away-name').textContent;
        document.getElementById('final-score-text').textContent = `${score.HOME} - ${score.AWAY}`;
        document.getElementById('endmatch-reason').textContent = reason;
        document.getElementById('endmatch-overlay').classList.remove('hidden');
      }
    };
  }

  // ==================== ADMIN STAT EDITOR (azzamkece26) ====================
  _bindAdminModal() {
    const modal = document.getElementById('admin-modal');
    const loginView = document.getElementById('admin-login-view');
    const editorView = document.getElementById('admin-editor-view');
    const errEl = document.getElementById('admin-error');
    const selPlayer = document.getElementById('admin-select-player');
    const formGrid = document.getElementById('admin-stats-form');

    const renderAdminStats = () => {
      const p = this.playersDB.find((x) => x.id === selPlayer.value);
      if (!p) return;
      formGrid.innerHTML = '';
      Object.entries(p.stats).forEach(([statKey, val]) => {
        const div = document.createElement('div');
        div.className = 'control-group';
        div.innerHTML = `
          <label>${statKey.toUpperCase()}</label>
          <input type="number" min="1" max="99" value="${val}" data-stat="${statKey}" />
        `;
        formGrid.appendChild(div);
      });
    };

    document.getElementById('btn-open-admin').addEventListener('click', () => {
      errEl.classList.add('hidden');
      modal.classList.remove('hidden');
    });

    document.getElementById('btn-close-admin').addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    document.getElementById('btn-submit-admin').addEventListener('click', () => {
      const pass = document.getElementById('input-admin-pass').value;
      if (pass === ADMIN_PASSWORD) {
        errEl.classList.add('hidden');
        loginView.classList.add('hidden');
        editorView.classList.remove('hidden');
        selPlayer.innerHTML = '';
        this.playersDB.forEach((p) => selPlayer.add(new Option(`${p.name} (${p.role})`, p.id)));
        renderAdminStats();
      } else {
        errEl.classList.remove('hidden');
      }
    });

    selPlayer.addEventListener('change', renderAdminStats);

    document.getElementById('btn-save-stats').addEventListener('click', () => {
      const p = this.playersDB.find((x) => x.id === selPlayer.value);
      if (!p) return;
      formGrid.querySelectorAll('input').forEach((inp) => {
        p.stats[inp.dataset.stat] = clamp(Number(inp.value) || 75, 1, 99);
      });
      // Sinkronkan juga ke lineup aktif jika pemain sedang dipilih
      const inLineup = this.lineup.find((m) => m.id === p.id);
      if (inLineup) inLineup.stats = { ...p.stats };
      modal.classList.add('hidden');
    });

    document.getElementById('btn-reset-stats').addEventListener('click', () => {
      this.playersDB = JSON.parse(JSON.stringify(INITIAL_PLAYERS));
      renderAdminStats();
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.futsalApp = new FutsalApp();
});
