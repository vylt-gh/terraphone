import { arcadeTokens } from './arcade-tokens.js';
import { renderGame } from './art/frame.js';
import { paintCanopy } from './art/canopy.js';
import { canopyReadout } from './game-readout.js';

export class LastForestGame {
  constructor(canvas, audioCtx, onExit) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onExit = onExit;

    this.isRunning = false;
    this.isPaused = false;
    this.isGameOver = false;
    this.isVictory = false;
    this.rafId = null;

    // Winged Sycamore Seed Flight Physics (Full 2D Aerodynamic Banking)
    this.seed = {
      x: canvas.width / 2,
      y: canvas.height * 0.45,
      vx: 0,
      vy: 0,
      tilt: 0,
      altitude: 100, // 0 - 100%
      seedsPlanted: 0,
      targetSeeds: 10
    };

    this.keys = { left: false, right: false, up: false, down: false };
    this.distance = 0;
    this.canopyLayers = [];
    this.thermalUpdrafts = [];
    this.wildfireSmokePlumes = []; // NASA FIRMS Obstacles

    this.initForest();
    this.initInput();
  }

  initForest() {
    this.canopyLayers = [];
    this.thermalUpdrafts = [];
    this.wildfireSmokePlumes = [];

    // Layered forest canopy
    for (let i = 0; i < 60; i++) {
      this.canopyLayers.push({
        x: Math.random() * this.canvas.width,
        y: -i * 120,
        r: 32 + Math.random() * 45,
        type: i % 2 === 0 ? 'redwood' : 'ancient_oak'
      });

      // Warm thermal updrafts (rise higher)
      if (i % 5 === 2) {
        this.thermalUpdrafts.push({
          x: 60 + Math.random() * (this.canvas.width - 120),
          y: -i * 120,
          r: 42
        });
      }

      // Wildfire smoke vortex obstacles (FIRMS)
      if (i % 7 === 4) {
        this.wildfireSmokePlumes.push({
          x: 60 + Math.random() * (this.canvas.width - 120),
          y: -i * 120,
          r: 48,
          hazard: '🔥 FIRMS Thermal Plume'
        });
      }
    }
  }

  initInput() {
    this.mouseTarget = { active: false, x: 0, y: 0 };

    this.onKeyDown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = true;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.up = true;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.keys.down = true;
      if (e.key === 'r' || e.key === 'R') {
        if (this.isVictory || this.isGameOver) this.restart();
      }
      if (e.key === 'Escape') { this.stop(); this.onExit?.(); }
    };
    this.onKeyUp = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = false;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.up = false;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.keys.down = false;
    };

    const updatePointerPos = (e) => {
      if (!this.canvas?.getBoundingClientRect) return;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.mouseTarget.active = true;
      this.mouseTarget.x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      this.mouseTarget.y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    };

    this.onPointerDown = (e) => {
      if (this.isVictory || this.isGameOver) {
        this.restart();
        return;
      }
      updatePointerPos(e);
    };

    this.onPointerMove = (e) => {
      if (e.buttons > 0 || this.mouseTarget.active) {
        updatePointerPos(e);
      }
    };

    this.onPointerUp = () => {
      this.mouseTarget.active = false;
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas?.addEventListener?.('pointerdown', this.onPointerDown);
    this.canvas?.addEventListener?.('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  restart() {
    this.isVictory = false;
    this.isGameOver = false;
    this.seed.x = this.canvas.width / 2;
    this.seed.y = this.canvas.height * 0.45;
    this.seed.vx = 0;
    this.seed.vy = 0;
    this.seed.tilt = 0;
    this.seed.altitude = 100;
    this.seed.seedsPlanted = 0;
    this.distance = 0;
    this.mouseTarget.active = false;
    this.initForest();
  }

  update(dt) {
    if (this.isVictory || this.isGameOver) return;

    // Full 2D Aerodynamic Banking Flight (Keyboard or Mouse Pointer)
    if (this.keys.left) {
      this.seed.vx -= 420 * dt;
      this.seed.tilt = Math.max(-0.45, this.seed.tilt - 2.5 * dt);
    } else if (this.keys.right) {
      this.seed.vx += 420 * dt;
      this.seed.tilt = Math.min(0.45, this.seed.tilt + 2.5 * dt);
    } else if (this.mouseTarget?.active) {
      const dx = this.mouseTarget.x - this.seed.x;
      if (Math.abs(dx) > 15) {
        if (dx < 0) {
          this.seed.vx -= 420 * dt;
          this.seed.tilt = Math.max(-0.45, this.seed.tilt - 2.5 * dt);
        } else {
          this.seed.vx += 420 * dt;
          this.seed.tilt = Math.min(0.45, this.seed.tilt + 2.5 * dt);
        }
      } else {
        this.seed.vx *= 0.85;
        this.seed.tilt *= 0.82;
      }
    } else {
      this.seed.vx *= 0.85;
      this.seed.tilt *= 0.82;
    }

    if (this.keys.up) {
      this.seed.vy -= 260 * dt;
    } else if (this.keys.down) {
      this.seed.vy += 260 * dt;
    } else if (this.mouseTarget?.active) {
      const dy = this.mouseTarget.y - this.seed.y;
      if (Math.abs(dy) > 15) {
        if (dy < 0) {
          this.seed.vy -= 260 * dt;
        } else {
          this.seed.vy += 260 * dt;
        }
      } else {
        this.seed.vy *= 0.85;
      }
    } else {
      this.seed.vy *= 0.85;
    }

    this.seed.x += this.seed.vx * dt;
    this.seed.y += this.seed.vy * dt;

    // Keep seed in screen
    this.seed.x = Math.max(30, Math.min(this.canvas.width - 30, this.seed.x));
    this.seed.y = Math.max(50, Math.min(this.canvas.height - 120, this.seed.y));

    this.distance += dt * 42;

    // Scroll canopy downward
    const scrollY = 120 * dt;
    this.canopyLayers.forEach(c => {
      c.y += scrollY;
      if (c.y > this.canvas.height + 60) {
        c.y = -60;
        c.x = Math.random() * this.canvas.width;
      }
    });

    // Check thermal updrafts (replenish altitude & seeds)
    this.thermalUpdrafts.forEach(t => {
      t.y += scrollY;
      if (t.y > this.canvas.height + 60) {
        t.y = -60;
        t.x = Math.random() * this.canvas.width;
      }
      if (Math.hypot(this.seed.x - t.x, this.seed.y - t.y) < t.r + 20) {
        this.seed.altitude = Math.min(100, this.seed.altitude + 15 * dt);
        if (Math.random() < 0.04) {
          this.seed.seedsPlanted += 1;
          arcadeTokens.addTokens(2, 'Dispersed Forest Sycamore Seed');
          if (this.seed.seedsPlanted >= this.seed.targetSeeds && !this.isVictory) {
            this.isVictory = true;
            arcadeTokens.addTokens(5, 'Ancient Forest Reforested');
          }
        }
      }
    });

    // Check wildfire smoke hazards (FIRMS)
    this.wildfireSmokePlumes.forEach(p => {
      p.y += scrollY;
      if (p.y > this.canvas.height + 60) {
        p.y = -60;
        p.x = Math.random() * this.canvas.width;
      }
      if (Math.hypot(this.seed.x - p.x, this.seed.y - p.y) < p.r + 15) {
        this.seed.altitude = Math.max(0, this.seed.altitude - 35 * dt);
        if (this.seed.altitude <= 0) {
          this.isGameOver = true;
        }
      }
    });

    arcadeTokens.recordHighScore('last_forest', this.seed.seedsPlanted, 'seeds');
  }

  render() {
    renderGame(this, paintCanopy, canopyReadout);
  }

  start() {
    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();
    const loop = (t) => {
      if (!this.isRunning) return;
      if (!this.isPaused) {
        const dt = Math.min(0.05, Math.max(0.001, (t - (this.lastTime || t)) / 1000 || 0.016));
        this.lastTime = t;
        this.update(dt);
        this.render();
      } else {
        this.lastTime = t;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; }
  stop() {
    this.isRunning = false;
    this.isPaused = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas?.removeEventListener?.('pointerdown', this.onPointerDown);
    this.canvas?.removeEventListener?.('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}
