import { FIELD } from './data.js';
import { clamp } from './utils.js';

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const availW = Math.max(300, parent.clientWidth);
    const availH = Math.max(200, parent.clientHeight);
    const aspect = FIELD.WIDTH / FIELD.HEIGHT;

    let displayW = availW;
    let displayH = availW / aspect;
    if (displayH > availH) {
      displayH = availH;
      displayW = availH * aspect;
    }

    // Batasi DPR demi performa stabil di HP maupun layar Retina 120Hz
    const dpr = clamp(window.devicePixelRatio || 1, 1, 1.75);
    this.canvas.style.width = `${Math.floor(displayW)}px`;
    this.canvas.style.height = `${Math.floor(displayH)}px`;
    this.canvas.width = Math.floor(displayW * dpr);
    this.canvas.height = Math.floor(displayH * dpr);
    this.scale = this.canvas.width / FIELD.WIDTH;
  }

  render(state) {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.save();
    ctx.scale(this.scale, this.scale);

    this._drawPitch(ctx);
    this._drawBallTrail(ctx, state.ball);
    this._drawPlayers(ctx, state.players, state.homeKit, state.awayKit, state.activePlayerIds, state.ball);
    this._drawBall(ctx, state.ball);

    ctx.restore();
  }

  _drawPitch(ctx) {
    const { WIDTH, HEIGHT, MARGIN_X, MARGIN_Y, GOAL_WIDTH, GOAL_DEPTH, PENALTY_AREA_RADIUS } = FIELD;
    const fieldW = WIDTH - MARGIN_X * 2;
    const fieldH = HEIGHT - MARGIN_Y * 2;

    // Latar belakang arena futsal indoor
    ctx.fillStyle = '#071912';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Rumput sintetis / vinyl biru-hijau khas turnamen futsal
    const stripeCount = 10;
    const stripeW = fieldW / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#0d5c3e' : '#0b4f35';
      ctx.fillRect(MARGIN_X + i * stripeW, MARGIN_Y, stripeW, fieldH);
    }

    // Garis putih lapangan
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(MARGIN_X, MARGIN_Y, fieldW, fieldH);

    // Garis tengah & lingkaran tengah
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, MARGIN_Y);
    ctx.lineTo(WIDTH / 2, HEIGHT - MARGIN_Y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(WIDTH / 2, HEIGHT / 2, 68, 0, Math.PI * 2);
    ctx.stroke();

    // Area Penalti (D-Shape Futsal) Kiri & Kanan
    ctx.beginPath();
    ctx.arc(MARGIN_X, HEIGHT / 2, PENALTY_AREA_RADIUS, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(WIDTH - MARGIN_X, HEIGHT / 2, PENALTY_AREA_RADIUS, Math.PI / 2, -Math.PI / 2);
    ctx.stroke();

    // Titik Penalti 6m & 10m
    ctx.fillStyle = '#ffffff';
    [MARGIN_X + 75, MARGIN_X + 130, WIDTH - MARGIN_X - 75, WIDTH - MARGIN_X - 130].forEach((px) => {
      ctx.beginPath();
      ctx.arc(px, HEIGHT / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Gawang Kiri & Kanan
    const goalTop = HEIGHT / 2 - GOAL_WIDTH / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 3;

    ctx.fillRect(MARGIN_X - GOAL_DEPTH, goalTop, GOAL_DEPTH, GOAL_WIDTH);
    ctx.strokeRect(MARGIN_X - GOAL_DEPTH, goalTop, GOAL_DEPTH, GOAL_WIDTH);

    ctx.fillRect(WIDTH - MARGIN_X, goalTop, GOAL_DEPTH, GOAL_WIDTH);
    ctx.strokeRect(WIDTH - MARGIN_X, goalTop, GOAL_DEPTH, GOAL_WIDTH);
  }

  _drawBallTrail(ctx, ball) {
    if (!ball || ball.trail.length < 2) return;
    for (let i = 1; i < ball.trail.length; i++) {
      const pt = ball.trail[i];
      const alpha = (i / ball.trail.length) * 0.45;
      const isCurving = Math.abs(pt.spin || 0) > 0.15;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, FIELD.BALL_RADIUS * (i / ball.trail.length), 0, Math.PI * 2);
      ctx.fillStyle = isCurving ? `rgba(236, 72, 153, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();
    }
  }

  _drawPlayers(ctx, players, homeKit, awayKit, activeIds = [], ball) {
    for (const p of players) {
      const kit = p.team === 'HOME' ? homeKit : awayKit;
      const isControlled = activeIds.includes(p.id);
      const hasBall = ball && ball.ownerId === p.id;

      // Indikator kursor pemain aktif gaya eFootball
      if (isControlled) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, FIELD.PLAYER_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // Bayangan
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + FIELD.PLAYER_RADIUS - 2, FIELD.PLAYER_RADIUS * 0.9, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fill();

      // Lingkaran tubuh pemain (Jersey utama + border aksen)
      ctx.beginPath();
      ctx.arc(p.x, p.y, FIELD.PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = p.role === 'GK' ? '#f59e0b' : kit.primary;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = kit.accent;
      ctx.stroke();

      // Nomor Punggung
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 2.5;
      ctx.strokeText(String(p.number), p.x, p.y);
      ctx.fillText(String(p.number), p.x, p.y);

      // Nama pemain kecil di bawah jika memegang bola atau aktif
      if (isControlled || hasBall) {
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(p.name, p.x, p.y + FIELD.PLAYER_RADIUS + 11);
      }
    }
  }

  _drawBall(ctx, ball) {
    if (!ball) return;
    ctx.beginPath();
    ctx.arc(ball.x + 2, ball.y + 3, FIELD.BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, FIELD.BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();
  }
}
