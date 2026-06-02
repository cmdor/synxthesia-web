(function () {
  const hero = document.querySelector(".hero");
  const canvas = document.querySelector(".hero-canvas");
  if (!hero || !canvas) return;

  const ctx = canvas.getContext("2d");
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const isCoarse = window.matchMedia("(pointer: coarse)").matches;

  // Brand palette — bloom accents only (source: brand/tokens/tokens.yaml)
  const brandCream = { r: 255, g: 248, b: 240 };
  const brandColors = [
    { r: 255, g: 123, b: 95 }, // coral
    { r: 255, g: 184, b: 140 }, // peach
    { r: 255, g: 179, b: 217 }, // rose
    { r: 255, g: 105, b: 180 }, // pink
    { r: 177, g: 156, b: 217 }, // lavender
    { r: 155, g: 126, b: 222 }, // violet
    { r: 135, g: 206, b: 235 }, // sky
    { r: 141, g: 232, b: 216 }, // mint
    { r: 78, g: 205, b: 196 }, // teal
  ];

  const stops = [
    { t: 0, r: 255, g: 128, b: 112 },
    { t: 0.18, r: 255, g: 154, b: 139 },
    { t: 0.4, r: 232, g: 160, b: 200 },
    { t: 0.55, r: 178, g: 162, b: 217 },
    { t: 0.75, r: 142, g: 202, b: 232 },
    { t: 1, r: 80, g: 213, b: 199 },
  ];

  const renderScale = isCoarse ? 0.34 : 0.38;
  const renderScaleX = isCoarse ? 0.44 : renderScale;
  const renderScaleY = isCoarse ? 0.28 : renderScale;
  const ANGLE_BINS = 64;

  /** @type {Map<number, { x: number, y: number, lastX: number, lastY: number }>} */
  const pointers = new Map();
  let fadeTouches = [];

  let renderW = 0;
  let renderH = 0;
  let heroRect = hero.getBoundingClientRect();
  let intensity = 0;
  let targetIntensity = 0;
  let pressBoost = 0;
  let targetPressBoost = 0;
  let pressedCount = 0;
  let spinAngle = 0;
  let animTime = 0;
  let rafId = 0;
  let dirty = false;
  let drawing = false;

  let imageData = null;
  /** @type {HTMLCanvasElement | null} */
  let bufferCanvas = null;
  /** @type {CanvasRenderingContext2D | null} */
  let bufferCtx = null;
  let displayW = 0;
  let displayH = 0;
  /** @type {Float32Array | null} */
  let accentTable = null;

  function sampleBrandPalette(t) {
    const n = brandColors.length;
    const wrapped = ((t % 1) + 1) % 1;
    const scaled = wrapped * n;
    const i0 = scaled | 0;
    const i1 = (i0 + 1) % n;
    const u = scaled - i0;
    const a = brandColors[i0];
    const b = brandColors[i1];
    return {
      r: a.r + (b.r - a.r) * u,
      g: a.g + (b.g - a.g) * u,
      b: a.b + (b.b - a.b) * u,
    };
  }

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

  function buildAccentTable(spin) {
    if (!accentTable) accentTable = new Float32Array(ANGLE_BINS * 3);
    for (let b = 0; b < ANGLE_BINS; b++) {
      const angle = (b / ANGLE_BINS) * Math.PI * 2 + spin;
      const rgb = sampleBrandPalette(angle / (Math.PI * 2));
      const i = b * 3;
      accentTable[i] = rgb.r;
      accentTable[i + 1] = rgb.g;
      accentTable[i + 2] = rgb.b;
    }
  }

  function sampleGradAt(t) {
    const c = sampleGradient(Math.max(0, Math.min(1, t)));
    return { r: c.r, g: c.g, b: c.b };
  }

  function ensureBuffer() {
    if (!bufferCanvas) {
      bufferCanvas = document.createElement("canvas");
      bufferCtx = bufferCanvas.getContext("2d");
    }
    if (bufferCanvas.width !== renderW || bufferCanvas.height !== renderH) {
      bufferCanvas.width = renderW;
      bufferCanvas.height = renderH;
      imageData = bufferCtx.createImageData(renderW, renderH);
    }
  }

  function presentFrame() {
    if (!bufferCtx || !imageData) return;
    bufferCtx.putImageData(imageData, 0, 0);

    if (isCoarse) {
      if (canvas.width !== displayW || canvas.height !== displayH) {
        canvas.width = displayW;
        canvas.height = displayH;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bufferCanvas, 0, 0, displayW, displayH);
      return;
    }

    if (canvas.width !== renderW || canvas.height !== renderH) {
      canvas.width = renderW;
      canvas.height = renderH;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bufferCanvas, 0, 0);
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

  function ensureLoop() {
    if (!drawing) {
      drawing = true;
      rafId = requestAnimationFrame(tick);
    }
  }

  function requestDraw() {
    dirty = true;
    ensureLoop();
  }

  function paintFlatGradient() {
    if (!imageData) return;
    const data = imageData.data;
    const denom = Math.max(1, renderW - 1);
    for (let y = 0; y < renderH; y++) {
      let row = y * renderW * 4;
      for (let x = 0; x < renderW; x++) {
        const c = sampleGradAt(x / denom);
        data[row++] = c.r;
        data[row++] = c.g;
        data[row++] = c.b;
        data[row++] = 255;
      }
    }
    presentFrame();
  }

  function resize() {
    heroRect = hero.getBoundingClientRect();
    if (heroRect.width < 2 || heroRect.height < 2) {
      requestAnimationFrame(resize);
      return;
    }
    const cssW = Math.max(1, Math.floor(heroRect.width));
    const cssH = Math.max(1, Math.floor(heroRect.height));
    displayW = cssW;
    displayH = cssH;
    renderW = Math.max(1, Math.floor(cssW * renderScaleX));
    renderH = Math.max(1, Math.floor(cssH * renderScaleY));
    ensureBuffer();
    if (!isCoarse) {
      canvas.width = renderW;
      canvas.height = renderH;
    } else {
      canvas.width = displayW;
      canvas.height = displayH;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    paintFlatGradient();
    dirty = false;
  }

  function draw() {
    if (!imageData) return;

    const effect = prefersReducedMotion ? 0 : intensity;
    const data = imageData.data;
    const minDim = Math.min(renderW, renderH);
    const pulse = prefersReducedMotion ? 1 : 1 + 0.12 * Math.sin(animTime * 2.4);
    const bloomR = minDim * 0.16 * pulse;
    const bloomRSq = bloomR * bloomR;
    const coreRSq = (minDim * 0.06) ** 2;
    const spin = spinAngle + animTime * 0.55;
    const skipDistSq = bloomRSq * 4.8;
    const warpBlend = 0.15;
    const invWarpBlend = 1 - warpBlend;
    const denom = Math.max(1, renderW - 1);

    buildAccentTable(spin);

    const touchSrc =
      pointers.size > 0 ? snapshotTouches() : fadeTouches;
    const touchCount = touchSrc.length;

    if (effect <= 0 || touchCount === 0) {
      paintFlatGradient();
      return;
    }

    const mxArr = new Float32Array(touchCount);
    const myArr = new Float32Array(touchCount);
    for (let t = 0; t < touchCount; t++) {
      mxArr[t] = touchSrc[t].x * renderW;
      myArr[t] = touchSrc[t].y * renderH;
    }

    for (let y = 0; y < renderH; y++) {
      let row = y * renderW * 4;
      for (let x = 0; x < renderW; x++) {
        const xi = x / denom;
        const base = sampleGradAt(xi);
        const baseR = base.r;
        const baseG = base.g;
        const baseB = base.b;

        let nearTouch = false;
        for (let t = 0; t < touchCount; t++) {
          const dx = x - mxArr[t];
          const dy = y - myArr[t];
          if (dx * dx + dy * dy <= skipDistSq) {
            nearTouch = true;
            break;
          }
        }

        if (!nearTouch) {
          data[row++] = baseR;
          data[row++] = baseG;
          data[row++] = baseB;
          data[row++] = 255;
          continue;
        }

        let dr = 0;
        let dg = 0;
        let db = 0;
        let totalWarp = 0;
        let anyBloom = false;

        for (let t = 0; t < touchCount; t++) {
          const dx = x - mxArr[t];
          const dy = y - myArr[t];
          const distSq = dx * dx + dy * dy;
          if (distSq > skipDistSq) continue;

          const dist = Math.sqrt(distSq);
          const bloom = Math.exp(-distSq / bloomRSq) * effect;
          if (bloom < 0.002) continue;

          anyBloom = true;
          const core = Math.exp(-distSq / coreRSq) * effect;
          const centerR = bloomR * 0.22;
          const centerBlend = 1 - Math.exp(-distSq / (centerR * centerR));
          const centerEase = centerBlend * centerBlend * (3 - 2 * centerBlend);
          const len = dist || 1;
          const warpPush =
            bloom * 58 +
            Math.max(0, Math.sin(dist * 0.1 - spin)) * bloom * 8;
          const warpFade = 1 - Math.exp(-distSq / (bloomR * 0.09 * (bloomR * 0.09)));
          totalWarp += (dx / len) * warpPush * warpFade;

          const angle = Math.atan2(dy, dx);
          const binF = ((angle / Math.PI + 1) * 0.5 * ANGLE_BINS) % ANGLE_BINS;
          const bin0 = binF | 0;
          const bin1 = (bin0 + 1) % ANGLE_BINS;
          const bu = binF - bin0;
          const i0 = bin0 * 3;
          const i1 = bin1 * 3;
          const ar = accentTable[i0] * (1 - bu) + accentTable[i1] * bu;
          const ag = accentTable[i0 + 1] * (1 - bu) + accentTable[i1 + 1] * bu;
          const ab = accentTable[i0 + 2] * (1 - bu) + accentTable[i1 + 2] * bu;

          const br = brandCream.r * (1 - centerEase) + ar * centerEase;
          const bg = brandCream.g * (1 - centerEase) + ag * centerEase;
          const bb = brandCream.b * (1 - centerEase) + ab * centerEase;

          const liftR = 255 * centerEase + brandCream.r * (1 - centerEase);
          const liftG = 255 * centerEase + brandCream.g * (1 - centerEase);
          const liftB = 255 * centerEase + brandCream.b * (1 - centerEase);

          const softBloom = bloom * bloom * (3 - 2 * bloom);
          const chromaOff = Math.sin(angle + spin * 0.8) * softBloom * 0.015 * centerEase;
          const baseC = sampleGradient(Math.max(0, Math.min(1, xi + chromaOff)));
          let nr = baseC.r;
          let ng = baseC.g;
          let nb = baseC.b;

          const colorMix = softBloom * 0.62 * (0.45 + 0.55 * centerEase);
          nr += (br - nr) * colorMix;
          ng += (bg - ng) * colorMix;
          nb += (bb - nb) * colorMix;

          const glow = bloom * 0.55 + core * 0.45;
          const brighten =
            softBloom * (0.36 + pressBoost * 0.05) +
            glow * (0.26 + pressBoost * 0.04);
          nr +=
            (br - nr) * brighten * 0.28 +
            (baseC.r - nr) * brighten * 0.12 +
            (liftR - nr) * brighten * 0.42;
          ng +=
            (bg - ng) * brighten * 0.28 +
            (baseC.g - ng) * brighten * 0.12 +
            (liftG - ng) * brighten * 0.42;
          nb +=
            (bb - nb) * brighten * 0.28 +
            (baseC.b - nb) * brighten * 0.12 +
            (liftB - nb) * brighten * 0.42;

          if (pressBoost > 0) {
            const radialT = Math.min(1, dist / (bloomR * 1.1));
            const smoothT = radialT * radialT * (3 - 2 * radialT);
            const sweep = smoothT * 0.65 + 0.35 * xi;
            const pg = sampleGradient(sweep);
            const pressR = pg.r * centerEase + brandCream.r * (1 - centerEase);
            const pressG = pg.g * centerEase + brandCream.g * (1 - centerEase);
            const pressB = pg.b * centerEase + brandCream.b * (1 - centerEase);
            const pressMix =
              pressBoost * softBloom * 0.32 * (0.5 + 0.5 * centerEase) * (0.35 + 0.65 * smoothT);
            nr += (pressR - nr) * pressMix;
            ng += (pressG - ng) * pressMix;
            nb += (pressB - nb) * pressMix;
            const hotCore = pressBoost * softBloom * 0.07 * (0.45 + 0.55 * centerEase);
            nr += (pressR - nr) * hotCore * 0.45 + (brandCream.r - nr) * hotCore * 0.35;
            ng += (pressG - ng) * hotCore * 0.45 + (brandCream.g - ng) * hotCore * 0.35;
            nb += (pressB - nb) * hotCore * 0.45 + (brandCream.b - nb) * hotCore * 0.35;
          }

          const radialRay =
            Math.pow(Math.max(0, Math.sin(dist * 0.09 - spin)), 3.5) *
            softBloom *
            0.1;
          const angularRay =
            Math.pow(Math.max(0, Math.cos(angle * 2.5 - spin)), 4) *
            softBloom *
            0.03 *
            centerEase;
          const lightRay = radialRay + angularRay;
          nr += (br - nr) * lightRay * 0.35 + (liftR - nr) * lightRay * 0.65;
          ng += (bg - ng) * lightRay * 0.35 + (liftG - ng) * lightRay * 0.65;
          nb += (bb - nb) * lightRay * 0.35 + (liftB - nb) * lightRay * 0.65;

          const mix = softBloom > 1 ? 1 : softBloom;
          dr += (nr - baseR) * mix;
          dg += (ng - baseG) * mix;
          db += (nb - baseB) * mix;
        }

        if (!anyBloom) {
          data[row++] = baseR;
          data[row++] = baseG;
          data[row++] = baseB;
          data[row++] = 255;
          continue;
        }

        let r = baseR + dr;
        let g = baseG + dg;
        let b = baseB + db;

        const srcX = x - totalWarp;
        const warp = sampleGradAt(srcX / denom);
        r = r * invWarpBlend + warp.r * warpBlend;
        g = g * invWarpBlend + warp.g * warpBlend;
        b = b * invWarpBlend + warp.b * warpBlend;

        data[row++] = r > 255 ? 255 : r < 0 ? 0 : r | 0;
        data[row++] = g > 255 ? 255 : g < 0 ? 0 : g | 0;
        data[row++] = b > 255 ? 255 : b < 0 ? 0 : b | 0;
        data[row++] = 255;
      }
    }

    presentFrame();
  }

  function tick(time) {
    animTime = time * 0.001;

    const prevIntensity = intensity;
    const prevPressBoost = pressBoost;
    const fadeEase = prefersReducedMotion ? 1 : 0.42;
    intensity += (targetIntensity - intensity) * fadeEase;
    pressBoost += (targetPressBoost - pressBoost) * fadeEase;

    const bloomActive =
      intensity > 0.01 || pointers.size > 0 || targetIntensity > 0;

    const stillFading =
      Math.abs(intensity - prevIntensity) > 0.004 ||
      Math.abs(targetIntensity - intensity) > 0.004 ||
      Math.abs(pressBoost - prevPressBoost) > 0.004 ||
      Math.abs(targetPressBoost - pressBoost) > 0.004;

    if (dirty || stillFading || (bloomActive && !prefersReducedMotion)) {
      draw();
      dirty = false;
    }

    if (intensity < 0.01 && pointers.size === 0) {
      fadeTouches = [];
    }

    if (dirty || stillFading || bloomActive) {
      rafId = requestAnimationFrame(tick);
    } else {
      drawing = false;
    }
  }

  function trackPointer(event, norm) {
    let ptr = pointers.get(event.pointerId);
    if (!ptr) {
      pointers.set(event.pointerId, {
        x: norm.x,
        y: norm.y,
        lastX: norm.x,
        lastY: norm.y,
      });
    } else {
      advanceSpin(norm.x, norm.y, ptr.lastX, ptr.lastY);
      ptr.lastX = norm.x;
      ptr.lastY = norm.y;
      ptr.x = norm.x;
      ptr.y = norm.y;
    }
    targetIntensity = 1;
    requestDraw();
  }

  function onPointerEnter(event) {
    if (event.pointerType !== "mouse") return;
    const norm = normFromClient(event.clientX, event.clientY);
    if (!norm) return;
    trackPointer(event, norm);
  }

  function onPointerMove(event) {
    const norm = normFromClient(event.clientX, event.clientY);
    if (!norm) return;

    if (event.pointerType === "mouse") {
      trackPointer(event, norm);
      return;
    }

    const ptr = pointers.get(event.pointerId);
    if (!ptr) return;
    advanceSpin(norm.x, norm.y, ptr.lastX, ptr.lastY);
    ptr.lastX = norm.x;
    ptr.lastY = norm.y;
    ptr.x = norm.x;
    ptr.y = norm.y;
    requestDraw();
  }

  function onPointerLeave(event) {
    if (event.pointerType !== "mouse") return;
    if (!pointers.has(event.pointerId)) return;
    if (pointers.size === 1) fadeTouches = snapshotTouches();
    pointers.delete(event.pointerId);
    if (pointers.size === 0) targetIntensity = 0;
    requestDraw();
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pressedCount++;
    targetPressBoost = 1;

    if (event.pointerType === "mouse") {
      requestDraw();
      return;
    }

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

  function onPointerEnd(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pressedCount = Math.max(0, pressedCount - 1);
    targetPressBoost = pressedCount > 0 ? 1 : 0;

    if (event.pointerType === "mouse") {
      requestDraw();
      return;
    }

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

  hero.addEventListener("pointerenter", onPointerEnter, { passive: true });
  hero.addEventListener("pointerleave", onPointerLeave, { passive: true });
  hero.addEventListener("pointerdown", onPointerDown, { passive: true });
  hero.addEventListener("pointermove", onPointerMove, { passive: true });
  hero.addEventListener("pointerup", onPointerEnd, { passive: true });
  hero.addEventListener("pointercancel", onPointerEnd, { passive: true });
  hero.addEventListener("lostpointercapture", onPointerEnd, { passive: true });

  const ro = new ResizeObserver(resize);
  ro.observe(hero);
  resize();
  window.addEventListener("load", resize, { once: true });
  requestDraw();

  window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
  });
})();
