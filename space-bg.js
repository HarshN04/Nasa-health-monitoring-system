/* space-bg.js — animated galaxy background for every Crew Health page.
   Original procedural animation (no video, no libraries, works offline).
   Use: <script src="space-bg.js" defer></script> anywhere in the page.
   Respects prefers-reduced-motion (draws one still frame) and pauses when the tab is hidden. */
(function () {
  "use strict";

  var reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var canvas = document.createElement("canvas");
  canvas.className = "space-bg";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var BG = "#04060d";
  var INTRO_MS = 3800;
  var TILT = -0.38;      // galaxy rotation on screen (radians)
  var FLATTEN = 0.42;    // how edge-on the disc looks

  // Colour buckets: drawing all particles of one colour together keeps it fast.
  var PALETTE = [
    "255,244,226", // core white
    "255,214,170", // warm peach
    "246,170,200", // pink
    "196,160,255", // violet
    "140,180,255", // blue
    "110,150,255"  // deep blue
  ];

  // Soft round sprites for nebula clouds, one per tint (made once, reused every frame)
  var CLOUD_TINTS = ["255,200,160", "240,140,190", "170,130,255", "100,150,255"];
  var cloudSprites = CLOUD_TINTS.map(function (rgb) {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(" + rgb + ",1)");
    grad.addColorStop(0.4, "rgba(" + rgb + ",0.45)");
    grad.addColorStop(1, "rgba(" + rgb + ",0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return c;
  });

  var W = 0, H = 0, dpr = 1;
  var stars = [], buckets = [], clouds = [], start = 0, raf = 0, running = false;
  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function gauss() { return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2; } // ~ -1..1
  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }

  function build() {
    var area = W * H;
    var count = Math.max(2500, Math.min(9000, Math.round(area / 140)));
    buckets = PALETTE.map(function () { return []; });

    for (var i = 0; i < count; i++) {
      var p = {};
      if (Math.random() < 0.22) {
        // Bulge: dense, warm, round
        p.r = Math.abs(gauss()) * 0.13;
        p.a = rand(0, Math.PI * 2);
        p.c = Math.random() < 0.6 ? 0 : 1;
        p.alpha = rand(0.35, 0.9);
      } else {
        // Two logarithmic-ish spiral arms with scatter
        var r = Math.pow(Math.random(), 1.35) * 0.95 + 0.04;
        var arm = i % 2;
        p.r = r + gauss() * (0.05 + r * 0.07);
        p.a = arm * Math.PI + r * 3.4 * Math.PI + gauss() * (0.28 + r * 0.25);
        var pick = r + gauss() * 0.15;
        p.c = pick < 0.22 ? 1 : pick < 0.4 ? 2 : pick < 0.55 ? 3 : pick < 0.78 ? 4 : 5;
        p.alpha = rand(0.18, 0.75) * (1.05 - r * 0.5);
      }
      p.size = Math.random() < 0.06 ? rand(1.6, 2.4) : rand(0.6, 1.3);
      // Inner stars orbit faster (differential rotation)
      p.speed = 0.022 / (0.18 + p.r);
      p.z = rand(0.6, 1.5); // depth, used by the intro fly-back
      buckets[p.c].push(p);
    }

    // Nebula clouds: big soft blobs that follow the arms and give them body
    clouds = [];
    var cloudCount = W < 860 ? 70 : 130;
    for (var k = 0; k < cloudCount; k++) {
      var cr = Math.pow(Math.random(), 1.1) * 0.85 + 0.06;
      var carm = k % 2;
      var cpick = cr + gauss() * 0.18;
      clouds.push({
        r: cr + gauss() * 0.04,
        a: carm * Math.PI + cr * 3.4 * Math.PI + gauss() * 0.3,
        size: rand(0.06, 0.15) * (0.7 + cr * 0.6),
        alpha: rand(0.05, 0.13),
        c: cpick < 0.25 ? 0 : cpick < 0.45 ? 1 : cpick < 0.65 ? 2 : 3,
        speed: 0.022 / (0.18 + cr)
      });
    }

    stars = [];
    var starCount = Math.round(area / 2600);
    for (var s = 0; s < starCount; s++) {
      stars.push({ x: Math.random(), y: Math.random(), r: rand(0.3, 1.2), base: rand(0.15, 0.7), tw: rand(0.4, 1.6), ph: rand(0, 6.3), drift: rand(0.002, 0.008) });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function geometry() {
    var narrow = W < 860;
    return {
      cx: W * (narrow ? 0.62 : 0.7) + pointer.x * 14,
      cy: H * (narrow ? 0.2 : 0.3) + pointer.y * 10,
      R: Math.max(W, H) * (narrow ? 0.62 : 0.5)
    };
  }

  function draw(now) {
    var t = (now - start) / 1000;
    var intro = reduceQuery.matches ? 1 : Math.min(1, (now - start) / INTRO_MS);
    var e = easeOutCubic(intro);
    var zoom = 1 + 2.6 * (1 - e);           // start inside the galaxy, pull back
    var fade = 0.25 + 0.75 * e;

    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;

    var g = geometry();
    var cosT = Math.cos(TILT), sinT = Math.sin(TILT);

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // Background stars: slow drift + twinkle
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var x = ((s.x - t * s.drift * 0.1) % 1 + 1) % 1 * W;
      var tw = s.base * (0.65 + 0.35 * Math.sin(t * s.tw + s.ph));
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, s.y * H, s.r, s.r);
    }

    ctx.globalCompositeOperation = "lighter";

    // Soft glows: core and arm haze
    var coreR = g.R * 0.3 * zoom;
    var glow = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, coreR);
    glow.addColorStop(0, "rgba(255,226,190," + 0.42 * fade + ")");
    glow.addColorStop(0.35, "rgba(240,160,190," + 0.12 * fade + ")");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.fillRect(g.cx - coreR, g.cy - coreR, coreR * 2, coreR * 2);

    var hazeR = g.R * 1.05 * zoom;
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(TILT);
    ctx.scale(1, FLATTEN);
    var haze = ctx.createRadialGradient(0, 0, hazeR * 0.15, 0, 0, hazeR);
    haze.addColorStop(0, "rgba(120,110,220," + 0.13 * fade + ")");
    haze.addColorStop(0.6, "rgba(60,90,200," + 0.06 * fade + ")");
    haze.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(-hazeR, -hazeR, hazeR * 2, hazeR * 2);
    ctx.restore();

    // Nebula clouds along the arms
    for (var q = 0; q < clouds.length; q++) {
      var cl = clouds[q];
      var cang = cl.a + cl.speed * t;
      var crr = cl.r * g.R * zoom;
      var clx = Math.cos(cang) * crr;
      var cly = Math.sin(cang) * crr * FLATTEN;
      var cpx = g.cx + clx * cosT - cly * sinT;
      var cpy = g.cy + clx * sinT + cly * cosT;
      var cs = cl.size * g.R * zoom;
      if (cpx < -cs || cpy < -cs || cpx > W + cs || cpy > H + cs) continue;
      ctx.globalAlpha = cl.alpha * fade;
      ctx.drawImage(cloudSprites[cl.c], cpx - cs, cpy - cs * 0.7, cs * 2, cs * 1.4);
    }

    // Particles
    for (var b = 0; b < buckets.length; b++) {
      var list = buckets[b];
      ctx.fillStyle = "rgb(" + PALETTE[b] + ")";
      for (var j = 0; j < list.length; j++) {
        var p = list[j];
        var ang = p.a + p.speed * t;
        var pz = 1 + (p.z - 1) * (1 - e) * 1.6; // depth spread while flying back
        var rr = p.r * g.R * zoom * pz;
        var lx = Math.cos(ang) * rr;
        var ly = Math.sin(ang) * rr * FLATTEN;
        var px = g.cx + lx * cosT - ly * sinT;
        var py = g.cy + lx * sinT + ly * cosT;
        if (px < -4 || py < -4 || px > W + 4 || py > H + 4) continue;
        var sz = p.size * (1 + (zoom - 1) * 0.5);
        ctx.globalAlpha = p.alpha * fade;
        ctx.fillRect(px, py, sz, sz);
      }
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    draw(now);
    raf = window.requestAnimationFrame(loop);
  }

  function play() {
    if (running || reduceQuery.matches) return;
    running = true;
    raf = window.requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    window.cancelAnimationFrame(raf);
  }

  function still() {
    // One calm frame, already settled, for reduced motion
    draw(start + INTRO_MS + 20000);
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resize();
      if (reduceQuery.matches) still();
    }, 120);
  });

  window.addEventListener("pointermove", function (ev) {
    if (ev.pointerType !== "mouse") return;
    pointer.tx = ev.clientX / W - 0.5;
    pointer.ty = ev.clientY / H - 0.5;
  }, { passive: true });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else play();
  });

  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener("change", function () {
      if (reduceQuery.matches) { stop(); still(); } else { play(); }
    });
  }

  resize();
  start = performance.now();
  if (reduceQuery.matches) still(); else play();
})();
