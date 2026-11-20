import { FIELD } from './data.js';
import { clamp, dist, normalize, safeNum } from './utils.js';

export class PhysicsEngine {
  constructor() {
    this.minX = FIELD.MARGIN_X;
    this.maxX = FIELD.WIDTH - FIELD.MARGIN_X;
    this.minY = FIELD.MARGIN_Y;
    this.maxY = FIELD.HEIGHT - FIELD.MARGIN_Y;
    this.goalTop = FIELD.HEIGHT / 2 - FIELD.GOAL_WIDTH / 2;
    this.goalBottom = FIELD.HEIGHT / 2 + FIELD.GOAL_WIDTH / 2;
  }

  /**
   * Simulasi fisika bola termasuk efek Curve (Magnus force) & trail visual.
   */
  updateBall(ball, players, dt, onEvent) {
    if (!ball) return;

    // Jika bola sedang dikuasai pemain
    if (ball.ownerId) {
      const owner = players.find((p) => p.id === ball.ownerId);
      if (owner) {
        const dribbleOffset = FIELD.PLAYER_RADIUS + FIELD.BALL_RADIUS - 2;
        const dir = normalize(owner.facingX, owner.facingY);
        const fx = dir.len > 0 ? dir.x : (owner.team === 'HOME' ? 1 : -1);
        const fy = dir.len > 0 ? dir.y : 0;

        ball.x = clamp(owner.x + fx * dribbleOffset, this.minX + 4, this.maxX - 4);
        ball.y = clamp(owner.y + fy * dribbleOffset, this.minY + 4, this.maxY - 4);
        ball.vx = owner.vx;
        ball.vy = owner.vy;
        ball.spin = 0;
        this._pushTrail(ball);
        return;
      } else {
        ball.ownerId = null;
      }
    }

    // Bebas meluncur: terapkan Efek Curve (Gaya Magnus tegak lurus kecepatan)
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 25 && Math.abs(ball.spin) > 0.01) {
      const perpX = -ball.vy / speed;
      const perpY = ball.vx / speed;
      const curveAccel = ball.spin * speed * 1.45;
      ball.vx += perpX * curveAccel * dt;
      ball.vy += perpY * curveAccel * dt;
      ball.spin *= Math.pow(0.45, dt); // spin meluruh alami
    }

    ball.x = safeNum(ball.x + ball.vx * dt, FIELD.WIDTH / 2);
    ball.y = safeNum(ball.y + ball.vy * dt, FIELD.HEIGHT / 2);

    // Gesekan lantai lapangan futsal (vinyl/parquet cepat)
    const friction = Math.pow(0.26, dt);
    ball.vx *= friction;
    ball.vy *= friction;
    if (Math.hypot(ball.vx, ball.vy) < 6) {
      ball.vx = 0;
      ball.vy = 0;
      ball.spin = 0;
    }

    if (ball.pickupCooldown > 0) {
      ball.pickupCooldown = Math.max(0, ball.pickupCooldown - dt);
    }

    this._pushTrail(ball);

    // Cek Interaksi Pemain (Kontrol bola, blok GK, atau Handball)
    this._handleBallPlayerCollisions(ball, players, onEvent);

