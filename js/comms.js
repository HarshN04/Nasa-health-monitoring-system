// =========================================================
// comms.js — Screen 7: Comms to Earth.
// Load order: data.js → session.js → secure.js → comms.js
//
// The link is SIMULATED on a mission clock that runs faster than real time
// (Speed in the demo box). Rules (Part 5 doc §3, §6):
//   - only send inside a contact window (02:20 and 14:20 UTC, 30 min each)
//   - 1,000 bytes/s, sent in 4 KB chunks; the link is re-checked after every chunk,
//     so an item that does not fit in a window carries on in the next one
//   - urgent items go first, then oldest first
//   - a repeated alert is merged into the waiting one (×2, ×3 …)
//   - behavioral items (mood) are held on board until the crew member presses Send
//   - "Delivered" only once Earth's receipt is back (one-way delay × 2)
//   - every item is sealed for Earth (secure.js) as soon as it is queued
// Queue is saved under CHM.store "queue", so CHM.addToQueue() from other pages
// and no-PIN emergencies from the Login screen (emergency.js) show up here.
// =========================================================

(function (CHM) {
  "use strict";

  var me = CHM.requireLogin();
  if (!me) return;

  var S = CHM.secure;
  var $ = function (id) { return document.getElementById(id); };

  var RATE = 1000;            // bytes per second
  var CHUNK = 4096;           // bytes
  var WINDOW_MIN = 30;        // minutes per window
  var WINDOW_STARTS = [2 * 60 + 20, 14 * 60 + 20]; // minutes after midnight UTC
  var DELAY_MS = CHM.MISSION.oneWayDelayMin * 60 * 1000;
  var DAY = 24 * 60 * 60 * 1000;
  var TICK_MS = 250;

  var PRESETS = {
    windows:  "Contact windows (normal)",
    open:     "Always open",
    blackout: "Blackout (no contact)"
  };

  // What each demo "Add" button queues
  var KINDS = {
    alert:   { title: "Alert: resting heart rate high", to: "Flight surgeon", bytes: 2000, urgent: true, merge: "alert:restingHR" },
    symptom: { title: "Symptom report: headache, moderate", to: "Flight surgeon", bytes: 6200 },
    mood:    { title: "Mood check-in", to: "Psychologist", bytes: 1500, behavioral: true },
    raw:     { title: "Raw sensor day " + CHM.MISSION.currentDay, to: "Mission data team", bytes: 2400000 },
    emergency: { title: "EMERGENCY · " + me.role + " needs help", to: "Flight surgeon + Mission control", bytes: 800, urgent: true }
  };

  // ----- State -----
  var clock = CHM.store.get("commsClock", null) || { sim: Date.now(), preset: "windows", speed: 60 };
  var queue = CHM.store.get("queue", []).map(normalize);

  function normalize(it) {
    var created = typeof it.created === "number" ? it.created : (Date.parse(it.created) || clock.sim);
    return {
      id: it.id || Date.now() + Math.random(),
      kind: it.kind || it.type || "other",
      title: it.title || it.text || it.type || "Message",
      to: it.to || "Flight surgeon",
      crew: it.crew === undefined ? me.id : it.crew,   // null = raised without a PIN
      reporter: it.reporter || null,
      about: it.about || null,
      bytes: it.bytes || 2000,
      sentBytes: it.sentBytes || 0,
      urgent: !!it.urgent,
      held: !!it.held,
      count: it.count || 1,
      status: it.status === "held" ? "waiting" : (it.status || "waiting"),
      created: created,
      sentAt: it.sentAt || null,
      sealed: it.sealed || null,
      merge: it.merge || null
    };
  }

  function save() {
    CHM.store.set("queue", queue);
    CHM.store.set("commsClock", clock);
  }

  function log(event) { if (S && S.supported) S.log(me.id, event); }

  // ----- Time helpers -----
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(t) { var d = new Date(t); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
  function dur(ms) {
    if (ms < 60000) return Math.max(1, Math.round(ms / 1000)) + " s";
    var m = Math.round(ms / 60000);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    return h + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
  }
  function size(b) {
    if (b < 1000) return b + " B";
    if (b < 1e6) return (b / 1000).toFixed(1) + " KB";
    return (b / 1e6).toFixed(1) + " MB";
  }

  // ----- Link model -----
  function dayStart(t) { return Math.floor(t / DAY) * DAY; }

  function windowAt(t) {
    var d = dayStart(t);
    for (var i = 0; i < WINDOW_STARTS.length; i++) {
      var s = d + WINDOW_STARTS[i] * 60000;
      if (t >= s && t < s + WINDOW_MIN * 60000) return { start: s, end: s + WINDOW_MIN * 60000 };
    }
    return null;
  }

  function isOpen(t) {
    if (clock.preset === "open") return true;
    if (clock.preset === "blackout") return false;
    return !!windowAt(t);
  }

  function nextOpen(t) {
    if (clock.preset === "open") return t;
    if (clock.preset === "blackout") return Infinity;
    if (windowAt(t)) return t;
    var d = dayStart(t);
    for (var k = 0; k < 2; k++) {
      for (var i = 0; i < WINDOW_STARTS.length; i++) {
        var s = d + k * DAY + WINDOW_STARTS[i] * 60000;
        if (s > t) return s;
      }
    }
    return Infinity;
  }

  // ----- Queue order: urgent first, then oldest -----
  function byPriority(a, b) {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return a.created - b.created;
  }

  function unsent() { return queue.filter(function (i) { return i.status === "waiting" || i.status === "sending"; }); }

  function nextToSend() {
    // An item half-way through a chunk finishes that chunk first.
    var mid = queue.filter(function (i) { return i.status === "sending" && !i.held && i.sentBytes % CHUNK !== 0; })[0];
    if (mid) return mid;
    return unsent().filter(function (i) { return !i.held; }).sort(byPriority)[0] || null;
  }

  // Runs the simulated link from clock.sim to `to`.
  function advance(to) {
    var t = clock.sim, changed = false, guard = 0;

    while (t < to && guard++ < 100000) {
      var item = nextToSend();
      if (!item) { t = to; break; }

      var midChunk = item.sentBytes % CHUNK !== 0;
      if (!midChunk && !isOpen(t)) { t = Math.min(to, nextOpen(t)); continue; }

      if (item.status !== "sending") { item.status = "sending"; changed = true; }

      var boundary = Math.min(item.bytes, (Math.floor(item.sentBytes / CHUNK) + 1) * CHUNK);
      var need = (boundary - item.sentBytes) / RATE * 1000;
      var step = Math.min(need, to - t);
      t += step;
      if (step >= need) item.sentBytes = boundary;
      else item.sentBytes = Math.min(boundary - 1, item.sentBytes + Math.floor(step * RATE / 1000));

      if (item.sentBytes >= item.bytes) {
        item.status = "transit";
        item.sentAt = t;
        changed = true;
        log("Sent to Earth: " + item.title);
      }
    }

    clock.sim = to;

    queue.forEach(function (i) {
      if (i.status === "transit" && clock.sim >= i.sentAt + 2 * DELAY_MS) {
        i.status = "delivered";
        changed = true;
        log("Earth receipt: " + i.title);
      }
    });
    return changed;
  }

  // ----- Adding items -----
  function add(kindName) {
    var k = KINDS[kindName];

    if (k.merge) {
      var same = queue.filter(function (i) { return i.merge === k.merge && i.status === "waiting"; })[0];
      if (same) {
        same.count += 1;
        same.created = Math.min(same.created, clock.sim);
        save();
        log("Merged repeat: " + same.title + " ×" + same.count);
        render(true);
        return same;
      }
    }

    var item = normalize({
      id: Date.now() + Math.random(),
      kind: kindName, title: k.title, to: k.to, bytes: k.bytes,
      urgent: !!k.urgent, held: !!k.behavioral, merge: k.merge || null,
      created: clock.sim, crew: me.id
    });
    queue.push(item);
    save();
    log("Queued: " + item.title + (item.held ? " (held on board)" : ""));
    sealItem(item);
    render(true);
    return item;
  }

  function sealItem(item) {
    if (!S || !S.canSeal()) return;
    S.seal({
      title: item.title, to: item.to, from: me.role, kind: item.kind,
      missionDay: CHM.MISSION.currentDay, queuedUtc: new Date(item.created).toISOString(),
      body: item.kind === "raw" ? "[" + size(item.bytes) + " of sensor readings]" : item.title
    }).then(function (sealed) {
      item.sealed = sealed;
      save();
      render(true);
    });
  }

  // ----- Rendering -----
  var listEl = $("queue");
  var rows = {};
  var lastSig = "";

  function displayOrder() {
    var rank = { sending: 0, waiting: 0, transit: 1, delivered: 2 };
    return queue.slice().sort(function (a, b) {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if (a.status === "delivered") return b.sentAt - a.sentAt;
      return byPriority(a, b);
    });
  }

  function stateText(i) {
    if (i.held) return ["held", "Held on board"];
    if (i.status === "sending") {
      var pct = Math.floor(i.sentBytes / i.bytes * 100) + "%";
      return isOpen(clock.sim) ? ["sending", "Sending " + pct] : ["held", "Paused " + pct + " · next window"];
    }
    if (i.status === "transit") return ["transit", "In transit"];
    if (i.status === "delivered") return ["delivered", "Delivered ✓"];
    return ["waiting", isOpen(clock.sim) ? "Next up" : "Waiting"];
  }

  function whenText(i) {
    var base = size(i.bytes) + (i.sealed ? " · sealed" : "");
    if (i.status === "transit") return "Sent " + hhmm(i.sentAt) + " UTC · receipt due " + hhmm(i.sentAt + 2 * DELAY_MS) + " · " + base;
    if (i.status === "delivered") return "Receipt back " + hhmm(i.sentAt + 2 * DELAY_MS) + " UTC · " + base;
    if (i.status === "sending") return size(i.sentBytes) + " of " + size(i.bytes) + " · " + (i.sealed ? "sealed" : "not sealed");
    return "Queued " + hhmm(i.created) + " UTC · " + base;
  }

  function buildRow(i) {
    var li = document.createElement("li");
    li.className = "q-item" + (i.urgent ? " urgent" : "") + (i.held ? " held" : "") + (i.status === "delivered" ? " delivered" : "");

    var main = document.createElement("div");
    main.className = "q-main";
    var title = document.createElement("div");
    title.className = "q-title";
    title.textContent = i.title;
    if (i.count > 1) {
      var c = document.createElement("span");
      c.className = "count";
      c.textContent = "×" + i.count;
      title.appendChild(c);
    }
    var to = document.createElement("div");
    to.className = "q-to";
    to.textContent = "To " + i.to + (i.reporter ? " · " + i.reporter :
      i.crew && i.crew !== me.id ? " · from " + (CHM.getCrew(i.crew) || {}).role : "");
    var when = document.createElement("div");
    when.className = "q-when";
    main.appendChild(title);
    main.appendChild(to);
    main.appendChild(when);

    var bar = null;
    if (i.status === "sending" || (i.status === "waiting" && i.sentBytes > 0)) {
      bar = document.createElement("div");
      bar.className = "bar";
      bar.appendChild(document.createElement("i"));
      main.appendChild(bar);
    }

    var right = document.createElement("div");
    right.className = "q-right";
    var state = document.createElement("span");
    right.appendChild(state);

    if (i.status === "waiting" || i.status === "sending") {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn small" + (i.held ? " dark" : "");
      b.dataset.act = i.held ? "send" : "hold";
      b.dataset.id = i.id;
      b.textContent = i.held ? "Send" : "Hold";
      b.setAttribute("aria-label", b.textContent + ": " + i.title);
      right.appendChild(b);
    }

    li.appendChild(main);
    li.appendChild(right);
    return { li: li, when: when, state: state, bar: bar };
  }

  function updateRow(r, i) {
    var st = stateText(i);
    r.state.className = "state " + st[0];
    r.state.textContent = st[1];
    r.when.textContent = whenText(i);
    if (r.bar) r.bar.firstChild.style.width = Math.floor(i.sentBytes / i.bytes * 100) + "%";
  }

  function render(force) {
    var order = displayOrder();
    var sig = order.map(function (i) {
      return i.id + ":" + i.status + ":" + i.held + ":" + i.count + ":" + !!i.sealed + ":" + (i.sentBytes > 0);
    }).join("|");

    if (force || sig !== lastSig) {
      lastSig = sig;
      rows = {};
      listEl.textContent = "";
      if (!order.length) {
        var e = document.createElement("li");
        e.className = "empty";
        e.textContent = "Nothing waiting. New alerts, reports and check-ins appear here.";
        listEl.appendChild(e);
      }
      order.forEach(function (i) {
        var r = buildRow(i);
        rows[i.id] = r;
        listEl.appendChild(r.li);
      });
    }
    order.forEach(function (i) { if (rows[i.id]) updateRow(rows[i.id], i); });

    renderTiles();
  }

  function renderTiles() {
    var t = clock.sim;
    $("clock").textContent = "Mission time " + hhmm(t) + " UTC";

    var tile = $("t-link"), l1 = $("link-1"), l2 = $("link-2");
    if (clock.preset === "blackout") {
      tile.className = "tile black";
      l1.textContent = "No contact";
      l2.textContent = "Blackout · everything waits on board";
    } else if (isOpen(t)) {
      tile.className = "tile open";
      l1.textContent = "Open";
      var w = windowAt(t);
      l2.textContent = clock.preset === "open" ? "Always open (demo)" : "Closes " + hhmm(w.end) + " UTC · in " + dur(w.end - t);
    } else {
      var n = nextOpen(t);
      tile.className = "tile closed";
      l1.textContent = "Closed";
      l2.textContent = "Next window " + hhmm(n) + " UTC · in " + dur(n - t);
    }

    $("delay").textContent = CHM.MISSION.oneWayDelayMin + " min one way";
    $("delay-2").textContent = "Receipt back after about " + CHM.MISSION.oneWayDelayMin * 2 + " min";

    var u = unsent();
    var held = u.filter(function (i) { return i.held; }).length;
    var bytes = u.reduce(function (s, i) { return s + (i.bytes - i.sentBytes); }, 0);
    $("waiting").textContent = u.length + (u.length === 1 ? " item" : " items");
    $("waiting-2").textContent = u.length ? size(bytes) + " left" + (held ? " · " + held + " held on board" : "") : "Queue is clear";
  }

  function renderNotices() {
    var box = $("notices");
    box.textContent = "";
    function banner(kind, html) {
      var d = document.createElement("div");
      d.className = "banner " + kind;
      d.innerHTML = html;
      box.appendChild(d);
    }
    var sw = CHM.getSpaceWeather && CHM.getSpaceWeather();
    if (sw && sw.active) {
      var d = document.createElement("div");
      d.className = "banner danger";
      d.textContent = "Space weather: " + (sw.message || sw.type || "event in progress");
      box.appendChild(d);
    }
    if (clock.preset === "blackout") banner("warn", "<strong>No contact with Earth.</strong> Items stay sealed on board and go out, urgent first, when the link is back.");
    if (!S || !S.supported) banner("danger", "This browser cannot seal items. Open the app over https:// or http://localhost.");
    else if (!S.isSetUp()) banner("info", "Items are <strong>not sealed</strong> because this tablet is not set up yet. <a href=\"setup.html\">Set up this tablet</a>.");
  }

  // ----- Events -----
  listEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-act]");
    if (!b) return;
    var item = queue.filter(function (i) { return String(i.id) === b.dataset.id; })[0];
    if (!item) return;
    item.held = b.dataset.act === "hold";
    save();
    log((item.held ? "Held on board: " : "Released to send: ") + item.title);
    render(true);
    var again = listEl.querySelector('button[data-id="' + b.dataset.id + '"]');
    if (again) again.focus();
  });

  $("emergency").addEventListener("click", function () {
    if (!confirm("Send an EMERGENCY call to the flight surgeon and mission control? It goes to the front of the queue.")) return;
    add("emergency");
    log("Emergency call queued");
    var open = isOpen(clock.sim);
    demoMsg(open ? "Emergency is first in the queue and sending now." :
      "Emergency is first in the queue. The link is closed; it goes out the moment the next window opens (" +
      (clock.preset === "blackout" ? "blackout: no window yet" : "in " + dur(nextOpen(clock.sim) - clock.sim)) + ").");
  });

  $("logout").addEventListener("click", function () {
    log("Logged out");
    CHM.logout();
  });

  // ----- Demo box -----
  var out = $("demo-out");
  function demoMsg(text) { $("demo-msg").textContent = text; }
  function showOut(text) { out.hidden = false; out.textContent = text; }

  var presetSel = $("preset");
  Object.keys(PRESETS).forEach(function (k) {
    var o = document.createElement("option");
    o.value = k;
    o.textContent = PRESETS[k];
    presetSel.appendChild(o);
  });
  presetSel.value = clock.preset;
  presetSel.addEventListener("change", function () {
    clock.preset = presetSel.value;
    save();
    log("Link set to: " + PRESETS[clock.preset] + " (demo)");
    renderNotices();
    render(true);
  });

  var speedSel = $("speed");
  speedSel.value = String(clock.speed);
  speedSel.addEventListener("change", function () { clock.speed = Number(speedSel.value); save(); });

  $("jump").addEventListener("click", function () {
    if (clock.preset === "blackout") { demoMsg("No windows during a blackout. Change Link to see one."); return; }
    if (isOpen(clock.sim)) { demoMsg("The link is already open."); return; }
    var n = nextOpen(clock.sim);
    demoMsg("Jumped " + dur(n - clock.sim) + " ahead to the " + hhmm(n) + " UTC window.");
    advance(n);
    save();
    render(true);
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-add]"), function (b) {
    b.addEventListener("click", function () {
      var item = add(b.dataset.add);
      demoMsg(item.count > 1 ? "Repeat alert merged into the waiting one (×" + item.count + ")." :
        item.held ? "Mood check-in is held on board. Press Send on it to share it." : "Queued: " + item.title + ".");
    });
  });

  $("clear-queue").addEventListener("click", function () {
    if (!confirm("Remove every item from the queue? (Demo only.)")) return;
    queue = [];
    save();
    log("Queue cleared (demo)");
    render(true);
    out.hidden = true;
    demoMsg("Queue cleared.");
  });

  $("show-stored").addEventListener("click", function () {
    var view = queue.map(function (i) {
      return {
        title: i.title, to: i.to, status: i.held ? "held" : i.status, bytes: i.bytes,
        sealed: i.sealed ? {
          alg: i.sealed.alg,
          key: i.sealed.key.slice(0, 24) + "… (" + i.sealed.key.length + " chars)",
          data: i.sealed.data.slice(0, 40) + "… (" + i.sealed.data.length + " chars)"
        } : "NOT SEALED (tablet not set up)"
      };
    });
    demoMsg("The list labels are kept in clear so this screen can show them. The content itself is only in the sealed blob.");
    showOut(JSON.stringify(view, null, 2) || "[]");
  });

  $("open-earth").addEventListener("click", function () {
    var mine = queue.filter(function (i) {
      return i.crew === me.id && i.sealed && (i.status === "transit" || i.status === "delivered");
    }).sort(function (a, b) { return b.sentAt - a.sentAt; })[0];
    if (!mine) { demoMsg("None of your sealed items has been sent yet. Open a window and let one go out first."); out.hidden = true; return; }
    S.openAsEarth(mine.sealed).then(function (obj) {
      demoMsg("Opened with Earth's private key. Only Earth can do this; the tablet's public key cannot.");
      showOut(JSON.stringify(obj, null, 2));
    }, function () {
      demoMsg("Could not open this item. The tablet was set up again after it was sealed, so the old Earth key is gone.");
      out.hidden = true;
    });
  });

  $("check-log").addEventListener("click", function () {
    if (!S || !S.supported) { demoMsg("This browser cannot check the log."); return; }
    S.checkLog().then(function (r) {
      var log = S.getLog();
      demoMsg(r.ok ? "Activity log OK: " + r.count + " entries, each one chained to the one before. Editing any entry breaks the chain."
                   : "Activity log BROKEN at entry " + (r.brokenAt + 1) + " of " + r.count + ": it was changed after it was written.");
      showOut(log.slice(-10).map(function (e) {
        return e.t.replace("T", " ").slice(0, 19) + "  " + (e.crew || "—").padEnd(3) + "  " + e.event + "\n    hash " + e.hash.slice(0, 16) + "…";
      }).join("\n") || "(empty)");
    });
  });

  // ----- Start -----
  $("me-role").textContent = me.role;
  $("me-day").textContent = CHM.MISSION.currentDay;

  // Items queued before the tablet was set up get sealed now.
  queue.forEach(function (i) { if (!i.sealed && i.status !== "delivered") sealItem(i); });

  renderNotices();
  render(true);

  var last = Date.now(), lastSave = 0;
  setInterval(function () {
    var now = Date.now();
    var changed = advance(clock.sim + (now - last) * clock.speed);
    last = now;
    if (changed || now - lastSave > 2000) { save(); lastSave = now; }
    render(false);
  }, TICK_MS);

  // Another tab (or page) changed the queue
  window.addEventListener("storage", function (ev) {
    if (ev.key === "chm:queue") { queue = CHM.store.get("queue", []).map(normalize); render(true); }
  });
})(window.CHM);
