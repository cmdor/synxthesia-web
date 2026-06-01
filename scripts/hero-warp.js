(function () {
  const hero = document.querySelector(".hero");
  const canvas = document.querySelector(".hero-canvas");
  if (!hero || !canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const isCoarse = window.matchMedia("(pointer: coarse)").matches;

  const stops = [
    { t: 0, r: 255, g: 128, b: 112 },
    { t: 0.18, r: 255, g: 154, b: 139 },
    { t: 0.4, r: 232, g: 160, b: 200 },
    { t: 0.55, r: 178, g: 162, b: 217 },
    { t: 0.75, r: 142, g: 202, b: 232 },
    { t: 1, r: 80, g: 213, b: 199 },
  ];

  const renderScale = isCoarse ? 0.26 : 0.38;
  const ANGLE_BINS = 32;

  /** @type {Map<number, { x: number, y: number, lastX: number, lastY: number }>} */
  const pointers = new Map();
  let fadeTouches = [];

  let renderW = 0;
  let renderH = 0;
  let heroRect = hero.getBoundingClientRect();
  let intensity = 0;
  let targetIntensity = 0;
  let spinAngle = 0;
  let rafId = 0;
  let dirty = false;
  let drawing = false;

  let imageData = null;
  /** @type {Uint8ClampedArray | null} */
  let gradR = null;
  /** @type {Uint8ClampedArray | null} */
  let gradG = null;
  /** @type {Uint8ClampedArray | null} */
  let gradB = null;
  /** @type {Float32Array | null} */
  let accentTable = null;

  function sampleGradient(t) {
    if (t <= stops[0].t) return stops[0];
    if (t >= stops[stops.length - 1].t) return stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (t >= a.t && t <= b.t) {
        const u = (t - a.t) / (b.t - a.t);
        return {
          r: a.r + (b.r - a.r) * u,
          g: a.g + (b.g - a.g) * u,
          b: a.b + (b.b - a.b) * u,
        };
      }
    }
    return stops[stops.length - 1];
  }

  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) {
      r = c;
      g = x;
    } else if (h < 120) {
      r = x;
      g = c;
    } else if (h < 180) {
      g = c;
      b = x;
    } else if (h < 240) {
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return {
      r: (r + m) * 255,
      g: (g + m) * 255,
      b: (b + m) * 255,
    };
  }

  function buildAccentTable(spin) {
    if (!accentTable) accentTable = new Float32Array(ANGLE_BINS * 3);
    for (let b = 0; b < ANGLE_BINS; b++) {
      const angle = (b / ANGLE_BINS) * Math.PI * 2;
      const hue =
        ((angle * 57.2958 + spin * 57.2958 + 180) % 360 + 360) % 360;
      const rgb = hslToRgb(hue, 0.95, 0.62);
      const i = b * 3;
      accentTable[i] = rgb.r;
      accentTable[i + 1] = rgb.g;
      accentTable[i + 2] = rgb.b;
    }
  }

  function buildGradientLut() {
    gradR = new Uint8ClampedArray(renderW);
    gradG = new Uint8ClampedArray(renderW);
    gradB = new Uint8ClampedArray(renderW);
    const denom = Math.max(1, renderW - 1);
    for (let x = 0; x < renderW; x++) {
      const c = sampleGradient(x / denom);
      gradR[x] = c.r;
      gradG[x] = c.g;
      gradB[x] = c.b;
    }
  }

  function lutIndex(t) {
    return Math.max(0, Math.min(renderW - 1, (t * (renderW - 1)) | 0));
  }

  function normFromClient(clientX, clientY) {
    if (heroRect.width <= 0 || heroRect.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - heroRect.left) / heroRect.width)),
      y: Math.max(0, Math.min(1, (clientY - heroRect.top) / heroRect.height)),
    };
  }

  function advanceSpin(nx, ny, lastX, lastY) {
    const dx = nx - lastX;
    const dy = ny - lastY;
    const motion = Math.hypot(dx, dy);
    if (motion < 0.0004) return;
    const orbit = dx * (ny - 0.5) - dy * (nx - 0.5);
    spinAngle += motion * 3 + orbit * 1.8;
  }

  function snapshotTouches() {
    return Array.from(pointers.values()).map((p) => ({ x: p.x, y: p.y }));
  }

  function requestDraw() {
    dirty = true;
    if (!drawing) {
      drawing = true;
      rafId = requestAnimationFrame(tick);
    }
  }

  function resize() {
    heroRect = hero.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(heroRect.width));
    const cssH = Math.max(1, Math.floor(heroRect.height));
    renderW = Math.max(1, Math.floor(cssW * renderScale));
    renderH = Math.max(1, Math.floor(cssH * renderScale));
    canvas.width = renderW;
    canvas.height = renderH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    imageData = ctx.createImageData(renderW, renderH);
    buildGradientLut();
    dirty = true;
  }

  function draw() {
    if (!imageData || !gradR) return;

    const effect = prefersReducedMotion ? 0 : intensity;
    const data = imageData.data;
    const minDim = Math.min(renderW, renderH);
    const bloomR = minDim * 0.105;
    const bloomRSq = bloomR * bloomR;
    const coreRSq = (minDim * 0.04) ** 2;
    const margin = bloomR * 1.15;
    const spin = spinAngle;
    const skipDistSq = bloomRSq * 6.25;
    const warpBlendBase = 0.35;
    const denom = Math.max(1, renderW - 1);

    buildAccentTable(spin);

    const touchSrc =
      pointers.size > 0 ? snapshotTouches() : fadeTouches;
    const touchCount = touchSrc.length;

    if (effect <= 0 || touchCount === 0) {
      for (let y = 0; y < renderH; y++) {
        let row = y * renderW * 4;
        for (let x = 0; x < renderW; x++) {
          data[row++] = gradR[x];
          data[row++] = gradG[x];
          data[row++] = gradB[x];
          data[row++] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return;
    }

    const boxes = new Array(touchCount);
    const mxArr = new Float32Array(touchCount);
    const myArr = new Float32Array(touchCount);
    for (let t = 0; t < touchCount; t++) {
      const mx = touchSrc[t].x * renderW;
      const my = touchSrc[t].y * renderH;
      mxArr[t] = mx;
      myArr[t] = my;
      boxes[t] = {
        x0: Math.max(0, (mx - margin) | 0),
        x1: Math.min(renderW - 1, (mx + margin) | 0),
        y0: Math.max(0, (my - margin) | 0),
        y1: Math.min(renderH - 1, (my + margin) | 0),
      };
    }

    const warpBlend = Math.min(1, touchCount * warpBlendBase);
    const invWarpBlend = 1 - warpBlend;

    for (let y = 0; y < renderH; y++) {
      let row = y * renderW * 4;
      for (let x = 0; x < renderW; x++) {
        let inZone = false;
        for (let t = 0; t < touchCount; t++) {
          const box = boxes[t];
          if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) {
            inZone = true;
            break;
          }
        }

        if (!inZone) {
          data[row++] = gradR[x];
          data[row++] = gradG[x];
          data[row++] = gradB[x];
          data[row++] = 255;
          continue;
        }

        let r = gradR[x];
        let g = gradG[x];
        let b = gradB[x];
        let totalWarp = 0;

        for (let t = 0; t < touchCount; t++) {
          const dx = x - mxArr[t];
          const dy = y - myArr[t];
          const distSq = dx * dx + dy * dy;
          if (distSq > skipDistSq) continue;

          const dist = Math.sqrt(distSq);
          const bloom = Math.exp(-distSq / bloomRSq) * effect;
          if (bloom < 0.002) continue;

          const core = Math.exp(-distSq / coreRSq) * effect;
          const len = dist || 1;
          const warpPush =
            bloom * 50 + Math.max(0, Math.sin(dist * 0.12 - spin)) * bloom * 10;
          totalWarp += (dx / len) * warpPush;

          const angle = Math.atan2(dy, dx);
          const bin =
            (((angle / Math.PI + 1) * 0.5 * ANGLE_BINS) | 0) % ANGLE_BINS;
          const ai = bin * 3;
          const ar = accentTable[ai];
          const ag = accentTable[ai + 1];
          const ab = accentTable[ai + 2];

          const xi = x / denom;
          const chroma = bloom * 0.07;
          const tr = gradR[lutIndex(xi - chroma)];
          const tg = gradG[lutIndex(xi)];
          const tb = gradB[lutIndex(xi + chroma)];

          let nr = tr + (ar - tr) * bloom * 0.75;
          let ng = tg + (ag - tg) * bloom * 0.75;
          let nb = tb + (ab - tb) * bloom * 0.75;

          const brighten = bloom * 0.55 + core * 0.45;
          nr += (255 - nr) * brighten;
          ng += (255 - ng) * brighten;
          nb += (255 - nb) * brighten;

          const radialRay =
            Math.pow(Math.max(0, Math.sin(dist * 0.13 - spin)), 2.2) *
            bloom *
            0.29;
          const angularRay =
            Math.pow(Math.max(0, Math.cos(angle * 2.5 - spin)), 3) *
            bloom *
            0.11;
          const lightRay = radialRay + angularRay;
          nr += (255 - nr) * lightRay;
          ng += (255 - ng) * lightRay;
          nb += (255 - nb) * lightRay;

          const mix = bloom > 1 ? 1 : bloom;
          r += (nr - r) * mix;
          g += (ng - g) * mix;
          b += (nb - b) * mix;
        }

        const srcX = x - totalWarp;
        const wi = lutIndex(srcX / denom);
        r = r * invWarpBlend + gradR[wi] * warpBlend;
        g = g * invWarpBlend + gradG[wi] * warpBlend;
        b = b * invWarpBlend + gradB[wi] * warpBlend;

        data[row++] = r > 255 ? 255 : r < 0 ? 0 : r | 0;
        data[row++] = g > 255 ? 255 : g < 0 ? 0 : g | 0;
        data[row++] = b > 255 ? 255 : b < 0 ? 0 : b | 0;
        data[row++] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  function tick() {
    const prevIntensity = intensity;
    const fadeEase = prefersReducedMotion ? 1 : 0.32;
    intensity += (targetIntensity - intensity) * fadeEase;

    const stillFading =
      Math.abs(intensity - prevIntensity) > 0.004 ||
      Math.abs(targetIntensity - intensity) > 0.004;

    if (dirty || stillFading) {
      draw();
      dirty = false;
    }

    if (intensity < 0.01 && pointers.size === 0) {
      fadeTouches = [];
    }

    if (dirty || stillFading || pointers.size > 0) {
      rafId = requestAnimationFrame(tick);
    } else {
      drawing = false;
    }
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    hero.setPointerCapture(event.pointerId);
    const norm = normFromClient(event.clientX, event.clientY);
    if (!norm) return;
    pointers.set(event.pointerId, {
      x: norm.x,
      y: norm.y,
      lastX: norm.x,
      lastY: norm.y,
    });
    targetIntensity = 1;
    requestDraw();
  }

  function onPointerMove(event) {
    const ptr = pointers.get(event.pointerId);
    if (!ptr) return;
    const norm = normFromClient(event.clientX, event.clientY);
    if (!norm) return;
    advanceSpin(norm.x, norm.y, ptr.lastX, ptr.lastY);
    ptr.lastX = norm.x;
    ptr.lastY = norm.y;
    ptr.x = norm.x;
    ptr.y = norm.y;
    requestDraw();
  }

  function onPointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    if (pointers.size === 1) fadeTouches = snapshotTouches();
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      targetIntensity = 0;
    } else {
      fadeTouches = [];
    }
    requestDraw();
  }

  hero.addEventListener("pointerdown", onPointerDown, { passive: true });
  hero.addEventListener("pointermove", onPointerMove, { passive: true });
  hero.addEventListener("pointerup", onPointerEnd, { passive: true });
  hero.addEventListener("pointercancel", onPointerEnd, { passive: true });
  hero.addEventListener("lostpointercapture", onPointerEnd, { passive: true });

  const ro = new ResizeObserver(resize);
  ro.observe(hero);
  resize();
  requestDraw();

  window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
  });
})();
