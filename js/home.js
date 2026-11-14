// =========================================================
// home.js — Home page for whichever crew member is checked in.
// Needs: data.js, session.js, scoring.js (loaded before this).
// =========================================================

(function (CHM) {

  const $ = (id) => document.getElementById(id);
  const PILL_TEXT = { ok: "OK", watch: "Watch", danger: "Act now" };

  let crew = null;          // the checked-in crew member
  let day = CHM.MISSION.currentDay;

  // ---------- Helpers ----------
  function bind(name, value) {
    document.querySelectorAll('[data-bind="' + name + '"]').forEach((el) => { el.textContent = value; });
  }
  function setPill(el, level) {
    el.className = "pill pill-" + level;
    el.textContent = PILL_TEXT[level];
  }
  function fmt(value, decimals) { return Number(value).toFixed(decimals); }

  // ---------- 1. Header & sidebar ----------
  function renderHeader() {
    const hour = new Date().getHours();
    $("greeting").textContent = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    bind("crew-role", crew.role);
    bind("mission-day", day);
    document.title = "Home · " + crew.role + " · Crew Health Monitor";
  }

  // ---------- 2. Space weather banner ----------
  function renderSpaceWeather() {
    const event = CHM.getSpaceWeather();
    const banner = $("space-weather-alert");
    const active = !!(event && event.active);
    banner.hidden = !active;
    $("btn-demo-alert").hidden = active;
    $("btn-demo-clear").hidden = !active;
    if (!active) return;

    $("space-weather-message").textContent = event.message;
    const acks = CHM.getShelterAcks();
    const missing = CHM.CREW.filter((c) => !acks.includes(c.id)).map((c) => c.short);
    $("shelter-status").textContent = missing.length
      ? "Not yet confirmed in shelter: " + missing.join(", ")
      : "All crew confirmed in shelter.";
    const iAmIn = acks.includes(crew.id);
    $("btn-shelter-ack").disabled = iAmIn;
    $("btn-shelter-ack").textContent = iAmIn ? "You're confirmed ✓" : "I'm in the shelter";
  }

  // ---------- 3. Body-system tiles + overall status ----------
  function renderSystems(score) {
    const box = $("system-tiles");
    const tpl = $("tile-template");
    box.innerHTML = "";

    score.systems.forEach((sys) => {
      const tile = tpl.content.firstElementChild.cloneNode(true);
      tile.classList.add("is-" + sys.level);
      tile.href = "vitals.html?system=" + sys.id;
      tile.dataset.system = sys.id;
      tile.querySelector(".tile-name").textContent = sys.name;
      setPill(tile.querySelector(".pill"), sys.level);
      tile.querySelector(".tile-reason").textContent = sys.reason;

      if (sys.id === "radiation") {
        const info = document.createElement("div");
        info.className = "tile-detail";
        info.textContent = fmt(sys.dose, 0) + " of " + sys.limit + " mSv · " + fmt(sys.ratePerDay, 2) + " mSv/day";
        const bar = document.createElement("div");
        bar.className = "progress" + (sys.level !== "ok" ? " is-" + sys.level : "");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuenow", Math.round(sys.pct));
        bar.setAttribute("aria-valuemin", 0);
        bar.setAttribute("aria-valuemax", 100);
        bar.innerHTML = '<span style="width:' + Math.min(100, sys.pct) + '%"></span>';
        tile.appendChild(info);
        tile.appendChild(bar);
      }
      box.appendChild(tile);
    });

    const bar = $("overall-status");
    const watch = score.systems.filter((s) => s.level === "watch").length;
    const danger = score.systems.filter((s) => s.level === "danger");
    bar.classList.remove("is-watch", "is-danger");
    if (danger.length) {
      bar.textContent = "Overall: act now. " + danger.map((s) => s.name).join(", ") + " need" + (danger.length === 1 ? "s" : "") + " attention.";
      bar.classList.add("is-danger");
    } else if (watch) {
      bar.textContent = "Overall: " + watch + " system" + (watch === 1 ? "" : "s") + " to watch. Nothing urgent.";
      bar.classList.add("is-watch");
    } else {
      bar.textContent = "Overall: all systems OK.";
    }
  }

  // ---------- 4. Suggested actions ----------
  function renderActions(score, cabin) {
    const list = $("action-list");
    const actions = CHM.suggestActions(score, cabin);
    const done = CHM.getActionsDone(crew.id, day);
    list.innerHTML = "";
    $("actions-empty").hidden = actions.length > 0;

    actions.forEach((a) => {
      const li = document.createElement("li");
      li.className = "level-" + a.level + (done.includes(a.id) ? " is-done" : "");
      li.dataset.actionId = a.id;
      const text = document.createElement("span");
      text.textContent = a.text;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost btn-sm";
      btn.dataset.action = "toggle";
      btn.textContent = done.includes(a.id) ? "Undo" : "Done";
      li.append(text, btn);
      list.appendChild(li);
    });
  }

  // ---------- 5. Tests due today ----------
  function renderTests() {
    const tests = CHM.testsDueToday(crew.id);
    const left = tests.filter((t) => !t.done);
    const list = $("due-list");
    list.innerHTML = "";
    $("tests-progress").textContent = "· " + (tests.length - left.length) + " of " + tests.length + " done";
    $("tests-empty").hidden = left.length > 0;
    $("btn-start-tests").disabled = left.length === 0;

    left.forEach((t) => {
      const li = document.createElement("li");
      li.innerHTML = "<span></span><small></small>";
      li.querySelector("span").textContent = t.name;
      li.querySelector("small").textContent = t.minutes + " min" + (t.freq === "weekly" ? " · weekly" : "");
      list.appendChild(li);
    });
  }

  // ---------- 6. Cabin strip ----------
  function renderCabin(cabin) {
    const strip = $("cabin-strip");
    strip.innerHTML = "<b>Cabin</b>";
    Object.keys(CHM.CABIN_LIMITS).forEach((k) => {
      const c = cabin[k];
      const span = document.createElement("span");
      span.className = c.level !== "ok" ? "cabin-" + c.level : "";
      span.textContent = c.label + " " + fmt(c.value, k === "humidity" ? 0 : 1) + " " + c.unit;
      strip.appendChild(span);
    });
    const pill = document.createElement("span");
    setPill(pill, cabin.overall);
    strip.appendChild(pill);
    const tag = document.createElement("span");
    tag.className = "tag-source tag-sim";
    tag.textContent = "Simulated";
    strip.appendChild(tag);
  }

  // ---------- Render everything ----------
  function render() {
    const cabin = CHM.scoreCabin(CHM.getCabin());
    const score = CHM.scoreCrewMember(crew.id, {
      spaceWeather: CHM.getSpaceWeather(),
      symptoms: CHM.store.get("symptoms", []).concat(CHM.SAMPLE_SYMPTOMS),   // saved by the Symptoms page
    });
    renderHeader();
    renderSpaceWeather();
    renderSystems(score);
    renderActions(score, cabin);
    renderTests();
    renderCabin(cabin);
  }

  // ---------- Buttons ----------
  function wireButtons() {
    // Emergency: confirm, queue an urgent message to Earth, open the urgent flow
    const dialog = $("emergency-dialog");
    $("btn-emergency").addEventListener("click", () => dialog.showModal());
    $("btn-emergency-cancel").addEventListener("click", () => dialog.close());
    $("btn-emergency-confirm").addEventListener("click", () => {
      CHM.addToQueue({ crewId: crew.id, type: "emergency", title: "EMERGENCY: " + crew.role, to: "Flight surgeon", urgent: true });
      location.href = "symptoms.html?emergency=1";
    });

    $("btn-start-tests").addEventListener("click", () => { location.href = "tests.html"; });
    $("btn-report-symptom").addEventListener("click", () => { location.href = "symptoms.html"; });

    $("btn-switch-crew").addEventListener("click", () => CHM.logout());

    // Suggested actions: tick off / undo (saved per crew member per day)
    $("action-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='toggle']");
      if (!btn) return;
      const li = btn.closest("li");
      const isDone = CHM.toggleActionDone(crew.id, day, li.dataset.actionId);
      li.classList.toggle("is-done", isDone);
      btn.textContent = isDone ? "Undo" : "Done";
    });

    // Shelter confirmation during a space weather event
    $("btn-shelter-ack").addEventListener("click", () => {
      CHM.ackShelter(crew.id);
      render();
    });

    // Demo: start / end a solar particle event for the whole crew
    $("btn-demo-alert").addEventListener("click", () => {
      CHM.clearShelterAcks();
      CHM.setSpaceWeather({
        active: true,
        type: "SEP",
        message: "Solar particle event detected. Move to the shielded area now and wait for the all-clear.",
        since: new Date().toISOString(),
      });
      render();
    });
    $("btn-demo-clear").addEventListener("click", () => {
      CHM.clearSpaceWeather();
      CHM.clearShelterAcks();
      render();
    });

    // Demo: start today again for this crew member (tests, actions, results)
    $("btn-demo-reset").addEventListener("click", () => {
      CHM.resetDay(crew.id, day);
      render();
      $("demo-reset-status").textContent = "Day " + day + " reset for " + crew.role + ".";
    });

    // Another tab or page changed shared data (e.g. tests done): refresh
    window.addEventListener("storage", render);
  }

  // ---------- Start ----------
  document.addEventListener("DOMContentLoaded", () => {
    crew = CHM.requireLogin();   // goes to login.html if nobody is checked in
    if (!crew) return;
    wireButtons();
    render();
    // Live NASA DONKI check (falls back to the saved copy offline), then redraw
    CHM.refreshSpaceWeather().then(render);
  });

})(window.CHM);