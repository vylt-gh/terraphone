import { arcadeTokens } from './arcade-tokens.js';
import { renderGame } from './art/frame.js';
import { paintAvenue } from './art/avenue.js';
import { avenueReadout } from './game-readout.js';

export class HeatEscapeGame {
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
    this.lastTime = 0;

    // 5 Discrete Subway-Style Lanes (0: Far Left, 1: Mid Left, 2: Center, 3: Mid Right, 4: Far Right)
    this.numLanes = 5;
    this.currentLane = 2;
    this.targetLane = 2;

    // Player Scooter State
    this.player = {
      x: canvas.width / 2,
      y: canvas.height * 0.72,
      tilt: 0,
      jumpY: 0,
      jumpVel: 0,
      isJumping: false,
      isSliding: false,
      slideTimer: 0,
      invulnerableTimer: 0,
      hydration: 100, // 0 - 100%
      distance: 0,
      dropletsCollected: 0,
      cryoTimer: 0
    };

    // Endless Runner & Milestone State
    this.milestonesPassed = 0;
    this.milestoneBannerTimer = 0;
    this.milestoneBannerText = '';

    // World & Spawner State
    this.obstacles = [];
    this.pickups = [];
    this.canopies = [];
    this.particles = [];
    this.nextSpawnDistance = 25;
    this.touchStartX = 0;
    this.touchStartY = 0;

