import { arcadeTokens } from './arcade-tokens.js';
import { renderGame } from './art/frame.js';
import { paintCloud } from './art/cloud.js';
import { cloudReadout } from './game-readout.js';

export class CloudCourierGame {
  constructor(canvas, audioCtx, onExit) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioCtx = audioCtx;
    this.onExit = onExit;

    this.isRunning = false;
    this.isPaused = false;
    this.isGameOver = false;
    this.isVictory = false;
    this.rafId = null;

    // Flappy Bird-inspired atmospheric cloud physics
    this.cloud = {
      x: 160,
      y: canvas.height * 0.45,
      vy: 0,
      gravity: 580,
      liftStrength: -260,
      purity: 100, // 0 - 100%
      distance: 0,
      gatesCleared: 0
    };

    this.ghostPurity = 100;
    this.damageFlash = 0;
    this.particles = [];
    this.lastDamageSfxTime = 0;
    this.milestonesPassed = 0;
    this.milestoneBannerTimer = 0;
    this.milestoneBannerText = '';

    this.smokestackGates = [];
    this.vaporDrops = [];
    this.initAtmosphere();
    this.initInput();
  }

  initAtmosphere() {
    this.smokestackGates = [];
    this.vaporDrops = [];
    const gateGap = 205; // Initial vertical flight corridor

    // Initialize initial conveyor of 8 gates
    for (let i = 0; i < 8; i++) {
      const topHeight = 60 + Math.random() * (this.canvas.height - gateGap - 140);
      this.smokestackGates.push({
        x: 550 + i * 360,
        w: 64,
        topH: topHeight,
        bottomY: topHeight + gateGap,
        passed: false,
        pollutant: i % 2 === 0 ? 'SO₂ (Sulfur Dioxide)' : 'NO₂ (Nitrogen Dioxide)'
      });

      this.vaporDrops.push({
        x: 550 + i * 360 + 180,
        y: topHeight + gateGap / 2 + (Math.random() * 40 - 20),
        collected: false
      });
    }
  }

  playSfx(type) {
    if (!this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      const now = this.audioCtx.currentTime;

      if (type === 'flap') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(480, now + 0.12);
        g.gain.setValueAtTime(0.12, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.13);
      } else if (type === 'acid') {
        // Harsh sizzling alarm buzz
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(140, now + 0.08);
        g.gain.setValueAtTime(0.22, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === 'pickup') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(659, now);
        osc.frequency.setValueAtTime(880, now + 0.08);
        g.gain.setValueAtTime(0.14, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === 'milestone') {
        const chord = [523.25, 659.25, 783.99, 1046.50];
        chord.forEach((freq, idx) => {
          const osc = this.audioCtx.createOscillator();
          const g = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.04);
          g.gain.setValueAtTime(0.10, now + idx * 0.04);
          g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.35);
          osc.connect(g);
          g.connect(this.audioCtx.destination);
          osc.start(now + idx * 0.04);
          osc.stop(now + idx * 0.04 + 0.36);
        });
      }
    } catch (e) {
      // Audio fallback
    }
  }

  initInput() {
    this.flap = () => {
      if (this.isGameOver) {
        this.restart();
        return;
      }
      this.cloud.vy = this.cloud.liftStrength;
      this.playSfx('flap');
    };

    this.onKeyDown = (e) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        this.flap();
      }
      if (e.key === 'r' || e.key === 'R') {
        if (this.isGameOver) this.restart();
      }
      if (e.key === 'Escape') { this.stop(); this.onExit?.(); }
    };

    this.onPointerDown = () => {
      if (this.isGameOver) {
        this.restart();
        return;
      }
      this.flap();
    };

    this.onWheel = (e) => {
      e.preventDefault();
      if (e.deltaY < 0) this.flap();
    };

    window.addEventListener('keydown', this.onKeyDown);
    this.canvas?.addEventListener?.('pointerdown', this.onPointerDown);
    this.canvas?.addEventListener?.('wheel', this.onWheel, { passive: false });
  }

  restart() {
    this.isGameOver = false;
    this.cloud.y = this.canvas.height * 0.45;
    this.cloud.vy = 0;
    this.cloud.purity = 100;
    this.ghostPurity = 100;
    this.damageFlash = 0;
    this.particles = [];
    this.cloud.gatesCleared = 0;
    this.cloud.distance = 0;
    this.milestonesPassed = 0;
    this.milestoneBannerTimer = 0;
    this.initAtmosphere();
  }

  update(dt) {
    if (this.isGameOver) return;

    this.damageFlash = Math.max(0, this.damageFlash - 3.8 * dt);

    // Aerodynamic gravity and lift
    this.cloud.vy += this.cloud.gravity * dt;
    this.cloud.y += this.cloud.vy * dt;
    this.cloud.distance += dt * 40;

    // Screen ceiling & floor collision (Crashing into mountain ridge or stratopause)
    if (this.cloud.y < 20 || this.cloud.y > this.canvas.height - 30) {
      this.cloud.purity = 0;
      this.damageFlash = 1.0;
      this.isGameOver = true;
      arcadeTokens.recordHighScore('cloud_courier', this.cloud.gatesCleared, 'gates');
      return;
    }

    // Smooth lagging ghost purity bar
    if (this.ghostPurity > this.cloud.purity) {
      this.ghostPurity = Math.max(this.cloud.purity, this.ghostPurity - 26 * dt);
    } else {
      this.ghostPurity = this.cloud.purity;
    }

    // Accelerating infinite wind speed
    const scrollSpeed = 165 + Math.min(240, this.cloud.gatesCleared * 3.8);

    // Update smokestack obstacles
    this.smokestackGates.forEach(g => {
      g.x -= scrollSpeed * dt;

      // Passing gate successfully
      if (!g.passed && g.x + g.w < this.cloud.x) {
        g.passed = true;
        this.cloud.gatesCleared += 1;
        arcadeTokens.addTokens(1, 'Navigated Clean Air Channel');

        // Endless milestone check every 10 gates
        const milestone = Math.floor(this.cloud.gatesCleared / 10);
        if (milestone > this.milestonesPassed) {
          this.milestonesPassed = milestone;
          arcadeTokens.addTokens(5, `Cloud Courier: ${milestone * 10} Gates Milestone!`);
          this.milestoneBannerTimer = 3.5;
          this.milestoneBannerText = `${milestone * 10} gates · +5 tokens`;
          this.playSfx('milestone');
        }
      }

      // Collision with pollution plumes / smokestack towers
      if (this.cloud.x + 20 >= g.x && this.cloud.x - 20 <= g.x + g.w) {
        if (this.cloud.y - 16 <= g.topH || this.cloud.y + 16 >= g.bottomY) {
          // Take acid pollution damage
          this.cloud.purity = Math.max(0, this.cloud.purity - 46 * dt);
          this.damageFlash = Math.min(0.65, this.damageFlash + 0.22);

          // Sizzling soot and acid particles (lightweight)
          if (this.particles.length < 20) {
            this.particles.push({
              x: this.cloud.x + (Math.random() * 16 - 8),
              y: this.cloud.y + (Math.random() * 12 - 6),
              vx: -scrollSpeed * 0.4 + (Math.random() - 0.5) * 40,
              vy: (Math.random() - 0.5) * 50,
              size: 3 + Math.random() * 4,
              color: Math.random() < 0.5 ? '#ef4444' : '#475569',
              life: 0.35,
              maxLife: 0.35
            });
          }

          // Throttle the acid contact sound
          const now = performance.now();
          if (now - this.lastDamageSfxTime > 320) {
            this.lastDamageSfxTime = now;
            this.playSfx('acid');
          }

          if (this.cloud.purity <= 0) {
            this.isGameOver = true;
          }
        }
      }
    });

    // Infinite gate generator: recycle passed gates
    this.smokestackGates = this.smokestackGates.filter(g => g.x + g.w > -140);
    while (this.smokestackGates.length < 8) {
      const lastX = this.smokestackGates.reduce((m, g) => Math.max(m, g.x), this.cloud.x + 300);
      const gateSpacing = Math.max(260, 360 - this.cloud.gatesCleared * 1.5);
      const gateGap = Math.max(145, 205 - this.cloud.gatesCleared * 0.9);
      const topHeight = 60 + Math.random() * (this.canvas.height - gateGap - 140);
      const nextGateIdx = this.cloud.gatesCleared + this.smokestackGates.length;

      this.smokestackGates.push({
        x: lastX + gateSpacing,
        w: 64,
        topH: topHeight,
        bottomY: topHeight + gateGap,
        passed: false,
        pollutant: nextGateIdx % 2 === 0 ? 'SO₂ (Sulfur Dioxide)' : 'NO₂ (Nitrogen Dioxide)'
      });

      this.vaporDrops.push({
        x: lastX + gateSpacing + gateSpacing / 2,
        y: topHeight + gateGap / 2 + (Math.random() * 40 - 20),
        collected: false
      });
    }

    // Collect clean vapor motes
    this.vaporDrops.forEach(v => {
      v.x -= scrollSpeed * dt;
      if (!v.collected && Math.hypot(this.cloud.x - v.x, this.cloud.y - v.y) < 34) {
        v.collected = true;
        this.cloud.purity = Math.min(100, this.cloud.purity + 18);
        this.playSfx('pickup');
      }
    });
    this.vaporDrops = this.vaporDrops.filter(v => !v.collected && v.x > -80);

    // Update particles
    this.particles.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    });
    this.particles = this.particles.filter(p => p.life > 0);


    // Timers
    if (this.milestoneBannerTimer > 0) this.milestoneBannerTimer -= dt;

    arcadeTokens.recordHighScore('cloud_courier', this.cloud.gatesCleared, 'gates');
  }

  render() {
    renderGame(this, paintCloud, cloudReadout);
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
    this.canvas?.removeEventListener?.('pointerdown', this.onPointerDown);
    this.canvas?.removeEventListener?.('wheel', this.onWheel);
  }
}
