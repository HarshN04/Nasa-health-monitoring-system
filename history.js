/* History & Notes — Crew Health Monitor
   SAMPLE DATA below: built from the wireframe and Part 1 numbers. Swap EVENTS / SEED_NOTES for the
   hackathon dataset (record shape: time · crew_id · metric · value · unit · source · quality). */
(function () {
  "use strict";

  var MISSION_DAY = 142;
  var NEXT_WINDOW = "14:20";
  var STORAGE_KEY = "chm-history-notes-v1";

  // type: alert | symptom | test | message | milestone   tone: act | watch | done | info | milestone
  var EVENTS = [
    { day: 142, time: "07:12", type: "alert", tone: "watch", title: "Resting heart rate high",
      detail: "74 bpm against your normal of 58–66, the third morning in a row. Suggested: re-measure after 10 minutes of rest.",
      badges: [["watch", "Watch"], ["", "Cardio"]] },
    { day: 142, time: "06:05", type: "alert", tone: "watch", title: "Short sleep",
      detail: "5 h 40 min against your normal of 6.5–7.5 h. Suggested: protect tonight's sleep window.",
      badges: [["watch", "Watch"], ["", "Sleep"]] },
    { day: 141, time: "15:30", type: "symptom", tone: "done", title: "Headache · severity 2 of 5",
      detail: "About 2 hours. Cabin CO₂ checked first: 2.8 mmHg, within limits. Eased after water and rest.",
      badges: [["done", "Resolved"]] },
    { day: 140, time: "09:00", type: "test", tone: "done", title: "Weekly tests done",
      detail: "Blood pressure 118/76 · body mass · isolation and wellbeing quiz. All inside your normal.",
      badges: [["done", "3 of 3 done"]] },
    { day: 138, time: "11:20", type: "alert", tone: "act", title: "Space weather alert · solar particle event",
      detail: "Moved to the shielded area for 3 h 10 min. Mission radiation dose now 42 of 600 mSv (7%).",
      badges: [["act", "Act now"], ["", "All clear 14:30"]] },
    { day: 137, time: "18:05", type: "message", tone: "info", title: "Reply from flight surgeon",
      detail: "Thanks for flagging the sleep. Try the earlier lights-out for a week and we'll compare.",
      badges: [["info", "From Earth"]] },
    { day: 128, time: "09:00", type: "test", tone: "done", title: "Monthly bone and muscle check",
      detail: "Body mass steady. Exercise log on target for 4 weeks.",
      badges: [["done", "Done"]] },
    { day: 120, time: "16:00", type: "message", tone: "info", title: "Private medical conference",
      detail: "20-minute call with the flight surgeon during the Earth link.",
      badges: [["info", "From Earth"]] },
    { day: 14, time: "20:00", type: "milestone", tone: "milestone", title: "Your normal is set",
      detail: "Normal ranges are now built from your pre-flight data and the first 14 days. Alerts compare you to yourself.",
      badges: [["", "Milestone"]] },
    { day: 1, time: "06:00", type: "milestone", tone: "milestone", title: "Launch · monitoring starts",
      detail: "Wearables paired and first readings logged on board.",
      badges: [["", "Milestone"]] }
  ];

  var SEED_NOTES = [
    { id: "n-142a", day: 142, time: "07:30", vis: "surgeon", title: "Heart rate feels normal to me",
      body: "No palpitations or dizziness. Coffee was earlier than usual. Will re-measure after rest." },
    { id: "n-139a", day: 139, time: "21:40", vis: "private", title: "Long day",
      body: "Family call moved again. Writing it down helps." },
    { id: "n-136a", day: 136, time: "20:15", vis: "surgeon", title: "Lower back tight after treadmill",
      body: "Better after stretching. Mentioning it in case it comes back." }
  ];

  var ICONS = {
    alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.2M12 17h.01"/>',
    symptom: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    test: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 13l2 2 4-4"/>',
    note: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    message: '<path d="M12 13v8M8 21h8"/><path d="M7.5 9.5a6.4 6.4 0 0 1 9 0M4.6 6.6a10.5 10.5 0 0 1 14.8 0"/><circle cx="12" cy="13" r="1.4"/>',
    milestone: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-25 12 12)"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
  };
  var TYPE_LABEL = { alert: "Alert", symptom: "Symptom", test: "Tests", note: "Note", message: "Message", milestone: "Milestone" };

  var state = { range: "7", type: "all", query: "", notes: loadNotes() };

  // ---------- storage (optional; page works without it) ----------
  function loadNotes() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (Array.isArray(saved)) return saved.concat(SEED_NOTES);
      }
    } catch (e) { /* storage blocked: fall back to sample notes */ }
    return SEED_NOTES.slice();
  }
  function saveNotes() {
    try {
      var mine = state.notes.filter(function (n) { return n.user; });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mine));
    } catch (e) { /* ignore */ }
  }

  // ---------- helpers ----------
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function icon(name) { return '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24">' + ICONS[name] + "</svg>"; }
  function badge(kind, text, ico) {
    return '<span class="badge' + (kind ? " badge-" + kind : "") + '">' + (ico ? icon(ico) : "") + esc(text) + "</span>";
  }
  function byNewest(a, b) { return b.day - a.day || (b.time < a.time ? -1 : b.time > a.time ? 1 : 0); }
  function inRange(day) {
    if (state.range === "all") return true;
    return day > MISSION_DAY - Number(state.range);
  }
  function noteTitle(n) {
    if (n.title) return n.title;
    var first = n.body.split("\n")[0];
    return first.length > 60 ? first.slice(0, 57).trim() + "…" : first;
  }
  function visBadge(vis) {
    return vis === "private" ? badge("", "Only me", "lock") : badge("info", "Shared with flight surgeon", "message");
  }

  // ---------- timeline ----------
  function timelineEntries() {
    var fromNotes = state.notes.map(function (n) {
      return { day: n.day, time: n.time, type: "note", tone: "info", note: n };
    });
    return EVENTS.concat(fromNotes).sort(byNewest);
  }

  function renderEntry(e) {
    var body, badges;
    if (e.type === "note") {
      var n = e.note;
      if (n.vis === "private") {
        body = "<h3>Private note</h3><p>Only you can read this. <a class=\"entry-link\" href=\"#" + esc(n.id) + "\" data-note=\"" + esc(n.id) + "\">Open in your notes</a></p>";
      } else {
        body = "<h3>" + esc(noteTitle(n)) + "</h3><p>" + esc(n.body) + "</p>";
      }
      badges = visBadge(n.vis);
    } else {
      body = "<h3>" + esc(e.title) + "</h3><p>" + esc(e.detail) + "</p>";
      badges = (e.badges || []).map(function (b) { return badge(b[0], b[1]); }).join("");
    }
    return '<li class="entry" data-tone="' + e.tone + '"><article class="entry-card">' +
      '<div class="entry-meta">' + icon(e.type) + "<span>" + TYPE_LABEL[e.type] + "</span>" +
      '<time>Day ' + e.day + " · " + esc(e.time) + "</time></div>" +
      body + '<div class="badges">' + badges + "</div></article></li>";
  }

  function renderTimeline() {
    var all = timelineEntries();
    var list = all.filter(function (e) {
      return inRange(e.day) && (state.type === "all" || e.type === state.type);
    });

    var html = "";
    var groups = [];
    list.forEach(function (e) {
      var g = groups[groups.length - 1];
      if (!g || g.day !== e.day) groups.push((g = { day: e.day, items: [] }));
      g.items.push(e);
    });
    groups.forEach(function (g) {
      var label = g.day === MISSION_DAY ? ' <span class="today">Today</span>' : g.day === MISSION_DAY - 1 ? ' <span class="today">Yesterday</span>' : "";
      html += '<section class="day-group" aria-label="Mission day ' + g.day + '"><h3 class="day-head">Day ' + g.day + label + "</h3>" +
        '<ol class="entries">' + g.items.map(renderEntry).join("") + "</ol></section>";
    });

    if (!list.length) {
      var hint = state.range !== "all" ? ' Try <button type="button" class="chip" data-jump-range="all">Mission</button> to see the whole mission.' : "";
      html = '<p class="empty">Nothing here for this filter.' + hint + "</p>";
    }

    el("timeline-list").innerHTML = html;
    el("toc-timeline-count").textContent = list.length;
    el("timeline-status").textContent = list.length + (list.length === 1 ? " entry" : " entries") + " shown";
  }

  // ---------- notes list ----------
  function renderNotes() {
    var q = state.query.trim().toLowerCase();
    var notes = state.notes.slice().sort(byNewest).filter(function (n) {
      return !q || (n.title + " " + n.body).toLowerCase().indexOf(q) !== -1;
    });
    el("notes-list").innerHTML = notes.length ? notes.map(function (n) {
      return '<li class="note" id="' + esc(n.id) + '"><div class="note-meta"><span>Day ' + n.day + " · " + esc(n.time) + "</span>" + visBadge(n.vis) + "</div>" +
        "<h3>" + esc(noteTitle(n)) + "</h3><p>" + esc(n.body) + "</p></li>";
    }).join("") : '<li class="empty">' + (q ? "No notes match “" + esc(state.query) + "”." : "No notes yet. Write your first one above.") + "</li>";
    el("toc-notes-count").textContent = state.notes.length;
  }

  // ---------- controls ----------
  function setPressed(group, attr, value) {
    group.querySelectorAll("[" + attr + "]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value));
    });
  }

  var rangeGroup = document.querySelector(".timeline-panel .segmented");
  rangeGroup.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-range]");
    if (!b) return;
    state.range = b.getAttribute("data-range");
    setPressed(rangeGroup, "data-range", state.range);
    renderTimeline();
  });

  var filterGroup = document.querySelector(".filters");
  filterGroup.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-type]");
    if (!b) return;
    state.type = b.getAttribute("data-type");
    setPressed(filterGroup, "data-type", state.type);
    renderTimeline();
  });

  el("timeline-list").addEventListener("click", function (ev) {
    var jump = ev.target.closest("[data-jump-range]");
    if (jump) {
      state.range = "all";
      setPressed(rangeGroup, "data-range", "all");
      renderTimeline();
      return;
    }
    var link = ev.target.closest("[data-note]");
    if (link) {
      state.query = "";
      el("note-search").value = "";
      renderNotes();
      var target = el(link.getAttribute("data-note"));
      if (target) {
        target.classList.add("flash");
        setTimeout(function () { target.classList.remove("flash"); }, 1800);
      }
    }
  });

  el("note-search").addEventListener("input", function (ev) {
    state.query = ev.target.value;
    renderNotes();
  });

  // ---------- composer ----------
  var form = el("note-form");
  var bodyField = el("note-body");
  var help = {
    private: "Stays on board. Only you can read it.",
    surgeon: "Joins the Comms queue and goes at the next Earth link (" + NEXT_WINDOW + "). It stays on board too."
  };

  bodyField.addEventListener("input", function () {
    el("note-count").textContent = bodyField.value.length + " / 1000";
    if (bodyField.value.trim()) {
      bodyField.removeAttribute("aria-invalid");
      el("note-error").textContent = "";
    }
  });

  form.addEventListener("change", function (ev) {
    if (ev.target.name === "vis") el("vis-help").textContent = help[ev.target.value];
  });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var body = bodyField.value.trim();
    if (!body) {
      bodyField.setAttribute("aria-invalid", "true");
      el("note-error").textContent = "Write something before saving.";
      bodyField.focus();
      return;
    }
    var vis = form.querySelector('input[name="vis"]:checked').value;
    var now = new Date();
    var time = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    var note = { id: "n-" + now.getTime(), day: MISSION_DAY, time: time, vis: vis, user: true,
      title: el("note-title").value.trim(), body: body };

    state.notes.unshift(note);
    saveNotes();
    renderNotes();
    renderTimeline();

    var li = el(note.id);
    if (li) li.classList.add("reveal");

    form.reset();
    el("note-count").textContent = "0 / 1000";
    el("vis-help").textContent = help.private;
    el("save-status").textContent = vis === "private"
      ? "Saved on board. Only you can read it."
      : "Saved. Queued for the flight surgeon at " + NEXT_WINDOW + ".";
  });

  // On narrow screens the menu scrolls sideways: bring the current page into view.
  var nav = document.querySelector(".app-nav");
  var current = nav && nav.querySelector('[aria-current="page"]');
  if (nav && current && nav.scrollWidth > nav.clientWidth) {
    nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }

  renderTimeline();
  renderNotes();
})();
