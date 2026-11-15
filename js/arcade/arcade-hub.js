/**
 * Terraphone — Earth Arcade Hub & Lifecycle Manager
 * NASA Space Apps Challenge
 * 
 * Orchestrates the six Earth Arcade environmental exploration games,
 * shared Web Audio engine, token wallet, and cosmetic shop.
 */

import { arcadeTokens, COSMETICS_CATALOG } from './arcade-tokens.js';
const gameLoaders = {
  fireline: () => import('./fireline.js').then(m => m.FirelineGame),
  heat_escape: () => import('./heat-escape.js').then(m => m.HeatEscapeGame),
  cloud_courier: () => import('./cloud-courier.js').then(m => m.CloudCourierGame),
  ozone_drift: () => import('./ozone-drift.js').then(m => m.OzoneDriftGame),
  coral_current: () => import('./coral-current.js').then(m => m.CoralCurrentGame),
  last_forest: () => import('./last-forest.js').then(m => m.LastForestGame)
};

const finishTitles = {
  fireline: 'The springs are flowing',
  heat_escape: 'Out of water',
  cloud_courier: 'Flight ended',
  ozone_drift: 'Orbit surveyed',
  coral_current: 'Dive ended',
  last_forest: 'Glide ended'
};

export const ARCADE_GAMES = [
  {
    id: 'fireline',
    title: 'Fireline',
    tag: 'Woodland exploration',
    nasaData: 'NASA FIRMS Active Fire Satellite Data',
    objective: 'Carry forest seeds to the three springs. Avoid heat pockets and collect golden fireflies for a burst of speed.',
    controls: [
      { key: 'Mouse Click / Drag or WASD', desc: 'Guide Spirit Wanderer' },
      { key: 'Spring Proximity', desc: 'Automatically deposits seeds' },
      { key: 'Golden Seed', desc: 'Golden Firefly high-speed flight boost' }
    ],
    environmentalImpact: 'Thermal hotspots correspond to NASA FIRMS (MODIS/VIIRS) satellite thermal detections. Protecting pristine headwater streams and re-seeding fire-prone forests preserves critical wildlife corridors and natural firebreaks.'
  },
  {
    id: 'heat_escape',
    title: 'Heat Escape',
    tag: 'Five-lane runner',
    nasaData: 'NASA ECOSTRESS Land Surface Temp',
    objective: 'Change lanes to avoid vans. Jump heat cracks, slide under steam vents and aim for the next 500 metres.',
    controls: [
      { key: 'Mouse Click / Swipe or ← / →', desc: 'Change Lanes, Jump & Slide' },
      { key: 'W / ↑ / Space or Wheel Up', desc: 'Jump Over Road Hazards' },
      { key: 'S / ↓ or Wheel Down', desc: 'Slide Under Steam Vents / Fast Fall' }
    ],
    environmentalImpact: 'Driven by NASA ECOSTRESS thermal measurements aboard the ISS. Unshaded asphalt surfaces can exceed 50°C (122°F), whereas tree-shaded parks lower ambient temperatures by up to 12°C, demonstrating the lifesaving power of urban greening.'
  },
  {
    id: 'cloud_courier',
    title: 'Cloud Courier',
    tag: 'Atmospheric flight',
    nasaData: 'NASA OMI SO₂/NO₂ & GPM',
    objective: 'Guide a cloud through gaps between smokestacks. Collect clean vapour and avoid polluted plumes.',
    controls: [
      { key: 'Mouse Click / Wheel or Space', desc: 'Ascend & Flap' },
      { key: 'Gravity', desc: 'Natural Aerodynamic Glide' }
    ],
    environmentalImpact: 'Incorporates NASA Aura OMI tropospheric air quality satellite measurements. Clean air corridors demonstrate how reducing factory emissions and vehicular pollutants prevents acid rain and protects human respiratory health.'
  },
  {
    id: 'ozone_drift',
    title: 'Ozone Drift',
    tag: 'Orbital exploration',
    nasaData: 'NASA Ozone Watch & Aura OMI',
    objective: 'Turn the probe and fire its thruster to collect 15 ozone samples.',
    controls: [
      { key: 'Mouse Aim & Click or A / D / W', desc: 'Rotate & Fire Thruster' },
      { key: 'A / D or ← / →', desc: 'Rotate the probe' },
      { key: 'W or ↑ or Hold Click', desc: 'Fire the thruster' }
    ],
    environmentalImpact: 'Reflects NASA Ozone Watch daily satellite observations. The stratospheric ozone layer absorbs harmful ultraviolet-B radiation, safeguarding terrestrial ecosystems, marine phytoplankton, and human skin health.'
  },
  {
    id: 'coral_current',
    title: 'Coral Current',
    tag: 'Reef survival',
    nasaData: 'NOAA Coral Reef Watch Bleaching Stress',
    objective: 'Swim through gaps in the reef. Dash past predators and find cool upwellings to revive bleached coral.',
    controls: [
      { key: 'Mouse Click Zones or Space / S / D', desc: 'Paddle, Dive, Dash & Brake' },
      { key: 'Space / ↑ / W / Wheel Up', desc: 'Paddle Upward' },
      { key: 'S / ↓ / Wheel Down', desc: 'Fast Dive-Bomb (Evade Predators)' },
      { key: 'D / Shift / → / Right-Click', desc: 'Hydro-Dash Jet (Invulnerable Burst)' },
      { key: 'A / ← / Left Click Zone', desc: 'Brake & Hover (Time Gaps)' }
    ],
    environmentalImpact: 'Incorporates NOAA Coral Reef Watch 5km satellite sea surface temperature anomaly metrics. Deep cold-water upwellings provide critical thermal refugia that rescue fragile reef ecosystems from devastating marine heatwaves.'
  },
  {
    id: 'last_forest',
    title: 'Last Forest',
    tag: 'Canopy gliding',
    nasaData: 'NASA / USGS Landsat Forest Canopy Cover',
    objective: 'Ride updrafts as a sycamore seed. Sow ten clearings before you lose altitude.',
    controls: [
      { key: 'Mouse Pointer or A / D / W / S', desc: 'Bank, Steer & Pitch' },
      { key: 'A / D or ← / →', desc: 'Bank & Steer' },
      { key: 'W / S or ↑ / ↓', desc: 'Pitch Up / Dive for Speed' }
    ],
    environmentalImpact: 'Based on NASA/USGS Landsat global tree canopy cover monitoring. Expanding contiguous forest corridors prevents habitat fragmentation, restores biodiversity highways, and bolsters planetary carbon sinks.'
  }
];

