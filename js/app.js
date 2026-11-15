/**
 * Terraphone - Main Application Controller
 * NASA Space Apps Challenge · NASA SVS 5650 & GPM IMERG
 * Centered Bumpy Globe with Elevation Colormap · Bilinear Data Interpolation
 * Hovering Atmospheric Cloud Deck · Convective Thunder & Lightning · Location Ambience
 */

import {
  IMERG_PALETTE,
  RAIN_TYPES,
  getRainType,
  PRESET_HOTSPOTS,
  CITIES_DATABASE,
  CITY_NOISE_PROFILES,
  getLeaderboardCities,
  isCoordinateLand,
  getCityNoiseData
} from './data.js';
import { SoundEngine } from './audio.js';
import { SearchController } from './search.js';
import { arcadeTokens } from './arcade/arcade-tokens.js';
import { initCalmUI } from './ui.js';

// Free Public Basemaps: Physical Elevation-Colored Topography (No API Keys)
const BASEMAP_TILES = {
  // World Physical Map: Intrinsic hypsometric elevation coloring (green valleys -> amber hills -> sienna cordilleras -> white snow peaks)
  physical: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'],
  darkSlate: ['https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
  lightSlate: ['https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}']
};

class App {
  constructor() {
    window.app = this;
    this.sound = new SoundEngine();
    this.map = null;

    // Theme state ('auto', 'dark', 'light')
    this.themeMode = 'auto';

    // 3D Terrain Relief Toggle State (starts ON with calibrated exaggeration 2.6)
    this.isTerrainEnabled = true;
    this.bumpLevel = 2.6;

    // Current city noise pollution profile & popup
    this.currentNoiseData = null;
    this.cityPopup = null;

    // Listening & Target state
    this.isListening = false;
    this.listeningTarget = null;
    this.crosshairMarker = null;
    this.crosshairEl = null;
    this.currentEnv = 'rural';
    this.activeRainLayerId = 'IMERG_Precipitation_Rate';
    this.convectiveThunderTimer = null;

    // High-performance CPU-cached precipitation buffer (zero GPU readbacks)
    this.samplingCanvas = document.createElement('canvas');
    this.samplingCanvas.width = 512;
    this.samplingCanvas.height = 512;
    this.samplingCtx = this.samplingCanvas.getContext('2d', { willReadFrequently: true });
    this.pixelData = null; // Uint8ClampedArray cached in RAM
    this.isRasterReady = false;

    // RAF throttle for mousemove
    this.mouseRafPending = false;
    this.lastMouseEvt = null;

    // Zen Mode Auto-Rotation State
    this.isZenMode = false;
    this.isAutoRotating = false;
    this.autoRotateRaf = null;
    this.autoRotateDegPerSec = 3.3; // Delta-time calibrated: 3.3 deg/sec (~109s full revolution, FPS-independent)
    this.zenInactivityTimer = null;

    // UI elements
    this.cursorTracker = document.getElementById('cursor-tracker');
    this.readout = document.getElementById('rain-readout');
    this.readingLocation = document.getElementById('reading-location');
    this.readingRate = document.getElementById('reading-rate');

    this.rainGaugeFill = document.getElementById('rain-gauge-fill');
    this.hudRate = document.getElementById('hud-rate');
    this.hudRainType = document.getElementById('hud-rain-type');
    this.hudLocation = document.getElementById('hud-location');
    this.hudStatus = document.getElementById('hud-status');
    this.infocardContainer = document.getElementById('rain-infocard');

    // Experience views ('rain' | 'sound-of-change' | 'arcade')
    this.currentView = 'rain';
    this.soundOfChange = null;
    this.arcade = null;

    this.initTheme();
    this.start();
  }

  async start() {
    await this.initMap();
    this.initAudioMixer();
    this.initControls();
    this.initSearch();
    this.initLeaderboard();
    this.initInfocardHover();
    this.initMobileUI();
    initCalmUI();
    this.initNavigation();
    this.loadGlobalPrecipitationBuffer();
  }

  // ==========================================
  // THEME MANAGEMENT (Auto / Dark / Light)
  // ==========================================

  initTheme() {
    const saved = localStorage.getItem('terraphone_theme') || localStorage.getItem('raintensity_theme') || 'auto';
    this.setTheme(saved, false);

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.themeMode === 'auto') {
        this.applyEffectiveTheme();
      }
    });
  }

  setTheme(mode, persist = true) {
    this.themeMode = mode;
    if (persist) {
      localStorage.setItem('terraphone_theme', mode);
    }
    this.applyEffectiveTheme();
    this.updateThemeButtonVisual();
  }

  applyEffectiveTheme() {
    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = this.themeMode === 'auto' ? (isSystemDark ? 'dark' : 'light') : this.themeMode;

    document.documentElement.setAttribute('data-theme', effective);
    document.documentElement.setAttribute('data-theme-setting', this.themeMode);

    if (this.map?.isStyleLoaded?.()) {
      this.updateMapThemeStyles(effective);
    }
  }

  updateThemeButtonVisual() {
    const btn = document.getElementById('btn-theme');
    const label = document.getElementById('theme-label');
    if (!btn || !label) return;

    if (this.themeMode === 'auto') {
      label.textContent = 'Auto';
      btn.title = 'Theme: System Auto (Click for Dark)';
    } else if (this.themeMode === 'dark') {
      label.textContent = 'Dark';
      btn.title = 'Theme: Dark Mode (Click for Light)';
    } else {
      label.textContent = 'Light';
      btn.title = 'Theme: Light Mode (Click for Auto)';
    }
  }

  cycleTheme() {
    if (this.themeMode === 'auto') this.setTheme('dark');
    else if (this.themeMode === 'dark') this.setTheme('light');
    else this.setTheme('auto');
  }

  // ==========================================
  // 3D BUMPY GLOBE WITH HOVERING CLOUD DECK
  // ==========================================

  async initMap() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const rainWmts = this.buildWmtsUrl(this.activeRainLayerId);

    // Globe starts centered symmetrically at pitch 0 for wobble-free rotation
    const options = {
      container: 'map',
      style: {
        version: 8,
        projection: { type: 'globe' },
        sources: {
          // 1. Elevation-Colored Physical Geography Basemap (Calibrated maxzoom: 8 for clean GPU bilinear overzoom)
          'base-source': {
            type: 'raster',
            tiles: BASEMAP_TILES.physical,
            tileSize: 256,
            maxzoom: 8,
            attribution: 'Esri, USGS, NOAA Physical Topography'
          },
          // 2. AWS Open Data 3D Digital Elevation Model (DEM)
          'terrain-source': {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 12,
            attribution: 'AWS Open Data Elevation'
          },
          // 3. NASA GIBS Live GPM IMERG Precipitation Overlay (WMTS GoogleMapsCompatible_Level6 Grid)
          'rain-source': {
            type: 'raster',
            tiles: [rainWmts],
            tileSize: 256,
            maxzoom: 6,
            attribution: 'NASA GIBS GPM IMERG'
          }
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': 'rgba(0, 0, 0, 0)' }
          },
          // Base Physical Topographic Layer
          {
            id: 'base-layer',
            type: 'raster',
            source: 'base-source',
            paint: {
              'raster-fade-duration': 250,
              'raster-brightness-max': isDark ? 0.88 : 1.0,
              'raster-contrast': isDark ? 0.22 : 0.05,
              'raster-saturation': isDark ? -0.45 : -0.20
            }
          },
          // Shaded Relief / Hillshade Layer to accentuate the 3D bumpy peaks
          {
            id: 'hillshade-layer',
            type: 'hillshade',
            source: 'terrain-source',
            paint: {
              'hillshade-exaggeration': 0.88,
              'hillshade-shadow-color': isDark ? '#02050e' : '#475569',
              'hillshade-highlight-color': '#ffffff',
              'hillshade-accent-color': isDark ? '#38bdf8' : '#cbd5e1',
              'hillshade-illumination-direction': 315
            }
          },
          // 1. Ground Cloud Shadow Layer (Casts dark diffuse cloud shadows on 3D terrain)
          {
            id: 'cloud-shadow-layer',
            type: 'raster',
            source: 'rain-source',
            paint: {
              'raster-opacity': 0.42,
              'raster-fade-duration': 200,
              'raster-brightness-max': 0.08,
              'raster-contrast': 0.50,
              'raster-saturation': -1.0,
              'raster-resampling': 'linear'
            }
          },
          // 2. Hovering Atmospheric Storm Cloud Deck (Vivid NASA IMERG Rain Visualization)
          {
            id: 'cloud-deck-layer',
            type: 'raster',
            source: 'rain-source',
            paint: {
              'raster-opacity': 0.88,
              'raster-fade-duration': 200,
              'raster-brightness-min': 0.05,
              'raster-brightness-max': 1.0,
              'raster-contrast': 0.15,
              'raster-saturation': 0.20,
              'raster-resampling': 'linear'
            }
          }
        ],
        terrain: {
          source: 'terrain-source',
          exaggeration: this.bumpLevel
        },
        sky: {
          'sky-color': isDark ? 'rgba(5, 7, 13, 0.2)' : 'rgba(207, 226, 254, 0.4)',
          'horizon-color': isDark ? 'rgba(10, 22, 40, 0.5)' : 'rgba(224, 242, 254, 0.6)',
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.90, 4, 0.65, 7, 0.15]
        }
      },
      center: [0, 15],
      zoom: Math.max(1.2, 2.15 + Math.log2(Math.min(1, window.innerWidth / window.innerHeight))),
      minZoom: 1.2,
      maxZoom: 11,
      pitch: 0,
      bearing: 0,
      renderWorldCopies: false,
      attributionControl: false
    };
    try {
      this.map = new maplibregl.Map(options);
    } catch (error) {
      const { CanvasGlobe } = await import('./canvas-globe.js');
      this.map = new CanvasGlobe(document.getElementById('map'));
      this.canvasGlobe = this.map;
      document.getElementById('atlas-credit').hidden = false;
      document.getElementById('btn-relief-toggle').closest('.relief-toggle-row').hidden = true;
      document.getElementById('map-source').textContent = '2D globe · NASA Blue Marble';
      console.info('Using the 2D globe because WebGL is unavailable.', error.message);
    }
    this.updateZoomDisplay();

    this.map.on('style.load', () => {
      this.applyTerrainBumpiness();
      this.applyEffectiveTheme();
      this.initCityMarkers();
    });

    // Zoom listener for altitude-dependent acoustics
    this.map.on('zoom', () => {
      this.updateAudioForCurrentTarget();
      this.updateZoomDisplay();
    });

    // Mousemove listener with RAF throttle
    this.map.on('mousemove', (e) => {
      if (this.isZenMode) {
        this.handleZenUserActivity();
        return;
      }
      if (this.currentView !== 'rain' || !this.isRasterReady) return;
      this.lastMouseEvt = e;
      if (!this.mouseRafPending) {
        this.mouseRafPending = true;
        requestAnimationFrame(() => {
          this.mouseRafPending = false;
          if (this.lastMouseEvt) {
            this.handleMouseMove(this.lastMouseEvt);
          }
        });
      }
    });

    this.map.on('mouseout', () => this.hideCursorTracker());

    // Globe Click listener: start listening at click point
    this.map.on('click', (e) => {
      if (this.isZenMode) {
        this.handleZenUserActivity();
      }
      this.handleGlobeClick(e);
    });

    // Drag / Pan interaction in Zen Mode
    this.map.on('dragstart', () => {
      if (this.isZenMode) this.handleZenUserActivity();
    });

    // Thunder strike callback for visual lightning flash
    this.sound.onThunder(({ duration }) => {
      const overlay = document.getElementById('lightning-overlay');
      if (overlay) {
        overlay.classList.add('flashing');
        setTimeout(() => overlay.classList.remove('flashing'), duration || 250);
      }

      try {
        if (this.map?.getLayer?.('cloud-deck-layer')) {
          this.map.setPaintProperty('cloud-deck-layer', 'raster-contrast', 0.95);
          setTimeout(() => {
            try {
              if (this.map?.getLayer?.('cloud-deck-layer')) {
                this.map.setPaintProperty('cloud-deck-layer', 'raster-contrast', 0.65);
              }
            } catch (e) {}
          }, 200);
        }
      } catch (e) {}
    });

    // Refresh NASA IMERG rain layer every 10 minutes
    setInterval(() => this.refreshRainLayer(), 10 * 60 * 1000);
  }

  buildWmtsUrl(layerId = 'IMERG_Precipitation_Rate') {
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(
      layerId
    )}&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible_Level6&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png`;
  }

  updateMapThemeStyles(theme) {
    const isDark = theme === 'dark';
    try {
      if (this.map.getLayer('background')) {
        this.map.setPaintProperty('background', 'background-color', 'rgba(0, 0, 0, 0)');
      }
      if (this.map.getLayer('base-layer')) {
        this.map.setPaintProperty('base-layer', 'raster-brightness-max', isDark ? 0.88 : 1.0);
        this.map.setPaintProperty('base-layer', 'raster-contrast', isDark ? 0.22 : 0.05);
        this.map.setPaintProperty('base-layer', 'raster-saturation', isDark ? -0.45 : -0.20);
      }
      if (this.map.getLayer('cloud-deck-layer')) {
        this.map.setPaintProperty('cloud-deck-layer', 'raster-saturation', 0.20);
        this.map.setPaintProperty('cloud-deck-layer', 'raster-contrast', 0.15);
      }
      if (this.map.getLayer('hillshade-layer')) {
        this.map.setPaintProperty('hillshade-layer', 'hillshade-shadow-color', isDark ? '#02050e' : '#475569');
      }
    } catch (e) {
      console.warn('Map styling update deferred:', e);
    }
  }

  // ==========================================
  // BUMPY GLOBE RELIEF CONTROLS (ON / OFF TOGGLE)
  // ==========================================

  toggleTerrainRelief() {
    this.isTerrainEnabled = !this.isTerrainEnabled;
    this.applyTerrainBumpiness();

    const btn = document.getElementById('btn-relief-toggle');
    const label = document.getElementById('relief-toggle-label');
    if (btn) {
      btn.classList.toggle('active', this.isTerrainEnabled);
      btn.setAttribute('aria-pressed', this.isTerrainEnabled ? 'true' : 'false');
    }
    if (label) {
      label.textContent = this.isTerrainEnabled ? 'ON' : 'OFF';
    }
  }

  applyTerrainBumpiness() {
    if (!this.map) return;
    try {
      if (!this.isTerrainEnabled) {
        this.map.setTerrain(null);
      } else {
        this.map.setTerrain({
          source: 'terrain-source',
          exaggeration: this.bumpLevel
        });
      }
    } catch (e) {
      console.warn('SetTerrain notice:', e);
    }
  }

  // ==========================================
  // BILINEAR DATA INTERPOLATION (NO BLOCKINESS)
  // ==========================================

  async loadGlobalPrecipitationBuffer() {
    // Stitch exact 4 WMTS tiles at TILEMATRIX=1 (GoogleMapsCompatible_Level6)
    // Row 0-1, Col 0-1 forms the complete 512x512 global projection
    // 100% mathematically and visually identical to MapLibre's live rain tiles!
    const baseUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(
      this.activeRainLayerId
    )}&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible_Level6&TILEMATRIX=1&FORMAT=image/png`;

    const tiles = [
      { col: 0, row: 0, dx: 0, dy: 0 },
      { col: 1, row: 0, dx: 256, dy: 0 },
      { col: 0, row: 1, dx: 0, dy: 256 },
      { col: 1, row: 1, dx: 256, dy: 256 }
    ];

    try {
      this.samplingCtx.clearRect(0, 0, 512, 512);

      await Promise.all(
        tiles.map(async (t) => {
          const url = `${baseUrl}&TILEROW=${t.row}&TILECOL=${t.col}`;
          const resp = await fetch(url, { cache: 'no-store' });
          if (!resp.ok) throw new Error(`WMTS tile ${t.col},${t.row} status ${resp.status}`);
          const blob = await resp.blob();
          const img = new Image();
          img.src = URL.createObjectURL(blob);
          await img.decode();
          this.samplingCtx.drawImage(img, t.dx, t.dy, 256, 256);
          URL.revokeObjectURL(img.src);
        })
      );

    } catch (err) {
      console.warn('WMTS 4-tile buffer fetch fallback to WMS:', err);
      try {
        const wmsUrl = `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${encodeURIComponent(
          this.activeRainLayerId
        )}&CRS=EPSG:3857&BBOX=-20037508,-20037508,20037508,20037508&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE`;
        const resp = await fetch(wmsUrl, { cache: 'no-store' });
        const blob = await resp.blob();
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        this.samplingCtx.clearRect(0, 0, 512, 512);
        this.samplingCtx.drawImage(img, 0, 0, 512, 512);
      } catch (e) {
        console.warn('Raster precipitation buffer unavailable:', e);
        return;
      }
    }
    this.pixelData = this.samplingCtx.getImageData(0, 0, 512, 512).data;
    this.isRasterReady = true;
    this.canvasGlobe?.setRain(this.pixelData);
    if (this.listeningTarget && this.currentView === 'rain') {
      this.setListeningPoint(this.listeningTarget.lng, this.listeningTarget.lat, this.listeningTarget.label, false);
    }
  }

  // True Bilinear Interpolation over floating coordinates with coordinate caching
  sampleRateAt(lng, lat) {
    if (!this.isRasterReady || !this.pixelData) return 0;

    const cacheKey = `${lng.toFixed(3)},${lat.toFixed(3)}`;
    if (this._sampleCache && this._sampleCache.key === cacheKey) {
      return this._sampleCache.val;
    }

    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const normLng = ((lng + 180) % 360 + 360) % 360 - 180;

    const fx = ((normLng + 180) / 360) * 512;
    const latRad = (clampedLat * Math.PI) / 180;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    const fy = (0.5 - mercN / (2 * Math.PI)) * 512;

    if (fx < 0 || fx >= 512 || fy < 0 || fy >= 512) return 0;

    const x0 = Math.floor(fx);
    const x1 = Math.min(511, x0 + 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(511, y0 + 1);

    const wx = fx - x0;
    const wy = fy - y0;

    const r00 = this.getPixelRainRate(x0, y0);
    const r10 = this.getPixelRainRate(x1, y0);
    const r01 = this.getPixelRainRate(x0, y1);
    const r11 = this.getPixelRainRate(x1, y1);

    if (r00 === 0 && r10 === 0 && r01 === 0 && r11 === 0) {
      this._sampleCache = { key: cacheKey, val: 0 };
      return 0;
    }

    const top = (1 - wx) * r00 + wx * r10;
    const bottom = (1 - wx) * r01 + wx * r11;
    const interpolated = Math.max(0, (1 - wy) * top + wy * bottom);

    this._sampleCache = { key: cacheKey, val: interpolated };
    return interpolated;
  }

  getPixelRainRate(px, py) {
    const idx = (py * 512 + px) * 4;
    const a = this.pixelData[idx + 3];
    if (a < 80) return 0; // Ignore transparent or insignificant background pixels

    const r = this.pixelData[idx];
    const g = this.pixelData[idx + 1];
    const b = this.pixelData[idx + 2];

    // Filter out grayscale land/sea base map bleed or no-data entries (e.g. 128,128,128 or 191,191,191)
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if (maxC - minC < 16) return 0;

    return this.matchPixelToPalette(r, g, b);
  }

  matchPixelToPalette(r, g, b) {
    let bestDist = Infinity;
    let bestVal = 0;

    for (const p of IMERG_PALETTE) {
      const dr = r - p.rgb[0];
      const dg = g - p.rgb[1];
      const db = b - p.rgb[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestVal = p.v;
        if (dist === 0) break;
      }
    }
    // Strict Euclidean distance cutoff: if pixel color is not within calibrated RGB distance of NASA IMERG palette, it's NOT rain!
    if (bestDist > 650) return 0;
    return bestVal;
  }

  // ==========================================
  // LOCATION HABITAT CLASSIFIER
  // Urban / Rural / Jungle / Ocean
  // ==========================================

  classifyLocationEnvironment(lng, lat) {
    // 1. Exact 1-degree global land/ocean bitmask lookup (Natural Earth 110m)
    // Instantaneous O(1) determination: oceans worldwide are 100% accurately detected
    if (!isCoordinateLand(lng, lat)) {
      return 'ocean';
    }

    // 2. Equatorial / tropical rainforests (Jungle wildlife)
    // Amazon Basin
    if (lat >= -12 && lat <= 6 && lng >= -76 && lng <= -48) return 'jungle';
    // Congo Basin
    if (lat >= -7 && lat <= 6 && lng >= 12 && lng <= 30) return 'jungle';
    // Southeast Asia / Borneo / Sumatra / Papua
    if (lat >= -10 && lat <= 10 && lng >= 96 && lng <= 150) return 'jungle';
    // Chocó Rainforest (Colombia)
    if (lat >= 2 && lat <= 9 && lng >= -78 && lng <= -75) return 'jungle';

    // 3. Urban proximity (Metropolises from CITIES_DATABASE)
    for (const city of CITIES_DATABASE) {
      const dLng = lng - city.lng;
      const dLat = lat - city.lat;
      const distSq = dLng * dLng + dLat * dLat;
      if (distSq < 0.30) {
        return 'urban';
      }
    }

    // 4. Land default: Countryside / Rural woodland
    return 'rural';
  }

  updateEnvironmentBadge(envType) {
    const badgeIcon = document.getElementById('hud-env-icon');
    const badgeLabel = document.getElementById('hud-env-label');
    if (!badgeIcon || !badgeLabel) return;

    const map = {
      urban: { icon: '🏙️', label: 'Urban Ambience' },
      rural: { icon: '🦗', label: 'Rural Ambience' },
      jungle: { icon: '🦜', label: 'Rainforest Wildlife' },
      ocean: { icon: '🌊', label: 'Ocean Swell' }
    };
    const info = map[envType] || map.rural;
    badgeIcon.textContent = info.icon;
    badgeLabel.textContent = info.label;
  }

  // ==========================================
  // ZEN MODE CINEMATIC AUTO-ROTATION
  // ==========================================

  startZenAutoRotation() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (this.isAutoRotating) return;
    this.isAutoRotating = true;
    let lastTime = performance.now();

    const rotateStep = (timestamp) => {
      if (!this.isAutoRotating || !this.map || !this.isZenMode) return;
      const now = timestamp || performance.now();
      const deltaSec = Math.min((now - lastTime) / 1000, 0.1); // Clamp to max 100ms to prevent jump on tab focus
      lastTime = now;

      const center = this.map.getCenter();
      let newLng = center.lng + (this.autoRotateDegPerSec * deltaSec);
      if (newLng > 180) newLng -= 360;
      if (newLng < -180) newLng += 360;

      this.map.setCenter([newLng, center.lat]);
      this.autoRotateRaf = requestAnimationFrame(rotateStep);
    };

    this.autoRotateRaf = requestAnimationFrame(rotateStep);
  }

  pauseZenAutoRotation() {
    this.isAutoRotating = false;
    if (this.autoRotateRaf) {
      cancelAnimationFrame(this.autoRotateRaf);
      this.autoRotateRaf = null;
    }
  }

  handleZenUserActivity() {
    this.pauseZenAutoRotation();
    clearTimeout(this.zenInactivityTimer);
    this.zenInactivityTimer = setTimeout(() => {
      if (this.isZenMode) {
        this.startZenAutoRotation();
      }
    }, 3200);
  }

  toggleUiVisibility() {
    this.isZenMode = document.body.classList.toggle('zen-mode');
    document.getElementById('btn-hide-ui')?.setAttribute('aria-pressed', String(this.isZenMode));
    document.getElementById('explore-menu')?.removeAttribute('open');
    this.hideCursorTracker();
    document.getElementById(this.isZenMode ? 'btn-exit-zen' : 'btn-explore').focus({ preventScroll: true });

    if (this.isZenMode) {
      this.startZenAutoRotation();

      // Zen Token Economy: 1 token accrued per active minute in Zen mode (up to daily cap)
      if (this.zenTokenInterval) clearInterval(this.zenTokenInterval);
      this.zenTokenInterval = setInterval(() => {
        if (this.isZenMode && document.visibilityState === 'visible') {
          arcadeTokens.recordZenMinute();
        }
      }, 60000);
    } else {
      this.pauseZenAutoRotation();
      clearTimeout(this.zenInactivityTimer);
      if (this.zenTokenInterval) {
        clearInterval(this.zenTokenInterval);
        this.zenTokenInterval = null;
      }
    }
  }

  toggleZenMode() {
    this.toggleUiVisibility();
  }

  // ==========================================
  // MOUSE FOLLOWER FOR RAIN HEAVINESS INFO
  // ==========================================

  handleMouseMove(e) {
    if (!this.map || this.isZenMode || this.currentView !== 'rain') return;
    const { lng, lat } = e.lngLat;
    const value = this.sampleRateAt(lng, lat).toFixed(1) + ' mm/h';
    if (this.cursorTracker.textContent !== value) this.cursorTracker.textContent = value;
    const x = Math.min(window.innerWidth - 92, Math.max(6, e.point.x + 14));
    const y = Math.min(window.innerHeight - 34, Math.max(6, e.point.y + 14));
    this.cursorTracker.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.cursorTracker.classList.add('visible');
  }

  hideCursorTracker() {
    this.lastMouseEvt = null;
    this.cursorTracker.classList.remove('visible');
  }

  // ==========================================
  // CLICK-TO-PLAY INTERACTION
  // ==========================================

  handleGlobeClick(e) {
    const { lng, lat } = e.lngLat;
    this.setListeningPoint(lng, lat, null, true);
  }

  setListeningPoint(lng, lat, customLabel = null, triggerRipple = true) {
    const rate = this.sampleRateAt(lng, lat);
    const rainType = getRainType(rate);

    const latStr = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
    const lngStr = `${Math.abs(lng).toFixed(1)}°${lng >= 0 ? 'E' : 'W'}`;
    const locationName = customLabel || `${latStr}, ${lngStr}`;

    this.listeningTarget = { lng, lat, rate, label: locationName };

    // Update persistent target crosshair indicator on the globe
    this.updateListeningCrosshair(lng, lat);

    // Detect environment (urban, rural, jungle, ocean)
    const envType = this.classifyLocationEnvironment(lng, lat);
    this.currentEnv = envType;
    this.updateEnvironmentBadge(envType);

    // City-specific noise pollution ranking & acoustic signature
    const noiseData = getCityNoiseData(locationName, lng, lat);
    this.currentNoiseData = noiseData;
    this.updateNoiseBadge(noiseData);

    if (noiseData) {
      this.sound.setCityAcoustics(noiseData.key, true);
    } else {
      this.sound.setCityAcoustics(null, false);
    }

    if (!this.isListening) {
      this.sound.startAudio();
      this.isListening = true;
      this.updatePlayButtonVisual(true);
    }

    this.updateHud(rate, rainType, locationName);

    const zoom = this.map ? this.map.getZoom() : 2.5;
    this.sound.updateRain(rate, zoom, true);
    this.sound.updateAmbience(envType, true);

    // Convective storm lightning strike trigger
    if (rate >= 18.0) {
      this.sound.triggerThunderStrike(1.0);
    }
  }

  updateNoiseBadge(noiseData) {
    const badge = document.getElementById('hud-noise-badge');
    const textEl = document.getElementById('hud-noise-text');
    if (!badge) return;

    if (!noiseData) {
      badge.style.display = 'none';
      return;
    }

    badge.style.display = 'inline-flex';
    badge.className = 'hud-noise-badge';
    if (noiseData.dBA <= 76) {
      badge.classList.add('low');
    } else if (noiseData.dBA <= 89) {
      badge.classList.add('moderate');
    } else {
      badge.classList.add('hazardous');
    }

    if (textEl) {
      textEl.textContent = `🔊 #${noiseData.rank} ${noiseData.name} · ${noiseData.dBA} dB`;
    }
  }

  openNoiseModal(noiseData) {
    if (!noiseData) return;
    const modal = document.getElementById('noise-modal');
    if (!modal) return;

    const badgeEl = document.getElementById('modal-noise-badge');
    const cityEl = document.getElementById('modal-noise-city');
    const dbEl = document.getElementById('modal-noise-db');
    const levelEl = document.getElementById('modal-noise-level');
    const barEl = document.getElementById('modal-noise-bar');
    const whoEl = document.getElementById('modal-noise-who');
    const sourcesEl = document.getElementById('modal-noise-sources');
    const natureEl = document.getElementById('modal-noise-nature');
    const solutionsEl = document.getElementById('modal-noise-solutions');

    if (badgeEl) badgeEl.textContent = `🔊 Noise Rank #${noiseData.rank}`;
    if (cityEl) cityEl.textContent = noiseData.name;
    if (dbEl) dbEl.textContent = noiseData.dBA;

    if (levelEl) {
      levelEl.textContent = noiseData.level;
      levelEl.className = 'meter-level-tag';
      if (noiseData.dBA <= 76) {
        levelEl.classList.add('low');
      } else if (noiseData.dBA <= 89) {
        levelEl.classList.add('moderate');
      } else {
        levelEl.classList.add('hazardous');
      }
    }

    if (barEl) {
      const pct = Math.min(100, Math.max(15, (noiseData.dBA / 125) * 100));
      barEl.style.width = `${pct}%`;
      if (noiseData.dBA <= 76) {
        barEl.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
      } else if (noiseData.dBA <= 89) {
        barEl.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
      } else {
        barEl.style.background = 'linear-gradient(90deg, #ef4444, #b91c1c)';
      }
    }

    if (whoEl) {
      const diff = noiseData.dBA - 53;
      whoEl.textContent = diff > 0
        ? `+${diff} dB above WHO Environmental Noise guideline (53 dB Lden)`
        : `${Math.abs(diff)} dB below WHO Environmental Noise guideline (53 dB Lden)`;
    }

    if (sourcesEl) sourcesEl.textContent = noiseData.sources;
    if (natureEl) natureEl.textContent = noiseData.natureImpact;

    if (solutionsEl && Array.isArray(noiseData.solutions)) {
      solutionsEl.innerHTML = noiseData.solutions.map((s) => `<li>${s}</li>`).join('');
    }

    const socBtn = document.getElementById('modal-btn-open-soc');
    if (socBtn) {
      socBtn.onclick = () => {
        modal.classList.remove('open');
        this.switchExperience('sound-of-change');
      };
    }

    modal.classList.add('open');
  }

  updateAudioForCurrentTarget() {
    if (!this.isListening || !this.listeningTarget) return;
    const zoom = this.map ? this.map.getZoom() : 2.5;
    const rate = this.sampleRateAt(this.listeningTarget.lng, this.listeningTarget.lat);
    this.listeningTarget.rate = rate;
    const rainType = getRainType(rate);

    this.updateHud(rate, rainType, this.listeningTarget.label);
    this.sound.updateRain(rate, zoom, true);
    this.sound.updateAmbience(this.currentEnv, true);

    // Periodic thunder timer for severe convective cells
    if (rate >= 16.0 && this.isListening) {
      if (!this.convectiveThunderTimer) {
        this.convectiveThunderTimer = setInterval(() => {
          if (this.isListening && this.listeningTarget && this.listeningTarget.rate >= 16.0) {
            this.sound.triggerThunderStrike(0.85);
          }
        }, 18000);
      }
    } else if (this.convectiveThunderTimer) {
      clearInterval(this.convectiveThunderTimer);
      this.convectiveThunderTimer = null;
    }
  }

  updateHud(rate, rainType, locationName) {
    const rateStr = rate < 0.05 ? '0.0' : rate.toFixed(1);
    this.hudRate.textContent = rateStr;
    this.hudRainType.innerHTML = `${rainType.icon} <span>${rainType.tag}</span>`;
    this.hudLocation.textContent = locationName;
    this.hudStatus.textContent = !this.isListening ? 'CLICK TO LISTEN' : this.sound.isMuted ? 'AUDIO PAUSED' : 'LISTENING';

    const logNorm = Math.min(1.0, Math.max(0, Math.log10(Math.max(0.01, rate) + 0.1) / 2.2));
    this.rainGaugeFill.style.width = `${Math.round(logNorm * 100)}%`;

    this.readout.hidden = false;
    this.readingLocation.textContent = locationName;
    this.readingRate.textContent = this.isRasterReady ? rateStr + ' mm/h' : '— mm/h';
    if (!this.isRasterReady) {
      this.hudRate.textContent = '—';
      this.hudRainType.textContent = 'Rain data unavailable';
    }
    document.getElementById('hud-rain-indicator').disabled = !this.isRasterReady;
    if (this.infocardContainer.classList.contains('visible') && this.isRasterReady) {
      this.populateInfocard(rainType, rate);
    }
  }

  updateListeningCrosshair(lng, lat) {
    if (!this.map) return;
    if (this.canvasGlobe) {
      this.canvasGlobe.mark(lng, lat);
      return;
    }

    if (!this.crosshairMarker) {
      const el = document.createElement('div');
      el.className = 'listening-crosshair';
      el.innerHTML = `
        <div class="crosshair-ring"></div>
        <div class="crosshair-center"></div>
        <div class="crosshair-tick tick-top"></div>
        <div class="crosshair-tick tick-bottom"></div>
        <div class="crosshair-tick tick-left"></div>
        <div class="crosshair-tick tick-right"></div>
      `;
      this.crosshairEl = el;
      this.crosshairMarker = new maplibregl.Marker({
        element: el,
        anchor: 'center'
      })
        .setLngLat([lng, lat])
        .addTo(this.map);
    } else {
      this.crosshairMarker.setLngLat([lng, lat]);
    }
  }

  // ==========================================
  // RAIN TYPE HOVER INFOCARDS WITH FLASHCARD WEBP
  // ==========================================

  initInfocardHover() {
    const indicator = document.getElementById('hud-rain-indicator');
    if (!indicator || !this.infocardContainer) return;

    const setOpen = (open) => {
      indicator.setAttribute('aria-expanded', String(open));
      this.infocardContainer.classList.toggle('visible', open);
      if (open && this.listeningTarget) {
        const rate = this.listeningTarget.rate;
        this.populateInfocard(getRainType(rate), rate);
      }
    };
    indicator.addEventListener('click', () => setOpen(indicator.getAttribute('aria-expanded') !== 'true'));
    this.readout.addEventListener('toggle', () => {
      if (!this.readout.open) setOpen(false);
    });
  }

  populateInfocard(rainType, currentRate) {
    if (!this.infocardContainer) return;

    const imgHtml = rainType.image ? `
      <div class="infocard-img-wrap">
        <img src="${rainType.image}" alt="${rainType.name}" class="infocard-img" loading="lazy">
        <div class="infocard-img-overlay">
          <span class="infocard-img-caption">${rainType.imageCaption || ''}</span>
        </div>
      </div>
    ` : '';

    this.infocardContainer.innerHTML = `
      <div class="infocard-header">
        <div class="infocard-badge">${rainType.icon} ${rainType.name}</div>
        <div class="infocard-range">${rainType.rateMin} – ${rainType.rateMax} mm/hr</div>
      </div>

      ${imgHtml}

      <div class="infocard-row">
        <span class="info-label">Scientific Class:</span>
        <span class="info-value">${rainType.scientificClass}</span>
      </div>

      <div class="infocard-row">
        <span class="info-label">Cloud Genus:</span>
        <span class="info-value">${rainType.cloudGenus}</span>
      </div>

      <div class="infocard-metrics">
        <div class="metric-box">
          <span class="metric-title">Drop Diameter</span>
          <span class="metric-num">${rainType.dropDiameter}</span>
        </div>
        <div class="metric-box">
          <span class="metric-title">Velocity</span>
          <span class="metric-num">${rainType.terminalVelocity}</span>
        </div>
        <div class="metric-box">
          <span class="metric-title">Kinetic Energy</span>
          <span class="metric-num">${rainType.kineticEnergy}</span>
        </div>
      </div>

      <div class="infocard-section">
        <span class="info-label">Acoustic Signature:</span>
        <p class="info-desc">${rainType.acousticSignature}</p>
      </div>

      <div class="infocard-section">
        <span class="info-label">NASA GPM IMERG Detection:</span>
        <p class="info-desc">${rainType.nasaGpmDetection}</p>
      </div>

      <div class="infocard-footer">
        <span>GPM DPR & GMI Algorithm V07B</span>
        <span>Observed: ${(currentRate || 0).toFixed(1)} mm/hr</span>
      </div>
    `;
  }

  // ==========================================
  // GLOBAL URBAN NOISE LEADERBOARD CONTROLLER
  // ==========================================

  initLeaderboard() {
    const leaderboardBtn = document.getElementById('btn-leaderboard');
    const modal = document.getElementById('leaderboard-modal');
    const closeBtn = document.getElementById('close-leaderboard-modal');

    if (leaderboardBtn && modal) {
      leaderboardBtn.addEventListener('click', () => {
        this.renderLeaderboardList();
        modal.classList.add('open');
      });
    }

    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => {
        modal.classList.remove('open');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('open');
      });
    }
  }

  renderLeaderboardList() {
    const listContainer = document.getElementById('leaderboard-list');
    const modal = document.getElementById('leaderboard-modal');
    if (!listContainer) return;

    const cities = getLeaderboardCities();
    listContainer.innerHTML = `
      <div class="leaderboard-soc-banner" id="leaderboard-soc-banner" style="background: linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(52, 211, 153, 0.15)); border: 1px solid var(--accent); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer;">
        <div>
          <div style="font-weight: 750; color: var(--text-main); font-size: 13px;">🏙️ Explore The Sound of Change (Manhattan)</div>
          <div style="font-size: 11px; color: var(--text-sub); margin-top: 2px;">Hear how 20 planning decisions change a Manhattan street.</div>
        </div>
        <button class="soc-btn soc-btn-primary" style="white-space: nowrap; font-size: 11.5px; padding: 6px 12px;">Simulate →</button>
      </div>
    `;

    document.getElementById('leaderboard-soc-banner')?.addEventListener('click', () => {
      modal?.classList.remove('open');
      this.switchExperience('sound-of-change');
    });

    cities.forEach((city) => {
      const item = document.createElement('div');
      item.className = 'leaderboard-item';

      let rankClass = 'rank-low';
      if (city.rank <= 4) rankClass = 'rank-extreme';
      else if (city.rank <= 12) rankClass = 'rank-severe';
      else if (city.rank <= 19) rankClass = 'rank-high';

      // Scale 50 dBA -> 120 dBA
      const pct = Math.max(10, Math.min(100, Math.round(((city.dBA - 50) / 70) * 100)));

      item.innerHTML = `
        <div class="leaderboard-left">
          <span class="leaderboard-rank-pill ${rankClass}">#${city.rank}</span>
          <div class="leaderboard-city-info">
            <span class="leaderboard-city-name">${city.name}</span>
            <span class="leaderboard-city-sub">${city.country} · ${city.level}</span>
          </div>
        </div>
        <div class="leaderboard-right">
          <div class="leaderboard-meter-wrap">
            <span class="leaderboard-db-pill" style="color:${city.color}">
              ${city.dBA}<span class="leaderboard-db-unit">dBA</span>
            </span>
            <div class="leaderboard-mini-track">
              <div class="leaderboard-mini-fill" style="width:${pct}%; background:${city.color};"></div>
            </div>
          </div>
          <button class="leaderboard-action-btn" title="Travel to ${city.name}">
            <span>Travel</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      `;

      item.addEventListener('click', () => {
        modal?.classList.remove('open');
        this.lockToLocation(city.lng, city.lat, 6.0, `${city.name}, ${city.country}`);
        if (city.soundType) {
          this.sound.triggerCitySignature(city.soundType);
        }
        setTimeout(() => this.openNoiseModal(city), 600);
      });

      listContainer.appendChild(item);
    });
  }

  // ==========================================
  // 3D GLOBE CITY MARKERS & ACOUSTIC INDICATORS
  // ==========================================

  initCityMarkers() {
    if (!this.map) return;

    const features = [];
    const addedNames = new Set();

    // 1. Noise ranked cities first
    for (const [key, profile] of Object.entries(CITY_NOISE_PROFILES)) {
      addedNames.add(profile.name.toLowerCase());
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [profile.lng, profile.lat]
        },
        properties: {
          name: profile.name,
          country: profile.country,
          isNoiseRanked: true,
          rank: profile.rank,
          dBA: profile.dBA,
          level: profile.level,
          soundType: profile.soundType || key
        }
      });
    }

    // 2. All 130+ metropolises and capitals from CITIES_DATABASE
    for (const city of CITIES_DATABASE) {
      if (addedNames.has(city.name.toLowerCase())) continue;
      addedNames.add(city.name.toLowerCase());
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [city.lng, city.lat]
        },
        properties: {
          name: city.name,
          country: city.country,
          isNoiseRanked: false,
          category: city.cat || 'Metropolis',
          pop: city.pop || ''
        }
      });
    }

    const geojsonData = {
      type: 'FeatureCollection',
      features
    };

    if (this.map.getSource('cities-source')) {
      this.map.getSource('cities-source').setData(geojsonData);
      return;
    }

    this.map.addSource('cities-source', {
      type: 'geojson',
      data: geojsonData
    });

    // Outer soft glow halo
    this.map.addLayer({
      id: 'cities-glow',
      type: 'circle',
      source: 'cities-source',
      paint: {
        'circle-radius': ['case', ['get', 'isNoiseRanked'], 8.5, 5.0],
        'circle-color': ['case', ['get', 'isNoiseRanked'], '#ef4444', '#38bdf8'],
        'circle-opacity': 0.38,
        'circle-blur': 0.8
      }
    });

    // Inner crisp dot
    this.map.addLayer({
      id: 'cities-dots',
      type: 'circle',
      source: 'cities-source',
      paint: {
        'circle-radius': ['case', ['get', 'isNoiseRanked'], 4.5, 3.2],
        'circle-color': ['case', ['get', 'isNoiseRanked'], '#ef4444', '#f8fafc'],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#070b14'
      }
    });

    // Generous, touch-friendly hitbox layer for mobile and desktop (48px tap target)
    this.map.addLayer({
      id: 'cities-hitbox',
      type: 'circle',
      source: 'cities-source',
      paint: {
        'circle-radius': 24,
        'circle-opacity': 0.0001
      }
    });

    // Floating Popup
    this.cityPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10
    });

    this.map.on('mouseenter', 'cities-hitbox', (e) => {
      this.map.getCanvas().style.cursor = 'pointer';
      if (!e.features || !e.features.length) return;
      const f = e.features[0];
      const coords = f.geometry.coordinates.slice();
      const p = f.properties;

      let badgeHtml = '';
      if (p.isNoiseRanked) {
        badgeHtml = `<span class="city-popup-badge ranked">🔊 Noise Rank #${p.rank} · ${p.dBA} dBA</span>`;
      } else {
        badgeHtml = `<span class="city-popup-badge metro">📍 ${p.category || 'City'}</span>`;
      }

      const content = `
        <div class="city-popup">
          <div class="city-popup-title">${p.name}, ${p.country}</div>
          ${badgeHtml}
          <div class="city-popup-hint">Click to listen & explore</div>
        </div>
      `;

      this.cityPopup.setLngLat(coords).setHTML(content).addTo(this.map);
    });

    this.map.on('mouseleave', 'cities-hitbox', () => {
      this.map.getCanvas().style.cursor = '';
      this.cityPopup.remove();
    });

    this.map.on('click', 'cities-hitbox', (e) => {
      if (!e.features || !e.features.length) return;
      const f = e.features[0];
      const coords = f.geometry.coordinates;
      const p = f.properties;

      this.cityPopup.remove();
      this.lockToLocation(coords[0], coords[1], 6.2, `${p.name}, ${p.country}`);

      if (p.soundType) {
        this.sound.triggerCitySignature(p.soundType);
      }

      if (p.isNoiseRanked) {
        const noiseData = getCityNoiseData(p.name, coords[0], coords[1]);
        if (noiseData) {
          setTimeout(() => this.openNoiseModal(noiseData), 600);
        }
      }
    });
  }

  // ==========================================
  // SEARCHBAR WITH CAMERA LOCK & LIVE AUTOCOMPLETE
  // ==========================================

  initSearch() {
    const searchInput = document.getElementById('search-input');
    const suggestionsBox = document.getElementById('search-suggestions');

    const explore = document.getElementById('explore-menu');
    new SearchController(searchInput, suggestionsBox, (item) => {
      explore.open = false;
      document.getElementById('btn-explore').focus();
      if (item.isHeaviestAction) {
        this.flyToHeaviestRainArea();
        return;
      }
      this.lockToLocation(item.lng, item.lat, item.zoom || 5.5, item.name);
    });

    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.key === '/' && this.currentView === 'rain' && !this.isZenMode && document.activeElement !== searchInput) {
        e.preventDefault();
        explore.open = true;
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'h' || e.key === 'H') {
        if (this.currentView === 'rain' && document.activeElement !== searchInput) {
          this.toggleUiVisibility();
        }
      } else if (e.key === ' ' && !document.activeElement.closest('input, button, summary, a, select, textarea')) {
        if (this.currentView === 'arcade') {
          // Allow arcade games to consume spacebar for jump / boost / cruise
          return;
        }
        e.preventDefault();
        if (this.currentView === 'sound-of-change') {
          this.soundOfChange?.toggleAudio();
        } else {
          this.togglePlayback();
        }
      } else if ((e.key === 'c' || e.key === 'C') && document.activeElement !== searchInput) {
        if (this.currentView === 'arcade' && this.arcade?.activeGameInstance) {
          // In-game arcade controls take priority
          return;
        }
        this.switchExperience(this.currentView === 'rain' ? 'sound-of-change' : 'rain');
      } else if ((e.key === 'a' || e.key === 'A') && document.activeElement !== searchInput) {
        if (this.currentView === 'arcade' && this.arcade?.activeGameInstance) {
          // Game movement takes priority
          return;
        }
        this.switchExperience(this.currentView === 'arcade' ? 'rain' : 'arcade');
      } else if ((e.key === 's' || e.key === 'S') && document.activeElement !== searchInput) {
        if (this.currentView === 'arcade') {
          return;
        }
        if (this.currentView === 'sound-of-change') {
          this.switchExperience('rain');
        }
        this.flyToHeaviestRainArea();
      }
    });
  }

  lockToLocation(lng, lat, zoom = 5.5, locationName = null) {
    if (!this.map) return;

    if (this.isZenMode) {
      this.handleZenUserActivity();
    }

    this.map.flyTo({
      center: [lng, lat],
      zoom: Math.max(4.0, Math.min(zoom, 7.0)),
      pitch: 0,
      bearing: 0,
      speed: 1.15,
      curve: 1.35,
      essential: true
    });

    setTimeout(() => {
      this.setListeningPoint(lng, lat, locationName, true);
    }, 500);
  }

  // ==========================================
  // FLY TO HEAVIEST RAIN AREA (LIVE NASA GPM)
  // ==========================================

  flyToHeaviestRainArea() {
    let maxRate = 0;
    let bestPixel = null;

    if (this.isRasterReady && this.pixelData) {
      for (let py = 12; py < 500; py += 2) {
        for (let px = 0; px < 512; px += 2) {
          const rate = this.getPixelRainRate(px, py);
          if (rate > maxRate) {
            maxRate = rate;
            bestPixel = { px, py };
          }
        }
      }

      if (bestPixel) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const px = Math.max(0, Math.min(511, bestPixel.px + dx));
            const py = Math.max(0, Math.min(511, bestPixel.py + dy));
            const rate = this.getPixelRainRate(px, py);
            if (rate > maxRate) {
              maxRate = rate;
              bestPixel = { px, py };
            }
          }
        }
      }
    }

    let targetLng, targetLat, locationLabel;

    if (bestPixel && maxRate >= 0.5) {
      targetLng = (bestPixel.px / 512) * 360 - 180;
      const mercN = (0.5 - bestPixel.py / 512) * (2 * Math.PI);
      const latRad = 2 * (Math.atan(Math.exp(mercN)) - Math.PI / 4);
      targetLat = (latRad * 180) / Math.PI;

      const latStr = `${Math.abs(targetLat).toFixed(1)}°${targetLat >= 0 ? 'N' : 'S'}`;
      const lngStr = `${Math.abs(targetLng).toFixed(1)}°${targetLng >= 0 ? 'E' : 'W'}`;
      locationLabel = `Storm Epicenter (${maxRate.toFixed(1)} mm/hr · ${latStr}, ${lngStr})`;
    } else {
      let highestObserved = 0;
      let topSpot = PRESET_HOTSPOTS[0];

      for (const spot of PRESET_HOTSPOTS) {
        const rate = this.sampleRateAt(spot.lng, spot.lat);
        if (rate > highestObserved) {
          highestObserved = rate;
          topSpot = spot;
        }
      }

      targetLng = topSpot.lng;
      targetLat = topSpot.lat;
      maxRate = highestObserved;
      locationLabel = topSpot.label;
    }

    if (this.isZenMode) {
      this.handleZenUserActivity();
    }

    this.map.flyTo({
      center: [targetLng, targetLat],
      zoom: 5.2,
      pitch: 0,
      bearing: 0,
      speed: 1.15,
      curve: 1.35,
      essential: true
    });

    setTimeout(() => {
      this.sound.startAudio();
      this.setListeningPoint(targetLng, targetLat, locationLabel, true);
    }, 400);
  }

  // ==========================================
  // AUDIO MIXER & 4 SLIDERS
  // ==========================================

  initAudioMixer() {
    const rainSlider = document.getElementById('slider-rain-vol');
    const thunderSlider = document.getElementById('slider-thunder-vol');
    const ambienceSlider = document.getElementById('slider-ambience-vol');
    const lofiSlider = document.getElementById('slider-lofi-vol');

    if (rainSlider) {
      rainSlider.addEventListener('input', (e) => {
        this.sound.setRainVolume(parseFloat(e.target.value));
      });
    }

    if (thunderSlider) {
      thunderSlider.addEventListener('input', (e) => {
        this.sound.setThunderVolume(parseFloat(e.target.value));
      });
    }

    if (ambienceSlider) {
      ambienceSlider.addEventListener('input', (e) => {
        this.sound.setAmbienceVolume(parseFloat(e.target.value));
      });
    }

    // Granular Ambience Dropdown toggle & sub-sliders
    const ambienceDropdownBtn = document.getElementById('btn-ambience-dropdown');
    const ambienceDropdownMenu = document.getElementById('ambience-dropdown-menu');

    if (ambienceDropdownBtn && ambienceDropdownMenu) {
      ambienceDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = ambienceDropdownMenu.classList.toggle('open');
        ambienceDropdownBtn.classList.toggle('open', isOpen);
        ambienceDropdownBtn.setAttribute('aria-expanded', String(isOpen));
      });
    }

    // Bind all 7 Granular Ambience sub-sliders & live percentage readouts
    const granularConfigs = [
      { sliderId: 'slider-wind-vol', valId: 'val-wind-vol', setter: (v) => this.sound.setWindVolume(v) },
      { sliderId: 'slider-habitat-vol', valId: 'val-habitat-vol', setter: (v) => this.sound.setHabitatVolume(v) },
      { sliderId: 'slider-traffic-vol', valId: 'val-traffic-vol', setter: (v) => this.sound.setTrafficVolume(v) },
      { sliderId: 'slider-horns-vol', valId: 'val-horns-vol', setter: (v) => this.sound.setHornsVolume(v) },
      { sliderId: 'slider-animals-vol', valId: 'val-animals-vol', setter: (v) => this.sound.setAnimalsVolume(v) },
      { sliderId: 'slider-birds-vol', valId: 'val-birds-vol', setter: (v) => this.sound.setBirdsVolume(v) },
      { sliderId: 'slider-voices-vol', valId: 'val-voices-vol', setter: (v) => this.sound.setVoicesVolume(v) }
    ];

    granularConfigs.forEach(({ sliderId, valId, setter }) => {
      const slider = document.getElementById(sliderId);
      const valEl = document.getElementById(valId);
      if (slider) {
        slider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          setter(val);
          if (valEl) {
            valEl.textContent = val <= 0.005 ? 'OFF' : `${Math.round(val * 100)}%`;
            valEl.classList.toggle('is-off', val <= 0.005);
          }
        });
      }
    });

    if (lofiSlider) {
      lofiSlider.addEventListener('input', (e) => {
        this.sound.setLoFiVolume(parseFloat(e.target.value));
      });
    }

    // Zoom stepper and compass controls
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      if (typeof this.map?.zoomIn === 'function') this.map.zoomIn({ duration: 250 });
      else if (this.canvasGlobe) this.canvasGlobe.setZoom(this.canvasGlobe.zoom + 0.5);
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      if (typeof this.map?.zoomOut === 'function') this.map.zoomOut({ duration: 250 });
      else if (this.canvasGlobe) this.canvasGlobe.setZoom(this.canvasGlobe.zoom - 0.5);
    });
    document.getElementById('btn-reset-north')?.addEventListener('click', () => {
      if (typeof this.map?.resetNorthPitch === 'function') this.map.resetNorthPitch({ duration: 400 });
      else if (this.canvasGlobe) this.canvasGlobe.setCenter([0, 15]);
    });

    const visualizerEl = document.getElementById('lofi-visualizer');
    if (visualizerEl) {
      this.sound.onVisualizer((bands) => {
        const bars = visualizerEl.querySelectorAll('.lofi-bar');
        bars.forEach((bar, i) => {
          const val = Array.isArray(bands) ? (bands[i] || 0.1) : 0.2;
          const height = Math.max(3, Math.round(val * 13));
          bar.style.height = `${height}px`;
        });
      });
    }
  }

  togglePlayback() {
    if (!this.isListening) {
      const center = this.map ? this.map.getCenter() : { lng: -60, lat: -3 };
      this.setListeningPoint(center.lng, center.lat, null, true);
    } else {
      const isMuted = this.sound.toggleMute();
      this.updatePlayButtonVisual(!isMuted);
    }
  }

  updatePlayButtonVisual(isPlaying) {
    const btn = document.getElementById('btn-listen');
    if (!btn) return;
    btn.querySelector('span').textContent = isPlaying ? 'Pause' : 'Listen';
    btn.classList.toggle('active', isPlaying);
    btn.setAttribute('aria-pressed', String(isPlaying));
    btn.setAttribute('aria-label', isPlaying ? 'Pause the soundscape' : 'Listen to the selected location');
    if (this.isListening) this.hudStatus.textContent = isPlaying ? 'LISTENING' : 'AUDIO PAUSED';
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn('Fullscreen request failed:', err);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch((err) => {
          console.warn('Exit fullscreen failed:', err);
        });
      }
    }
  }

  updateFullscreenVisual(isFs) {
    const button = document.getElementById('btn-fullscreen');
    button.setAttribute('aria-pressed', String(isFs));
    button.textContent = isFs ? 'Exit fullscreen' : 'Fullscreen';
  }

  initControls() {
    document.getElementById('btn-heaviest')?.addEventListener('click', () => this.flyToHeaviestRainArea());
    document.getElementById('btn-theme')?.addEventListener('click', () => this.cycleTheme());
    document.getElementById('btn-listen')?.addEventListener('click', () => this.togglePlayback());
    document.getElementById('btn-hide-ui')?.addEventListener('click', () => this.toggleUiVisibility());
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => this.toggleFullscreen());
    document.getElementById('btn-exit-zen')?.addEventListener('click', () => this.toggleUiVisibility());

    document.addEventListener('fullscreenchange', () => {
      this.updateFullscreenVisual(!!document.fullscreenElement);
    });

    // 3D Terrain Relief Toggle
    document.getElementById('btn-relief-toggle')?.addEventListener('click', () => {
      this.toggleTerrainRelief();
    });

    // Info Modal
    const infoModal = document.getElementById('info-modal');
    document.getElementById('btn-info')?.addEventListener('click', () => {
      infoModal?.classList.add('open');
    });
    document.getElementById('close-info-modal')?.addEventListener('click', () => {
      infoModal?.classList.remove('open');
    });
    infoModal?.addEventListener('click', (e) => {
      if (e.target === infoModal) infoModal.classList.remove('open');
    });

    // Noise Pollution Modal
    const noiseModal = document.getElementById('noise-modal');
    document.getElementById('hud-noise-badge')?.addEventListener('click', () => {
      if (this.currentNoiseData) {
        this.openNoiseModal(this.currentNoiseData);
      }
    });
    document.getElementById('close-noise-modal')?.addEventListener('click', () => {
      noiseModal?.classList.remove('open');
    });
    noiseModal?.addEventListener('click', (e) => {
      if (e.target === noiseModal) noiseModal.classList.remove('open');
    });
  }

  // ==========================================
  // NAVIGATION & EXPERIENCE SWITCHER
  // ==========================================

  initNavigation() {
    const btnSoc = document.getElementById('btn-sound-of-change');
    const btnArcade = document.getElementById('btn-arcade');
    const brand = document.getElementById('btn-brand');

    btnSoc?.addEventListener('click', () => {
      this.switchExperience('sound-of-change');
    });
    btnArcade?.addEventListener('click', () => {
      this.switchExperience('arcade');
    });
    brand?.addEventListener('click', () => this.switchExperience('rain'));
    document.getElementById('btn-token-shop').addEventListener('click', async () => {
      await this.switchExperience('arcade');
      if (this.currentView === 'arcade') this.arcade?.openShop();
    });
    const updateWallet = () => {
      document.getElementById('hud-token-count').textContent = arcadeTokens.profile.tokens + ' tokens';
    };
    updateWallet();
    window.addEventListener('terraphone_arcade_token_event', updateWallet);
    document.getElementById('btn-global-rain')?.addEventListener('click', () => this.switchExperience('rain'));

    // Hash routing
    const handleHash = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash === '#sound-of-change' || hash === '#change' || hash === '#interventions') {
        this.switchExperience('sound-of-change', false);
      } else if (hash === '#arcade' || hash.startsWith('#arcade/')) {
        this.switchExperience('arcade', false);
      } else if (hash === '#rain' || hash === '#globe') {
        this.switchExperience('rain', false);
      } else if (hash === '#about') {
        document.getElementById('info-modal')?.classList.add('open');
      }
    };

    window.addEventListener('hashchange', handleHash);
    handleHash();
  }

  async switchExperience(viewName, updateHash = true) {
    if (this.currentView === viewName && !updateHash) return;
    if (this.isZenMode) this.toggleUiVisibility();
    this.readout.open = false;
    this.hideCursorTracker();
    if (this.currentView === 'sound-of-change' && viewName !== 'sound-of-change') this.soundOfChange?.leave();
    if (this.currentView === 'arcade' && viewName !== 'arcade') this.arcade?.leave();
    this.currentView = viewName;
    document.body.dataset.experience = viewName;
    document.getElementById('map').inert = viewName !== 'rain';
    document.getElementById('explore-menu')?.removeAttribute('open');
    document.getElementById('hud-bottom-right')?.classList.remove('mobile-open');
    document.getElementById('btn-mobile-mixer')?.setAttribute('aria-expanded', 'false');
    for (const [id, view] of [['btn-global-rain', 'rain'], ['btn-sound-of-change', 'sound-of-change'], ['btn-arcade', 'arcade']]) {
      const button = document.getElementById(id);
      if (view === viewName) button?.setAttribute('aria-current', 'page');
      else button?.removeAttribute('aria-current');
    }

    const socView = document.getElementById('sound-of-change-view');
    const arcadeView = document.getElementById('arcade-view');
    socView.classList.toggle('active', viewName === 'sound-of-change');
    arcadeView.classList.toggle('active', viewName === 'arcade');

    if (updateHash) window.history.replaceState(null, '', '#' + viewName);
    if (viewName === 'rain') {
      if (this.isListening && this.listeningTarget) {
        this.sound.updateRain(this.listeningTarget.rate, this.map.getZoom(), true);
        this.sound.updateAmbience(this.currentEnv, true);
      }
      return;
    }
    if (this.isListening) {
      this.sound.updateRain(0, this.sound.currentZoom, false);
      this.sound.updateAmbience(this.currentEnv, false);
    }

    const panel = viewName === 'arcade' ? arcadeView : socView;
    try {
      if (viewName === 'arcade' && !this.arcade) {
        const { ArcadeHub } = await import('./arcade/arcade-hub.js');
        if (this.currentView === viewName) this.arcade ??= new ArcadeHub(panel, this.sound.ctx);
      } else if (viewName === 'sound-of-change') {
        const { SoundOfChangeEngine } = await import('./sound-of-change.js');
        if (this.currentView !== viewName) return;
        if (this.soundOfChange) this.soundOfChange.enter();
        else {
          const engine = new SoundOfChangeEngine(this.sound.ctx);
          engine.mount(panel, this.sound.ctx);
          this.soundOfChange = engine;
        }
      }
    } catch (error) {
      console.error('Could not open the experience', error);
      if (this.currentView !== viewName) return;
      const retry = document.createElement('button');
      retry.className = 'experience-retry';
      retry.textContent = 'Could not load this experience. Retry';
      retry.onclick = () => this.switchExperience(viewName);
      panel.replaceChildren(retry);
    }
  }

  initMobileUI() {
    const button = document.getElementById('btn-mobile-mixer');
    const panel = document.getElementById('hud-bottom-right');
    const closeButton = document.getElementById('btn-close-mixer');
    const setMixer = (open) => {
      panel.classList.toggle('mobile-open', open);
      button.setAttribute('aria-expanded', String(open));
      if (open) this.readout.open = false;
    };
    button.addEventListener('click', () => {
      const open = !panel.classList.contains('mobile-open');
      setMixer(open);
      if (open) closeButton.focus();
    });
    closeButton.addEventListener('click', () => {
      setMixer(false);
      button.focus();
    });
    if (new URLSearchParams(window.location.search).has('mixer')) setMixer(true);
    this.map.on('click', () => {
      setMixer(false);
      this.readout.open = false;
    });
  }

  updateZoomDisplay() {
    const el = document.getElementById('zoom-display');
    if (el && this.map) {
      const z = this.map.getZoom();
      el.textContent = `Zoom ${z.toFixed(1)}`;
    }
  }

  refreshRainLayer() {
    if (this.canvasGlobe) return this.loadGlobalPrecipitationBuffer();
    if (!this.map?.getSource('rain-source')) return;
    try {
      const newUrl = this.buildWmtsUrl(this.activeRainLayerId) + `&_t=${Date.now()}`;
      this.map.getSource('rain-source').setTiles([newUrl]);
      this.loadGlobalPrecipitationBuffer();
    } catch (e) {
      console.warn('Rain layer refresh error:', e);
    }
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
  });
} else {
  window.app = new App();
}
