import { FIELD } from './data.js';
import { clamp, dist, normalize } from './utils.js';

export class TacticalAI {
  constructor() {
    this.minX = FIELD.MARGIN_X;
    this.maxX = FIELD.WIDTH - FIELD.MARGIN_X;
    this.minY = FIELD.MARGIN_Y;
    this.maxY = FIELD.HEIGHT - FIELD.MARGIN_Y;
  }

  /**
   * Menghitung target taktis untuk seluruh pemain AI (rekan setim non-aktif & tim lawan).
   */
  updateTeamAI(teamSide, players, ball, activeHumanPlayerId, difficulty = 'pro', dt = 0.016) {
    const diffMult = difficulty === 'legend' ? 1.08 : difficulty === 'amateur' ? 0.82 : 0.96;
    const teamPlayers = players.filter((p) => p.team === teamSide);
    const ballOwner = players.find((p) => p.id === ball.ownerId) || null;
    const teamHasBall = ballOwner?.team === teamSide;
    const attackDir = teamSide === 'HOME' ? 1 : -1;

    // Cari pemain outfield terdekat dengan bola untuk pressing / mengejar bola bebas
    let chaserId = null;
    let bestBallDist = Infinity;
    for (const p of teamPlayers) {
      if (p.role === 'GK' || p.id === activeHumanPlayerId) continue;
      const d = dist(p.x, p.y, ball.x, ball.y);
      if (d < bestBallDist) {
        bestBallDist = d;
        chaserId = p.id;
      }
    }

    for (const p of teamPlayers) {
      if (p.id === activeHumanPlayerId) continue;

      if (p.aiCooldown > 0) {
        p.aiCooldown = Math.max(0, p.aiCooldown - dt);
      }

      // 1. LOGIKA GOALKEEPER (GK)
      if (p.role === 'GK') {
        this._updateGoalkeeper(p, ball, attackDir, diffMult);
        continue;
      }

      // 2. JIKA PEMAIN AI INI MEMEGANG BOLA (Khusus Tim AI Lawan)
      if (ball.ownerId === p.id) {
        this._updateBallCarrierAI(p, teamPlayers, players, ball, attackDir, diffMult);
        continue;
      }

      // 3. PERGERAKAN TANPA BOLA (Off-the-Ball Rotasi Futsal)
      let target = this._getTacticalSlot(p, ball, teamHasBall, attackDir);

      // Jika tim tidak memegang bola, pemain terdekat menekan pembawa bola / mengejar bola bebas
      if (!teamHasBall && p.id === chaserId) {
        target = { x: ball.x, y: ball.y };
      }

      this._steerToTarget(p, target.x, target.y, diffMult);
    }
  }

