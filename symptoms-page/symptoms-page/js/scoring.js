// =========================================================
// scoring.js — the evaluation engine.
// Turns raw readings into OK / Watch / Act now.
//
// Rules (from the wireframe notes):
//  • Each astronaut is compared to THEIR OWN normal
//    (mean ± 2 SD of the baseline days).
//  • Watch   = outside normal in the bad direction 3+ days in a row.
//  • Act now = past a hard limit, or very far from normal (4+ SD) today.
//  • Radiation only adds up: compared to the mission limit instead.
// =========================================================

window.CHM = window.CHM || {};

(function (CHM) {

  CHM.RULES = {
    normalSd: 2,          // normal range = mean ± 2 SD
    dangerSd: 4,          // today this far off → Act now
    watchDays: 3,         // outside normal this many days in a row → Watch
    radiationWatchPct: 75,
    radiationDangerPct: 100,
  };

  const LEVEL_RANK = { ok: 0, watch: 1, danger: 2 };
  CHM.worst = function (levels) {
    return levels.reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a), "ok");
  };

  function mean(arr) { return arr.reduce((s, x) => s + x, 0) / arr.length; }
  function sd(arr) {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1));
  }

  // Personal baseline for one vital
  CHM.baseline = function (readings, key) {
    const base = readings.slice(0, CHM.MISSION.baselineDays).map((r) => r[key]);
    const m = mean(base);
    const s = Math.max(sd(base), CHM.VITALS[key].minSd || 1e-6);
    return { mean: m, sd: s, low: m - CHM.RULES.normalSd * s, high: m + CHM.RULES.normalSd * s };
  };

  // Is a value off in the bad direction?
  function isBad(value, b, dir, sds) {
    const limitHigh = b.mean + sds * b.sd;
    const limitLow = b.mean - sds * b.sd;
    if (dir === "high") return value > limitHigh;
    if (dir === "low") return value < limitLow;
    return value > limitHigh || value < limitLow;
  }

  // Status for one vital
  CHM.scoreVital = function (readings, key) {
    const def = CHM.VITALS[key];
    const b = CHM.baseline(readings, key);
    const today = readings[readings.length - 1][key];

    // days in a row outside normal, counting back from today
    let streak = 0;
    for (let i = readings.length - 1; i >= CHM.MISSION.baselineDays; i--) {
      if (isBad(readings[i][key], b, def.bad, CHM.RULES.normalSd)) streak++;
      else break;
    }

    let level = "ok";
    let reason = def.label + " within your normal";
    const hard = (def.hardHigh !== undefined && today > def.hardHigh) ||
                 (def.hardLow !== undefined && today < def.hardLow);

    if (hard || isBad(today, b, def.bad, CHM.RULES.dangerSd)) {
      level = "danger";
      reason = def.label + " far " + (def.bad === "low" ? "below" : "above") + " your normal today";
    } else if (streak >= CHM.RULES.watchDays) {
      level = "watch";
      reason = def.label + " " + (def.bad === "low" ? "below" : "above") + " your normal for " + streak + " days";
    }

    return { key, def, level, reason, today, baseline: b, streak };
  };

  // Radiation: cumulative dose vs mission limit
  CHM.scoreRadiation = function (readings, spaceWeather) {
    const dose = readings[readings.length - 1].doseTotal;
    const limit = CHM.MISSION.doseLimitMsv;
    const pct = (dose / limit) * 100;
    const last7 = readings.slice(-7);
    const ratePerDay = (last7[last7.length - 1].doseTotal - last7[0].doseTotal) / (last7.length - 1);

    let level = "ok";
    let reason = Math.round(pct) + "% of mission limit";
    if (spaceWeather && spaceWeather.active) {
      level = "danger";
      reason = "Solar particle event: go to shelter";
    } else if (pct >= CHM.RULES.radiationDangerPct) {
      level = "danger";
      reason = "Mission dose limit reached";
    } else if (pct >= CHM.RULES.radiationWatchPct) {
      level = "watch";
      reason = Math.round(pct) + "% of mission limit";
    }
    return { level, reason, dose, limit, pct, ratePerDay };
  };

  // Status for every body system
  CHM.scoreCrewMember = function (crewId, options) {
    options = options || {};
    const readings = CHM.getReadings(crewId);
    const vitals = Object.keys(CHM.VITALS).map((k) => CHM.scoreVital(readings, k));

    // recent unresolved symptoms push Immune to Watch
    const symptoms = (options.symptoms || []).filter(
      (s) => s.crewId === crewId && !s.resolved && s.day >= CHM.MISSION.currentDay - 2
    );

    const systems = CHM.SYSTEMS.map((sys) => {
      if (sys.id === "radiation") {
        const r = CHM.scoreRadiation(readings, options.spaceWeather);
        return Object.assign({ id: sys.id, name: sys.name, vitals: [] }, r);
      }
      const own = vitals.filter((v) => v.def.system === sys.id);
      let level = CHM.worst(own.map((v) => v.level));
      // reason = the worst vital's reason, or a calm line
      const worstVital = own.slice().sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0];
      let reason = level === "ok" ? "All readings within your normal" : worstVital.reason;

      if (sys.id === "immune" && symptoms.length && level === "ok") {
        level = "watch";
        reason = "Open symptom: " + symptoms[0].symptom.toLowerCase();
      }
      return { id: sys.id, name: sys.name, level, reason, vitals: own };
    });

    const overall = CHM.worst(systems.map((s) => s.level));
    return { crewId, readings, vitals, systems, overall };
  };

  // ----- Suggested actions: what to do for each vital that is off -----
  CHM.ACTIONS = {
    restingHR:  "Re-measure resting heart rate after 10 minutes of rest",
    hrv:        "Keep today's exercise light and drink extra water",
    systolic:   "Re-measure blood pressure seated after 5 minutes",
    spo2:       "Re-measure blood oxygen and check cabin O₂ levels",
    bodyMass:   "Check exercise log and calorie intake with the crew medical officer",
    skinTemp:   "Re-measure temperature; report a symptom if you feel unwell",
    sleepHours: "Protect tonight's sleep window: lights down 30 min earlier",
    mood:       "Take a break and consider a private call home at the next window",
    reactionMs: "Avoid critical tasks until rested; repeat the reaction test tomorrow",
    radiation:  "Limit time in low-shielding modules today",
    shelter:    "Go to the shielded area now and stay until the all-clear",
    cabinCo2:   "Headache or fatigue? Check cabin CO₂ scrubber status",
  };

  CHM.suggestActions = function (score, cabinStatus) {
    const list = [];
    const radiation = score.systems.find((s) => s.id === "radiation");
    if (radiation.level === "danger" && radiation.reason.indexOf("Solar") === 0) {
      list.push({ id: "shelter", text: CHM.ACTIONS.shelter, level: "danger" });
    } else if (radiation.level !== "ok") {
      list.push({ id: "radiation", text: CHM.ACTIONS.radiation, level: radiation.level });
    }
    score.vitals
      .filter((v) => v.level !== "ok")
      .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])
      .forEach((v) => list.push({ id: v.key, text: CHM.ACTIONS[v.key], level: v.level }));
    if (cabinStatus && cabinStatus.co2.level !== "ok") {
      list.push({ id: "cabinCo2", text: CHM.ACTIONS.cabinCo2, level: cabinStatus.co2.level });
    }
    return list;
  };

  // ----- Cabin environment -----
  CHM.scoreCabin = function (cabin) {
    const out = {};
    Object.keys(CHM.CABIN_LIMITS).forEach((k) => {
      const lim = CHM.CABIN_LIMITS[k];
      const v = cabin[k];
      let level = "ok";
      if (lim.dangerHigh !== undefined && v > lim.dangerHigh) level = "danger";
      else if ((lim.watchHigh !== undefined && v > lim.watchHigh) ||
               (lim.watchLow !== undefined && v < lim.watchLow)) level = "watch";
      out[k] = { value: v, level, label: lim.label, unit: lim.unit };
    });
    out.overall = CHM.worst(Object.keys(CHM.CABIN_LIMITS).map((k) => out[k].level));
    return out;
  };

  // ----- Tests due today -----
  CHM.testsDueToday = function (crewId) {
    const day = CHM.MISSION.currentDay;
    const weekly = day % 7 === CHM.WEEKLY_TEST_DAY;
    const done = CHM.getTestsDone(crewId, day);
    return CHM.TESTS
      .filter((t) => t.freq === "daily" || weekly)
      .map((t) => Object.assign({ done: done.includes(t.id) }, t));
  };

})(window.CHM);