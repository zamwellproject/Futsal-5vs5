import { clamp, normalize } from './utils.js';

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.joyVec = { x: 0, y: 0 };
    this.touchActive = false;
    this.curveModeMobile = false;

    this.state = {
      moveX: 0,
      moveY: 0,
      sprint: false,
      shootHeld: false,
      shootCharge: 0,
      curveBias: 0, // -1 (kiri) s/d +1 (kanan)
      justPass: false,
      justThrough: false,
      justSwitch: false,
      justShootRelease: false
    };

    this._joyTouchId = null;
    this._bindKeyboard();
    this._bindTouch();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
        if (document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }
      if (!this.keys.has(code)) {
        if (code === 'KeyJ') this.state.justPass = true;
        if (code === 'KeyL') this.state.justThrough = true;
        if (code === 'KeyQ') this.state.justSwitch = true;
        if (code === 'KeyK' || code === 'Space') {
          this.state.shootHeld = true;
          this.state.shootCharge = 0.15;
        }
      }
      this.keys.add(code);
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      this.keys.delete(code);
      if (code === 'KeyK' || code === 'Space') {
        if (this.state.shootHeld) {
          this.state.justShootRelease = true;
        }
        this.state.shootHeld = false;
      }
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.state.shootHeld = false;
      this.state.sprint = false;
    });
  }

  _bindTouch() {
    const joyZone = document.getElementById('joystick-zone');
    const joyStick = document.getElementById('joystick-stick');
    const maxRadius = 38;

    const resetJoy = () => {
      this._joyTouchId = null;
      this.joyVec = { x: 0, y: 0 };
      if (joyStick) joyStick.style.transform = 'translate(-50%, -50%)';
    };

    if (joyZone) {
      joyZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        if (!t) return;
        this._joyTouchId = t.identifier;
        this._updateJoyFromTouch(t, joyZone, joyStick, maxRadius);
      }, { passive: false });

      joyZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (t.identifier === this._joyTouchId) {
            this._updateJoyFromTouch(t, joyZone, joyStick, maxRadius);
          }
        }
      }, { passive: false });

      joyZone.addEventListener('touchend', (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this._joyTouchId) resetJoy();
        }
      });
      joyZone.addEventListener('touchcancel', resetJoy);
    }

    // Bind tombol aksi layar sentuh
    const bindBtn = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        onDown?.();
      }, { passive: false });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        onUp?.();
      }, { passive: false });
      el.addEventListener('touchcancel', () => onUp?.());
    };

    bindBtn('btn-touch-pass', () => { this.state.justPass = true; });
    bindBtn('btn-touch-through', () => { this.state.justThrough = true; });
    bindBtn('btn-touch-switch', () => { this.state.justSwitch = true; });
    bindBtn('btn-touch-sprint',
      () => { this.state.sprint = true; },
      () => { this.state.sprint = false; }
    );
    bindBtn('btn-touch-shoot',
      () => {
        this.state.shootHeld = true;
        this.state.shootCharge = 0.2;
      },
      () => {
        if (this.state.shootHeld) {
          this.state.justShootRelease = true;
        }
        this.state.shootHeld = false;
      }
    );

    const curveBtn = document.getElementById('btn-touch-curve');
    if (curveBtn) {
      curveBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.curveModeMobile = !this.curveModeMobile;
        curveBtn.classList.toggle('active', this.curveModeMobile);
        curveBtn.innerHTML = `CURVE<br><small>${this.curveModeMobile ? 'ON' : 'OFF'}</small>`;
      }, { passive: false });
    }
  }

  _updateJoyFromTouch(touch, zone, stick, maxR) {
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = touch.clientX - cx;
    const dy = touch.clientY - cy;
    const d = Math.hypot(dx, dy);
    const clampedD = Math.min(d, maxR);
    const angle = Math.atan2(dy, dx);
    const ox = Math.cos(angle) * clampedD;
    const oy = Math.sin(angle) * clampedD;

    if (stick) {
      stick.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
    }
    this.joyVec = {
      x: clampedD > 6 ? ox / maxR : 0,
      y: clampedD > 6 ? oy / maxR : 0
    };
  }

  update(dt) {
    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky += 1;

    const hasJoy = Math.hypot(this.joyVec.x, this.joyVec.y) > 0.05;
    if (hasJoy) {
      this.state.moveX = clamp(this.joyVec.x, -1, 1);
      this.state.moveY = clamp(this.joyVec.y, -1, 1);
    } else {
      const n = normalize(kx, ky);
      this.state.moveX = n.x;
      this.state.moveY = n.y;
    }

    if (this.keys.has('KeyE') || this.keys.has('ShiftLeft')) {
      this.state.sprint = true;
    } else if (!hasJoy) {
      this.state.sprint = false;
    }

    // Charge power & curve saat tombol tembak ditahan
    if (this.state.shootHeld) {
      this.state.shootCharge = clamp(this.state.shootCharge + dt * 1.15, 0.15, 1.0);
      // Arah vertikal joystick/keyboard saat menahan tembakan menentukan belokan curve
      const biasInput = clamp(this.state.moveY, -1, 1);
      if (Math.abs(biasInput) > 0.15) {
        this.state.curveBias = biasInput;
      } else if (this.curveModeMobile) {
        // Otomatis lengkung ke arah tiang jauh jika mode curve aktif di HP
        this.state.curveBias = 0.75;
      } else {
        this.state.curveBias *= 0.9;
      }
    }
  }

  consumeTriggers() {
    const snap = {
      moveX: this.state.moveX,
      moveY: this.state.moveY,
      sprint: this.state.sprint,
      shootHeld: this.state.shootHeld,
      shootCharge: this.state.shootCharge,
      curveBias: this.state.curveBias,
      justPass: this.state.justPass,
      justThrough: this.state.justThrough,
      justSwitch: this.state.justSwitch,
      justShootRelease: this.state.justShootRelease
    };
    this.state.justPass = false;
    this.state.justThrough = false;
    this.state.justSwitch = false;
    if (this.state.justShootRelease) {
      this.state.justShootRelease = false;
      this.state.shootCharge = 0;
    }
    return snap;
  }
}