export class ArcadeHub {
  constructor(containerEl, audioCtx) {
    this.container = containerEl;
    this.audioCtx = audioCtx;
    this.activeGameInstance = null;
    this.activeGameId = null;

    this.renderLayout();
    this.bindEvents();
    this.updateCardScores();
  }

  renderLayout() {
    const profile = arcadeTokens.profile;

    this.container.innerHTML = `
      <!-- Arcade Viewport Container -->
      <div class="arcade-shell" id="arcade-shell">

        <main class="arcade-hub-content" id="arcade-hub-content">
          <div class="arcade-edition">
            <h2>Earth Arcade</h2>
            <button id="arcade-btn-shop" class="arcade-wallet" aria-label="Open Zen collection" title="Zen collection">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><ellipse cx="11" cy="9" rx="7" ry="4"/><path d="M4 9v4c0 2 3 4 7 4s7-2 7-4V9m-9 10c4 2 11 0 11-4"/></svg>
              <span id="arcade-token-count">${profile.tokens} tokens</span>
            </button>
          </div>
          <section class="arcade-gallery" aria-label="Choose a game" aria-roledescription="carousel">
            <div id="arcade-track" class="arcade-track">
              ${ARCADE_GAMES.map((game, i) => `
                <button class="arcade-card${i === 0 ? ' selected' : ''}" id="arcade-card-${game.id}" data-game="${game.id}" aria-label="Play ${game.title}">
                  <img class="arcade-cover" src="img/arcade/${game.id}.svg" alt="" decoding="async" draggable="false" width="1000" height="550">
                  <span class="arcade-card-copy"><span class="arcade-genre">${game.tag}</span><strong>${game.title}</strong></span>
                  <span class="arcade-card-action"><span class="arcade-best"></span><span class="arcade-play">Play <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 13 13 3M4 3h9v9"/></svg></span></span>
                </button>`).join('')}
            </div>
            <div class="arcade-navigation">
              <span id="arcade-position" class="arcade-position" aria-live="polite">01 / 06</span>
              <div class="arcade-stops" aria-label="Select game">
                ${ARCADE_GAMES.map((game, i) => `<button type="button" aria-label="Select ${game.title}" aria-current="${i === 0}" data-index="${i}"></button>`).join('')}
              </div>
              <div class="arcade-arrows">
                <button id="arcade-prev" aria-label="Previous game" disabled>←</button>
                <button id="arcade-next" aria-label="Next game">→</button>
              </div>
            </div>
          </section>
        </main>

        <!-- Active Game Canvas Viewport Layer -->
        <div class="arcade-game-viewport" id="arcade-game-viewport" style="display: none;">
          <div class="arcade-hud-controls">
            <button id="arcade-btn-leave-game" class="arcade-hud-btn" title="Exit to Arcade Menu (Esc)">
              <span>← Arcade</span>
            </button>
            <button id="arcade-btn-pause-game" class="arcade-hud-btn" title="Pause / Resume">
              <span>Pause</span>
            </button>
          </div>

          <canvas id="arcade-canvas" class="arcade-canvas"></canvas>
          <div id="arcade-onscreen-controls" class="arcade-onscreen-controls"></div>
          <div id="arcade-result" class="arcade-result" hidden>
            <div class="arcade-result-card">
              <h2 id="arcade-result-title" aria-live="polite"></h2>
              <button type="button" id="arcade-replay" class="arcade-hud-btn">Play again</button>
            </div>
          </div>
        </div>

        <!-- Cosmetic Shop Modal -->
        <dialog id="arcade-shop-modal" class="arcade-modal-backdrop" aria-labelledby="arcade-shop-title">
          <div class="arcade-modal-dialog">
            <div class="arcade-modal-header">
              <h3 id="arcade-shop-title">Zen collection</h3>
              <button id="arcade-btn-close-shop" aria-label="Close collection" class="arcade-close-btn">✕</button>
            </div>
            <div class="arcade-modal-body">
              <div class="arcade-vault-summary">
                <div>
                  <span class="vault-label">Your Token Balance</span>
                  <div class="vault-amount" id="modal-token-balance">${profile.tokens} 🪙</div>
                </div>
                <div>
                  <span class="vault-label">Zen Active Time</span>
                  <div class="vault-stat">${profile.zenMinutes} minutes</div>
                </div>
              </div>

              <!-- Scooter Paint & Gradient Customization -->
              <div class="shop-category">
                <h4>🛴 Heat Escape Scooter Finishes &amp; Holographic Skins</h4>
                <div class="shop-items-row">
                  ${COSMETICS_CATALOG.carPaints.map(item => {
                    const isUnlocked = (profile.unlocked.carPaints || []).includes(item.id);
                    const isEquipped = profile.equipped.carPaint === item.id;
                    let swatchStyle = `background: ${item.hex};`;
                    if (item.type === 'gradient' && item.colors) {
                      swatchStyle = `background: linear-gradient(135deg, ${item.colors.join(', ')});`;
                      if (item.id === 'quantum_singularity') swatchStyle += ' box-shadow: 0 0 10px rgba(147, 51, 234, 0.85);';
                    } else if (item.type === 'crown' || item.hasCrown) {
                      swatchStyle = `background: linear-gradient(135deg, #ffd700, #b45309); box-shadow: 0 0 12px rgba(255, 215, 0, 0.85);`;
                    } else if (item.type === 'textured') {
                      if (item.pattern === 'carbon') {
                        swatchStyle = `background: repeating-linear-gradient(45deg, #1e293b, #1e293b 3px, #0f172a 3px, #0f172a 6px); border: 1px solid #38bdf8;`;
                      } else {
                        swatchStyle = `background: repeating-linear-gradient(45deg, #7f1d1d, #7f1d1d 3px, #dc2626 3px, #f97316 6px); border: 1px solid #f97316;`;
                      }
                    }
                    return `
                      <div class="shop-item ${isUnlocked ? 'unlocked' : ''} ${isEquipped ? 'equipped' : ''}" data-cat="carPaints" data-id="${item.id}" data-cost="${item.cost}">
                        <div class="color-swatch" style="${swatchStyle}"></div>
                        <span class="shop-item-name">${item.name}</span>
                        <span class="shop-item-cost">${isUnlocked ? (isEquipped ? 'Equipped' : 'Equip') : `${item.cost.toLocaleString()} 🪙`}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Royal Crowns & Headgear Customization -->
              <div class="shop-category">
                <h4>👑 Royal Crowns &amp; Headgear Accessories</h4>
                <div class="shop-items-row">
                  ${(COSMETICS_CATALOG.crowns || []).map(item => {
                    const isUnlocked = (profile.unlocked.crowns || ['none']).includes(item.id);
                    const isEquipped = (profile.equipped.crown || 'none') === item.id;
                    let swatchStyle = `background: ${item.hex};`;
                    if (item.id === 'golden_crown') {
                      swatchStyle = `background: linear-gradient(135deg, #ffd700, #b45309); box-shadow: 0 0 12px rgba(255, 215, 0, 0.85);`;
                    } else if (item.id === 'cyber_halo') {
                      swatchStyle = `background: radial-gradient(circle, #0c0e18 40%, #38bdf8 70%); box-shadow: 0 0 10px rgba(56, 189, 248, 0.8);`;
                    } else if (item.id === 'phoenix_crest') {
                      swatchStyle = `background: linear-gradient(135deg, #f97316, #ef4444); box-shadow: 0 0 10px rgba(249, 115, 22, 0.8);`;
                    } else if (item.id === 'celestial_diadem') {
                      swatchStyle = `background: linear-gradient(135deg, #e0f2fe, #38bdf8); box-shadow: 0 0 12px rgba(56, 189, 248, 0.9);`;
                    }
                    return `
                      <div class="shop-item ${isUnlocked ? 'unlocked' : ''} ${isEquipped ? 'equipped' : ''}" data-cat="crowns" data-id="${item.id}" data-cost="${item.cost}">
                        <div class="color-swatch" style="${swatchStyle}"></div>
                        <span class="shop-item-name">${item.name}</span>
                        <span class="shop-item-cost">${isUnlocked ? (isEquipped ? 'Equipped' : 'Equip') : `${item.cost.toLocaleString()} 🪙`}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Cloud Glider & Atmospheric Skins -->
              <div class="shop-category">
                <h4>☁️ Cloud Courier &amp; Atmospheric Skins</h4>
                <div class="shop-items-row">
                  ${COSMETICS_CATALOG.gliderSkins.map(item => {
                    const isUnlocked = (profile.unlocked.gliderSkins || []).includes(item.id);
                    const isEquipped = profile.equipped.gliderSkin === item.id;
                    let swatchStyle = `background: ${item.hex};`;
                    if (item.type === 'gradient' && item.colors) {
                      swatchStyle = `background: linear-gradient(135deg, ${item.colors.join(', ')});`;
                      if (item.id === 'stellar_supernova') swatchStyle += ' box-shadow: 0 0 10px rgba(251, 191, 36, 0.8);';
                    } else if (item.id === 'golden_cloud') {
                      swatchStyle = `background: linear-gradient(135deg, #ffd700, #b45309); box-shadow: 0 0 12px rgba(255, 215, 0, 0.85);`;
                    }
                    return `
                      <div class="shop-item ${isUnlocked ? 'unlocked' : ''} ${isEquipped ? 'equipped' : ''}" data-cat="gliderSkins" data-id="${item.id}" data-cost="${item.cost}">
                        <div class="color-swatch" style="${swatchStyle}"></div>
                        <span class="shop-item-name">${item.name}</span>
                        <span class="shop-item-cost">${isUnlocked ? (isEquipped ? 'Equipped' : 'Equip') : `${item.cost.toLocaleString()} 🪙`}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Fireline Spirit Glow Customization -->
              <div class="shop-category">
                <h4>✨ Spirit Glow &amp; Auras</h4>
                <div class="shop-items-row">
                  ${COSMETICS_CATALOG.spiritGlows.map(item => {
                    const isUnlocked = (profile.unlocked.spiritGlows || []).includes(item.id);
                    const isEquipped = profile.equipped.spiritGlow === item.id;
                    let swatchStyle = `background: ${item.hex};`;
                    if (item.type === 'gradient' && item.colors) {
                      swatchStyle = `background: linear-gradient(135deg, ${item.colors.join(', ')});`;
                      if (item.id === 'cosmic_pulsar') swatchStyle += ' box-shadow: 0 0 10px rgba(6, 182, 212, 0.85);';
                    } else if (item.id === 'sovereign_gold') {
                      swatchStyle = `background: linear-gradient(135deg, #ffd700, #b45309); box-shadow: 0 0 12px rgba(255, 215, 0, 0.85);`;
                    }
                    return `
                      <div class="shop-item ${isUnlocked ? 'unlocked' : ''} ${isEquipped ? 'equipped' : ''}" data-cat="spiritGlows" data-id="${item.id}" data-cost="${item.cost}">
                        <div class="color-swatch" style="${swatchStyle}"></div>
                        <span class="shop-item-name">${item.name}</span>
                        <span class="shop-item-cost">${isUnlocked ? (isEquipped ? 'Equipped' : 'Equip') : `${item.cost.toLocaleString()} 🪙`}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

            </div>
          </div>
        </dialog>

        <!-- Game Briefing & Environmental Science Modal -->
        <dialog id="arcade-briefing-modal" class="modal-backdrop" aria-labelledby="briefing-title">
          <div class="modal-dialog arcade-briefing-dialog">
            <div class="modal-header briefing-header">
              <div class="briefing-header-left">
                <div>
                  <h2 id="briefing-title" class="modal-title">Mission Briefing</h2>
                  <span id="briefing-tag" class="sugg-tag">NASA Earth Science</span>
                </div>
              </div>
              <button id="arcade-btn-close-briefing" class="modal-close" aria-label="Close briefing">✕</button>
            </div>
            <div class="modal-content briefing-content">
              <div class="briefing-section">
                <h4 class="briefing-section-title">Objective</h4>
                <p id="briefing-objective" class="briefing-text"></p>
              </div>
              <div class="briefing-section">
                <h4 class="briefing-section-title">Controls</h4>
                <div id="briefing-controls" class="briefing-controls-grid"></div>
              </div>
              <details class="briefing-section"><summary>Earth science</summary><p id="briefing-impact" class="briefing-text"></p></details>
              <div class="briefing-action-row">
                <button id="btn-cancel-briefing" class="briefing-btn briefing-btn-secondary" type="button">Back</button>
                <button id="btn-start-briefing-mission" class="briefing-btn briefing-btn-primary" type="button">Start game</button>
              </div>
            </div>
          </div>
        </dialog>

      </div>
    `;
  }

