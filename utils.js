/**
 * Guardrail numerik untuk mencegah NaN, Infinity, atau pembagian nol.
 */
export function safeNum(val, fallback = 0) {
  return Number.isFinite(val) ? val : fallback;
}

export function clamp(val, min, max) {
  const v = safeNum(val, min);
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return safeNum(a) + (safeNum(b) - safeNum(a)) * clamp(t, 0, 1);
}

export function dist(x1, y1, x2, y2) {
  const dx = safeNum(x2) - safeNum(x1);
  const dy = safeNum(y2) - safeNum(y1);
  return Math.hypot(dx, dy);
}

export function normalize(vx, vy) {
  const x = safeNum(vx, 0);
  const y = safeNum(vy, 0);
  const len = Math.hypot(x, y);
  if (len < 1e-6) return { x: 0, y: 0, len: 0 };
  return { x: x / len, y: y / len, len };
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(safeNum(seconds, 0)));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Memastikan tidak ada nomor punggung ganda dalam satu tim (1 - 99).
 */
export function resolveUniqueJerseyNumbers(lineup) {
  const used = new Set();
  return lineup.map((member) => {
    let num = Math.round(clamp(Number(member.number) || 1, 1, 99));
    while (used.has(num)) {
      num = num >= 99 ? 1 : num + 1;
    }
    used.add(num);
    return { ...member, number: num };
  });
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
