import { arcadeTokens } from './arcade-tokens.js';
import { renderGame } from './art/frame.js';
import { paintReef } from './art/reef.js';
import { reefReadout } from './game-readout.js';

export class CoralCurrentGame {
  constructor(canvas, audioCtx, onExit) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioCtx = audioCtx;
    this.onExit = onExit;

    this.isRunning = false;
    this.isPaused = false;
    this.isGameOver = false;
    this.rafId = null;

    // Active Sea Turtle Physics & Health
    this.turtle = {
      x: 140,
      y: canvas.height * 0.45,
      vy: 0,
      swimStrength: -210,
      diveStrength: 340,
      gravity: 280,
      flipperAngle: 0,
      hp: 100,
      stamina: 100,
      isDashing: false,
      dashTimer: 0,
      invulnTimer: 0,
      isBraking: false
    };

    this.ghostHp = 100;
    this.distance = 0;
    this.milestonesPassed = 0;
    this.milestoneBannerTimer = 0;
    this.milestoneBannerText = '';

    // Damage & Screen effects
    this.biteFlash = 0;
    this.particles = [];
    this.bubbles = [];

    // Entities
    this.corals = [];
    this.predators = [];
    this.seaSponges = [];

    this.nextPredatorDist = 300;
    this.coralsRevived = 0;
    this.predatorsEvaded = 0;

