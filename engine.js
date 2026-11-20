import { FIELD, OUTFIELD_POSITIONS } from './data.js';
import { PhysicsEngine } from './physics.js';
import { TacticalAI } from './ai.js';
import { clamp, dist, formatTime, normalize } from './utils.js';

export class MatchEngine {
  constructor(renderer, inputManager, networkManager, uiCallbacks) {
    this.renderer = renderer;
    this.input = inputManager;
    this.net = networkManager;
    this.ui = uiCallbacks;

    this.physics = new PhysicsEngine();
    this.ai = new TacticalAI();

    this.running = false;
    this.paused = false;
    this.rafId = null;
    this.lastTimestamp = 0;

    this.mode = 'AI'; // 'AI' | 'ONLINE'
    this.isHost = true;
    this.difficulty = 'pro';

    this.matchConfig = {
      totalMinutes: 5,
      homeTeam: null,
      awayTeam: null
    };

    // State Machine: HALF_1 -> HALF_2 -> EXTRA_TIME -> PENALTY -> SUIT -> FINISHED
    this.phase = 'HALF_1';
    this.phaseTimeLeft = 150;
    this.bannerTimer = 0;
    this.score = { HOME: 0, AWAY: 0 };

    this.players = [];
    this.ball = null;
    this.activePlayerIds = { HOME: null, AWAY: null };
    this.remoteInput = { moveX: 0, moveY: 0, sprint: false };

    // State Adu Penalti (3 Penendang) & Suit Golden Ball
    this.penaltyState = { round: 1, maxRounds: 3, homeResults: [], awayResults: [], turn: 'HOME' };
    this.suitState = { homeChoice: null, awayChoice: null, winner: null, shooterTeam: null };
  }

