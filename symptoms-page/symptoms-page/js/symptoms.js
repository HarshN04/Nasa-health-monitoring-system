// =========================================================
// symptoms.js · Report a symptom (wireframe screen 5)
//
// Uses the shared team files:
//   CHM.MISSION, CHM.getCabin, CHM.SAMPLE_SYMPTOMS   (js/data.js)
//   CHM.getCurrentCrewId, CHM.getCrew, CHM.store, CHM.addToQueue (js/session.js)
//   CHM.scoreCabin                                    (js/scoring.js)
//
// Ethics rules for this page:
//   • Never diagnose, never name or suggest a medication.
//   • Self-care steps are only rest, water, environment checks and re-checking.
//   • Anything severe or worrying → "Act now: contact the flight surgeon".
// =========================================================

(function (CHM) {

  // =========================================================
  // RULES · team rules, not medical advice.
  // Review these with a medical mentor before the final demo.
  // =========================================================
  const RULES = {
    actNowSeverity: 4,      // severity 4 or 5 → Act now
    watchSeverity: 3,       // severity 3 → Watch
    watchDurations: ["days"], // lasting several days → Watch
    worseIsWatch: true,     // getting worse → Watch (at least)
  };

  // The 8 symptoms from the wireframe, plus "Something else".
  // alwaysActNow: report straight to the flight surgeon whatever the severity.
  // checkCabin:   check cabin CO₂ first (headache can come from high CO₂).
  const SYMPTOMS = [
    { id: "headache",  name: "Headache", checkCabin: true,
      steps: ["Drink some water.", "Take a break from screens and rest your eyes for 15 minutes.", "Re-check how you feel in 1 hour."] },
    { id: "dizziness", name: "Dizziness",
      steps: ["Stop and anchor yourself somewhere safe.", "Avoid fast head movements.", "Drink some water.", "Don't start critical tasks until it has passed."] },
    { id: "chest",     name: "Chest discomfort", alwaysActNow: true,
      steps: ["Stop what you are doing and rest.", "Tell a crewmate now.", "Contact the flight surgeon now."] },
    { id: "back",      name: "Back pain",
      steps: ["Do the gentle stretches from your training.", "Check your posture and restraints at your workstation.", "Re-check tomorrow."] },
    { id: "sleep",     name: "Trouble sleeping",
      steps: ["Protect tonight's sleep window.", "Dim the lights and stop screens 30 minutes earlier.", "Fill in the sleep log on the Tests page each morning."] },
    { id: "mood",      name: "Low mood / stress",
      steps: ["Take a break and talk to a crewmate you trust.", "Consider a private call home at the next Earth link.", "Do the mood check-in on the Tests page."] },
    { id: "nausea",    name: "Nausea",
      steps: ["Rest and keep your head still.", "Take small sips of water.", "Report again if you vomit or it lasts more than a few hours."] },
    { id: "rash",      name: "Skin rash",
      steps: ["Keep the area clean and dry.", "Try not to scratch it.", "Take a photo so the flight surgeon can see how it changes."] },
    { id: "other",     name: "Something else",
      steps: ["Rest if you can.", "Re-check how you feel in a few hours.", "Add a note in History about anything else you notice."] },
  ];

  const SEVERITY = [
    { value: 1, label: "Barely noticeable" },
    { value: 2, label: "Mild" },
    { value: 3, label: "Distracting" },
    { value: 4, label: "Hard to work" },
    { value: 5, label: "Can't work" },
  ];

  const DURATIONS = [
    { id: "now",   label: "Just started" },
    { id: "hours", label: "A few hours" },
    { id: "day",   label: "Since yesterday" },
    { id: "days",  label: "Several days" },
  ];

  // ---------- Who is checked in (standalone for now, no login page) ----------
  // When the pages are linked, swap these lines for:  const crew = CHM.requireLogin(); if (!crew) return;
  let crewId = CHM.getCurrentCrewId();
  if (!crewId) {
    crewId = "CDR";
    CHM.store.set("currentCrew", crewId);
  }
  const crew = CHM.getCrew(crewId);
  const day = CHM.MISSION.currentDay;

  document.getElementById("crew-role").textContent = crew.role;
  document.getElementById("mission-day").textContent = day;
  document.getElementById("strip-day").textContent = day;
  document.getElementById("strip-crew").textContent = crew.role;
  document.getElementById("strip-delay").textContent = CHM.MISSION.oneWayDelayMin;
  document.getElementById("em-delay").textContent = CHM.MISSION.oneWayDelayMin;

  // ---------- Saved symptom reports ----------
  // Same shape as CHM.SAMPLE_SYMPTOMS so Home/scoring can read them:
  // { crewId, day, symptom, severity, resolved, ... }
  const STORE_KEY = "symptoms";
  function getReports() { return CHM.store.get(STORE_KEY, []); }
  function saveReports(list) { CHM.store.set(STORE_KEY, list); }

  // ---------- What the person has chosen so far ----------
  const report = { symptomId: null, otherText: "", severity: null, duration: null, worse: false };
  let step = 1;

  // =========================================================
  // Build the choices
  // =========================================================
  const grid = document.getElementById("symptom-grid");
  SYMPTOMS.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "symptom";
    b.dataset.id = s.id;
    b.setAttribute("aria-pressed", "false");
    b.textContent = s.name;
    b.addEventListener("click", () => {
      report.symptomId = s.id;
      grid.querySelectorAll(".symptom").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      document.getElementById("other-wrap").hidden = s.id !== "other";
      if (s.id === "other") document.getElementById("other-text").focus();
      setError(1, "");
    });
    grid.appendChild(b);
  });

  const scale = document.getElementById("severity-scale");
  SEVERITY.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "scale-btn";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.innerHTML = '<span class="scale-num"></span><span class="scale-label"></span>';
    b.querySelector(".scale-num").textContent = s.value;
    b.querySelector(".scale-label").textContent = s.label;
    b.addEventListener("click", () => {
      report.severity = s.value;
      scale.querySelectorAll(".scale-btn").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      setError(2, "");
    });
    scale.appendChild(b);
  });

  const durationGroup = document.getElementById("duration-group");
  DURATIONS.forEach((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.textContent = d.label;
    b.addEventListener("click", () => {
      report.duration = d.id;
      durationGroup.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      setError(2, "");
    });
    durationGroup.appendChild(b);
  });

  document.querySelectorAll("#worse-group button").forEach((b) => {
    b.addEventListener("click", () => {
      report.worse = b.dataset.worse === "yes";
      document.querySelectorAll("#worse-group button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
  });

  // =========================================================
  // Decide what to do (OK / Watch / Act now)
  // =========================================================
  function assess() {
    const s = SYMPTOMS.find((x) => x.id === report.symptomId);
    let level = "ok";
    const reasons = [];

    if (s.alwaysActNow) {
      level = "act";
      reasons.push(s.name + " is always checked by the flight surgeon");
    } else if (report.severity >= RULES.actNowSeverity) {
      level = "act";
      reasons.push("severity " + report.severity + " of 5");
    } else {
      if (report.severity >= RULES.watchSeverity) reasons.push("severity " + report.severity + " of 5");
      if (RULES.watchDurations.includes(report.duration)) reasons.push("it has lasted several days");
      if (RULES.worseIsWatch && report.worse) reasons.push("it is getting worse");
      if (reasons.length) level = "watch";
    }

    // Headache: check cabin CO₂ first
    let cabin = null;
    const steps = s.steps.slice();
    if (s.checkCabin) {
      const scored = CHM.scoreCabin(CHM.getCabin());
      cabin = scored.co2;
      if (cabin.level !== "ok") {
        steps.unshift("Cabin CO₂ is high: tell the crew and check the CO₂ scrubber first.");
        if (level === "ok") level = "watch";
        reasons.push("cabin CO₂ is above its limit");
      }
    }

    // Severe: put "contact the flight surgeon" first (chest discomfort already lists it)
    if (level === "act" && !s.alwaysActNow) {
      steps.unshift("Contact the flight surgeon now. Tell a crewmate.");
    }

    return { symptom: s, level: level, reasons: reasons, steps: steps, cabin: cabin };
  }

  const LEVEL_TEXT = {
    ok:    { badge: "badge-done",  label: "Self-care", title: "Look after yourself and re-check",
             summary: "This looks manageable on board. Follow these steps." },
    watch: { badge: "badge-watch", label: "Watch",     title: "Keep an eye on it",
             summary: "Worth watching because " },
    act:   { badge: "badge-act",   label: "Act now",   title: "Contact the flight surgeon now",
             summary: "Get help now because " },
  };

  function renderAction() {
    const a = assess();
    const t = LEVEL_TEXT[a.level];
    const card = document.getElementById("action-card");
    card.dataset.level = a.level;

    const badge = document.getElementById("action-badge");
    badge.className = "badge " + t.badge;
    badge.textContent = t.label;
    document.getElementById("action-title").textContent = t.title;
    document.getElementById("action-summary").textContent =
      a.level === "ok" ? t.summary : t.summary + a.reasons.join(", ") + ".";

    const ol = document.getElementById("action-steps");
    ol.innerHTML = "";
    a.steps.forEach((txt) => {
      const li = document.createElement("li");
      li.textContent = txt;
      ol.appendChild(li);
    });

    // CO₂ box for headache
    const box = document.getElementById("cabin-check");
    box.hidden = !a.cabin;
    if (a.cabin) {
      document.getElementById("cabin-value").textContent =
        a.cabin.value.toFixed(1) + " " + a.cabin.unit + (a.cabin.level === "ok" ? " · within limits" : " · above limit");
      const cb = document.getElementById("cabin-badge");
      cb.className = "badge " + (a.cabin.level === "ok" ? "badge-done" : a.cabin.level === "watch" ? "badge-watch" : "badge-act");
      cb.textContent = a.cabin.level === "ok" ? "OK" : a.cabin.level === "watch" ? "Watch" : "Act now";
    }

    // Act now reports always go to the flight surgeon
    const me = document.getElementById("share-me");
    const surgeon = document.getElementById("share-surgeon");
    me.disabled = a.level === "act";
    if (a.level === "act") surgeon.checked = true;
    updateShareHelp(a.level);
    return a;
  }

  function updateShareHelp(level) {
    const toSurgeon = document.getElementById("share-surgeon").checked;
    document.getElementById("share-help").textContent =
      level === "act" ? "Act now reports always go to the flight surgeon, marked urgent."
      : toSurgeon ? "Goes in the Comms queue and is sent at the next Earth link."
      : "Stays on board. Only you can see it.";
  }
  document.querySelectorAll('input[name="share"]').forEach((r) =>
    r.addEventListener("change", () => updateShareHelp(assess().level)));

  // =========================================================
  // Steps: Next / Back / Save
  // =========================================================
  const nextBtn = document.getElementById("next-btn");
  const backBtn = document.getElementById("back-btn");

  function setError(n, msg) {
    const el = document.getElementById("step-" + n + "-error");
    if (el) el.textContent = msg;
  }

  function showStep(n) {
    step = n;
    ["1", "2", "3", "done"].forEach((id) => {
      document.getElementById("step-" + id).hidden = String(n) !== id;
    });
    document.querySelectorAll(".step").forEach((li) => {
      const s = Number(li.dataset.step);
      const num = n === "done" ? 4 : n;
      li.classList.toggle("is-done", s < num);
      if (s === num) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    backBtn.hidden = n === 1 || n === "done";
    nextBtn.textContent = n === 3 ? "Save report" : n === "done" ? "Report another symptom" : "Next";
    if (n === 3) renderAction();
  }

  nextBtn.addEventListener("click", () => {
    if (step === 1) {
      if (!report.symptomId) return setError(1, "Choose what you are noticing.");
      if (report.symptomId === "other") {
        report.otherText = document.getElementById("other-text").value.trim();
        if (!report.otherText) return setError(1, "Describe it in a few words.");
      }
      showStep(2);
    } else if (step === 2) {
      if (!report.severity) return setError(2, "Choose how bad it is.");
      if (!report.duration) return setError(2, "Choose how long it has lasted.");
      showStep(3);
    } else if (step === 3) {
      saveReport();
    } else {
      resetForm();
    }
  });
  backBtn.addEventListener("click", () => showStep(step - 1));

  function symptomName(s) {
    return s.id === "other" ? report.otherText : s.name;
  }

  function saveReport() {
    const a = assess();
    const shared = document.getElementById("share-surgeon").checked || a.level === "act";
    const name = symptomName(a.symptom);
    const duration = DURATIONS.find((d) => d.id === report.duration).label.toLowerCase();

    const list = getReports();
    list.push({
      id: Date.now(),
      crewId: crew.id,
      day: day,
      time: new Date().toISOString(),
      symptom: name,
      severity: report.severity,
      duration: report.duration,
      worse: report.worse,
      level: a.level,
      shared: shared,
      resolved: false,
    });
    saveReports(list);

    if (shared) {
      CHM.addToQueue({
        title: "Symptom report: " + name.toLowerCase(),
        to: "Flight surgeon",
        text: "Day " + day + ": severity " + report.severity + " of 5, " + duration + (report.worse ? ", getting worse" : ""),
        urgent: a.level === "act",
      });
    }

    document.getElementById("saved-text").textContent = shared
      ? (a.level === "act"
          ? "Sent to the top of the Comms queue as urgent. Don't wait for a reply: follow the steps and tell a crewmate."
          : "Waiting in the Comms queue for the next Earth link.")
      : "Kept on board. Only you can see it.";
    showStep("done");
    renderRecent();
  }

  function resetForm() {
    report.symptomId = null;
    report.otherText = "";
    report.severity = null;
    report.duration = null;
    report.worse = false;
    document.querySelectorAll(".symptom, #duration-group button").forEach((b) => b.setAttribute("aria-pressed", "false"));
    document.querySelectorAll(".scale-btn").forEach((b) => b.setAttribute("aria-checked", "false"));
    document.querySelectorAll("#worse-group button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.worse === "no")));
    document.getElementById("other-text").value = "";
    document.getElementById("other-wrap").hidden = true;
    document.getElementById("share-surgeon").checked = true;
    showStep(1);
  }

  // =========================================================
  // Recent reports (saved + sample), with "Mark resolved"
  // =========================================================
  function renderRecent() {
    const ul = document.getElementById("recent-list");
    ul.innerHTML = "";
    const saved = getReports().filter((r) => r.crewId === crew.id);
    const samples = (CHM.SAMPLE_SYMPTOMS || []).filter((r) => r.crewId === crew.id)
      .map((r) => Object.assign({ sample: true }, r));
    const all = saved.slice().reverse().concat(samples);

    if (!all.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No symptoms reported.";
      ul.appendChild(li);
      return;
    }

    all.forEach((r) => {
      const li = document.createElement("li");
      li.className = "recent";

      const meta = document.createElement("p");
      meta.className = "recent-meta";
      meta.textContent = "Day " + r.day + (r.sample ? " · sample" : "");

      const title = document.createElement("h3");
      title.textContent = r.symptom + " · severity " + r.severity;

      const badge = document.createElement("span");
      if (r.resolved) {
        badge.className = "badge badge-done";
        badge.textContent = "Resolved";
      } else {
        badge.className = "badge " + (r.level === "act" ? "badge-act" : "badge-watch");
        badge.textContent = r.level === "act" ? "Act now" : "Open";
      }

      const row = document.createElement("div");
      row.className = "recent-row";
      row.appendChild(badge);

      if (!r.resolved && !r.sample) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-ghost btn-small";
        btn.textContent = "Mark resolved";
        btn.addEventListener("click", () => {
          const list = getReports();
          const item = list.find((x) => x.id === r.id);
          if (item) item.resolved = true;
          saveReports(list);
          renderRecent();
        });
        row.appendChild(btn);
      }

      li.appendChild(meta);
      li.appendChild(title);
      li.appendChild(row);
      ul.appendChild(li);
    });
  }

  // =========================================================
  // Emergency button
  // =========================================================
  const emDialog = document.getElementById("emergency-dialog");
  document.getElementById("emergency-btn").addEventListener("click", () => {
    document.getElementById("em-status").textContent = "";
    emDialog.showModal();
  });
  document.getElementById("em-cancel").addEventListener("click", () => emDialog.close());
  document.getElementById("em-send").addEventListener("click", () => {
    CHM.addToQueue({
      title: "EMERGENCY: " + crew.role + " needs help",
      to: "Flight surgeon",
      text: "Day " + day + ": emergency button pressed on the Symptoms page",
      urgent: true,
    });
    document.getElementById("em-status").textContent = "Urgent alert is at the top of the Comms queue. Tell a crewmate now.";
  });

  // ---------- Start ----------
  showStep(1);
  renderRecent();

  // On phones the menu scrolls sideways: show the current page's item (from template.html)
  const nav = document.querySelector(".app-nav");
  const cur = nav && nav.querySelector('[aria-current="page"]');
  if (nav && cur && nav.scrollWidth > nav.clientWidth) {
    nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
  }

})(window.CHM);
