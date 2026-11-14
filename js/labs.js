// =========================================================
// labs.js — blood tests from REAL astronauts (NASA OSDR).
//
// Adds a second layer to scoring.js:
//   • daily vitals (simulated)  → scored by scoring.js as before
//   • blood tests (NASA data)   → scored here, then merged into
//     the Cardio / Immune / Bone & muscle tiles on Home.
//
// Rules:
//   • "range"    → Watch if outside the lab's min/max for that person
//   • "baseline" → no range in the file, so Watch if the value is
//                  ≥ 2× the person's own pre-flight average
//                  (a demo rule, not a clinical one)
//   • Batch check → if most of the crew are flagged for the same test
//                  on the same draw, it's probably a sample-handling
//                  problem: say "re-test" instead of blaming the body.
//   • Labs alone never give "Act now": one blood draw is not enough.
//
// Load order: data.js → data/crew-labs.js → session.js → scoring.js
//             → labs.js → <page>.js
// =========================================================

window.CHM = window.CHM || {};

(function (CHM) {

  // ----- Which test feeds which Home tile -----
  CHM.LAB_TESTS = {
    hemoglobin:  { label: "Hemoglobin",               unit: "g/dL",     system: "cardio", rule: "range" },
    hematocrit:  { label: "Hematocrit",               unit: "%",        system: "cardio", rule: "range" },
    potassium:   { label: "Potassium",                unit: "mmol/L",   system: "cardio", rule: "range" },
    sodium:      { label: "Sodium",                   unit: "mmol/L",   system: "cardio", rule: "range" },
    glucose:     { label: "Blood sugar",              unit: "mg/dL",    system: "cardio", rule: "range" },
    crp:         { label: "CRP (inflammation)",       unit: "pg/mL",    system: "cardio", rule: "baseline" },
    fibrinogen:  { label: "Fibrinogen (clotting)",    unit: "ng/mL",    system: "cardio", rule: "baseline" },
    wbc:         { label: "White blood cells",        unit: "×10³/µL",  system: "immune", rule: "range" },
    lymphocytes: { label: "Lymphocytes",              unit: "cells/µL", system: "immune", rule: "range" },
    neutrophils: { label: "Neutrophils",              unit: "cells/µL", system: "immune", rule: "range" },
    platelets:   { label: "Platelets",                unit: "×10³/µL",  system: "immune", rule: "range" },
    il6:         { label: "IL-6 (inflammation)",      unit: "pg/mL",    system: "immune", rule: "baseline" },
    tnfa:        { label: "TNF-α (inflammation)",     unit: "pg/mL",    system: "immune", rule: "baseline" },
    il10:        { label: "IL-10 (immune signal)",    unit: "pg/mL",    system: "immune", rule: "baseline" },
    calcium:     { label: "Calcium",                  unit: "mg/dL",    system: "bone",   rule: "range" },
    alkPhos:     { label: "Alkaline phosphatase",     unit: "U/L",      system: "bone",   rule: "range" },
    creatinine:  { label: "Creatinine (muscle)",      unit: "mg/dL",    system: "bone",   rule: "range" },
  };

  CHM.LAB_RULES = {
    baselineFold: 2,   // ≥ 2× own pre-flight average → Watch
    batchShare: 0.75,  // ≥ 75% of crew flagged on one draw → likely sample problem
  };

  // ----- When each NASA draw "happens" in our mission -----
  // The real mission lasted 3 days, so we spread the return-side
  // draws across our 142-day mission. Change these freely; keep the
  // pre-flight ones negative (they build each person's baseline).
  CHM.LAB_SCHEDULE = {
    "L-92": -92, "L-44": -44, "L-3": -3,     // pre-flight baseline
    "R+1": 7, "R+45": 45, "R+82": 82, "R+194": 140,
  };

  // ----- Data access -----
  CHM.getLabs = function (crewId) {
    const raw = (CHM.LABS_RAW || {})[crewId];
    if (!raw) return [];
    return raw.draws
      .map((d) => ({ nasa: d.nasa, day: CHM.LAB_SCHEDULE[d.nasa], values: d.values }))
      .filter((d) => d.day !== undefined)
      .sort((a, b) => a.day - b.day);
  };

  // latest draw on or before today
  CHM.latestLabDraw = function (crewId, day) {
    day = day === undefined ? CHM.MISSION.currentDay : day;
    const past = CHM.getLabs(crewId).filter((d) => d.day <= day);
    return past.length ? past[past.length - 1] : null;
  };

  function preflightMean(draws, key) {
    const vals = draws.filter((d) => d.day < 0 && d.values[key]).map((d) => d.values[key][0]);
    return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  }

  function fmt(v) {
    return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : String(Math.round(v * 100) / 100);
  }

  // Score one test on one draw, without the batch check
  function rawScore(crewId, draw, key) {
    const def = CHM.LAB_TESTS[key];
    const cell = draw.values[key];
    if (!def || !cell) return null;
    const [value, min, max] = cell;
    const out = { key, def, value, min, max, nasa: draw.nasa, day: draw.day, level: "ok", reason: def.label + " normal" };

    if (def.rule === "range") {
      if (min !== null && value < min) { out.level = "watch"; out.reason = def.label + " low (" + fmt(value) + " " + def.unit + ")"; }
      else if (max !== null && value > max) { out.level = "watch"; out.reason = def.label + " high (" + fmt(value) + " " + def.unit + ")"; }
    } else {
      const base = preflightMean(CHM.getLabs(crewId), key);
      out.baseline = base;
      if (base) {
        out.fold = value / base;
        if (out.fold >= CHM.LAB_RULES.baselineFold) {
          out.level = "watch";
          out.reason = def.label + " " + (Math.round(out.fold * 10) / 10) + "× your pre-flight level";
        }
      }
    }
    return out;
  }

  // Share of crew flagged for this test on this NASA draw
  function batchShare(nasa, key) {
    let flagged = 0, total = 0;
    CHM.CREW.forEach((c) => {
      const draw = CHM.getLabs(c.id).find((d) => d.nasa === nasa);
      const s = draw && rawScore(c.id, draw, key);
      if (s) { total++; if (s.level !== "ok") flagged++; }
    });
    return total ? flagged / total : 0;
  }

  // All tests for one person on their latest draw
  CHM.scoreLabs = function (crewId, day) {
    const draw = CHM.latestLabDraw(crewId, day);
    if (!draw) return { draw: null, tests: [] };
    const tests = Object.keys(CHM.LAB_TESTS)
      .map((k) => rawScore(crewId, draw, k))
      .filter(Boolean)
      .map((s) => {
        if (s.level !== "ok" && batchShare(draw.nasa, s.key) >= CHM.LAB_RULES.batchShare) {
          s.suspectSample = true;
          s.reason = s.def.label + " off for most of the crew: possible sample problem, re-test";
        }
        return s;
      });
    return { draw, tests };
  };

  // ----- Merge into the existing scoring -----
  const RANK = { ok: 0, watch: 1, danger: 2 };
  const originalScore = CHM.scoreCrewMember;

  CHM.scoreCrewMember = function (crewId, options) {
    const score = originalScore(crewId, options);
    const labs = CHM.scoreLabs(crewId);
    score.labs = labs;

    score.systems.forEach((sys) => {
      const own = labs.tests.filter((t) => t.def.system === sys.id);
      sys.labs = own;
      if (!own.length) return;
      sys.lastBloodTest = labs.draw ? labs.draw.day : null;
      const worstLab = own.slice().sort((a, b) => RANK[b.level] - RANK[a.level])[0];
      // a lab finding only raises the tile if vitals didn't already
      if (RANK[worstLab.level] > RANK[sys.level]) {
        sys.level = worstLab.level;
        sys.reason = worstLab.reason;
      }
    });
    score.overall = CHM.worst(score.systems.map((s) => s.level));
    return score;
  };

  const originalActions = CHM.suggestActions;
  CHM.suggestActions = function (score, cabinStatus) {
    const list = originalActions(score, cabinStatus);
    const flagged = (score.labs ? score.labs.tests : []).filter((t) => t.level !== "ok");
    if (flagged.some((t) => t.suspectSample)) {
      list.push({ id: "labRetest", level: "watch", text: "Repeat today's blood draw: results look like a sample problem" });
    }
    const real = flagged.filter((t) => !t.suspectSample);
    if (real.length) {
      list.push({ id: "labReview", level: "watch",
        text: "Send blood results (" + real.map((t) => t.def.label).join(", ") + ") to the flight surgeon" });
    }
    return list;
  };

})(window.CHM);