    this.initReef();
    this.initInput();
  }

  initReef() {
    this.corals = [];
    this.predators = [];
    this.seaSponges = [];

    // Generate initial undulating reef cavern (Floor AND Ceiling corals across entire screen)
    for (let i = 0; i < 16; i++) {
      const cx = 350 + i * 160;
      this.spawnCoralPair(cx, i);
    }

    // Ambient floating bubbles
    this.bubbles.length = 0;
    for (let b = 0; b < 24; b++) {
      this.bubbles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vy: -20 - Math.random() * 40,
        r: 2 + Math.random() * 4
      });
    }
  }

  spawnCoralPair(x, index) {
    const h = this.canvas.height;
    const isBleached = (index % 4 === 1);
    const coralType = index % 3; // 0: Staghorn, 1: Brain Coral, 2: Sea Fan

    // Floor Coral (grows upward from sand)
    const floorH = 90 + Math.random() * 140;
    this.corals.push({
      x,
      y: h - 35,
      height: floorH,
      width: 48 + Math.random() * 26,
      type: coralType,
      isCeiling: false,
      bleached: isBleached,
      revived: false
    });

    // Ceiling Coral (hangs downward like stalactite reef)
    const ceilingH = 80 + Math.random() * 130;
    this.corals.push({
      x: x + 70,
      y: 0,
      height: ceilingH,
      width: 44 + Math.random() * 24,
      type: (coralType + 1) % 3,
      isCeiling: true,
      bleached: false,
      revived: false
    });

    // Spawn healing sea sponge periodically
    if (index % 3 === 0) {
      this.seaSponges.push({
        x: x + 80,
        y: h * 0.45 + (Math.random() * 140 - 70),
        collected: false
      });
    }
  }

  playSfx(type) {
    if (!this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      const now = this.audioCtx.currentTime;

      if (type === 'paddle') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(70, now + 0.14);
        g.gain.setValueAtTime(0.14, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'dive') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.18);
        g.gain.setValueAtTime(0.16, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === 'dash') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.22);
        g.gain.setValueAtTime(0.20, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.23);
      } else if (type === 'bite') {
        // Terrifying predatory crunch
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc1.type = 'sawtooth';
        osc2.type = 'square';
        osc1.frequency.setValueAtTime(120, now);
        osc1.frequency.exponentialRampToValueAtTime(40, now + 0.22);
        osc2.frequency.setValueAtTime(280, now);
        osc2.frequency.exponentialRampToValueAtTime(80, now + 0.16);
        g.gain.setValueAtTime(0.30, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc1.connect(g);
        osc2.connect(g);
        g.connect(this.audioCtx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.23);
        osc2.stop(now + 0.23);
      } else if (type === 'scrape') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.14);
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'upwelling') {
        const chord = [392.00, 523.25, 659.25];
        chord.forEach((freq, idx) => {
          const osc = this.audioCtx.createOscillator();
          const g = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.03);
          g.gain.setValueAtTime(0.12, now + idx * 0.03);
          g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.03 + 0.28);
          osc.connect(g);
          g.connect(this.audioCtx.destination);
          osc.start(now + idx * 0.03);
          osc.stop(now + idx * 0.03 + 0.29);
        });
      } else if (type === 'milestone') {
        const chord = [440, 554.37, 659.25, 880];
        chord.forEach((freq, idx) => {
          const osc = this.audioCtx.createOscillator();
          const g = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.05);
          g.gain.setValueAtTime(0.12, now + idx * 0.05);
          g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.4);
          osc.connect(g);
          g.connect(this.audioCtx.destination);
          osc.start(now + idx * 0.05);
          osc.stop(now + idx * 0.05 + 0.42);
        });
      }
    } catch (e) {
      // Audio fallback
    }
  }

  initInput() {
    this.paddle = () => {
      if (this.isGameOver) {
        this.restart();
        return;
      }
      this.turtle.vy = this.turtle.swimStrength;
      this.turtle.flipperAngle = 0.55;
      this.playSfx('paddle');
    };

    this.diveBomb = () => {
      if (this.isGameOver) return;
      this.turtle.vy = this.turtle.diveStrength;
      this.turtle.flipperAngle = -0.55;
      this.playSfx('dive');
    };

    this.dash = () => {
      if (this.isGameOver) return;
      if (this.turtle.stamina >= 30 && !this.turtle.isDashing) {
        this.turtle.stamina -= 30;
        this.turtle.isDashing = true;
        this.turtle.dashTimer = 0.38;
        this.turtle.invulnTimer = 0.45;
        this.playSfx('dash');

        // Hydro jet bubble blast
        for (let b = 0; b < 14; b++) {
          this.bubbles.push({
            x: this.turtle.x - 20,
            y: this.turtle.y + (Math.random() * 16 - 8),
            vy: (Math.random() - 0.5) * 60,
            r: 3 + Math.random() * 5
          });
        }
      }
    };

    this.onKeyDown = (e) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        this.paddle();
      }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.diveBomb();
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'Shift') {
        e.preventDefault();
        this.dash();
      }
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        this.turtle.isBraking = true;
      }
      if (e.key === 'r' || e.key === 'R') {
        if (this.isGameOver) this.restart();
      }
      if (e.key === 'Escape') { this.stop(); this.onExit?.(); }
    };

    this.onKeyUp = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        this.turtle.isBraking = false;
      }
    };

    this.onPointerDown = (e) => {
      const rect = this.canvas?.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { left: 0, top: 0, width: this.canvas.width, height: this.canvas.height };
      const clickY = e.clientY - rect.top;
      const clickX = e.clientX - rect.left;

      if (this.isGameOver) {
        this.restart();
        return;
      }

      if (clickX < rect.width * 0.22) {
        // Left side: Brake & Hover
        this.turtle.isBraking = true;
      } else if (clickX > rect.width * 0.7) {
        // Right side: Hydro Dash
        this.dash();
      } else if (clickY > rect.height * 0.6) {
        // Bottom half: Dive-Bomb
        this.diveBomb();
      } else {
        // Top half: Paddle Up
        this.paddle();
      }
    };

    this.onPointerUp = () => {
      this.turtle.isBraking = false;
    };

    this.onWheel = (e) => {
      e.preventDefault();
      if (e.deltaY < -8) {
        this.paddle();
      } else if (e.deltaY > 8) {
        this.diveBomb();
      }
    };

    this.onContextMenu = (e) => {
      e.preventDefault();
      this.dash();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas?.addEventListener?.('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas?.addEventListener?.('wheel', this.onWheel, { passive: false });
    this.canvas?.addEventListener?.('contextmenu', this.onContextMenu);
  }

  restart() {
    this.isGameOver = false;
    this.turtle.y = this.canvas.height * 0.45;
    this.turtle.vy = 0;
    this.turtle.hp = 100;
    this.ghostHp = 100;
    this.turtle.stamina = 100;
    this.turtle.isDashing = false;
    this.turtle.dashTimer = 0;
    this.turtle.invulnTimer = 0;
    this.turtle.isBraking = false;
    this.distance = 0;
    this.milestonesPassed = 0;
    this.milestoneBannerTimer = 0;
    this.biteFlash = 0;
    this.particles = [];
    this.nextPredatorDist = 280;
    this.coralsRevived = 0;
    this.predatorsEvaded = 0;
    this.initReef();
  }

  spawnPredator() {
    const isShark = Math.random() < 0.65;
    const spawnY = 80 + Math.random() * (this.canvas.height - 180);

    this.predators.push({
      x: this.canvas.width + 100,
      y: spawnY,
      type: isShark ? 'shark' : 'barracuda',
      w: isShark ? 68 : 52,
      h: isShark ? 28 : 18,
      speed: isShark ? (190 + Math.random() * 50) : (270 + Math.random() * 80),
      state: 'patrolling', // 'patrolling', 'hunting', 'lunging', 'evaded'
      lungeTimer: 0,
      jawOpen: 0,
      passed: false
    });
  }

  update(dt) {
    if (this.isGameOver) return;
    this.biteFlash = Math.max(0, this.biteFlash - 3.5 * dt);

    // Stamina regeneration
    this.turtle.stamina = Math.min(100, this.turtle.stamina + 22 * dt);

    // Dash timer
    if (this.turtle.isDashing) {
      this.turtle.dashTimer -= dt;
      if (this.turtle.dashTimer <= 0) {
        this.turtle.isDashing = false;
      }
    }
    if (this.turtle.invulnTimer > 0) this.turtle.invulnTimer -= dt;

    // Buoyancy and gravity physics
    this.turtle.vy += this.turtle.gravity * dt;
    this.turtle.y += this.turtle.vy * dt;

    // Bounds checking
    this.turtle.y = Math.max(30, Math.min(this.canvas.height - 65, this.turtle.y));
    this.turtle.flipperAngle *= 0.92;

    // Scrolling speed: adjusted by braking, hydro-dash, and distance acceleration
    let scrollSpeed = 155 + Math.min(160, this.distance * 0.09);
    if (this.turtle.isDashing) scrollSpeed *= 1.85;
    if (this.turtle.isBraking) scrollSpeed *= 0.45;

    this.distance += (scrollSpeed / 12) * dt;

    // Milestone check every 500m
    const milestone = Math.floor(this.distance / 500);
    if (milestone > this.milestonesPassed) {
      this.milestonesPassed = milestone;
      arcadeTokens.addTokens(5, `Coral Current: ${milestone * 500}m Milestone!`);
      this.milestoneBannerTimer = 3.5;
      this.milestoneBannerText = `${milestone * 500} m · +5 tokens`;
      this.playSfx('milestone');
    }
    if (this.milestoneBannerTimer > 0) this.milestoneBannerTimer -= dt;

    // Lagging ghost HP drain
    if (this.ghostHp > this.turtle.hp) {
      this.ghostHp = Math.max(this.turtle.hp, this.ghostHp - 26 * dt);
    } else {
      this.ghostHp = this.turtle.hp;
    }

    // Spawn predators periodically
    if (this.distance >= this.nextPredatorDist) {
      this.spawnPredator();
      this.nextPredatorDist = this.distance + Math.max(160, 320 - (this.distance * 0.05));
    }

    // Update Predators (Reef Sharks & Great Barracudas)
    this.predators.forEach(p => {
      // Relative movement towards turtle
      p.x -= (scrollSpeed + p.speed) * dt;

      // Predator AI targeting
      const distToTurtle = p.x - this.turtle.x;
      if (distToTurtle > 0 && distToTurtle < 420 && p.state === 'patrolling') {
        p.state = 'hunting'; // Alert! Locked on
      }

      if (p.state === 'hunting') {
        // Track turtle's Y position aggressively
        const dy = (this.turtle.y - p.y);
        p.y += dy * Math.min(1.0, (p.type === 'shark' ? 3.8 : 5.2) * dt);

        if (distToTurtle < 180) {
          p.state = 'lunging';
          p.jawOpen = 1.0; // Open razor jaws!
        }
      }

      // Check evasion
      if (!p.passed && p.x + p.w < this.turtle.x) {
        p.passed = true;
        this.predatorsEvaded++;
      }

      // Check collision / predatory bite attack!
      const isNearX = Math.abs((this.turtle.x) - (p.x + p.w * 0.2)) < (p.w * 0.45);
      const isNearY = Math.abs(this.turtle.y - p.y) < (p.h * 0.75 + 12);

      if (isNearX && isNearY) {
        if (this.turtle.invulnTimer <= 0 && !this.turtle.isDashing) {
          // CHOMP! Devastating shark bite
          this.turtle.hp = Math.max(0, this.turtle.hp - 25);
          this.turtle.invulnTimer = 1.0;
          this.biteFlash = 0.55;
          this.playSfx('bite');

          // Blood / bubble splash particles (lightweight)
          if (this.particles.length < 16) {
            for (let i = 0; i < 4; i++) {
              this.particles.push({
                x: this.turtle.x,
                y: this.turtle.y,
                vx: (Math.random() - 0.5) * 80,
                vy: (Math.random() - 0.5) * 80,
                size: 2.5 + Math.random() * 3,
                color: Math.random() < 0.6 ? '#ef4444' : '#bae6fd',
                life: 0.4,
                maxLife: 0.4
              });
            }
          }


          if (this.turtle.hp <= 0) {
            this.isGameOver = true;
            arcadeTokens.recordHighScore('coral_current', Math.floor(this.distance), 'meters');
          }
        }
      }
    });
    this.predators = this.predators.filter(p => p.x > -160);

    // Update Full-Screen Cavern Corals
    this.corals.forEach(c => {
      c.x -= scrollSpeed * dt;

      // Revive bleached corals when close
      if (c.bleached && !c.revived && !c.isCeiling) {
        if (Math.hypot(this.turtle.x - c.x, this.turtle.y - (this.canvas.height - c.height / 2)) < 75) {
          c.revived = true;
          c.bleached = false;
          this.coralsRevived++;
          this.turtle.hp = Math.min(100, this.turtle.hp + 6);
          arcadeTokens.addTokens(1, 'Revived Stressed Barrier Coral');
          this.playSfx('upwelling');

          // Healing sparkles
          for (let sp = 0; sp < 8; sp++) {
            this.particles.push({
              x: c.x,
              y: this.canvas.height - c.height / 2,
              vx: (Math.random() - 0.5) * 70,
              vy: -40 - Math.random() * 40,
              size: 3,
              color: '#34d399',
              life: 0.5,
              maxLife: 0.5
            });
          }
        }
      }

      // Coral scrape collision
      const inX = (this.turtle.x + 18 >= c.x - c.width / 2 && this.turtle.x - 18 <= c.x + c.width / 2);
      if (inX) {
        let isScraping = false;
        if (!c.isCeiling && (this.turtle.y + 14 >= this.canvas.height - 35 - c.height)) {
          isScraping = true;
        } else if (c.isCeiling && (this.turtle.y - 14 <= c.height)) {
          isScraping = true;
        }

        if (isScraping && this.turtle.invulnTimer <= 0 && !this.turtle.isDashing) {
          this.turtle.hp = Math.max(0, this.turtle.hp - 10);
          this.turtle.invulnTimer = 0.8;
          this.playSfx('scrape');


          if (this.turtle.hp <= 0) {
            this.isGameOver = true;
            arcadeTokens.recordHighScore('coral_current', Math.floor(this.distance), 'meters');
          }
        }
      }
    });

    // Recycle corals across infinite horizon
    this.corals = this.corals.filter(c => c.x > -140);
    while (this.corals.length < 32) {
      const maxX = this.corals.reduce((m, c) => Math.max(m, c.x), this.canvas.width);
      this.spawnCoralPair(maxX + 160, Math.floor(this.distance / 10) + this.corals.length);
    }

    // Update Sea Sponges
    this.seaSponges.forEach(s => {
      s.x -= scrollSpeed * dt;
      if (!s.collected && Math.hypot(this.turtle.x - s.x, this.turtle.y - s.y) < 28) {
        s.collected = true;
        this.turtle.hp = Math.min(100, this.turtle.hp + 15);
        this.playSfx('upwelling');
      }
    });
    this.seaSponges = this.seaSponges.filter(s => !s.collected && s.x > -60);

    // Update Ambient bubbles
    this.bubbles.forEach(b => {
      b.y += b.vy * dt;
      b.x -= scrollSpeed * 0.3 * dt;
      if (b.y < -10) {
        b.y = this.canvas.height + 10;
        b.x = Math.random() * this.canvas.width;
      }
    });

    // Update particles
    this.particles.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    });
    this.particles = this.particles.filter(p => p.life > 0);
  }

  render() {
    renderGame(this, paintReef, reefReadout);
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
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas?.removeEventListener?.('wheel', this.onWheel);
    this.canvas?.removeEventListener?.('contextmenu', this.onContextMenu);
  }
}