  startMatch(config) {
    this.stop();
    this.mode = config.mode || 'AI';
    this.isHost = config.isHost !== false;
    this.difficulty = config.difficulty || 'pro';
    this.matchConfig = config;

    this.score = { HOME: 0, AWAY: 0 };
    this.phase = 'HALF_1';
    this.phaseTimeLeft = (clamp(config.totalMinutes, 3, 7) * 60) / 2;
    this.paused = false;

    this._buildPlayers(config.homeLineup, config.awayLineup);
    this._resetKickoff('HOME');
    this._showBanner('KICK OFF!', 'Babak 1 Dimulai');

    this.renderer.resize();
    this.running = true;
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _buildPlayers(homeLineup, awayLineup) {
    this.players = [];
    const buildSide = (lineup, side) => {
      let outIdx = 0;
      lineup.forEach((p) => {
        const isGK = p.role === 'GK';
        const tacticalPos = isGK ? 'GK' : OUTFIELD_POSITIONS[outIdx++ % OUTFIELD_POSITIONS.length];
        this.players.push({
          ...p,
          id: `${side}_${p.id}`,
          team: side,
          tacticalPos,
          x: FIELD.WIDTH / 2,
          y: FIELD.HEIGHT / 2,
          vx: 0,
          vy: 0,
          facingX: side === 'HOME' ? 1 : -1,
          facingY: 0,
          aiCooldown: 0
        });
      });
    };

    buildSide(homeLineup, 'HOME');
    buildSide(awayLineup, 'AWAY');

    this.activePlayerIds.HOME = this.players.find((p) => p.team === 'HOME' && p.role !== 'GK')?.id || null;
    this.activePlayerIds.AWAY = this.players.find((p) => p.team === 'AWAY' && p.role !== 'GK')?.id || null;
  }

  _resetKickoff(kickoffTeam) {
    const cx = FIELD.WIDTH / 2;
    const cy = FIELD.HEIGHT / 2;
    const isSecondHalf = this.phase === 'HALF_2';

    this.players.forEach((p) => {
      const sideSign = (p.team === 'HOME' ? -1 : 1) * (isSecondHalf ? -1 : 1);
      p.vx = 0;
      p.vy = 0;
      p.facingX = -sideSign;
      p.facingY = 0;

      if (p.role === 'GK') {
        p.x = cx + sideSign * (FIELD.WIDTH / 2 - FIELD.MARGIN_X - 18);
        p.y = cy;
      } else if (p.tacticalPos === 'ANCHOR') {
        p.x = cx + sideSign * 210;
        p.y = cy;
      } else if (p.tacticalPos === 'PIVOT') {
        p.x = cx + sideSign * 45;
        p.y = cy;
      } else if (p.tacticalPos === 'FLANK_R') {
        p.x = cx + sideSign * 110;
        p.y = cy + 125;
      } else {
        p.x = cx + sideSign * 110;
        p.y = cy - 125;
      }
    });

    const kicker = this.players.find((p) => p.team === kickoffTeam && p.role !== 'GK');
    if (kicker) {
      kicker.x = cx;
      kicker.y = cy;
      this.activePlayerIds[kickoffTeam] = kicker.id;
    }

    this.ball = {
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      spin: 0,
      ownerId: kicker ? kicker.id : null,
      lastTouchId: kicker ? kicker.id : null,
      lastTouchTeam: kickoffTeam,
      pickupCooldown: 0,
      trail: []
    };
  }

  _loop(timestamp) {
    if (!this.running) return;
    // Clamp dt maksimal 0.05s (20 FPS floor) agar stabil di layar 60Hz hingga 120Hz
    const dt = clamp((timestamp - this.lastTimestamp) / 1000, 0.001, 0.05);
    this.lastTimestamp = timestamp;

    try {
      if (!this.paused) {
        this._update(dt);
      }
      this._renderFrame();
    } catch (err) {
      // Guardrail: tangkap anomaly agar loop tidak pernah crash fatal
      console.warn('[MatchEngine Safe Guard]:', err);
    }

    this.rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  _update(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.ui.hideBanner?.();
    }

    // Jika sedang dalam fase Adu Penalti atau Suit Golden Ball, hentikan fisika lapangan
    if (this.phase === 'PENALTY' || this.phase === 'SUIT' || this.phase === 'FINISHED') {
      return;
    }

    // Update Timer Babak
    this.phaseTimeLeft -= dt;
    if (this.phaseTimeLeft <= 0) {
      this._handlePeriodEnd();
      return;
    }

    // Input lokal
    this.input.update(dt);
    const localTrigger = this.input.consumeTriggers();
    const mySide = this.mode === 'ONLINE' && !this.isHost ? 'AWAY' : 'HOME';

    // Update Power Gauge UI
    this.ui.updateGauge?.(localTrigger.shootHeld, localTrigger.shootCharge, localTrigger.curveBias);

    // Dalam mode ONLINE, Guest mengirim input ke Host dan menerima state otoritatif
    if (this.mode === 'ONLINE' && !this.isHost) {
      this.net.send('INPUT', localTrigger);
      this._updateHUD();
      return;
    }

    // Terapkan kontrol pemain manusia (HOME)
    this._applyPlayerControl('HOME', localTrigger);

    // Terapkan kontrol lawan (Guest Online atau AI Bot)
    if (this.mode === 'ONLINE') {
      this._applyPlayerControl('AWAY', this.remoteInput);
      this.ai.updateTeamAI('AWAY', this.players, this.ball, this.activePlayerIds.AWAY, 'pro', dt);
    } else {
      this.ai.updateTeamAI('AWAY', this.players, this.ball, null, this.difficulty, dt);
    }

    // AI rekan setim HOME (kecuali pemain aktif yang dikendalikan user)
    this.ai.updateTeamAI('HOME', this.players, this.ball, this.activePlayerIds.HOME, 'pro', dt);

    // Eksekusi aksi AI yang ingin menendang / mengoper
    this._processAIActions();

    // Update Fisika Bola & Tabrakan Pemain
    this.physics.updateBall(this.ball, this.players, dt, (event) => this._handleMatchEvent(event));
    this.physics.resolvePlayers(this.players, dt);

    // Otomatis ganti pemain aktif ke rekan terdekat bola saat bertahan
    const owner = this.players.find((p) => p.id === this.ball.ownerId);
    if (owner && owner.team === 'HOME' && owner.role !== 'GK') {
      this.activePlayerIds.HOME = owner.id;
    }

    // Sinkronisasi state ke Guest jika Online Host
    if (this.mode === 'ONLINE' && this.isHost) {
      this.net.send('STATE', this.serializeState());
    }

    this._updateHUD();
  }

  _applyPlayerControl(side, trig) {
    if (!trig) return;
    if (trig.justSwitch) {
      this._switchActivePlayer(side);
    }

    const active = this.players.find((p) => p.id === this.activePlayerIds[side]);
    if (!active) return;

    const spdStat = active.stats.speed || 80;
    const sprintMult = trig.sprint ? 1.32 : 1.0;
    const moveSpd = (155 + spdStat * 1.25) * sprintMult;

    active.vx = trig.moveX * moveSpd;
    active.vy = trig.moveY * moveSpd;
    if (Math.hypot(trig.moveX, trig.moveY) > 0.1) {
      const n = normalize(trig.moveX, trig.moveY);
      active.facingX = n.x;
      active.facingY = n.y;
    }

    // Jika pemain aktif ini menguasai bola, proses Oper, Terobosan, atau Tendang Curve
    if (this.ball.ownerId === active.id) {
      if (trig.justPass) {
        this._kickPass(active, false);
      } else if (trig.justThrough) {
        this._kickPass(active, true);
      } else if (trig.justShootRelease) {
        this._kickShoot(active, trig.shootCharge || 0.6, trig.curveBias || 0);
      }
    }
  }

  _processAIActions() {
    for (const p of this.players) {
      if (p._wantsShoot && this.ball.ownerId === p.id) {
        p._wantsShoot = false;
        this._kickShoot(p, 0.78, p._aiCurveBias || 0);
      }
      if (p._wantsPass && this.ball.ownerId === p.id) {
        p._wantsPass = false;
        this._kickPass(p, false);
      }
    }
  }

  _switchActivePlayer(side) {
    const candidates = this.players.filter((p) => p.team === side && p.role !== 'GK');
    candidates.sort((a, b) => dist(a.x, a.y, this.ball.x, this.ball.y) - dist(b.x, b.y, this.ball.x, this.ball.y));
    const next = candidates.find((c) => c.id !== this.activePlayerIds[side]) || candidates[0];
    if (next) this.activePlayerIds[side] = next.id;
  }

  _kickPass(passer, isThrough) {
    const mates = this.players.filter((p) => p.team === passer.team && p.id !== passer.id);
    let bestMate = null;
    let bestScore = -Infinity;

    for (const m of mates) {
      const d = dist(passer.x, passer.y, m.x, m.y);
      if (d < 35) continue;
      const toMate = normalize(m.x - passer.x, m.y - passer.y);
      const align = toMate.x * passer.facingX + toMate.y * passer.facingY;
      const score = align * 150 - d * 0.25;
      if (score > bestScore) {
        bestScore = score;
        bestMate = m;
      }
    }

    const attackDir = passer.team === 'HOME' ? 1 : -1;
    let targetX = bestMate ? bestMate.x : passer.x + passer.facingX * 180;
    let targetY = bestMate ? bestMate.y : passer.y + passer.facingY * 180;

    if (isThrough && bestMate) {
      targetX += attackDir * 75;
    }

    const dir = normalize(targetX - this.ball.x, targetY - this.ball.y);
    const passPower = (isThrough ? 430 : 370) + (passer.stats.pass || 80) * 1.4;

    this.ball.ownerId = null;
    this.ball.lastTouchId = passer.id;
    this.ball.lastTouchTeam = passer.team;
    this.ball.vx = dir.x * passPower;
    this.ball.vy = dir.y * passPower;
    this.ball.spin = 0;
    this.ball.pickupCooldown = 0.14;

    if (bestMate && bestMate.role !== 'GK') {
      this.activePlayerIds[passer.team] = bestMate.id;
    }
  }

  /**
   * Tendangan + Efek Curve (Tendangan Pisang) dipengaruhi stat shoot & dribble.
   */
  _kickShoot(shooter, powerRatio, curveBias) {
    const isSecondHalf = this.phase === 'HALF_2';
    const targetGoalX = (shooter.team === 'HOME' ? !isSecondHalf : isSecondHalf)
      ? FIELD.WIDTH - FIELD.MARGIN_X
      : FIELD.MARGIN_X;

    // Sedikit arahkan ke dalam mulut gawang berdasarkan input arah vertikal pemain
    const aimY = clamp(FIELD.HEIGHT / 2 + shooter.facingY * 46, FIELD.HEIGHT / 2 - 48, FIELD.HEIGHT / 2 + 48);
    const dir = normalize(targetGoalX - this.ball.x, aimY - this.ball.y);

    const shootStat = shooter.stats.shoot || 80;
    const dribbleStat = shooter.stats.dribble || 80;
    const baseSpeed = 480 + shootStat * 2.4 + clamp(powerRatio, 0.2, 1) * 230;
    const curveCapability = ((shootStat + dribbleStat) / 200) * 1.35;

    this.ball.ownerId = null;
    this.ball.lastTouchId = shooter.id;
    this.ball.lastTouchTeam = shooter.team;
    this.ball.vx = dir.x * baseSpeed;
    this.ball.vy = dir.y * baseSpeed;
    this.ball.spin = clamp(curveBias, -1, 1) * curveCapability;
    this.ball.pickupCooldown = 0.16;
  }

  _handleMatchEvent(ev) {
    if (!ev) return;

    if (ev.type === 'GOAL') {
      this.score[ev.scoringTeam] += 1;
      const scorer = this.players.find((p) => p.id === ev.scorerId);
      this._showBanner('⚽ GOOOAAAL!', scorer ? `Dicetak oleh ${scorer.name} (#${scorer.number})` : 'Gol Indah!');
      const concedeTeam = ev.scoringTeam === 'HOME' ? 'AWAY' : 'HOME';
      this._resetKickoff(concedeTeam);
      return;
    }

    // Set Piece Futsal: OUT (Kick-In), CORNER, GOAL_KICK, HANDBALL (Free Kick)
    const labelMap = {
      OUT: 'OUT — KICK IN FUTSAL',
      CORNER: 'TENDANGAN POJOK (CORNER)',
      GOAL_KICK: 'BOLA KIPER (GOAL KICK)',
      HANDBALL: `HANDBALL (${ev.offender || 'Pelanggaran'}) — FREE KICK`
    };

    this._showBanner(labelMap[ev.type] || 'SET PIECE', `Bola untuk tim ${ev.team}`);
    const taker = this.players.find((p) => p.team === ev.team && (ev.type === 'GOAL_KICK' ? p.role === 'GK' : p.role !== 'GK'));
    if (taker) {
      taker.x = ev.x;
      taker.y = ev.y;
      this.ball.x = ev.x;
      this.ball.y = ev.y;
      this.ball.vx = 0;
      this.ball.vy = 0;
      this.ball.spin = 0;
      this.ball.ownerId = taker.id;
      this.ball.lastTouchId = taker.id;
      this.ball.lastTouchTeam = ev.team;
      if (taker.role !== 'GK') this.activePlayerIds[ev.team] = taker.id;
    }
  }

  _handlePeriodEnd() {
    if (this.phase === 'HALF_1') {
      this.phase = 'HALF_2';
      this.phaseTimeLeft = (this.matchConfig.totalMinutes * 60) / 2;
      this._resetKickoff('AWAY');
      this._showBanner('BABAK KEDUA DIMULAI', 'Pergantian sisi lapangan!');
      return;
    }

    if (this.phase === 'HALF_2') {
      if (this.score.HOME !== this.score.AWAY) {
        this._finishMatch('Full Time (2 Babak)');
      } else {
        // Seri -> Babak Tambahan 2 Menit
        this.phase = 'EXTRA_TIME';
        this.phaseTimeLeft = 120;
        this._resetKickoff('HOME');
        this._showBanner('EXTRA TIME (2 MENIT)', 'Skor imbang! Babak tambahan dimulai.');
      }
      return;
    }

    if (this.phase === 'EXTRA_TIME') {
      if (this.score.HOME !== this.score.AWAY) {
        this._finishMatch('Selesai Setelah Extra Time');
      } else {
        // Masih Seri -> Adu Penalti 3 Penendang
        this.phase = 'PENALTY';
        this.penaltyState = { round: 1, maxRounds: 3, homeResults: [], awayResults: [], turn: 'HOME' };
        this.ui.openPenaltyShootout?.(this.penaltyState);
      }
    }
  }

  /**
   * Resolusi satu tembakan Adu Penalti (3 penendang per tim).
   */
  submitPenaltyShot(zone) {
    if (this.phase !== 'PENALTY') return;
    const zones = ['TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'BOT_LEFT', 'BOT_CENTER', 'BOT_RIGHT'];
    const keeperDive = zones[Math.floor(Math.random() * zones.length)];
    const isGoal = zone !== keeperDive && Math.random() < 0.82;

    this.penaltyState.homeResults.push(isGoal);

    // Giliran AI / Lawan menendang pada ronde yang sama
    const aiShot = zones[Math.floor(Math.random() * zones.length)];
    const aiGoal = Math.random() < 0.72 && aiShot !== zone;
    this.penaltyState.awayResults.push(aiGoal);

    if (this.penaltyState.round >= this.penaltyState.maxRounds) {
      const hGoals = this.penaltyState.homeResults.filter(Boolean).length;
      const aGoals = this.penaltyState.awayResults.filter(Boolean).length;
      this.ui.closePenaltyShootout?.();

      if (hGoals !== aGoals) {
        this.score.HOME += hGoals;
        this.score.AWAY += aGoals;
        this._finishMatch(`Menang Adu Penalti (${hGoals} - ${aGoals})`);
      } else {
        // Masih imbang -> Lanjut ke Golden Ball Suit!
        this.phase = 'SUIT';
        this.suitState = { homeChoice: null, awayChoice: null, winner: null, shooterTeam: null };
        this.ui.openGoldenBallSuit?.();
      }
    } else {
      this.penaltyState.round += 1;
      this.ui.updatePenaltyUI?.(this.penaltyState, isGoal, aiGoal);
    }
  }

  /**
   * Resolusi Suit Golden Ball (Batu, Gunting, Kertas).
   */
  submitSuitChoice(userChoice) {
    if (this.phase !== 'SUIT') return;
    const opts = ['BATU', 'GUNTING', 'KERTAS'];
    const oppChoice = opts[Math.floor(Math.random() * opts.length)];

    if (userChoice === oppChoice) {
      this.ui.updateSuitDraw?.(userChoice, oppChoice);
      return;
    }

    const userWins =
      (userChoice === 'BATU' && oppChoice === 'GUNTING') ||
      (userChoice === 'GUNTING' && oppChoice === 'KERTAS') ||
      (userChoice === 'KERTAS' && oppChoice === 'BATU');

    this.suitState.winner = userWins ? 'HOME' : 'AWAY';
    if (userWins) {
      this.ui.promptSuitWinnerRole?.(userChoice, oppChoice);
    } else {
      // AI menang suit, otomatis memilih menendang Golden Ball
      this.resolveGoldenBallShot('AWAY');
    }
  }

  resolveGoldenBallShot(shooterTeam) {
    this.ui.closeGoldenBallSuit?.();
    const isGoal = Math.random() < 0.58;
    const winnerTeam = isGoal ? shooterTeam : (shooterTeam === 'HOME' ? 'AWAY' : 'HOME');
    this.score[winnerTeam] += 1;
    this._finishMatch(`Golden Ball (${winnerTeam === 'HOME' ? 'Gol Penentu' : 'Tepis Penentu'})`);
  }

  _finishMatch(reason) {
    this.phase = 'FINISHED';
    this.running = false;
    this.ui.showEndMatch?.(this.score, reason);
  }

  _showBanner(title, sub) {
    this.bannerTimer = 2.1;
    this.ui.showBanner?.(title, sub);
  }

  _updateHUD() {
    const periodMap = {
      HALF_1: '1ST HALF',
      HALF_2: '2ND HALF',
      EXTRA_TIME: 'EXTRA TIME',
      PENALTY: 'PENALTIES',
      SUIT: 'GOLDEN BALL'
    };
    this.ui.updateHUD?.({
      homeScore: this.score.HOME,
      awayScore: this.score.AWAY,
      clock: formatTime(this.phaseTimeLeft),
      period: periodMap[this.phase] || 'MATCH'
    });
  }

  serializeState() {
    return {
      score: this.score,
      phase: this.phase,
      phaseTimeLeft: this.phaseTimeLeft,
      ball: this.ball,
      players: this.players.map((p) => ({
        id: p.id, x: p.x, y: p.y, team: p.team, role: p.role, number: p.number, name: p.name
      }))
    };
  }

  applyRemoteState(remote) {
    if (!remote) return;
    this.score = remote.score || this.score;
    this.phase = remote.phase || this.phase;
    this.phaseTimeLeft = remote.phaseTimeLeft ?? this.phaseTimeLeft;
    if (remote.ball) this.ball = remote.ball;
    if (Array.isArray(remote.players)) {
      remote.players.forEach((rp) => {
        const localP = this.players.find((lp) => lp.id === rp.id);
        if (localP) {
          localP.x = rp.x;
          localP.y = rp.y;
        }
      });
    }
  }

  _renderFrame() {
    this.renderer.render({
      players: this.players,
      ball: this.ball,
      homeKit: this.matchConfig.homeTeam,
      awayKit: this.matchConfig.awayTeam,
      activePlayerIds: [this.activePlayerIds.HOME, this.activePlayerIds.AWAY].filter(Boolean)
    });
  }
}