    // Cek Batas Lapangan (Goal, Out Samping, Corner, Goal Kick)
    this._checkFieldBoundaries(ball, onEvent);
  }

  _pushTrail(ball) {
    ball.trail.push({ x: ball.x, y: ball.y, spin: ball.spin });
    if (ball.trail.length > 14) ball.trail.shift();
  }

  _handleBallPlayerCollisions(ball, players, onEvent) {
    const ballSpeed = Math.hypot(ball.vx, ball.vy);

    for (const p of players) {
      if (p.id === ball.lastTouchId && ball.pickupCooldown > 0) continue;

      const d = dist(ball.x, ball.y, p.x, p.y);
      const hitDist = FIELD.PLAYER_RADIUS + FIELD.BALL_RADIUS + (p.role === 'GK' ? 4 : 0);

      if (d <= hitDist) {
        // 1. Logika Goalkeeper Menepis / Menangkap
        if (p.role === 'GK') {
          const handling = (p.stats.gkHandling || 85) / 100;
          ball.lastTouchId = p.id;
          ball.lastTouchTeam = p.team;
          ball.spin = 0;

          if (ballSpeed < 460 * handling) {
            // Tangkap bersih
            ball.ownerId = p.id;
            ball.vx = 0;
            ball.vy = 0;
          } else {
            // Tepis menjauhi gawang
            const pushDir = p.team === 'HOME' ? 1 : -1;
            ball.ownerId = null;
            ball.vx = pushDir * (240 + Math.random() * 120);
            ball.vy = (ball.y - p.y) * 7;
            ball.pickupCooldown = 0.25;
          }
          return;
        }

        // 2. Logika Handball Futsal (Tembakan keras mengenai lengan outfield non-natural)
        if (ballSpeed > 430 && p.id !== ball.lastTouchId && Math.random() < 0.065) {
          ball.vx *= 0.2;
          ball.vy *= 0.2;
          ball.ownerId = null;
          onEvent?.({
            type: 'HANDBALL',
            team: p.team === 'HOME' ? 'AWAY' : 'HOME',
            x: clamp(ball.x, this.minX + 20, this.maxX - 20),
            y: clamp(ball.y, this.minY + 20, this.maxY - 20),
            offender: p.name
          });
          return;
        }

        // 3. Kontrol / Intersep Bola oleh Pemain Outfield
        const controlStat = ((p.stats.dribble || 80) + (p.stats.defense || 75)) / 200;
        if (ballSpeed < 540 * controlStat || p.team === ball.lastTouchTeam) {
          ball.ownerId = p.id;
          ball.lastTouchId = p.id;
          ball.lastTouchTeam = p.team;
          ball.vx = 0;
          ball.vy = 0;
          ball.spin = 0;
          return;
        } else {
          // Pantulan keras dari badan
          const n = normalize(ball.x - p.x, ball.y - p.y);
          ball.vx = n.x * ballSpeed * 0.45;
          ball.vy = n.y * ballSpeed * 0.45;
          ball.lastTouchId = p.id;
          ball.lastTouchTeam = p.team;
          ball.pickupCooldown = 0.18;
          return;
        }
      }
    }
  }

  _checkFieldBoundaries(ball, onEvent) {
    // 1. Cek Gol Kiri (Gawang HOME -> AWAY mencetak gol)
    if (ball.x - FIELD.BALL_RADIUS < this.minX) {
      if (ball.y > this.goalTop && ball.y < this.goalBottom) {
        onEvent?.({ type: 'GOAL', scoringTeam: 'AWAY', scorerId: ball.lastTouchId });
        return;
      }
      // Bola keluar garis gawang kiri: Corner (jika terakhir disentuh HOME) atau Goal Kick (jika AWAY)
      if (ball.lastTouchTeam === 'HOME') {
        const cornerY = ball.y < FIELD.HEIGHT / 2 ? this.minY + 8 : this.maxY - 8;
        onEvent?.({ type: 'CORNER', team: 'AWAY', x: this.minX + 10, y: cornerY });
      } else {
        onEvent?.({ type: 'GOAL_KICK', team: 'HOME', x: this.minX + 36, y: FIELD.HEIGHT / 2 });
      }
      return;
    }

    // 2. Cek Gol Kanan (Gawang AWAY -> HOME mencetak gol)
    if (ball.x + FIELD.BALL_RADIUS > this.maxX) {
      if (ball.y > this.goalTop && ball.y < this.goalBottom) {
        onEvent?.({ type: 'GOAL', scoringTeam: 'HOME', scorerId: ball.lastTouchId });
        return;
      }
      if (ball.lastTouchTeam === 'AWAY') {
        const cornerY = ball.y < FIELD.HEIGHT / 2 ? this.minY + 8 : this.maxY - 8;
        onEvent?.({ type: 'CORNER', team: 'HOME', x: this.maxX - 10, y: cornerY });
      } else {
        onEvent?.({ type: 'GOAL_KICK', team: 'AWAY', x: this.maxX - 36, y: FIELD.HEIGHT / 2 });
      }
      return;
    }

    // 3. Cek Out Garis Samping (Atas / Bawah) -> Kick-in Futsal
    if (ball.y - FIELD.BALL_RADIUS < this.minY) {
      const awardTeam = ball.lastTouchTeam === 'HOME' ? 'AWAY' : 'HOME';
      onEvent?.({
        type: 'OUT',
        team: awardTeam,
        x: clamp(ball.x, this.minX + 16, this.maxX - 16),
        y: this.minY + 10
      });
      return;
    }

    if (ball.y + FIELD.BALL_RADIUS > this.maxY) {
      const awardTeam = ball.lastTouchTeam === 'HOME' ? 'AWAY' : 'HOME';
      onEvent?.({
        type: 'OUT',
        team: awardTeam,
        x: clamp(ball.x, this.minX + 16, this.maxX - 16),
        y: this.maxY - 10
      });
    }
  }

  /**
   * Resolusi tabrakan antar pemain & clamping ketat di dalam batas lapangan.
   */
  resolvePlayers(players, dt) {
    const minDist = FIELD.PLAYER_RADIUS * 2.05;
    for (let i = 0; i < players.length; i++) {
      const a = players[i];
      a.x = safeNum(a.x + a.vx * dt, FIELD.WIDTH / 2);
      a.y = safeNum(a.y + a.vy * dt, FIELD.HEIGHT / 2);

      // Tabrakan antar pemain
      for (let j = i + 1; j < players.length; j++) {
        const b = players[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.001 && d < minDist) {
          const overlap = (minDist - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }

      // Clamping batas lapangan agar tidak pernah keluar/nyangkut di gawang
      if (a.role === 'GK') {
        const goalLineX = a.team === 'HOME' ? this.minX + 16 : this.maxX - 16;
        a.x = clamp(a.x, goalLineX - 28, goalLineX + 28);
        a.y = clamp(a.y, this.goalTop - 16, this.goalBottom + 16);
      } else {
        a.x = clamp(a.x, this.minX + FIELD.PLAYER_RADIUS, this.maxX - FIELD.PLAYER_RADIUS);
        a.y = clamp(a.y, this.minY + FIELD.PLAYER_RADIUS, this.maxY - FIELD.PLAYER_RADIUS);
      }
    }
  }
}
