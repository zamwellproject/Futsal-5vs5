import { generateRoomCode } from './utils.js';

const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
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
    this._connectedFired = false;
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
      if (this.status === 'CONNECTING' && !this._connectedFired) {
        this._setStatus('FAILED', msg);
      }
    }, 12000);
  }

  createRoom() {
    this.cleanup();
    this.isHost = true;
    this._connectedFired = false;
    this.roomCode = generateRoomCode();
    const peerId = `efutsal5v5-${this.roomCode}`;

    this._setStatus('CONNECTING', 'Menyiapkan room...');
    this._armConnectTimeout('Gagal membuat room (timeout). Klik Coba Lagi.');

    try {
      if (typeof window.Peer === 'undefined') {
        throw new Error('PeerJS belum termuat. Periksa koneksi internet.');
      }

      this.peer = new window.Peer(peerId, PEER_CONFIG);

      this.peer.on('open', () => {
        this._clearTimeout();
        this._setStatus('CONNECTING', `Room ${this.roomCode} siap! Berikan kode ini ke lawan.`);
        this.callbacks.onRoomCreated?.(this.roomCode);
      });

      this.peer.on('connection', (connection) => {
        if (this.conn && this.conn.open) {
          connection.close();
          return;
        }
        this.conn = connection;
        this._bindDataChannel();
      });

      this.peer.on('disconnected', () => {
        if (!this._connectedFired) {
          this._setStatus('FAILED', 'Koneksi ke server signaling terputus.');
        }
      });

      this.peer.on('error', (err) => {
        const type = err?.type || 'error';
        if (this._connectedFired) return;
        this._setStatus('FAILED', `Gangguan P2P (${type}). Coba buat room ulang.`);
      });
    } catch (err) {
      this._setStatus('FAILED', err.message || 'Gagal memulai room.');
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
    this._connectedFired = false;
    this.roomCode = cleanCode;
    const targetPeerId = `efutsal5v5-${cleanCode}`;

    this._setStatus('CONNECTING', `Menghubungkan ke room ${cleanCode}...`);
    this._armConnectTimeout(`Gagal terhubung ke room ${cleanCode}. Pastikan kode benar & Host sedang menunggu.`);

    try {
      if (typeof window.Peer === 'undefined') {
        throw new Error('PeerJS belum termuat.');
      }

      this.peer = new window.Peer(undefined, PEER_CONFIG);

      this.peer.on('open', () => {
        if (!this.peer || this.peer.destroyed) return;
        const connection = this.peer.connect(targetPeerId, {
          reliable: true,
          serialization: 'json'
        });
        this.conn = connection;
        this._bindDataChannel();
      });

      this.peer.on('error', (err) => {
        const type = err?.type || 'error';
        if (this._connectedFired) return;
        const msg =
          type === 'peer-unavailable'
            ? `Room ${cleanCode} tidak ditemukan atau sudah ditutup.`
            : `Gangguan koneksi P2P (${type}).`;
        this._setStatus('FAILED', msg);
      });
    } catch (err) {
      this._setStatus('FAILED', err.message || 'Gagal bergabung ke room.');
    }
  }

  _bindDataChannel() {
    if (!this.conn) return;

    const handleReady = () => {
      if (this._connectedFired) return;
      this._connectedFired = true;
      this._clearTimeout();
      this._setStatus('CONNECTED', `Terhubung ke Room ${this.roomCode}! Membuka kustomisasi...`);
      this.callbacks.onConnected?.(this.isHost);
    };

    if (this.conn.open) {
      handleReady();
    }

    this.conn.on('open', handleReady);

    // Fallback jika pesan pertama datang sebelum event open terdeteksi
    this.conn.on('data', (payload) => {
      if (!this._connectedFired) {
        handleReady();
      }
      if (payload && typeof payload === 'object') {
        this.callbacks.onData?.(payload);
      }
    });

    this.conn.on('close', () => {
      this._clearTimeout();
      if (this._connectedFired) {
        this._connectedFired = false;
        this._setStatus('FAILED', 'Koneksi dengan lawan terputus.');
        this.callbacks.onDisconnected?.();
      } else {
        this._setStatus('FAILED', 'Jalur koneksi ditutup sebelum terhubung.');
      }
    });

    this.conn.on('error', () => {
      this._clearTimeout();
      this._setStatus('FAILED', 'Terjadi gangguan koneksi P2P.');
    });
  }

  send(type, data = {}) {
    try {
      if (this.conn && this.conn.open) {
        this.conn.send({ type, data, ts: Date.now() });
      }
    } catch {
      // Aman saat koneksi ditutup
    }
  }

  cleanup() {
    this._clearTimeout();
    this._connectedFired = false;
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
