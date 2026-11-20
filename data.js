export const ADMIN_PASSWORD = 'azzamkece26';

export const TEAMS = [
  { id: 'EVR', name: 'EVERSION', short: 'EVR', primary: '#00e5ff', accent: '#0f172a' },
  { id: 'VDL', name: 'Vaedalation', short: 'VDL', primary: '#f43f5e', accent: '#1e1b4b' },
  { id: 'AWFA', name: 'Alwafi futsal academy', short: 'AWFA', primary: '#10b981', accent: '#064e3b' },
  { id: 'ZVR', name: 'Zetsvire', short: 'ZVR', primary: '#facc15', accent: '#18181b' }
];

export const OUTFIELD_POSITIONS = ['ANCHOR', 'PIVOT', 'FLANK_R', 'FLANK_L'];

export const INITIAL_PLAYERS = [
  // ================= OUTFIELD (13 Pemain) =================
  {
    id: 'out_hilmy', name: 'Hilmy', defaultNumber: 7, role: 'OUTFIELD', preferredPos: 'FLANK_R',
    stats: { speed: 88, shoot: 84, pass: 82, dribble: 89, defense: 68 }
  },
  {
    id: 'out_sunan', name: 'Sunan', defaultNumber: 18, role: 'OUTFIELD', preferredPos: 'ANCHOR',
    stats: { speed: 78, shoot: 79, pass: 87, dribble: 80, defense: 88 }
  },
  {
    id: 'out_faiq', name: 'Faiq', defaultNumber: 48, role: 'OUTFIELD', preferredPos: 'PIVOT',
    stats: { speed: 79, shoot: 89, pass: 81, dribble: 83, defense: 70 }
  },
  {
    id: 'out_nyong', name: 'Nyong', defaultNumber: 29, role: 'OUTFIELD', preferredPos: 'FLANK_L',
    stats: { speed: 87, shoot: 81, pass: 83, dribble: 86, defense: 72 }
  },
  {
    id: 'out_ahmad', name: 'Ahmad', defaultNumber: 25, role: 'OUTFIELD', preferredPos: 'ANCHOR',
    stats: { speed: 80, shoot: 77, pass: 86, dribble: 79, defense: 87 }
  },
  {
    id: 'out_hamdi', name: 'Hamdi', defaultNumber: 27, role: 'OUTFIELD', preferredPos: 'PIVOT',
    stats: { speed: 81, shoot: 87, pass: 80, dribble: 82, defense: 73 }
  },
  {
    id: 'out_ikenzie', name: 'I. Kenzie', defaultNumber: 13, role: 'OUTFIELD', preferredPos: 'FLANK_R',
    stats: { speed: 86, shoot: 83, pass: 85, dribble: 87, defense: 74 }
  },
  {
    id: 'out_sajjad', name: 'Sajjad', defaultNumber: 10, role: 'OUTFIELD', preferredPos: 'PIVOT',
    stats: { speed: 84, shoot: 90, pass: 88, dribble: 91, defense: 71 }
  },
  {
    id: 'out_alraffle', name: 'Al raffle', defaultNumber: 77, role: 'OUTFIELD', preferredPos: 'FLANK_L',
    stats: { speed: 89, shoot: 82, pass: 80, dribble: 88, defense: 69 }
  },
  {
    id: 'out_rakan', name: 'Rakan', defaultNumber: 23, role: 'OUTFIELD', preferredPos: 'ANCHOR',
    stats: { speed: 82, shoot: 80, pass: 88, dribble: 82, defense: 86 }
  },
  {
    id: 'out_abiyu', name: 'Abiyu', defaultNumber: 7, role: 'OUTFIELD', preferredPos: 'FLANK_R',
    stats: { speed: 87, shoot: 85, pass: 84, dribble: 86, defense: 73 }
  },
  {
    id: 'out_manggos', name: 'Manggos', defaultNumber: 67, role: 'OUTFIELD', preferredPos: 'PIVOT',
    stats: { speed: 77, shoot: 88, pass: 79, dribble: 81, defense: 75 }
  },
  {
    id: 'out_najid', name: 'Najid', defaultNumber: 57, role: 'OUTFIELD', preferredPos: 'FLANK_L',
    stats: { speed: 85, shoot: 83, pass: 85, dribble: 85, defense: 76 }
  },

  // ================= GOALKEEPERS (4 Pemain) =================
  {
    id: 'gk_bima', name: 'Bima', defaultNumber: 2, role: 'GK', preferredPos: 'GK',
    stats: { speed: 74, shoot: 65, pass: 80, dribble: 70, defense: 82, gkHandling: 88 }
  },
  {
    id: 'gk_ikenzie', name: 'I.kenzie', defaultNumber: 9, role: 'GK', preferredPos: 'GK',
    stats: { speed: 76, shoot: 68, pass: 82, dribble: 73, defense: 80, gkHandling: 86 }
  },
  {
    id: 'gk_rmaliq', name: 'R. Maliq', defaultNumber: 6, role: 'GK', preferredPos: 'GK',
    stats: { speed: 73, shoot: 64, pass: 79, dribble: 69, defense: 84, gkHandling: 89 }
  },
  {
    id: 'gk_naufal', name: 'Naufal', defaultNumber: 1, role: 'GK', preferredPos: 'GK',
    stats: { speed: 77, shoot: 66, pass: 84, dribble: 72, defense: 85, gkHandling: 91 }
  }
];

// Dimensi Lapangan Futsal Standar Internasional (dalam satuan dunia virtual)
export const FIELD = {
  WIDTH: 1000,
  HEIGHT: 560,
  MARGIN_X: 60,
  MARGIN_Y: 45,
  GOAL_WIDTH: 112,
  GOAL_DEPTH: 32,
  PENALTY_AREA_RADIUS: 115,
  PLAYER_RADIUS: 15,
  BALL_RADIUS: 8.5
};