  bindCarousel() {
    const track = this.container.querySelector('#arcade-track');
    const cards = Array.from(track.querySelectorAll('.arcade-card'));
    const stops = Array.from(this.container.querySelectorAll('.arcade-stops button'));
    const position = this.container.querySelector('#arcade-position');
    const previous = this.container.querySelector('#arcade-prev');
    const next = this.container.querySelector('#arcade-next');
    let selected = 0;
    let scrollEndTimer;

    const mark = index => {
      selected = index;
      for (const [i, card] of cards.entries()) {
        card.classList.toggle('selected', i === index);
        stops[i].setAttribute('aria-current', String(i === index));
      }
      position.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(cards.length).padStart(2, '0');
      position.setAttribute('aria-label', ARCADE_GAMES[index].title + ', ' + (index + 1) + ' of ' + cards.length);
      previous.disabled = index === 0;
      next.disabled = index === cards.length - 1;
    };
    const go = index => {
      if (index < 0 || index >= cards.length) return;
      mark(index);
      const left = cards[index].offsetLeft - track.offsetLeft - (track.clientWidth - cards[index].offsetWidth) / 2;
      track.scrollTo({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    const settle = () => {
      const center = track.offsetLeft + track.scrollLeft + track.clientWidth / 2;
      const closest = cards.reduce((best, card, i) => {
        const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
        return distance < best.distance ? { index: i, distance } : best;
      }, { index: 0, distance: Infinity });
      if (closest.index !== selected) mark(closest.index);
    };
    track.addEventListener('scroll', () => {
      clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(settle, 100);
    }, { passive: true });
    previous.addEventListener('click', () => go(selected - 1));
    next.addEventListener('click', () => go(selected + 1));
    stops.forEach((stop, i) => stop.addEventListener('click', () => go(i)));
    cards.forEach((card, i) => {
      card.addEventListener('focus', () => { if (i !== selected) go(i); });
      card.addEventListener('click', () => this.openGameBriefing(card.dataset.game));
    });
    this.container.querySelector('.arcade-gallery').addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1
        : Math.max(0, Math.min(cards.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1)));
      go(index);
      cards[index].focus({ preventScroll: true });
    });
  }

