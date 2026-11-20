import { ADMIN_PASSWORD, INITIAL_PLAYERS, TEAMS } from './data.js';
import { InputManager } from './input.js';
import { GameRenderer } from './renderer.js';
import { NetworkManager } from './network.js';
import { MatchEngine } from './engine.js';
import { clamp, resolveUniqueJerseyNumbers } from './utils.js';

function $(id) {
  return document.getElementById(id);
}

class FutsalApp {
  constructor() {
    this.playersDB = JSON.parse(JSON.stringify(INITIAL_PLAYERS));
    this.mode = 'AI';
    this.poolFilter = 'ALL';

    this.selectedTeamId = 'EVR';
    this.aiTeamId = 'VDL';
    this.kitPrimary = '#00e5ff';
    this.kitAccent = '#0f172a';
    this.lineup = this._buildDefaultLineup();

    this.onlineSetupInterval = null;
    this.onlineSetupSeconds = 60;
    this.localReady = false;
    this.remoteSquadData = null;

    this.input = new InputManager();
    this.renderer = new GameRenderer($('game-canvas'));
    this.net = new NetworkManager({
      onStatusChange: (status, msg) => this._onNetStatus(status, msg),
      onRoomCreated: (code) => {
        $('room-code-display')?.classList.remove('hidden');
        if ($('host-room-code')) $('host-room-code').textContent = code;
      },
      onConnected: () => this._enterOnlineSquadSetup(),
      onData: (payload) => this._handleNetworkData(payload),
      onDisconnected: () => {
        if (this.engine.running) {
          this.engine.stop();
          this.showScreen('screen-menu');
        }
      }
    });

    this.engine = new MatchEngine(this.renderer, this.input, this.net, this._buildEngineUICallbacks());

    this._initUI();
  }

  _buildDefaultLineup() {
    const gk = this.playersDB.find((p) => p.role === 'GK') || INITIAL_PLAYERS.find((p) => p.role === 'GK');
    const outs = this.playersDB.filter((p) => p.role === 'OUTFIELD').slice(0, 4);
    return resolveUniqueJerseyNumbers([
      { ...gk, number: gk.defaultNumber },
      ...outs.map((o) => ({ ...o, number: o.defaultNumber }))
    ]);
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    const target = $(screenId);
    if (target) target.classList.add('active');
    if (screenId === 'screen-match') {
      requestAnimationFrame(() => this.renderer.resize());
    }
  }

