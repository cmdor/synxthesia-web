(function () {
  const hero = document.querySelector(".hero");
  const canvas = document.querySelector(".hero-canvas");
  if (!hero || !canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const stops = [
    { t: 0, r: 255, g: 128, b: 112 },
    { t: 0.18, r: 255, g: 154, b: 139 },
    { t: 0.4, r: 232, g: 160, b: 200 },
    { t: 0.55, r: 178, g: 162, b: 217 },
    { t: 0.75, r: 142, g: 202, b: 232 },
    { t: 1, r: 80, g: 213, b: 199 },
  ];

  const renderScale = 0.55;

  let renderW = 0;
  let renderH = 0;
  let mouseX = 0.5;
  let mouseY = 0.5;
  let targetX = 0.5;
  let targetY = 0.5;
  let intensity = 0;
  let targetIntensity = 0;
  /** Radians; advances only while the pointer moves. */
  let spinAngle = 0;
  let lastNormX = null;
  let lastNormY = null;
  let rafId = 0;
  let dirty = true;

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

  function accentAt(angle, spin) {
    const hue = ((angle * 57.2958 + spin * 57.2958 + 180) % 360 + 360) % 360;
    return hslToRgb(hue, 0.95, 0.62);
  }

  function advanceSpinFromMotion(nx, ny) {
    if (lastNormX === null) {
      lastNormX = nx;
      lastNormY = ny;
      return;
    }
    const dx = nx - lastNormX;
    const dy = ny - lastNormY;
    const motion = Math.hypot(dx, dy);
    if (motion < 0.0004) return;

    const orbit =
      dx * (ny - 0.5) - dy * (nx - 0.5);
    spinAngle += motion * 3 + orbit * 1.8;

    lastNormX = nx;
    lastNormY = ny;
  }

  function clearPointerTrail() {
    lastNormX = null;
    lastNormY = null;
  }

  function setTargetFromEvent(event) {
    const rect = hero.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const ny = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    advanceSpinFromMotion(nx, ny);
    targetX = nx;
    targetY = ny;
    mouseX = nx;
    mouseY = ny;
    targetIntensity = 1;
    dirty = true;
  }

  function resize() {
    const rect = hero.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    renderW = Math.max(1, Math.floor(cssW * renderScale));
    renderH = Math.max(1, Math.floor(cssH * renderScale));
    canvas.width = renderW;
    canvas.height = renderH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    dirty = true;
  }

  function draw() {
    const mx = mouseX * renderW;
    const my = mouseY * renderH;
    const effect = prefersReducedMotion ? 0 : intensity;
    const minDim = Math.min(renderW, renderH);
    const bloomRadius = minDim * 0.21;
    const coreRadius = minDim * 0.08;
    const spin = spinAngle;

    const imageData = ctx.createImageData(renderW, renderH);
    const data = imageData.data;

    for (let y = 0; y < renderH; y++) {
      for (let x = 0; x < renderW; x++) {
        const dx = x - mx;
        const dy = y - my;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);

        const bloom =
          Math.exp(-(dist * dist) / (bloomRadius * bloomRadius)) * effect;
        const core =
          Math.exp(-(dist * dist) / (coreRadius * coreRadius)) * effect;

        const warpPush =
          bloom * 50 +
          Math.max(0, Math.sin(dist * 0.12 - spin)) * bloom * 10;
        const len = dist || 1;
        const srcX = x - (dx / len) * warpPush;
        let sampleT = srcX / renderW;
        sampleT = Math.max(0, Math.min(1, sampleT));

        const chroma = bloom * 0.07;
        const baseR = sampleGradient(sampleT - chroma);
        const baseG = sampleGradient(sampleT);
        const baseB = sampleGradient(sampleT + chroma);

        let r = baseR.r;
        let g = baseG.g;
        let b = baseB.b;

        const accent = accentAt(angle, spin);
        const colorMix = bloom * 0.75;
        r = r + (accent.r - r) * colorMix;
        g = g + (accent.g - g) * colorMix;
        b = b + (accent.b - b) * colorMix;

        const brighten = bloom * 0.55 + core * 0.45;
        r = Math.min(255, r + (255 - r) * brighten);
        g = Math.min(255, g + (255 - g) * brighten);
        b = Math.min(255, b + (255 - b) * brighten);

        const radialRay = Math.pow(
          Math.max(0, Math.sin(dist * 0.13 - spin)),
          2.2,
        );
        const angularRay = Math.pow(
          Math.max(0, Math.cos(angle * 2.5 - spin)),
          3,
        );
        const lightRay = (radialRay * 0.7 + angularRay * 0.25) * bloom * 0.42;
        r = Math.min(255, r + (255 - r) * lightRay);
        g = Math.min(255, g + (255 - g) * lightRay);
        b = Math.min(255, b + (255 - b) * lightRay);

        const i = (y * renderW + x) * 4;
        data[i] = r | 0;
        data[i + 1] = g | 0;
        data[i + 2] = b | 0;
        data[i + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  function tick() {
    const prevIntensity = intensity;
    const fadeEase = prefersReducedMotion ? 1 : 0.28;
    intensity += (targetIntensity - intensity) * fadeEase;

    const stillFading =
      Math.abs(intensity - prevIntensity) > 0.003 ||
      Math.abs(targetIntensity - intensity) > 0.003;

    if (dirty || stillFading) {
      draw();
      dirty = false;
    }

    rafId = requestAnimationFrame(tick);
  }

  hero.addEventListener("pointerdown", (e) => {
    hero.setPointerCapture(e.pointerId);
    clearPointerTrail();
    setTargetFromEvent(e);
    dirty = true;
  });
  hero.addEventListener("pointermove", setTargetFromEvent);
  hero.addEventListener("pointerup", () => {
    targetIntensity = 0;
    clearPointerTrail();
    dirty = true;
  });
  hero.addEventListener("pointercancel", () => {
    targetIntensity = 0;
    clearPointerTrail();
    dirty = true;
  });
  hero.addEventListener("pointerleave", () => {
    targetIntensity = 0;
    clearPointerTrail();
    dirty = true;
  });

  const ro = new ResizeObserver(resize);
  ro.observe(hero);
  resize();
  dirty = true;
  rafId = requestAnimationFrame(tick);

  window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
  });
})();
