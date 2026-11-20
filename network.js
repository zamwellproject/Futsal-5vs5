import { generateRoomCode } from './utils.js';

const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  }
};

export class NetworkManager {
  constructor(callbacks = {}) {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomCode = '';
    this.status = 'IDLE'; // IDLE | CONNECTING | CONNECTED | FAILED
    this._connectTimeout = null;
    this.callbacks = callbacks;
  }

  _setStatus(status, message = '') {
    if (status !== 'CONNECTING') {
      this._clearTimeout();
    }
    this.status = status;
    this.callbacks.onStatusChange?.(status, message);
  }

  _clearTimeout() {
    if (this._connectTimeout) {
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
    }
  }

  _armConnectTimeout(msg) {
    this._clearTimeout();
    this._connectTimeout = setTimeout(() => {
      if (this.status === 'CONNECTING') {
        this._setStatus('FAILED', msg);
      }
    }, 12000);
  }

  createRoom() {
    this.cleanup();
    this.isHost = true;
    this.roomCode = generateRoomCode();
    const peerId = `efutsal5v5-${this.roomCode}`;
    this._setStatus('CONNECTING', 'Menghubungkan ke server signaling room...');
    this._armConnectTimeout('Waktu habis saat membuat room. Coba klik Coba Lagi.');

    try {
      if (typeof window.Peer === 'undefined') {
        throw new Error('Library PeerJS belum siap. Periksa koneksi internet.');
      }

      this.peer = new window.Peer(peerId, PEER_CONFIG);

      this.peer.on('open', () => {
        this._clearTimeout();
        this._setStatus('CONNECTING', `Room ${this.roomCode} aktif. Menunggu lawan bergabung...`);
        this.callbacks.onRoomCreated?.(this.roomCode);
      });

      this.peer.on('connection', (connection) => {
        if (this.conn && this.conn.open) {
          connection.close();
          return;
        }
        this.conn = connection;
        this._setupConnectionHandlers();
      });

      this.peer.on('disconnected', () => {
        if (this.status !== 'CONNECTED') {
          this._setStatus('FAILED', 'Terputus dari server signaling. Coba lagi.');
        }
      });

      this.peer.on('error', (err) => {
        const type = err?.type || 'error';
        const reason =
          type === 'unavailable-id'
            ? 'Kode room sedang dipakai, silakan buat room ulang.'
            : `Gangguan koneksi P2P (${type}).`;
        this._setStatus('FAILED', reason);
      });
    } catch (err) {
      this._setStatus('FAILED', err.message || 'Gagal menginisialisasi koneksi.');
    }
  }

  joinRoom(codeInput) {
    const cleanCode = String(codeInput || '').trim().toUpperCase();
    if (cleanCode.length < 4) {
      this._setStatus('FAILED', 'Masukkan kode room yang valid (minimal 4 karakter).');
      return;
    }

    this.cleanup();
    this.isHost = false;
    this.roomCode = cleanCode;
    const targetPeerId = `efutsal5v5-${cleanCode}`;
    this._setStatus('CONNECTING', `Mencari room ${cleanCode}...`);
    this._armConnectTimeout(`Gagal terhubung ke room ${cleanCode} (timeout). Pastikan kode benar & room aktif.`);

    try {
      if (typeof window.Peer === 'undefined') {
        throw new Error('Library PeerJS belum siap.');
      }

      this.peer = new window.Peer(undefined, PEER_CONFIG);

      this.peer.on('open', () => {
        if (!this.peer || this.peer.destroyed) return;
        const connection = this.peer.connect(targetPeerId, {
          reliable: true,
          serialization: 'json'
        });
        this.conn = connection;
        this._setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        const type = err?.type || 'error';
        const reason =
          type === 'peer-unavailable'
            ? `Room ${cleanCode} tidak ditemukan atau belum siap.`
            : `Gangguan koneksi P2P (${type}).`;
        this._setStatus('FAILED', reason);
      });
    } catch (err) {
      this._setStatus('FAILED', err.message || 'Gagal bergabung ke room.');
    }
  }

  _setupConnectionHandlers() {
    if (!this.conn) return;

    this.conn.on('open', () => {
      this._clearTimeout();
      this._setStatus('CONNECTED', `Terhubung di Room ${this.roomCode}!`);
      this.callbacks.onConnected?.(this.isHost);
    });

    this.conn.on('data', (payload) => {
      if (payload && typeof payload === 'object') {
        this.callbacks.onData?.(payload);
      }
    });

    this.conn.on('close', () => {
      this._clearTimeout();
      this._setStatus('FAILED', 'Koneksi dengan lawan terputus.');
      this.callbacks.onDisconnected?.();
    });

    this.conn.on('error', () => {
      this._clearTimeout();
      this._setStatus('FAILED', 'Terjadi gangguan jalur data P2P.');
    });
  }

  send(type, data = {}) {
    try {
      if (this.conn && this.conn.open) {
        this.conn.send({ type, data, ts: Date.now() });
      }
    } catch {
      // Mencegah throw saat koneksi baru terputus
    }
  }

  cleanup() {
    this._clearTimeout();
    try {
      if (this.conn) this.conn.close();
      if (this.peer) this.peer.destroy();
    } catch {
      // Ignore cleanup errors
    }
    this.conn = null;
    this.peer = null;
    this._setStatus('IDLE', 'Siap membuat/gabung room');
  }
}