  _initUI() {
    // 1. Menu Utama (VS AI BOT & ONLINE)
    $('btn-mode-ai')?.addEventListener('click', () => {
      this.mode = 'AI';
      this.net.cleanup();
      $('ai-opponent-box')?.classList.remove('hidden');
      $('online-timer-box')?.classList.add('hidden');
      if ($('hud-net-indicator')) $('hud-net-indicator').classList.add('hidden');
      this._renderSquadScreen();
      this.showScreen('screen-squad');
    });

    $('btn-mode-online')?.addEventListener('click', () => {
      this.mode = 'ONLINE';
      this.showScreen('screen-lobby');
    });

    // 2. Lobby Online
    $('btn-lobby-back')?.addEventListener('click', () => {
      this.net.cleanup();
      this.showScreen('screen-menu');
    });

    $('btn-create-room')?.addEventListener('click', () => {
      $('lobby-error-box')?.classList.add('hidden');
      this.net.createRoom();
    });

    $('btn-copy-code')?.addEventListener('click', () => {
      const code = $('host-room-code')?.textContent || '';
      if (code) navigator.clipboard?.writeText(code).catch(() => {});
    });

    $('btn-join-room')?.addEventListener('click', () => {
      $('lobby-error-box')?.classList.add('hidden');
      const code = $('input-room-code')?.value || '';
      this.net.joinRoom(code);
    });

    $('btn-retry-net')?.addEventListener('click', () => {
      $('lobby-error-box')?.classList.add('hidden');
      if (this.net.isHost) this.net.createRoom();
      else this.net.joinRoom($('input-room-code')?.value || '');
    });

    // 3. Squad Setup
    this._populateTeamSelects();

    $('btn-squad-back')?.addEventListener('click', () => {
      this._stopOnlineTimer();
      this.net.cleanup();
      this.showScreen('screen-menu');
    });

    $('btn-confirm-squad')?.addEventListener('click', () => {
      this._confirmSquadAndStart(false);
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.poolFilter = btn.dataset.filter || 'ALL';
        this._renderPlayerPool();
      });
    });

    // 4. Match Controls
    $('btn-pause-match')?.addEventListener('click', () => {
      if (this.mode === 'ONLINE') return;
      this.engine.paused = true;
      if ($('endmatch-title')) $('endmatch-title').textContent = 'PERTANDINGAN DIJEDA';
      if ($('final-score-text')) $('final-score-text').textContent = `${this.engine.score.HOME} - ${this.engine.score.AWAY}`;
      $('btn-resume-match')?.classList.remove('hidden');
      $('endmatch-overlay')?.classList.remove('hidden');
    });

    $('btn-resume-match')?.addEventListener('click', () => {
      this.engine.paused = false;
      $('endmatch-overlay')?.classList.add('hidden');
    });

    $('btn-back-to-menu')?.addEventListener('click', () => {
      this.engine.stop();
      this.net.cleanup();
      $('endmatch-overlay')?.classList.add('hidden');
      this.showScreen('screen-menu');
    });

    document.querySelectorAll('.pen-target').forEach((btn) => {
      btn.addEventListener('click', () => this.engine.submitPenaltyShot(btn.dataset.zone));
    });

    document.querySelectorAll('.suit-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.engine.submitSuitChoice(btn.dataset.suit));
    });

    $('btn-choose-kick')?.addEventListener('click', () => {
      this.engine.resolveGoldenBallShot('HOME');
    });

    $('btn-choose-save')?.addEventListener('click', () => {
      this.engine.resolveGoldenBallShot('AWAY');
    });

    // 5. Admin Modal
    this._bindAdminModal();
  }

  _populateTeamSelects() {
    const selTeam = $('select-team');
    const selAI = $('select-ai-team');
    if (!selTeam || !selAI) return;

    selTeam.innerHTML = '';
    selAI.innerHTML = '';

    TEAMS.forEach((t) => {
      selTeam.add(new Option(`${t.name} (${t.short})`, t.id));
      selAI.add(new Option(`${t.name} (${t.short})`, t.id));
    });

    selTeam.value = this.selectedTeamId;
    selAI.value = this.aiTeamId;

    const pInput = $('color-primary');
    const aInput = $('color-accent');

    selTeam.addEventListener('change', () => {
      this.selectedTeamId = selTeam.value;
      const t = TEAMS.find((x) => x.id === this.selectedTeamId);
      if (t) {
        this.kitPrimary = t.primary;
        this.kitAccent = t.accent;
        if (pInput) pInput.value = t.primary;
        if (aInput) aInput.value = t.accent;
        this._updateJerseyPreview();
      }
    });

    selAI.addEventListener('change', () => {
      this.aiTeamId = selAI.value;
    });

    pInput?.addEventListener('input', () => {
      this.kitPrimary = pInput.value;
      this._updateJerseyPreview();
    });

    aInput?.addEventListener('input', () => {
      this.kitAccent = aInput.value;
      this._updateJerseyPreview();
    });
  }

  _updateJerseyPreview() {
    const t = TEAMS.find((x) => x.id === this.selectedTeamId) || TEAMS[0];
    const card = $('jersey-preview');
    const stripe = $('jersey-stripe-el');
    const codeEl = $('jersey-team-code');
    if (card) card.style.background = this.kitPrimary;
    if (stripe) stripe.style.background = this.kitAccent;
    if (codeEl) codeEl.textContent = t.short;
  }

  _renderSquadScreen() {
    this._updateJerseyPreview();
    this._renderLineupSlots();
    this._renderPlayerPool();
  }

  _renderLineupSlots() {
    const box = $('active-lineup-list');
    if (!box) return;
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
        if (!this.lineup[idx]) return;
        this.lineup[idx].number = Number(inp.value) || 1;
        this.lineup = resolveUniqueJerseyNumbers(this.lineup);
        this._renderLineupSlots();
      });
    });
  }

  _renderPlayerPool() {
    const box = $('player-pool-list');
    if (!box) return;
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

      row.querySelector('button')?.addEventListener('click', () => {
        if (inLineup) return;
        const freshPlayer = this.playersDB.find((x) => x.id === p.id);
        if (!freshPlayer) return;
        if (freshPlayer.role === 'GK') {
          this.lineup[0] = { ...freshPlayer, number: freshPlayer.defaultNumber };
        } else {
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

  _onNetStatus(status, msg) {
    const banner = $('net-status-banner');
    if (banner) {
      banner.className = `status-pill ${status.toLowerCase()}`;
      banner.textContent = `Status: ${msg}`;
    }

    if (status === 'FAILED') {
      $('lobby-error-box')?.classList.remove('hidden');
      if ($('lobby-error-msg')) $('lobby-error-msg').textContent = msg;
    }
  }

  _enterOnlineSquadSetup() {
    this.localReady = false;
    this.remoteSquadData = null;
    $('ai-opponent-box')?.classList.add('hidden');
    $('online-timer-box')?.classList.remove('hidden');
    this._renderSquadScreen();
    this.showScreen('screen-squad');

    this._stopOnlineTimer();
    this.onlineSetupSeconds = 60;
    if ($('online-setup-timer')) $('online-setup-timer').textContent = '60s';

    this.onlineSetupInterval = setInterval(() => {
      this.onlineSetupSeconds -= 1;
      if ($('online-setup-timer')) {
        $('online-setup-timer').textContent = `${Math.max(0, this.onlineSetupSeconds)}s`;
      }
      if (this.onlineSetupSeconds <= 0) {
        this._stopOnlineTimer();
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
    this._stopOnlineTimer();
    this.lineup = resolveUniqueJerseyNumbers(this.lineup);
    const myTeamMeta = TEAMS.find((t) => t.id === this.selectedTeamId) || TEAMS[0];
    const duration = Number($('select-duration')?.value) || 5;

    const myPayload = {
      team: { ...myTeamMeta, primary: this.kitPrimary, accent: this.kitAccent },
      lineup: this.lineup,
      duration
    };

    if (this.mode === 'AI') {
      const oppMeta = TEAMS.find((t) => t.id === this.aiTeamId) || TEAMS[1];
      const allGKs = this.playersDB.filter((p) => p.role === 'GK');
      const oppGK = allGKs.find((g) => g.id !== this.lineup[0]?.id) || allGKs[0];
      const lineupIds = new Set(this.lineup.map((m) => m.id));
      const oppOuts = this.playersDB.filter((p) => p.role === 'OUTFIELD' && !lineupIds.has(p.id)).slice(0, 4);

      const oppLineup = resolveUniqueJerseyNumbers([
        { ...oppGK, number: oppGK.defaultNumber },
        ...oppOuts.map((o) => ({ ...o, number: o.defaultNumber }))
      ]);

      this._launchMatch(myPayload.team, myPayload.lineup, oppMeta, oppLineup, myPayload.duration);
      return;
    }

    this.localReady = true;
    if ($('btn-confirm-squad')) $('btn-confirm-squad').textContent = 'Menunggu Lawan...';
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
          duration: Number($('select-duration')?.value) || 5
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
    if ($('btn-confirm-squad')) $('btn-confirm-squad').textContent = 'Siap Bertanding ✔';

    const fallbackTeam = TEAMS[1];
    const fallbackLineup = this._buildDefaultLineup();
    const remote = this.remoteSquadData || { team: fallbackTeam, lineup: fallbackLineup, duration: myPayload.duration };

    const home = this.net.isHost ? myPayload : remote;
    const away = this.net.isHost ? remote : myPayload;

    $('hud-net-indicator')?.classList.remove('hidden');
    this._launchMatch(home.team, home.lineup, away.team, away.lineup, home.duration);
  }

  _launchMatch(homeTeam, homeLineup, awayTeam, awayLineup, totalMinutes) {
    if ($('hud-home-name')) $('hud-home-name').textContent = homeTeam.short;
    if ($('hud-away-name')) $('hud-away-name').textContent = awayTeam.short;
    if ($('hud-home-dot')) $('hud-home-dot').style.background = homeTeam.primary;
    if ($('hud-away-dot')) $('hud-away-dot').style.background = awayTeam.primary;

    this.showScreen('screen-match');
    this.engine.startMatch({
      mode: this.mode,
      isHost: this.net.isHost,
      difficulty: $('select-difficulty')?.value || 'pro',
      totalMinutes,
      homeTeam,
      awayTeam,
      homeLineup,
      awayLineup
    });
  }

  _buildEngineUICallbacks() {
    return {
      updateHUD: ({ homeScore, awayScore, clock, period }) => {
        if ($('hud-home-score')) $('hud-home-score').textContent = homeScore;
        if ($('hud-away-score')) $('hud-away-score').textContent = awayScore;
        if ($('hud-clock')) $('hud-clock').textContent = clock;
        if ($('hud-period')) $('hud-period').textContent = period;
      },
      updateGauge: (visible, charge, curveBias) => {
        const box = $('shot-gauge-container');
        if (!box) return;
        if (!visible) {
          box.classList.add('hidden');
          return;
        }
        box.classList.remove('hidden');
        if ($('shot-power-fill')) $('shot-power-fill').style.width = `${Math.round(charge * 100)}%`;
        const dirText = curveBias < -0.15 ? 'CURVE: KIRI ↺' : curveBias > 0.15 ? 'CURVE: KANAN ↻' : 'CURVE: LURUS';
        if ($('curve-dir-label')) $('curve-dir-label').textContent = dirText;
      },
      showBanner: (title, sub) => {
        if ($('match-banner-title')) $('match-banner-title').textContent = title;
        if ($('match-banner-sub')) $('match-banner-sub').textContent = sub;
        $('match-banner')?.classList.remove('hidden');
      },
      hideBanner: () => {
        $('match-banner')?.classList.add('hidden');
      },
      openPenaltyShootout: (penState) => {
        $('penalty-overlay')?.classList.remove('hidden');
        if ($('penalty-scoreboard')) $('penalty-scoreboard').textContent = `Ronde ${penState.round} dari 3`;
      },
      updatePenaltyUI: (penState, homeScored, awayScored) => {
        const hStr = penState.homeResults.map((g) => (g ? '⚽' : '❌')).join(' ');
        const aStr = penState.awayResults.map((g) => (g ? '⚽' : '❌')).join(' ');
        if ($('penalty-scoreboard')) $('penalty-scoreboard').textContent = `HOME: [${hStr}]  |  AWAY: [${aStr}]`;
        if ($('penalty-status-text')) {
          $('penalty-status-text').textContent =
            `Tembakanmu ${homeScored ? 'GOL!' : 'Ditepis!'} | Lawan ${awayScored ? 'GOL!' : 'Gagal!'}. Ronde ${penState.round}/3:`;
        }
      },
      closePenaltyShootout: () => {
        $('penalty-overlay')?.classList.add('hidden');
      },
      openGoldenBallSuit: () => {
        $('suit-role-choice')?.classList.add('hidden');
        $('suit-choices')?.classList.remove('hidden');
        $('suit-overlay')?.classList.remove('hidden');
      },
      updateSuitDraw: (u, o) => {
        if ($('suit-instruction')) $('suit-instruction').textContent = `Seri (${u} vs ${o})! Pilih suit lagi!`;
      },
      promptSuitWinnerRole: (u, o) => {
        $('suit-choices')?.classList.add('hidden');
        $('suit-role-choice')?.classList.remove('hidden');
        if ($('suit-result-msg')) $('suit-result-msg').textContent = `Menang Suit (${u} vs ${o})!`;
      },
      closeGoldenBallSuit: () => {
        $('suit-overlay')?.classList.add('hidden');
      },
      showEndMatch: (score, reason) => {
        $('btn-resume-match')?.classList.add('hidden');
        if ($('endmatch-title')) $('endmatch-title').textContent = 'PERTANDINGAN SELESAI';
        if ($('final-home-name')) $('final-home-name').textContent = $('hud-home-name')?.textContent || 'HOME';
        if ($('final-away-name')) $('final-away-name').textContent = $('hud-away-name')?.textContent || 'AWAY';
        if ($('final-score-text')) $('final-score-text').textContent = `${score.HOME} - ${score.AWAY}`;
        if ($('endmatch-reason')) $('endmatch-reason').textContent = reason;
        $('endmatch-overlay')?.classList.remove('hidden');
      }
    };
  }

  _bindAdminModal() {
    const modal = $('admin-modal');
    const loginView = $('admin-login-view');
    const editorView = $('admin-editor-view');
    const errEl = $('admin-error');
    const selPlayer = $('admin-select-player');
    const formGrid = $('admin-stats-form');

    const renderAdminStats = () => {
      const p = this.playersDB.find((x) => x.id === selPlayer?.value);
      if (!p || !formGrid) return;
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

    $('btn-open-admin')?.addEventListener('click', () => {
      errEl?.classList.add('hidden');
      modal?.classList.remove('hidden');
    });

    $('btn-close-admin')?.addEventListener('click', () => {
      modal?.classList.add('hidden');
    });

    $('btn-submit-admin')?.addEventListener('click', () => {
      const pass = $('input-admin-pass')?.value || '';
      if (pass === ADMIN_PASSWORD) {
        errEl?.classList.add('hidden');
        loginView?.classList.add('hidden');
        editorView?.classList.remove('hidden');
        if (selPlayer) {
          selPlayer.innerHTML = '';
          this.playersDB.forEach((p) => selPlayer.add(new Option(`${p.name} (${p.role})`, p.id)));
        }
        renderAdminStats();
      } else {
        errEl?.classList.remove('hidden');
      }
    });

    selPlayer?.addEventListener('change', renderAdminStats);

    $('btn-save-stats')?.addEventListener('click', () => {
      const p = this.playersDB.find((x) => x.id === selPlayer?.value);
      if (!p || !formGrid) return;
      formGrid.querySelectorAll('input').forEach((inp) => {
        p.stats[inp.dataset.stat] = clamp(Number(inp.value) || 75, 1, 99);
      });
      const inLineup = this.lineup.find((m) => m.id === p.id);
      if (inLineup) inLineup.stats = { ...p.stats };
      modal?.classList.add('hidden');
    });

    $('btn-reset-stats')?.addEventListener('click', () => {
      this.playersDB = JSON.parse(JSON.stringify(INITIAL_PLAYERS));
      renderAdminStats();
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.futsalApp = new FutsalApp();
});