  bindEvents() {
    this.bindCarousel();

    // Briefing modal handlers
    const briefingModal = document.getElementById('arcade-briefing-modal');
    document.getElementById('arcade-btn-close-briefing')?.addEventListener('click', () => {
      this.closeGameBriefing();
    });
    document.getElementById('btn-cancel-briefing')?.addEventListener('click', () => {
      this.closeGameBriefing();
    });
    document.getElementById('btn-start-briefing-mission')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const gid = this.pendingBriefingGameId;
      const art = this.takeBriefingArt(gid);
      this.closeGameBriefing();
      if (gid) this.launchGame(gid, art);
    });
    briefingModal?.addEventListener('close', () => {
      if (briefingModal.open) return;
      this.pendingBriefingGameId = null;
      this.takeBriefingArt();
    });
    briefingModal?.addEventListener('click', (e) => {
      if (e.target === briefingModal) this.closeGameBriefing();
    });

    const viewport = document.getElementById('arcade-game-viewport');
    viewport?.addEventListener('keydown', event => {
      if (event.target.closest('button') && (event.key === ' ' || event.key === 'Enter')) event.stopPropagation();
    });

    // Leave active game button
    document.getElementById('arcade-btn-leave-game')?.addEventListener('click', () => {
      this.closeActiveGame();
    });

    document.getElementById('arcade-replay')?.addEventListener('click', () => {
      const game = this.activeGameInstance;
      if (!game || (!game.isGameOver && !game.isVictory)) return;
      if (!game.restart) { this.launchGame(this.activeGameId); return; }
      game.restart();
      game.canvas.focus({ preventScroll: true });
    });

    // Pause button
    document.getElementById('arcade-btn-pause-game')?.addEventListener('click', () => {
      if (this.activeGameInstance) {
        if (this.activeGameInstance.isPaused) {
          this.activeGameInstance.resume();
          document.getElementById('arcade-btn-pause-game').innerHTML = '<span>Pause</span>';
        } else {
          this.activeGameInstance.pause();
          document.getElementById('arcade-btn-pause-game').innerHTML = '<span>Resume</span>';
        }
      }
    });

    // Shop modal triggers
    const shopModal = document.getElementById('arcade-shop-modal');
    document.getElementById('arcade-btn-shop')?.addEventListener('click', () => this.openShop());

    document.getElementById('arcade-btn-close-shop')?.addEventListener('click', () => {
      shopModal?.close();
    });
    shopModal?.addEventListener('click', (e) => {
      if (e.target === shopModal) shopModal.close();
    });

    // Token update listener
    if (!this._tokenListenerAttached) {
      window.addEventListener('terraphone_arcade_token_event', () => {
        const countEl = document.getElementById('arcade-token-count');
        const modalBal = document.getElementById('modal-token-balance');
        const tokensText = `${arcadeTokens.profile.tokens} tokens`;
        if (countEl) countEl.textContent = tokensText;
        if (modalBal) modalBal.textContent = `${arcadeTokens.profile.tokens} 🪙`;
      });
      this._tokenListenerAttached = true;
    }

    // Shop item click delegation
    this.container.addEventListener('click', (e) => {
      const itemEl = e.target.closest('.shop-item');
      if (!itemEl) return;
      const cat = itemEl.getAttribute('data-cat');
      const id = itemEl.getAttribute('data-id');
      const cost = parseInt(itemEl.getAttribute('data-cost'), 10);

      let catKey = 'carPaint';
      if (cat === 'crowns') catKey = 'crown';
      if (cat === 'gliderSkins') catKey = 'gliderSkin';
      if (cat === 'spiritGlows') catKey = 'spiritGlow';

      const unlockedList = arcadeTokens.profile.unlocked[cat] || (cat === 'crowns' ? ['none'] : ['cyan']);
      if (unlockedList.includes(id)) {
        arcadeTokens.equipCosmetic(catKey, id);
        this.updateShopModal();
      } else {
        const ok = arcadeTokens.unlockCosmetic(cat, id, cost);
        if (ok) {
          arcadeTokens.equipCosmetic(catKey, id);
          this.updateShopModal();
        } else {
          alert("Not enough tokens! Spend more active minutes in Zen mode or explore games to earn tokens.");
        }
      }
    });
  }

  openShop() {
    this.updateShopModal();
    const modal = document.getElementById('arcade-shop-modal');
    if (modal && !modal.open) modal.showModal();
    document.getElementById('arcade-btn-close-shop')?.focus();
  }

  updateShopModal() {
    const p = arcadeTokens.profile;
    const modal = document.getElementById('arcade-shop-modal');
    if (!modal) return;
    const bal = document.getElementById('modal-token-balance');
    if (bal) bal.textContent = `${p.tokens.toLocaleString()} 🪙`;

    // Re-render categories
    modal.querySelectorAll('.shop-item').forEach(itemEl => {
      const cat = itemEl.getAttribute('data-cat');
      const id = itemEl.getAttribute('data-id');
      const unlockedList = p.unlocked[cat] || (cat === 'crowns' ? ['none'] : ['cyan']);
      const isUnlocked = unlockedList.includes(id);

      let catKey = 'carPaint';
      if (cat === 'crowns') catKey = 'crown';
      if (cat === 'gliderSkins') catKey = 'gliderSkin';
      if (cat === 'spiritGlows') catKey = 'spiritGlow';
      const isEquipped = (p.equipped[catKey] || (catKey === 'crown' ? 'none' : 'cyan')) === id;

      itemEl.classList.toggle('unlocked', isUnlocked);
      itemEl.classList.toggle('equipped', isEquipped);
      const costEl = itemEl.querySelector('.shop-item-cost');
      if (costEl) {
        costEl.textContent = isUnlocked ? (isEquipped ? 'Equipped' : 'Equip') : `${parseInt(itemEl.getAttribute('data-cost'), 10).toLocaleString()} 🪙`;
      }
    });
  }

  openGameBriefing(gameId) {
    const game = ARCADE_GAMES.find(g => g.id === gameId);
    if (!game) return;
    this.takeBriefingArt();
    this.pendingBriefingGameId = gameId;
    const briefing = this.artBriefing = { gameId };
    // Fetch the selected module and prepare its scenery while the controls are open.
    gameLoaders[gameId]().then(Game => {
      if (this.artBriefing === briefing) {
        briefing.work = Game.prepareArtwork?.(window.innerWidth, window.innerHeight);
      }
    }).catch(() => {});

    const modal = document.getElementById('arcade-briefing-modal');
    const titleEl = document.getElementById('briefing-title');
    const tagEl = document.getElementById('briefing-tag');
    const objEl = document.getElementById('briefing-objective');
    const controlsEl = document.getElementById('briefing-controls');
    const impactEl = document.getElementById('briefing-impact');

    if (titleEl) titleEl.textContent = `${game.title}`;
    if (tagEl) tagEl.textContent = game.nasaData;
    if (objEl) objEl.textContent = game.objective;
    if (impactEl) impactEl.textContent = game.environmentalImpact || 'Explores real NASA and NOAA satellite observations.';

    if (controlsEl) {
      controlsEl.innerHTML = (game.controls || []).map(c => `
        <div class="briefing-control-item">
          <kbd class="briefing-kbd">${c.key}</kbd>
          <span class="briefing-control-desc">${c.desc}</span>
        </div>
      `).join('');
    }

    if (modal && !modal.open) modal.showModal();
  }

  takeBriefingArt(gameId) {
    const briefing = this.artBriefing;
    this.artBriefing = null;
    briefing?.work?.cancel();
    return briefing && briefing.gameId === gameId ? briefing.work?.art : null;
  }

  closeGameBriefing() {
    this.takeBriefingArt();
    const modal = document.getElementById('arcade-briefing-modal');
    if (modal?.open) modal.close();
    this.pendingBriefingGameId = null;
  }

  async launchGame(gameId, preparedArt = null) {
    if (!ARCADE_GAMES.some(game => game.id === gameId)) return;
    this.closeActiveGame();
    this.activeGameId = gameId;
    const launch = this.pendingLaunch = {};

    this.audioCtx ??= window.app?.sound?.getSharedContext();
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});

    // Hide global HUD capsules during gameplay to avoid any overlap
    const hudLeft = document.getElementById('hud-top-left');
    const hudRight = document.getElementById('hud-top-right');
    if (hudLeft) hudLeft.style.display = 'none';
    if (hudRight) hudRight.style.display = 'none';

    const hubEl = document.getElementById('arcade-hub-content');
    const viewportEl = document.getElementById('arcade-game-viewport');
    const canvas = document.getElementById('arcade-canvas');
    const pauseBtn = document.getElementById('arcade-btn-pause-game');
    if (pauseBtn) { pauseBtn.hidden = false; pauseBtn.textContent = 'Pause'; }

    // Set canvas dimensions
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    hubEl.style.display = 'none';
    viewportEl.style.display = 'block';

    const onExit = () => this.closeActiveGame();

    // Instantiate and start game
    try {
      const Game = await gameLoaders[gameId]();
      if (this.pendingLaunch !== launch) return;
      const game = this.activeGameInstance = new Game(canvas, this.audioCtx, onExit);
      game.art = preparedArt;
      game.onResultChange = finished => {
        const result = document.getElementById('arcade-result');
        const controlsEl = document.getElementById('arcade-onscreen-controls');
        result.hidden = !finished;
        pauseBtn.hidden = finished;
        if (controlsEl) controlsEl.style.display = finished ? 'none' : '';
        if (finished) {
          document.getElementById('arcade-result-title').textContent =
            gameId === 'last_forest' && game.isVictory ? 'The canopy is growing' : finishTitles[gameId];
          document.getElementById('arcade-replay').focus({ preventScroll: true });
        } else {
          canvas.focus({ preventScroll: true });
        }
      };
      this.activeGameInstance.start();
      this.renderOnScreenControls(gameId);
      canvas.tabIndex = -1;
      canvas.focus({ preventScroll: true });
    } catch (err) {
      if (this.pendingLaunch !== launch) return;
      this.closeActiveGame();
      console.error(`Failed to launch arcade game [${gameId}]:`, err);
    }
  }

  renderOnScreenControls(gameId) {
    const container = document.getElementById('arcade-onscreen-controls');
    if (!container) return;
    container.innerHTML = '';
    const game = this.activeGameInstance;
    if (!game) return;

    const createBtn = (label, title, onPress, onRelease) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'arcade-virtual-btn';
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.innerHTML = `<span>${label}</span>`;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress?.();
      });
      if (onRelease) {
        btn.addEventListener('pointerup', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onRelease?.();
        });
        btn.addEventListener('pointerleave', () => onRelease?.());
        btn.addEventListener('pointercancel', () => onRelease?.());
      }
      return btn;
    };

    if (gameId === 'fireline') {
      const bar = document.createElement('div');
      bar.className = 'arcade-action-bar arcade-dpad-bar';
      bar.appendChild(createBtn('◀', 'Move Left (A / ←)', () => { game.keys.left = true; }, () => { game.keys.left = false; }));
      bar.appendChild(createBtn('▲', 'Move Up (W / ↑)', () => { game.keys.up = true; }, () => { game.keys.up = false; }));
      bar.appendChild(createBtn('▼', 'Move Down (S / ↓)', () => { game.keys.down = true; }, () => { game.keys.down = false; }));
      bar.appendChild(createBtn('▶', 'Move Right (D / →)', () => { game.keys.right = true; }, () => { game.keys.right = false; }));
      container.appendChild(bar);
    } else if (gameId === 'heat_escape') {
      const bar = document.createElement('div');
      bar.className = 'arcade-action-bar';
      bar.appendChild(createBtn('◀ Left', 'Lane Left (A / ←)', () => game.changeLane(-1)));
      bar.appendChild(createBtn('▲ Jump', 'Jump (W / ↑ / Space)', () => game.jump()));
      bar.appendChild(createBtn('▼ Slide', 'Slide / Fast Fall (S / ↓)', () => game.slide()));
      bar.appendChild(createBtn('Right ▶', 'Lane Right (D / →)', () => game.changeLane(1)));
      container.appendChild(bar);
    } else if (gameId === 'cloud_courier') {
      const bar = document.createElement('div');
      bar.className = 'arcade-action-bar';
      bar.appendChild(createBtn('☁ Flap / Ascend', 'Flap Wings (Click / Space)', () => game.flap()));
      container.appendChild(bar);
    } else if (gameId === 'coral_current') {
      const bar = document.createElement('div');
      bar.className = 'arcade-action-bar';
      bar.appendChild(createBtn('⏸ Brake', 'Brake & Hover (A / ←)', () => { game.turtle.isBraking = true; }, () => { game.turtle.isBraking = false; }));
      bar.appendChild(createBtn('▲ Paddle', 'Paddle Up (Space / W / ↑)', () => game.paddle()));
      bar.appendChild(createBtn('▼ Dive', 'Dive-Bomb (S / ↓)', () => game.diveBomb()));
      bar.appendChild(createBtn('⚡ Dash', 'Hydro-Dash (D / Shift / →)', () => game.dash()));
      container.appendChild(bar);
    } else if (gameId === 'last_forest') {
      const bar = document.createElement('div');
      bar.className = 'arcade-action-bar';
      bar.appendChild(createBtn('◀ Bank Left', 'Bank Left (A / ←)', () => { game.keys.left = true; }, () => { game.keys.left = false; }));
      bar.appendChild(createBtn('▲ Pitch Up', 'Pitch Up (W / ↑)', () => { game.keys.up = true; }, () => { game.keys.up = false; }));
      bar.appendChild(createBtn('▼ Dive Down', 'Dive (S / ↓)', () => { game.keys.down = true; }, () => { game.keys.down = false; }));
      bar.appendChild(createBtn('Bank Right ▶', 'Bank Right (D / →)', () => { game.keys.right = true; }, () => { game.keys.right = false; }));
      container.appendChild(bar);
    } else if (gameId === 'ozone_drift') {
      const bar = document.createElement('div');
      bar.className = 'arcade-action-bar';
      bar.appendChild(createBtn('⟲ Turn Left', 'Rotate Left (A / ←)', () => { game.keys.left = true; }, () => { game.keys.left = false; }));
      bar.appendChild(createBtn('🚀 Thrust', 'Fire Thruster (W / ↑)', () => { game.keys.thrust = true; }, () => { game.keys.thrust = false; }));
      bar.appendChild(createBtn('Turn Right ⟳', 'Rotate Right (D / →)', () => { game.keys.right = true; }, () => { game.keys.right = false; }));
      container.appendChild(bar);
    }
  }

  closeActiveGame() {
    this.pendingLaunch = null;
    const controlsEl = document.getElementById('arcade-onscreen-controls');
    if (controlsEl) controlsEl.innerHTML = '';
    const result = document.getElementById('arcade-result');
    if (result) result.hidden = true;
    const lastGame = this.activeGameId;
    if (this.activeGameInstance) {
      this.activeGameInstance.stop();
      this.activeGameInstance = null;
    }
    this.activeGameId = null;

    const hubEl = document.getElementById('arcade-hub-content');
    const viewportEl = document.getElementById('arcade-game-viewport');
    const pauseBtn = document.getElementById('arcade-btn-pause-game');
    if (pauseBtn) { pauseBtn.hidden = false; pauseBtn.textContent = 'Pause'; }

    // Restore global HUD capsules
    const hudLeft = document.getElementById('hud-top-left');
    const hudRight = document.getElementById('hud-top-right');
    if (hudLeft) hudLeft.style.display = '';
    if (hudRight) hudRight.style.display = '';

    if (hubEl) hubEl.style.display = '';
    if (viewportEl) viewportEl.style.display = 'none';

    if (lastGame) document.getElementById('arcade-card-' + lastGame)?.focus({ preventScroll: true });

    // Refresh best scores on cards
    this.updateCardScores();
  }

  updateCardScores() {
    const profile = arcadeTokens.profile;
    ARCADE_GAMES.forEach(game => {
      const card = this.container.querySelector(`.arcade-card[data-game="${game.id}"]`);
      if (!card) return;
      const best = profile.highScores[game.id];
      const label = card.querySelector('.arcade-best');
      if (label) label.textContent = best?.score > 0 ? `Best ${best.score} ${best.metric || ''}`.trim() : '';
    });
  }

  leave() {
    this.closeGameBriefing();
    const shop = document.getElementById('arcade-shop-modal');
    if (shop?.open) shop.close();
    this.closeActiveGame();
  }

  destroy() {
    this.closeActiveGame();
  }
}
