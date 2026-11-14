// =========================================================
// tests.js · Tests page (Part 3: behavioral health & daily tests)
//
// Uses the shared team files:
//   CHM.TESTS, CHM.MISSION, CHM.getReadings   (js/data.js)
//   CHM.getCurrentCrewId, CHM.store, CHM.markTestDone, CHM.addToQueue (js/session.js)
//   CHM.baseline, CHM.testsDueToday, CHM.RULES, CHM.ACTIONS     (js/scoring.js)
//   CHM.CREW_STATE   (data/crew-state-data.js, made from the NASA dataset)
//
// Ethics rule for this page: never diagnose, never suggest medication.
// Results only say "within your normal" or "outside your normal" and point
// to rest, a repeat test, or the flight surgeon.
// =========================================================

(function (CHM) {

  // ---------- Check the other files loaded (shows a message instead of a blank page) ----------
  const needed = [
    ["js/data.js",              CHM && CHM.TESTS],
    ["js/session.js",           CHM && CHM.getCurrentCrewId],
    ["js/scoring.js",           CHM && CHM.baseline],
    ["data/crew-state-data.js", CHM && CHM.CREW_STATE],
  ];
  const missing = needed.filter((n) => !n[1]).map((n) => n[0]);
  if (missing.length) {
    const box = document.createElement("div");
    box.className = "panel load-error";
    box.setAttribute("role", "alert");
    box.innerHTML = "<h2>Some files did not load</h2><p>Check these files are in the project folder, next to tests.html:</p>";
    const ul = document.createElement("ul");
    missing.forEach((m) => { const li = document.createElement("li"); li.textContent = m; ul.appendChild(li); });
    box.appendChild(ul);
    document.getElementById("main").prepend(box);
    if (!CHM || !CHM.TESTS || !CHM.getCurrentCrewId || !CHM.baseline) return; // can't run without the team files
  }

  // ---------- Who is checked in ----------
  // Uses ?crew=PLT in the address or the saved check-in, otherwise goes to login.html.
  const crew = CHM.requireLogin();
  if (!crew) return;

  const day = CHM.MISSION.currentDay;
  const readings = CHM.getReadings(crew.id);

  document.getElementById("crew-role").textContent = crew.role;
  document.getElementById("mission-day").textContent = day;
  document.getElementById("strip-day").textContent = day;
  document.getElementById("strip-crew").textContent = crew.role;

  // ---------- Extra details for each test in CHM.TESTS ----------
  const TEST_INFO = {
    mood:      { meta: "5 sliders · Behavioral", run: runMoodCheckin },
    sleeplog:  { meta: "How rested you feel",    run: runSleepLog },
    reaction:  { meta: "Fatigue and focus",      run: runReactionTest },
    bp:        { meta: "Cardiovascular",         run: runBloodPressure },
    mass:      { meta: "Bone and muscle",        run: runBodyMass },
    wellbeing: { meta: "Behavioral",             run: runWellbeingQuiz },
  };

  // Reaction-time test settings (based on NASA's 3-minute PVT-B)
  const RT = {
    fullSeconds: 180,
    practiceSeconds: 30,
    minGapMs: 1000,     // wait between targets: 1–4 s
    maxGapMs: 4000,
    lapseMs: 355,       // PVT-B lapse threshold
    falseStartMs: 100,  // faster than this = guessed, not reacted
  };

  // =========================================================
  // 1. NASA focus & stress signals
  // =========================================================
  let signalsWatch = false;

  function renderSignals() {
    const cs = CHM.CREW_STATE;
    const statusEl = document.getElementById("signals-status");
    const reasonEl = document.getElementById("signals-reason");

    if (!cs) {
      statusEl.hidden = true;
      reasonEl.textContent = "NASA crew-state data not found. Check data/crew-state-data.js is loaded.";
      return;
    }

    const normal = cs.session.normal;
    const sds = CHM.RULES.normalSd; // same rule as the rest of the app: mean ± 2 SD
    const windows = cs.session.windows.map((w) => ({ t: w[0], breath: w[1], stress: w[2], event: w[3] }));

    function isOutside(w) {
      return Math.abs(w.stress - normal.stress.mean) > sds * normal.stress.sd ||
             Math.abs(w.breath - normal.breath.mean) > sds * normal.breath.sd;
    }

    // Look at the last 10 minutes (20 half-minutes) of the session
    const recent = windows.slice(-20);
    const outsideCount = recent.filter(isOutside).length;
    signalsWatch = outsideCount >= 3;

    if (signalsWatch) {
      statusEl.className = "badge badge-watch";
      statusEl.textContent = "Watch";
      reasonEl.textContent = "Breathing or stress responses were outside your normal in " + outsideCount +
        " of the last 20 half-minutes of your last session. A reaction-time test is suggested today.";
    } else {
      statusEl.className = "badge badge-done";
      statusEl.textContent = "OK";
      reasonEl.textContent = "Breathing and stress responses stayed within your normal in the last 10 minutes of your last session.";
    }

    drawSignalsChart(windows, normal, sds, isOutside);

    // "How this is worked out"
    document.getElementById("signals-method").textContent =
      "Your normal comes from the first " + cs.method.baselineMinutes + " minutes of the session, before any event. " +
      "Every " + cs.method.windowSeconds + " seconds we count stress responses (quick rises in skin conductance) " +
      "and breaths. A half-minute is outside your normal when either is more than " + sds +
      " standard deviations from your usual value. Your normal: " +
      normal.stress.mean + " ± " + normal.stress.sd + " stress responses/min, " +
      normal.breath.mean + " ± " + normal.breath.sd + " breaths/min.";

    const tbody = document.getElementById("signals-table");
    tbody.innerHTML = "";
    cs.session.byState.forEach((s) => {
      const tr = document.createElement("tr");
      [s.name, s.stress, s.breath, s.windows].forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    const src = document.getElementById("signals-source");
    src.textContent = "Source: " + cs.source.title + " (" + cs.source.publisher + "), " +
      cs.source.subject + ", " + cs.session.name + ", " + cs.session.minutes + " min. " + cs.source.note + " ";
    const link = document.createElement("a");
    link.href = cs.source.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open dataset";
    src.appendChild(link);
  }

  // Small SVG line chart: stress responses per minute over the session
  function drawSignalsChart(windows, normal, sds, isOutside) {
    const W = 360, H = 160, padL = 22, padR = 6, padT = 8, padB = 20;
    const step = CHM.CREW_STATE.method.windowSeconds;
    const tMax = windows[windows.length - 1].t + step;
    const yMax = Math.max(...windows.map((w) => w.stress), normal.stress.mean + sds * normal.stress.sd) + 2;

    const x = (t) => padL + (t / tMax) * (W - padL - padR);
    const y = (v) => H - padB - (v / yMax) * (H - padT - padB);

    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img">';

    // shaded "your normal" band
    const bandLow = Math.max(0, normal.stress.mean - sds * normal.stress.sd);
    const bandHigh = normal.stress.mean + sds * normal.stress.sd;
    svg += '<rect class="band" x="' + padL + '" y="' + y(bandHigh) + '" width="' + (W - padL - padR) +
           '" height="' + (y(bandLow) - y(bandHigh)) + '"></rect>';

    // attention events
    windows.filter((w) => w.event !== 0).forEach((w) => {
      svg += '<rect class="event" x="' + x(w.t) + '" y="' + padT + '" width="' + (x(w.t + step) - x(w.t)) +
             '" height="' + (H - padT - padB) + '"></rect>';
    });

    // the line
    const points = windows.map((w) => x(w.t + step / 2).toFixed(1) + "," + y(w.stress).toFixed(1)).join(" ");
    svg += '<polyline class="line" points="' + points + '"></polyline>';

    // dots where the person was outside their normal
    windows.filter(isOutside).forEach((w) => {
      svg += '<circle class="out" r="3" cx="' + x(w.t + step / 2).toFixed(1) + '" cy="' + y(w.stress).toFixed(1) + '"></circle>';
    });

    // axis labels
    svg += '<text class="axis" x="' + padL + '" y="' + (H - 4) + '">0 min</text>';
    svg += '<text class="axis" x="' + (W - padR) + '" y="' + (H - 4) + '" text-anchor="end">' + Math.round(tMax / 60) + " min</text>";
    svg += '<text class="axis" x="2" y="' + (padT + 10) + '">' + Math.round(yMax) + "</text>";
    svg += '<text class="axis" x="2" y="' + (H - padB) + '">0</text>';
    svg += "</svg>";

    document.getElementById("signals-chart").innerHTML = svg;
  }

  // =========================================================
  // 2. Test lists and progress
  // =========================================================
  function renderTests() {
    const due = CHM.testsDueToday(crew.id);
    const dueIds = due.map((t) => t.id);
    const doneIds = CHM.getTestsDone(crew.id, day);
    const daysToWeekly = (7 + CHM.WEEKLY_TEST_DAY - (day % 7)) % 7 || 7;

    const daily = document.getElementById("daily-list");
    const weekly = document.getElementById("weekly-list");
    daily.innerHTML = "";
    weekly.innerHTML = "";

    CHM.TESTS.forEach((test) => {
      const info = TEST_INFO[test.id] || { meta: "" };
      const isDue = dueIds.includes(test.id);
      const isDone = doneIds.includes(test.id);

      const li = document.createElement("li");
      li.className = "test-card" + (isDone ? " is-done" : "");

      const text = document.createElement("div");
      const name = document.createElement("h3");
      name.className = "test-name";
      name.textContent = test.name;
      const meta = document.createElement("p");
      meta.className = "test-meta";
      meta.textContent = info.meta + " · " + test.minutes + " min";
      text.appendChild(name);
      text.appendChild(meta);

      // Suggested by the NASA signals card
      if (test.id === "reaction" && signalsWatch && !isDone) {
        li.classList.add("is-suggested");
        const pill = document.createElement("span");
        pill.className = "badge badge-watch";
        pill.textContent = "Suggested";
        name.appendChild(pill);
      }

      let action;
      if (isDone) {
        action = document.createElement("span");
        action.className = "test-state test-action is-done";
        action.textContent = "Done ✓";
      } else if (!isDue) {
        action = document.createElement("span");
        action.className = "test-state test-action";
        action.textContent = "Due day " + (day + daysToWeekly);
      } else {
        action = document.createElement("button");
        action.type = "button";
        action.className = "btn btn-primary test-action";
        action.textContent = "Start";
        action.addEventListener("click", () => info.run(test));
      }

      li.appendChild(text);
      li.appendChild(action);
      (test.freq === "weekly" ? weekly : daily).appendChild(li);
    });

    // progress = tests due today that are done
    const doneCount = due.filter((t) => doneIds.includes(t.id)).length;
    const pct = due.length ? Math.round((doneCount / due.length) * 100) : 0;
    document.getElementById("progress-label").textContent = doneCount + " of " + due.length;
    document.getElementById("progress-fill").style.width = pct + "%";
    const bar = document.getElementById("progress-bar");
    bar.setAttribute("aria-valuemax", due.length);
    bar.setAttribute("aria-valuenow", doneCount);
  }

  function finishTest(testId) {
    CHM.markTestDone(crew.id, day, testId);
    renderTests();
  }

  // Save a result in this crew member's own history (stays on board)
  function saveResult(kind, result) {
    const key = kind + ":" + crew.id;
    const list = CHM.store.get(key, []);
    list.push(Object.assign({ day: day, time: new Date().toISOString() }, result));
    CHM.store.set(key, list);
  }

  // =========================================================
  // 3. Pop-up dialog helpers
  // =========================================================
  const dialog = document.getElementById("test-dialog");
  const dialogTitle = document.getElementById("dialog-title");
  const dialogBody = document.getElementById("dialog-body");
  let onDialogClose = null;

  function openDialog(title, html) {
    dialogTitle.textContent = title;
    dialogBody.innerHTML = html;
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  // Runs when the dialog closes for any reason (button, Esc key)
  dialog.addEventListener("close", () => {
    if (onDialogClose) onDialogClose();
    onDialogClose = null;
  });

  function actionsHtml(saveLabel) {
    return '<div class="dialog-actions">' +
      '<button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + saveLabel + "</button></div>";
  }

  function wireForm(onSubmit) {
    const form = dialogBody.querySelector("form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      onSubmit(new FormData(form));
    });
    dialogBody.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeDialog));
  }

  function showMessage(title, levelClass, levelText, message, note) {
    openDialog(title,
      '<p><span class="badge ' + levelClass + '">' + levelText + "</span></p>" +
      '<p id="msg-text"></p>' +
      (note ? '<p class="muted" id="msg-note"></p>' : "") +
      '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-close>Close</button></div>');
    document.getElementById("msg-text").textContent = message;
    if (note) document.getElementById("msg-note").textContent = note;
    dialogBody.querySelector("[data-close]").addEventListener("click", closeDialog);
  }

  // =========================================================
  // 4. The tests
  // =========================================================

  // ----- Mood and stress check-in: 5 sliders, private by default -----
  function runMoodCheckin(test) {
    const sliders = [
      { name: "mood",     label: "Mood",     low: "Very low",  high: "Very good" },
      { name: "stress",   label: "Stress",   low: "Calm",      high: "Very stressed" },
      { name: "workload", label: "Workload", low: "Light",     high: "Too much" },
      { name: "energy",   label: "Energy",   low: "Exhausted", high: "Full of energy" },
      { name: "team",     label: "Team",     low: "Tense",     high: "Working well" },
    ];
    let html = '<form><p class="muted">How are you right now? 1 = low, 5 = high.</p>';
    sliders.forEach((s) => {
      html += '<div class="slider-row">' +
        '<label class="field-label" for="sl-' + s.name + '">' + s.label + ' <output id="out-' + s.name + '">3</output></label>' +
        '<input type="range" id="sl-' + s.name + '" name="' + s.name + '" min="1" max="5" step="1" value="3">' +
        '<div class="slider-ends"><span>' + s.low + "</span><span>" + s.high + "</span></div></div>";
    });
    html += '<label class="check-row"><input type="checkbox" name="share"> Also share with psych support</label>' +
      '<p class="muted">Private by default: your answers stay on board unless you tick the box.</p>' +
      actionsHtml("Save check-in") + "</form>";
    openDialog(test.name, html);

    sliders.forEach((s) => {
      const input = document.getElementById("sl-" + s.name);
      input.addEventListener("input", () => {
        document.getElementById("out-" + s.name).textContent = input.value;
      });
    });

    wireForm((data) => {
      const values = {};
      sliders.forEach((s) => { values[s.name] = Number(data.get(s.name)); });
      const shared = data.get("share") === "on";
      saveResult("checkins", { values: values, shared: shared });
      if (shared) {
        CHM.addToQueue({ title: "Mood check-ins", to: "Psych support", text: "Check-in, day " + day });
      }
      finishTest(test.id);

      const b = CHM.baseline(readings, "mood");
      if (values.mood < b.low) {
        showMessage(test.name, "badge-watch", "Below your normal",
          "Your mood is lower than your usual. " + CHM.ACTIONS.mood + ".",
          "Nothing is sent unless you choose to share it.");
      } else {
        showMessage(test.name, "badge-done", "Saved",
          "Thanks. Your check-in is saved.", shared ? "A copy is waiting in Comms for psych support." : "Kept private on board.");
      }
    });
  }

  // ----- Sleep log -----
  function runSleepLog(test) {
    openDialog(test.name,
      "<form>" +
      '<div class="slider-row"><label class="field-label" for="sleep-hours">Hours slept</label>' +
      '<input type="number" id="sleep-hours" name="hours" min="0" max="14" step="0.25" value="7" required></div>' +
      '<div class="slider-row"><label class="field-label" for="sl-rested">How rested do you feel? <output id="out-rested">3</output></label>' +
      '<input type="range" id="sl-rested" name="rested" min="1" max="5" step="1" value="3">' +
      '<div class="slider-ends"><span>Not at all</span><span>Fully rested</span></div></div>' +
      actionsHtml("Save sleep log") + "</form>");

    const rested = document.getElementById("sl-rested");
    rested.addEventListener("input", () => { document.getElementById("out-rested").textContent = rested.value; });

    wireForm((data) => {
      const hours = Number(data.get("hours"));
      saveResult("sleep", { hours: hours, rested: Number(data.get("rested")) });
      finishTest(test.id);
      const b = CHM.baseline(readings, "sleepHours");
      if (hours < b.low) {
        showMessage(test.name, "badge-watch", "Below your normal",
          "You slept " + hours + " h, less than your usual " + b.mean.toFixed(1) + " h. " + CHM.ACTIONS.sleepHours + ".");
      } else {
        showMessage(test.name, "badge-done", "Saved", "Sleep log saved. " + hours + " h is within your normal.");
      }
    });
  }

  // ----- Blood pressure (weekly) -----
  function runBloodPressure(test) {
    openDialog(test.name,
      '<form><p class="muted">Sit still for 5 minutes, then measure with the cuff and enter the numbers.</p>' +
      '<div class="field-grid">' +
      '<div><label class="field-label" for="bp-sys">Systolic (top)</label><input type="number" id="bp-sys" name="sys" min="60" max="250" required></div>' +
      '<div><label class="field-label" for="bp-dia">Diastolic (bottom)</label><input type="number" id="bp-dia" name="dia" min="30" max="150" required></div>' +
      "</div>" + actionsHtml("Save") + "</form>");
    wireForm((data) => {
      saveResult("bp", { systolic: Number(data.get("sys")), diastolic: Number(data.get("dia")) });
      finishTest(test.id);
      showMessage(test.name, "badge-done", "Saved", "Blood pressure saved. The Vitals page compares it with your normal.");
    });
  }

  // ----- Body mass (weekly) -----
  function runBodyMass(test) {
    openDialog(test.name,
      '<form><label class="field-label" for="mass-kg">Body mass (kg)</label>' +
      '<input type="number" id="mass-kg" name="kg" min="30" max="200" step="0.1" required>' +
      actionsHtml("Save") + "</form>");
    wireForm((data) => {
      saveResult("mass", { kg: Number(data.get("kg")) });
      finishTest(test.id);
      showMessage(test.name, "badge-done", "Saved", "Body mass saved. The Vitals page compares it with your normal.");
    });
  }

  // ----- Isolation and wellbeing quiz (weekly): not built yet -----
  function runWellbeingQuiz(test) {
    showMessage(test.name, "badge-info", "Coming next",
      "This quiz is still being written. It will be private by default, like the mood check-in.");
  }

  // ----- Reaction-time test (PVT-B style) -----
  function runReactionTest(test) {
    const b = CHM.baseline(readings, "reactionMs");
    openDialog(test.name,
      "<p>A blue box will light up at random moments. Tap it, or press the space bar, as fast as you can. " +
      "Don't tap before it lights up.</p>" +
      '<p class="muted">Your normal: about ' + Math.round(b.mean) + " ms. " +
      "The result goes to your flight surgeon (fitness for duty).</p>" +
      '<div class="dialog-actions">' +
      '<button type="button" class="btn btn-ghost" id="rt-practice">Practice (30 s)</button>' +
      '<button type="button" class="btn btn-primary" id="rt-full">Start test (3 min)</button></div>');
    document.getElementById("rt-practice").addEventListener("click", () => startReaction(test, RT.practiceSeconds, true));
    document.getElementById("rt-full").addEventListener("click", () => startReaction(test, RT.fullSeconds, false));
  }

  function startReaction(test, seconds, practice) {
    openDialog(test.name + (practice ? " · practice" : ""),
      '<div class="rt-area" id="rt-area" role="button" tabindex="0">Wait for blue…</div>' +
      '<p class="rt-timer" id="rt-timer"></p>' +
      '<div class="dialog-actions"><button type="button" class="btn btn-ghost" data-close>Stop</button></div>');
    dialogBody.querySelector("[data-close]").addEventListener("click", closeDialog);

    const area = document.getElementById("rt-area");
    const timerEl = document.getElementById("rt-timer");
    area.focus();

    const times = [];          // reaction times in ms
    let falseStarts = 0;
    let onsetAt = null;        // when the current target appeared
    let gapTimer = null;
    let frame = null;
    let finished = false;
    const endAt = performance.now() + seconds * 1000;

    function scheduleNext() {
      onsetAt = null;
      area.className = "rt-area";
      area.textContent = "Wait for blue…";
      if (performance.now() >= endAt) return finish();
      const gap = RT.minGapMs + Math.random() * (RT.maxGapMs - RT.minGapMs);
      gapTimer = setTimeout(showTarget, gap);
    }

    function showTarget() {
      area.className = "rt-area is-go";
      area.textContent = "0";
      onsetAt = performance.now();
      tick();
    }

    // running millisecond counter on the target, plus the countdown
    function tick() {
      const now = performance.now();
      if (onsetAt !== null) area.textContent = Math.round(now - onsetAt);
      timerEl.textContent = Math.max(0, Math.ceil((endAt - now) / 1000)) + " s left";
      frame = requestAnimationFrame(tick);
    }

    function respond(e) {
      if (e.type === "keydown" && e.code !== "Space") return;
      e.preventDefault();
      if (finished) return;
      if (onsetAt === null) {
        // tapped before the target: false start
        falseStarts++;
        clearTimeout(gapTimer);
        area.className = "rt-area is-early";
        area.textContent = "Too early";
        gapTimer = setTimeout(scheduleNext, 800);
        return;
      }
      const rt = performance.now() - onsetAt;
      onsetAt = null;
      if (rt < RT.falseStartMs) falseStarts++;
      else times.push(rt);
      area.className = "rt-area";
      area.textContent = Math.round(rt) + " ms";
      gapTimer = setTimeout(scheduleNext, 600);
    }

    function cleanup() {
      finished = true;
      clearTimeout(gapTimer);
      cancelAnimationFrame(frame);
      area.removeEventListener("pointerdown", respond);
      document.removeEventListener("keydown", respond);
    }

    function finish() {
      cleanup();
      onDialogClose = null;
      showReactionResult(test, times, falseStarts, practice);
    }

    area.addEventListener("pointerdown", respond);
    document.addEventListener("keydown", respond);
    onDialogClose = cleanup; // closing early (Stop / Esc) cancels the test, nothing saved
    tick();
    scheduleNext();
  }

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function showReactionResult(test, times, falseStarts, practice) {
    if (times.length < 3) {
      showMessage(test.name, "badge-info", "Not enough taps",
        "Fewer than 3 reactions were recorded, so there is no result. Please try again.");
      return;
    }
    const med = Math.round(median(times));
    const lapses = times.filter((t) => t >= RT.lapseMs).length;
    const b = CHM.baseline(readings, "reactionMs");
    const outside = med > b.high;

    let html =
      '<div class="result-grid">' +
      '<div class="result-box"><div class="result-value">' + med + ' ms</div><span class="result-label">Typical reaction</span></div>' +
      '<div class="result-box"><div class="result-value">' + lapses + '</div><span class="result-label">Slow reactions (≥ ' + RT.lapseMs + " ms)</span></div>" +
      '<div class="result-box"><div class="result-value">' + falseStarts + '</div><span class="result-label">Too early</span></div></div>' +
      '<p><span class="badge ' + (outside ? "badge-watch" : "badge-done") + '">' +
      (outside ? "Slower than your normal" : "Within your normal") + "</span></p>" +
      '<p id="rt-message"></p>' +
      '<p class="muted">Your normal: ' + Math.round(b.mean) + " ms (up to " + Math.round(b.high) + " ms). " +
      '<span class="sample-tag">Simulated baseline</span></p>';

    if (practice) {
      html += '<p class="muted">Practice run: not saved.</p>';
    }
    html += '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-close>Close</button></div>';
    openDialog(test.name + " · result", html);
    document.getElementById("rt-message").textContent = outside
      ? CHM.ACTIONS.reactionMs + "."
      : "Good. No action needed.";
    dialogBody.querySelector("[data-close]").addEventListener("click", closeDialog);

    if (!practice) {
      saveResult("reaction", { medianMs: med, lapses: lapses, falseStarts: falseStarts, taps: times.length });
      // Fitness for duty: reaction results are shared with the flight surgeon
      CHM.addToQueue({
        title: "Reaction-time result",
        to: "Flight surgeon",
        text: "Day " + day + ": " + med + " ms typical, " + lapses + " slow reactions" + (outside ? " (slower than normal)" : ""),
      });
      finishTest(test.id);
    }
  }

  // ---------- Start ----------
  renderSignals();
  renderTests();

})(window.CHM);