  _updateGoalkeeper(gk, ball, attackDir, diffMult) {
    const homeGoalX = attackDir === 1 ? this.minX + 18 : this.maxX - 18;
    const goalHalf = FIELD.GOAL_WIDTH * 0.44;
    const centerY = FIELD.HEIGHT / 2;

    // Kiper mengikuti sudut vertikal bola secara proporsional
    const desiredY = clamp(ball.y, centerY - goalHalf, centerY + goalHalf);
    const distBallGoal = Math.abs(ball.x - homeGoalX);
    const desiredX = distBallGoal < 145
      ? homeGoalX + attackDir * 14
      : homeGoalX;

    this.  _steerToTarget(p, tx, ty, speedFactor = 1) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 12) {
      p.vx *= 0.55;
      p.vy *= 0.55;
      return;
    }
    const n = normalize(dx, dy);
    // Kecepatan lebih realistis & terkontrol di lapangan 1000x560
    const baseSpeed = 78 + (p.stats.speed || 80) * 0.62;
    const approachScale = d < 45 ? d / 45 : 1;
    const maxSpd = baseSpeed * speedFactor * approachScale;
    p.vx = n.x * maxSpd;
    p.vy = n.y * maxSpd;
    p.facingX = n.x;
    p.facingY = n.y;
  }


  _updateBallCarrierAI(carrier, mates, allPlayers, ball, attackDir, diffMult) {
    const enemyGoalX = attackDir === 1 ? this.maxX : this.minX;
    const distToGoal = Math.abs(enemyGoalX - carrier.x);

    // Cek apakah dalam jarak tembak ideal
    if (distToGoal < 245 && carrier.aiCooldown <= 0) {
      carrier.aiCooldown = 0.65;
      carrier._wantsShoot = true;
      carrier._aiCurveBias = carrier.y < FIELD.HEIGHT / 2 ? 0.65 : -0.65;
      return;
    }

    // Cek tekanan lawan di dekat pembawa bola
    const opponents = allPlayers.filter((o) => o.team !== carrier.team);
    const nearestOppDist = Math.min(...opponents.map((o) => dist(o.x, o.y, carrier.x, carrier.y)));

    if (nearestOppDist < 68 && carrier.aiCooldown <= 0) {
      // Cari rekan yang lebih maju / terbuka untuk dioper
      const openMate = mates.find(
        (m) => m.id !== carrier.id && m.role !== 'GK' && dist(m.x, m.y, carrier.x, carrier.y) > 95
      );
      if (openMate) {
        carrier.aiCooldown = 0.55;
        carrier._wantsPass = true;
        return;
      }
    }

    // Dribble progresif menuju ruang kosong depan gawang lawan
    const targetX = clamp(carrier.x + attackDir * 140, this.minX + 50, this.maxX - 50);
    const targetY = clamp(FIELD.HEIGHT / 2 + Math.sin(performance.now() * 0.002) * 95, this.minY + 40, this.maxY - 40);
    this._steerToTarget(carrier, targetX, targetY, diffMult);
  }

  /**
   * Formasi Dinamis Futsal (1-2-1 Diamond): Anchor, Pivot, Flank Kanan, Flank Kiri.
   */
  _getTacticalSlot(player, ball, teamHasBall, attackDir) {
    const midX = FIELD.WIDTH / 2;
    const midY = FIELD.HEIGHT / 2;
    const ballProgress = (ball.x - midX) * attackDir; // positif jika menyerang
    const shiftX = clamp(ballProgress * 0.45, -180, 210) * attackDir;
    const shiftY = clamp((ball.y - midY) * 0.35, -75, 75);

    const spreadMult = teamHasBall ? 1.18 : 0.82;
    let baseX = midX;
    let baseY = midY;

    switch (player.tacticalPos) {
      case 'ANCHOR':
        baseX = midX - 150 * attackDir + shiftX * 0.75;
        baseY = midY + shiftY * 0.6;
        break;
      case 'PIVOT':
        baseX = midX + 175 * attackDir + shiftX * 0.85;
        baseY = midY - shiftY * 0.5;
        break;
      case 'FLANK_R':
        baseX = midX + 35 * attackDir + shiftX;
        baseY = midY + 145 * spreadMult + shiftY * 0.4;
        break;
      case 'FLANK_L':
      default:
        baseX = midX + 35 * attackDir + shiftX;
        baseY = midY - 145 * spreadMult + shiftY * 0.4;
        break;
    }

    return {
      x: clamp(baseX, this.minX + 45, this.maxX - 45),
      y: clamp(baseY, this.minY + 35, this.maxY - 35)
    };
  }

  _steerToTarget(p, tx, ty, speedFactor = 1) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) {
      p.vx *= 0.65;
      p.vy *= 0.65;
      return;
    }
    const n = normalize(dx, dy);
    const maxSpd = (145 + (p.stats.speed || 80) * 1.15) * speedFactor;
    p.vx = n.x * maxSpd;
    p.vy = n.y * maxSpd;
    p.facingX = n.x;
    p.facingY = n.y;
  }
}
