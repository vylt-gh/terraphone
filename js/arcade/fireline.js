/**
 * Terraphone — FIRELINE: Into the Forest
 * NASA Space Apps Challenge
 * 
 * Endless 2.5D isometric forest exploration game.
 * Features:
 * - Procedural isometric forest with pines, birch, rivers, and clearings
 * - NASA FIRMS thermal anomaly detection risk bands
 * - Glowing woodland spirit character with customizable spirit glow
 * - Forest seed collection & river spring restoration
 * - Golden Firefly Flight Easter egg transformation
 * - Shared procedural Web Audio soundscape
 */

import { arcadeTokens } from './arcade-tokens.js';

import { prepareGameArt, renderGame } from './art/frame.js';
import { paintWoodland, prepareWoodland } from './art/woodland.js';
import { woodlandReadout } from './game-readout.js';

export class FirelineGame {
  static prepareArtwork(width, height) {
    return prepareGameArt(width, height, prepareWoodland);
  }

  constructor(canvas, audioCtx, onExit) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioCtx = audioCtx;
    this.onExit = onExit;

    this.isRunning = false;
    this.isPaused = false;
    this.rafId = null;
    this.lastTime = 0;

    // World & Camera
    this.player = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      speed: 180, // px/s
      size: 14,
      trail: [],
      seedsCarried: 0,
      isFirefly: false,
      fireflyTimer: 0
    };

    this.camera = { x: 0, y: 0 };

    // Procedural grid & chunks
    this.tileSize = 48;
    this.seeds = [];
    this.springs = [];
    this.trees = [];
    this.firmsAnomalies = []; // NASA FIRMS heat risk zones

    // Stats
    this.seedsSaved = 0;
    this.distanceTraveled = 0;
    this.forestsRestored = 0;

    // Inputs
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false
    };

    this.audioNodes = null;

    this.initWorld();
    this.initInput();
    this.initAudio();
  }

  initWorld() {
    // Generate initial procedural forest features around origin
    this.trees = [];
    this.seeds = [];
    this.springs = [];
    this.firmsAnomalies = [];

    // Compact procedural grid for instant lag-free startup
    for (let x = -22; x <= 22; x++) {
      for (let y = -22; y <= 22; y++) {
        const dist = Math.hypot(x, y);
        if (dist < 3) continue; // Clear clearing at spawn

        const rand = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const fract = rand - Math.floor(rand);

        // Trees
        if (fract < 0.22) {
          this.trees.push({
            x: x * this.tileSize + (fract * 20 - 10),
            y: y * this.tileSize + (fract * 20 - 10),
            type: fract > 0.11 ? 'pine' : 'birch',
            size: 28 + Math.floor(fract * 24)
          });
        }

        // NASA FIRMS Thermal Anomaly Zones (warm satellite thermal hotspots)
        if (fract > 0.94 && dist > 7) {
          this.firmsAnomalies.push({
            x: x * this.tileSize,
            y: y * this.tileSize,
            radius: 80 + Math.floor(fract * 60),
            riskLevel: 'Moderate Anomaly (MODIS/VIIRS)',
            tempKelvin: Math.floor(315 + fract * 30)
          });
        }

        // Luminous seeds
        if (fract > 0.88 && fract <= 0.94) {
          const isGolden = (fract > 0.935);
          this.seeds.push({
            x: x * this.tileSize,
            y: y * this.tileSize,
            isGolden,
            collected: false
          });
        }

        // Sacred River Spring / Wells at designated intervals (3 ancient springs to restore)
        if ((x === 0 && y === 10) || (x === 14 && y === -12) || (x === -15 && y === 14)) {
          this.springs.push({
            x: x * this.tileSize,
            y: y * this.tileSize,
            active: true,
            restored: false,
            seedsNeeded: 4,
            seedsDeposited: 0
          });
        }
      }
    }

    // Pre-sort trees once during generation to eliminate per-frame sorting overhead
    this.trees.sort((a, b) => a.y - b.y);
    this.isVictory = false;
  }

  initInput() {
    this.pointerState = { active: false, x: 0, y: 0 };

    this.onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') this.keys.up = true;
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.keys.down = true;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.keys.left = true;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.keys.right = true;
      if (e.key === 'Escape') {
        this.stop();
        if (this.onExit) this.onExit();
      }
    };

    this.onKeyUp = (e) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') this.keys.up = false;
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.keys.down = false;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.keys.left = false;
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.keys.right = false;
    };

    this.onPointerDown = (e) => {
      this.pointerState.active = true;
      this.pointerState.x = e.clientX;
      this.pointerState.y = e.clientY;
      if (this.canvas?.setPointerCapture && e.pointerId != null) {
        try { this.canvas.setPointerCapture(e.pointerId); } catch {}
      }
    };

    this.onPointerMove = (e) => {
      if (this.pointerState.active) {
        this.pointerState.x = e.clientX;
        this.pointerState.y = e.clientY;
      }
    };

    this.onPointerUp = (e) => {
      this.pointerState.active = false;
      if (this.canvas?.releasePointerCapture && e.pointerId != null) {
        try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
      }
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas?.addEventListener?.('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  restart() {
    this.isVictory = false;
    this.player.x = 0;
    this.player.y = 0;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.seedsCarried = 0;
    this.player.isFirefly = false;
    this.player.fireflyTimer = 0;
    this.seedsSaved = 0;
    this.distanceTraveled = 0;
    this.forestsRestored = 0;
    this.initMap();
  }

  triggerFireflyMode(duration = 10) {
    this.player.isFirefly = true;
    this.player.fireflyTimer = duration;
    arcadeTokens.unlockEasterEgg('Golden Firefly Flight', 5);
    this.playChime(880);
  }

  getSpeed() {
    return this.player.isFirefly ? this.player.speed * 1.5 : this.player.speed;
  }

  initAudio() {
    if (!this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const master = this.audioCtx.createGain();
      master.gain.setValueAtTime(0.7, now);
      master.connect(this.audioCtx.destination);

      // Forest Wind Ambience
      const bufferSize = this.audioCtx.sampleRate * 2;
      const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const windSource = this.audioCtx.createBufferSource();
      windSource.buffer = noiseBuffer;
      windSource.loop = true;

      const windFilter = this.audioCtx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.setValueAtTime(450, now);
      windFilter.Q.setValueAtTime(1.2, now);

      const windGain = this.audioCtx.createGain();
      windGain.gain.setValueAtTime(0.08, now);

      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      windSource.start();

      this.audioNodes = { master, windGain, windFilter };
    } catch (e) {}
  }

  playChime(freq = 640) {
    if (!this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.6, now + 0.35);

      g.gain.setValueAtTime(0.14, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(g);
      g.connect(this.audioNodes ? this.audioNodes.master : this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    } catch (e) {}
  }

  update(dt) {
    if (this.isVictory) return;

    // Movement: Convert screen intent (WASD / Arrows or Mouse Pointer) to isometric world direction
    let sx = 0;
    let sy = 0;
    if (this.keys.up) sy -= 1;
    if (this.keys.down) sy += 1;
    if (this.keys.left) sx -= 1;
    if (this.keys.right) sx += 1;

    if (this.pointerState?.active && sx === 0 && sy === 0 && this.canvas?.getBoundingClientRect) {
      const rect = this.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = this.pointerState.x - cx;
      const dy = this.pointerState.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 15) {
        sx = dx / dist;
        sy = dy / dist;
      }
    }

    const curSpeed = this.player.isFirefly ? this.player.speed * 1.5 : this.player.speed;

    if (sx !== 0 || sy !== 0) {
      const sLen = Math.hypot(sx, sy);
      const nSx = sx / sLen;
      const nSy = sy / sLen;
      const cos30 = Math.cos(Math.PI / 6);
      const sin30 = Math.sin(Math.PI / 6);
      const wx = (nSx / cos30 + nSy / sin30) / 2;
      const wy = (nSy / sin30 - nSx / cos30) / 2;
      const wLen = Math.hypot(wx, wy);
      this.player.vx = (wx / wLen) * curSpeed;
      this.player.vy = (wy / wLen) * curSpeed;
    } else {
      this.player.vx *= 0.8;
      this.player.vy *= 0.8;
    }

    this.player.x += this.player.vx * dt;
    this.player.y += this.player.vy * dt;

    // Particle light trail
    this.player.trail.unshift({ x: this.player.x, y: this.player.y, alpha: 1.0 });
    if (this.player.trail.length > 18) this.player.trail.pop();
    this.player.trail.forEach(t => t.alpha -= dt * 2.2);

    // Camera smoothly follows player
    this.camera.x += (this.player.x - this.camera.x) * 0.1;
    this.camera.y += (this.player.y - this.camera.y) * 0.1;

    // Track distance
    this.distanceTraveled = Math.floor(Math.hypot(this.player.x, this.player.y) / 10);

    // Firefly mode timer
    if (this.player.isFirefly) {
      this.player.fireflyTimer -= dt;
      if (this.player.fireflyTimer <= 0) {
        this.player.isFirefly = false;
      }
    }

    // Seed collection
    this.seeds.forEach(s => {
      if (!s.collected && Math.hypot(this.player.x - s.x, this.player.y - s.y) < 28) {
        s.collected = true;
        this.player.seedsCarried += 1;
        this.playChime(s.isGolden ? 880 : 580);

        if (s.isGolden) {
          // Transform into soaring firefly
          this.player.isFirefly = true;
          this.player.fireflyTimer = 10;
          arcadeTokens.unlockEasterEgg('Golden Firefly Flight', 10);
        }
      }
    });

    // Sacred Spring restoration deposit
    this.springs.forEach(sp => {
      if (!sp.restored && this.player.seedsCarried > 0 && Math.hypot(this.player.x - sp.x, this.player.y - sp.y) < 55) {
        const deposit = Math.min(this.player.seedsCarried, sp.seedsNeeded - sp.seedsDeposited);
        sp.seedsDeposited += deposit;
        this.player.seedsCarried -= deposit;
        this.seedsSaved += deposit;
        if (sp.seedsDeposited >= sp.seedsNeeded) {
          sp.restored = true;
          this.forestsRestored += 1;
          arcadeTokens.addTokens(1, 'Restored Forest Spring');
          this.playChime(1040);
        } else {
          this.playChime(780);
        }

        // Check overall victory condition (all 3 springs restored)
        if (this.springs.every(s => s.restored) && !this.isVictory) {
          this.isVictory = true;
          arcadeTokens.addTokens(5, 'Forest Watershed Fully Restored');
          this.playChime(1200);
        }
      }
    });

    arcadeTokens.recordHighScore('fireline', this.seedsSaved, 'seeds');
  }

  // Convert 2D world coords to 2.5D Isometric screen coords
  worldToIso(wx, wy) {
    const cx = wx - this.camera.x;
    const cy = wy - this.camera.y;
    return {
      x: (cx - cy) * Math.cos(Math.PI / 6) + this.canvas.width / 2,
      y: (cx + cy) * Math.sin(Math.PI / 6) + this.canvas.height / 2
    };
  }

  render() {
    renderGame(this, paintWoodland, woodlandReadout);
  }

  start() {
    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();

    const loop = (time) => {
      if (!this.isRunning) return;
      const dt = Math.min(0.05, (time - this.lastTime) / 1000);
      this.lastTime = time;

      if (!this.isPaused) {
        this.update(dt);
        this.render();
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; this.lastTime = performance.now(); }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas?.removeEventListener?.('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);

    if (this.audioNodes && this.audioCtx) {
      try {
        const now = this.audioCtx.currentTime;
        this.audioNodes.master.gain.setTargetAtTime(0, now, 0.1);
      } catch (e) {}
    }
  }
}
