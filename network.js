import { generateRoomCode } from './utils.js';

export class NetworkManager {
  constructor(callbacks = {}) {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomCode = '';
    this.status = 'IDLE'; // IDLE | CONNECTING | CONNECTED | FAILED
    this.callbacks = callbacks;
  }

  _setStatus(status, message = '') {
    this.status = status;
    this.callbacks.onStatusChange?.(status, message);
  }

  createRoom() {
    this.cleanup();
    this.isHost = true;
    this.roomCode = generateRoomCode();
    const peerId = `efutsal5v5-${this.roomCode}`;
    this._setStatus('CONNECTING', 'Membuat room P2P...');

    try {
      if (typeof window.Peer === 'undefined') {
        throw new Error('Library PeerJS gagal dimuat. Periksa koneksi internet.');
      }

      this.peer = new window.Peer(peerId, { debug: 0 });

      this.peer.on('open', () => {
        this._setStatus('CONNECTING', `Room siap! Menunggu lawan bergabung ke kode ${this.roomCode}...`);
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

      this.peer.on('error', (err) => {
        this._setStatus('FAILED', `Koneksi bermasalah (${err?.type || 'error'}).`);
      });
    } catch (err) {
      this._setStatus('FAILED', err.message || 'Gagal menginisialisasi koneksi.');
    }
  }

  joinRoom(codeInput) {
    const cleanCode = String(codeInput || '').trim().toUpperCase();
    if (cleanCode.length < 4) {
      this._setStatus('FAILED', 'Masukkan kode room yang valid.');
      return;
    }

    this.cleanup();
    this.isHost = false;
    this.roomCode = cleanCode;
    const targetPeerId = `efutsal5v5-${cleanCode}`;
    this._setStatus('CONNECTING', `Menghubungkan ke room ${cleanCode}...`);

    try {
      if (typeof window.Peer === 'undefined') {
        throw new Error('Library PeerJS gagal dimuat.');
      }

      this.peer = new window.Peer(undefined, { debug: 0 });

      this.peer.on('open', () => {
        this.conn = this.peer.connect(targetPeerId, { reliable: true });
        this._setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        this._setStatus('FAILED', `Room tidak ditemukan atau gagal terhubung (${err?.type || 'timeout'}).`);
      });
    } catch (err) {
      this._setStatus('FAILED', err.message || 'Gagal bergabung ke room.');
    }
  }

  _setupConnectionHandlers() {
    if (!this.conn) return;

    this.conn.on('open', () => {
      this._setStatus('CONNECTED', `Terhubung di Room ${this.roomCode}!`);
      this.callbacks.onConnected?.(this.isHost);
    });

    this.conn.on('data', (payload) => {
      if (payload && typeof payload === 'object') {
        this.callbacks.onData?.(payload);
      }
    });

    this.conn.on('close', () => {
      this._setStatus('FAILED', 'Koneksi dengan lawan terputus.');
      this.callbacks.onDisconnected?.();
    });

    this.conn.on('error', () => {
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
    try {
      if (this.conn) this.conn.close();
      if (this.peer) this.peer.destroy();
    } catch {
      // Ignore cleanup errors
    }
    this.conn = null;
    this.peer = null;
    this._setStatus('IDLE', 'Siap');
  }
}