    this.initInput();
  }

  getRoadGeometry() {
    const w = this.canvas.width;
    const roadW = Math.min(w * 0.94, 620);
    const roadLeft = (w - roadW) / 2;
    const laneW = roadW / this.numLanes;
    return {
      roadW,
      roadLeft,
      laneW,
      getLaneX: (l) => roadLeft + (l + 0.5) * laneW
    };
  }

  initInput() {
    this.onKeyDown = (e) => {
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        this.changeLane(-1);
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        this.changeLane(1);
      } else if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp' || e.key === ' ') {
        this.jump();
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        this.slide();
      } else if (e.key === 'r' || e.key === 'R') {
        if (this.isGameOver || this.isVictory) this.restart();
      } else if (e.key === 'Escape') {
        this.stop();
        this.onExit?.();
      }
    };

    // Mouse & Touch Gesture Support (Drag / Swipe / Click Zones / Wheel)
    this.pointerStartX = null;
    this.pointerStartY = null;

    this.onPointerDown = (e) => {
      if (this.isGameOver || this.isVictory) {
        this.restart();
        return;
      }
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
    };

    this.onPointerUp = (e) => {
      if (this.pointerStartX == null) return;
      const dx = e.clientX - this.pointerStartX;
      const dy = e.clientY - this.pointerStartY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      this.pointerStartX = null;
      this.pointerStartY = null;

      if (Math.max(absX, absY) > 22) {
        // Drag / Swipe gesture
        if (absX > absY) {
          dx < 0 ? this.changeLane(-1) : this.changeLane(1);
        } else {
          dy < 0 ? this.jump() : this.slide();
        }
      } else if (this.canvas?.getBoundingClientRect) {
        // Click Zones: left / right / jump / slide
        const rect = this.canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        if (clickX < rect.width * 0.33) {
          this.changeLane(-1);
        } else if (clickX > rect.width * 0.67) {
          this.changeLane(1);
        } else {
          if (clickY < rect.height * 0.5) {
            this.jump();
          } else {
            this.slide();
          }
        }
      }
    };

    this.onWheel = (e) => {
      e.preventDefault();
      if (e.deltaY < -8) {
        this.jump();
      } else if (e.deltaY > 8) {
        this.slide();
      }
    };

    this.onTouchStart = (e) => {
      if (e.touches?.length > 0) {
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
      }
    };

    this.onTouchEnd = (e) => {
      if (e.changedTouches?.length > 0) {
        const dx = e.changedTouches[0].clientX - this.touchStartX;
        const dy = e.changedTouches[0].clientY - this.touchStartY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);

        if (Math.max(absX, absY) > 24) {
          if (absX > absY) {
            dx < 0 ? this.changeLane(-1) : this.changeLane(1);
          } else {
            dy < 0 ? this.jump() : this.slide();
          }
        }
      }
    };

    window.addEventListener('keydown', this.onKeyDown);
    this.canvas?.addEventListener?.('pointerdown', this.onPointerDown);
    this.canvas?.addEventListener?.('pointerup', this.onPointerUp);
    this.canvas?.addEventListener?.('wheel', this.onWheel, { passive: false });
    this.canvas?.addEventListener?.('touchstart', this.onTouchStart, { passive: true });
    this.canvas?.addEventListener?.('touchend', this.onTouchEnd, { passive: true });
  }

  changeLane(dir) {
    if (this.isGameOver || this.isVictory) return;
    const next = Math.max(0, Math.min(4, this.targetLane + dir));
    if (next !== this.targetLane) {
      this.targetLane = next;
      this.playSfx('lane');
      this.spawnLaneShiftParticles();
    }
  }

  jump() {
    if (this.isGameOver || this.isVictory) return;
    if (!this.player.isJumping) {
      this.player.isJumping = true;
      this.player.jumpVel = -680;
      this.player.isSliding = false;
      this.player.slideTimer = 0;
      this.playSfx('jump');
    }
  }

  slide() {
    if (this.isGameOver || this.isVictory) return;
    if (this.player.isJumping) {
      // Subway Surfers fast-fall slam down!
      this.player.jumpVel = 950;
    }
    this.player.isSliding = true;
    this.player.slideTimer = 0.65;
    this.playSfx('slide');
  }

  restart() {
    this.isGameOver = false;
    this.isVictory = false;
    this.currentLane = 2;
    this.targetLane = 2;
    this.milestonesPassed = 0;
    this.milestoneBannerTimer = 0;
    this.player.x = this.canvas.width / 2;
    this.player.y = this.canvas.height * 0.72;
    this.player.tilt = 0;
    this.player.jumpY = 0;
    this.player.jumpVel = 0;
    this.player.isJumping = false;
    this.player.isSliding = false;
    this.player.slideTimer = 0;
    this.player.invulnerableTimer = 0;
    this.player.hydration = 100;
    this.player.distance = 0;
    this.player.dropletsCollected = 0;
    this.player.cryoTimer = 0;

    this.obstacles = [];
    this.pickups = [];
    this.canopies = [];
    this.particles = [];
    this.nextSpawnDistance = 25;
  }

  spawnLaneShiftParticles() {
    const geom = this.getRoadGeometry();
    const x = geom.getLaneX(this.targetLane);
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: this.player.y + 12,
        vx: (Math.random() - 0.5) * 80,
        vy: (Math.random() - 0.5) * 50 + 20,
        life: 0.35,
        maxLife: 0.35,
        color: '#38bdf8',
        size: 3
      });
    }
  }

  spawnDustParticles() {
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: this.player.x + (Math.random() - 0.5) * 26,
        y: this.player.y + 14,
        vx: (Math.random() - 0.5) * 110,
        vy: (Math.random() - 0.5) * 40 - 20,
        life: 0.4,
        maxLife: 0.4,
        color: '#f97316',
        size: 3.5
      });
    }
  }

  spawnHitParticles() {
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        x: this.player.x + (Math.random() - 0.5) * 20,
        y: this.player.y + this.player.jumpY,
        vx: (Math.random() - 0.5) * 220,
        vy: (Math.random() - 0.5) * 220,
        life: 0.5,
        maxLife: 0.5,
        color: '#ef4444',
        size: 4
      });
    }
  }

  spawnSplashParticles() {
    for (let i = 0; i < 18; i++) {
      this.particles.push({
        x: this.player.x + (Math.random() - 0.5) * 35,
        y: this.player.y + this.player.jumpY,
        vx: (Math.random() - 0.5) * 180,
        vy: (Math.random() - 0.5) * 160 - 40,
        life: 0.6,
        maxLife: 0.6,
        color: '#38bdf8',
        size: 4
      });
    }
  }

  spawnDropletParticles(x, y) {
    for (let i = 0; i < 7; i++) {
      this.particles.push({
        x: x || this.player.x,
        y: y || (this.player.y + this.player.jumpY),
        vx: (Math.random() - 0.5) * 120,
        vy: (Math.random() - 0.5) * 120 - 40,
        life: 0.45,
        maxLife: 0.45,
        color: '#06b6d4',
        size: 3.5
      });
    }
  }

  spawnObstacles(geom) {
    const d = this.player.distance;
    const laneW = geom.laneW;
    const spawnY = -120;
    const pattern = Math.floor(Math.random() * 6);

    if (pattern === 0) {
      // Ground hazard: Boiling asphalt rifts (Jump challenge!)
      const lane1 = Math.floor(Math.random() * 5);
      const lane2 = (lane1 + 2) % 5;
      this.obstacles.push({
        type: 'thermal_rift',
        lane: lane1,
        y: spawnY,
        w: laneW * 0.88,
        h: 30,
        tempLST: 52.8
      });
      this.obstacles.push({
        type: 'thermal_rift',
        lane: lane2,
        y: spawnY,
        w: laneW * 0.88,
        h: 30,
        tempLST: 51.5
      });
      // Floating coin in air over the rift to reward jumping
      this.pickups.push({
        type: 'water',
        lane: lane1,
        y: spawnY,
        inAir: true
      });
    } else if (pattern === 1) {
      // Overhead hazard: Scorching steam pipes (Slide challenge!)
      const lane = Math.floor(Math.random() * 4);
      this.obstacles.push({
        type: 'steam_pipe',
        lane: lane,
        y: spawnY,
        w: laneW * 0.9,
        h: 36,
        tempLST: 49.2
      });
      this.obstacles.push({
        type: 'steam_pipe',
        lane: lane + 1,
        y: spawnY,
        w: laneW * 0.9,
        h: 36,
        tempLST: 49.2
      });
    } else if (pattern === 2) {
      // Tall barrier / delivery van (Lane switch challenge!)
      const blockedLane = Math.floor(Math.random() * 5);
      this.obstacles.push({
        type: 'van',
        lane: blockedLane,
        y: spawnY,
        w: laneW * 0.84,
        h: 68,
        tempLST: 47.4
      });
      // Clear lane next to it with mist archway or water coin
      const freeLane = (blockedLane + 1) % 5;
      if (Math.random() < 0.4) {
        this.obstacles.push({
          type: 'mist_arch',
          lane: freeLane,
          y: spawnY,
          w: laneW * 0.95,
          h: 40,
          tempLST: 21.0
        });
      }
    } else if (pattern === 3) {
      // Shaded Tree Canopy corridor over a lane (Green sanctuary!)
      const canopyLane = Math.floor(Math.random() * 5);
      this.canopies.push({
        lane: canopyLane,
        y: spawnY,
        h: 320,
        tempLST: 22.1
      });
      // Line of hydration droplets under the trees
      for (let k = 0; k < 4; k++) {
        this.pickups.push({
          type: 'water',
          lane: canopyLane,
          y: spawnY + k * 65,
          inAir: false
        });
      }
    } else if (pattern === 4) {
      // Coin trail: 5 water droplets in a single lane
      const coinLane = Math.floor(Math.random() * 5);
      for (let k = 0; k < 5; k++) {
        this.pickups.push({
          type: 'water',
          lane: coinLane,
          y: spawnY + k * 48,
          inAir: false
        });
      }
      // Rare Cryo-Boost ice crystal power-up
      if (Math.random() < 0.25 && this.player.cryoTimer <= 0) {
        const cLane = (coinLane + 2) % 5;
        this.pickups.push({
          type: 'cryo',
          lane: cLane,
          y: spawnY + 70,
          inAir: false
        });
      }
    } else {
      // Mist archway + van combo
      const archLane = Math.floor(Math.random() * 5);
      this.obstacles.push({
        type: 'mist_arch',
        lane: archLane,
        y: spawnY,
        w: laneW * 0.95,
        h: 40,
        tempLST: 20.8
      });
      const vanLane = (archLane + 2) % 5;
      this.obstacles.push({
        type: 'van',
        lane: vanLane,
        y: spawnY - 30,
        w: laneW * 0.84,
        h: 68,
        tempLST: 48.0
      });
    }

    // Schedule next spawn distance
    const baseGap = Math.max(42, 70 - (d / 1000) * 25);
    this.nextSpawnDistance = d + baseGap;
  }

  update(dt) {
    if (this.isGameOver || this.isVictory) return;

    const geom = this.getRoadGeometry();

    // Speed progression: accelerates smoothly and endlessly as distance grows!
    const baseSpeed = 380 + this.player.distance * 0.42;
    const scrollSpeed = baseSpeed * (this.player.cryoTimer > 0 ? 1.25 : 1.0);
    this.currentKmh = Math.round(scrollSpeed / 9.5);

    // Distance progression
    this.player.distance += (scrollSpeed / 14) * dt;

    // Endless milestone check every 500m
    const currentMilestone = Math.floor(this.player.distance / 500);
    if (currentMilestone > this.milestonesPassed) {
      this.milestonesPassed = currentMilestone;
      arcadeTokens.addTokens(5, `Subway Heat Escape: ${currentMilestone * 500}m Milestone!`);
      this.milestoneBannerTimer = 3.5;
      this.milestoneBannerText = `${currentMilestone * 500} m · +5 tokens`;
      this.playSfx('mist');
    }
    if (this.milestoneBannerTimer > 0) this.milestoneBannerTimer -= dt;

    // Smooth snappy Subway Surfers lane snapping
    const targetX = geom.getLaneX(this.targetLane);
    this.player.x += (targetX - this.player.x) * Math.min(1.0, 22.0 * dt);
    this.player.tilt = Math.max(-0.35, Math.min(0.35, (targetX - this.player.x) * 0.0024));

    // Jump physics with gravity
    if (this.player.isJumping) {
      this.player.jumpVel += 1850 * dt;
      this.player.jumpY += this.player.jumpVel * dt;
      if (this.player.jumpY >= 0) {
        this.player.jumpY = 0;
        this.player.jumpVel = 0;
        this.player.isJumping = false;
        this.spawnDustParticles();
      }
    }

    // Slide timer
    if (this.player.isSliding) {
      this.player.slideTimer -= dt;
      if (this.player.slideTimer <= 0) {
        this.player.isSliding = false;
      }
    }

    // Powerup / Invulnerability timers
    if (this.player.invulnerableTimer > 0) this.player.invulnerableTimer -= dt;
    if (this.player.cryoTimer > 0) this.player.cryoTimer -= dt;

    // Spawn obstacles
    if (this.player.distance >= this.nextSpawnDistance) {
      this.spawnObstacles(geom);
    }

    // Scroll canopies downward
    this.canopies.forEach(c => {
      c.y += scrollSpeed * dt;
    });
    this.canopies = this.canopies.filter(c => c.y < this.canvas.height + 150);

    // Check if player is currently under canopy shade or mist
    let inCoolZone = false;
    let currentTemp = 48.5 + Math.sin(this.player.distance * 0.08) * 3.5;

    this.canopies.forEach(c => {
      if (c.lane === this.targetLane) {
        if (this.player.y >= c.y && this.player.y <= c.y + c.h) {
          inCoolZone = true;
          currentTemp = c.tempLST;
        }
      }
    });

    // Hydration physics driven by NASA ECOSTRESS Surface Temp
    if (this.player.cryoTimer > 0) {
      // Cryo-boost ice shield: zero heat drain + cooling
      this.player.hydration = Math.min(100, this.player.hydration + 18 * dt);
      currentTemp = 18.0;
    } else if (inCoolZone) {
      // Shaded tree canopy: rapid hydration recovery
      this.player.hydration = Math.min(100, this.player.hydration + 40 * dt);
    } else {
      // Hot asphalt heat island: steady heat fatigue
      const heatFactor = Math.max(0.6, (currentTemp - 30) / 18);
      this.player.hydration = Math.max(0, this.player.hydration - 6.2 * heatFactor * dt);
    }

    // Update obstacles & collisions
    this.obstacles.forEach(o => {
      o.y += scrollSpeed * dt;

      // Check collision
      const laneX = geom.getLaneX(o.lane);
      const isPlayerInLane = Math.abs(this.player.x - laneX) < geom.laneW * 0.44;
      const isYInRange = Math.abs(this.player.y - (o.y + o.h / 2)) < (o.h / 2 + 18);

      if (isPlayerInLane && isYInRange) {
        if (o.type === 'thermal_rift') {
          // Can be jumped over!
          if (this.player.jumpY < -28) {
            // Jumped safely over the crack!
          } else if (this.player.invulnerableTimer <= 0 && this.player.cryoTimer <= 0) {
            this.player.hydration = Math.max(0, this.player.hydration - 18);
            this.player.invulnerableTimer = 1.0;
            this.playSfx('hit');
            this.spawnHitParticles();
          }
        } else if (o.type === 'steam_pipe') {
          // Can be slid under!
          if (this.player.isSliding) {
            // Slid safely under the pipe!
          } else if (this.player.invulnerableTimer <= 0 && this.player.cryoTimer <= 0) {
            this.player.hydration = Math.max(0, this.player.hydration - 18);
            this.player.invulnerableTimer = 1.0;
            this.playSfx('hit');
            this.spawnHitParticles();
          }
        } else if (o.type === 'van') {
          // Tall barrier: cannot jump or slide; must dodge!
          if (this.player.invulnerableTimer <= 0 && this.player.cryoTimer <= 0) {
            this.player.hydration = Math.max(0, this.player.hydration - 25);
            this.player.invulnerableTimer = 1.2;
            this.playSfx('hit');
            this.spawnHitParticles();
          }
        } else if (o.type === 'mist_arch') {
          // Hydration mist gateway
          if (!o.collected) {
            o.collected = true;
            this.player.hydration = Math.min(100, this.player.hydration + 25);
            this.playSfx('mist');
            this.spawnSplashParticles();
          }
        }
      }
    });
    this.obstacles = this.obstacles.filter(o => o.y < this.canvas.height + 150);

    // Update pickups (Water droplets & Cryo crystals)
    this.pickups.forEach(p => {
      p.y += scrollSpeed * dt;

      // Magnet effect when Cryo-Boost is active
      if (this.player.cryoTimer > 0 && p.type === 'water') {
        const pLaneX = geom.getLaneX(p.lane);
        p.x = p.x !== undefined ? p.x : pLaneX;
        p.x += (this.player.x - p.x) * Math.min(1.0, 14.0 * dt);
      }

      const pX = p.x !== undefined ? p.x : geom.getLaneX(p.lane);
      const isPlayerNear = Math.hypot(this.player.x - pX, (this.player.y + this.player.jumpY) - p.y) < 38;

      if (isPlayerNear && !p.collected) {
        p.collected = true;
        if (p.type === 'water') {
          this.player.hydration = Math.min(100, this.player.hydration + 2.5);
          this.player.dropletsCollected++;
          this.playSfx('coin');
          this.spawnDropletParticles(pX, p.y);
        } else if (p.type === 'cryo') {
          this.player.cryoTimer = 6.0;
          this.playSfx('mist');
          this.spawnSplashParticles();
        }
      }
    });
    this.pickups = this.pickups.filter(p => !p.collected && p.y < this.canvas.height + 120);

    // Update particles
    this.particles.forEach(pt => {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
    });
    this.particles = this.particles.filter(pt => pt.life > 0);

    // Game Over condition (Heat exhaustion)
    if (this.player.hydration <= 0) {
      this.isGameOver = true;
      arcadeTokens.recordHighScore('heat_escape', Math.floor(this.player.distance), 'meters');
      return;
    }

    arcadeTokens.recordHighScore('heat_escape', Math.floor(this.player.distance), 'meters');
    this.lastLST = currentTemp;
  }

  playSfx(type) {
    if (!this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      const now = this.audioCtx.currentTime;

      if (type === 'lane') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.08);
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'jump') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(740, now + 0.16);
        g.gain.setValueAtTime(0.12, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.17);
      } else if (type === 'slide') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.14);
        g.gain.setValueAtTime(0.09, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'coin') {
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(988, now);
        osc2.frequency.setValueAtTime(1318, now + 0.04);
        g.gain.setValueAtTime(0.10, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc1.connect(g);
        osc2.connect(g);
        g.connect(this.audioCtx.destination);
        osc1.start(now);
        osc2.start(now + 0.04);
        osc1.stop(now + 0.19);
        osc2.stop(now + 0.19);
      } else if (type === 'mist') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.22);
        g.gain.setValueAtTime(0.14, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.23);
      } else if (type === 'hit') {
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.18);
        g.gain.setValueAtTime(0.20, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g);
        g.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
      }
    } catch (e) {
      // AudioContext fallback
    }
  }

  render() {
    renderGame(this, paintAvenue, avenueReadout);
  }

  start() {
    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();
    const loop = (t) => {
      if (!this.isRunning) return;
      if (!this.isPaused) {
        this.update(Math.min(0.05, (t - this.lastTime) / 1000));
        this.render();
      }
      this.lastTime = t;
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; this.lastTime = performance.now(); }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.canvas) {
      this.canvas.removeEventListener?.('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener?.('pointerup', this.onPointerUp);
      this.canvas.removeEventListener?.('wheel', this.onWheel);
      this.canvas.removeEventListener?.('touchstart', this.onTouchStart);
      this.canvas.removeEventListener?.('touchend', this.onTouchEnd);
    }
  }
}
