// =========================================================
// vitals.js — Vitals page.
// Reads everything from the shared CHM scripts:
//   CHM.scoreCrewMember()  → vitals, systems, labs (scoring.js + labs.js)
//   CHM.getReadings()      → daily readings for the trend charts
//   CHM.getCabin()/scoreCabin(), CHM.suggestActions()
//   CHM.refreshSpaceWeather() (spaceweather.js)
// Nothing here changes the scoring rules: it only draws them.
// =========================================================

(function (CHM) {
  "use strict";

  const crew = CHM.requireLogin();
  if (!crew) return; // requireLogin already sent us to login.html

  // ----- What to show -----
  const MAIN_VITALS = ["restingHR", "hrv", "spo2", "systolic", "skinTemp", "sleepHours"]; // as on the wireframe
  const MORE_VITALS = ["bodyMass", "mood", "reactionMs"];
  const RANGES = { "7": 7, "30": 30, all: Infinity };
  const LEVEL_TEXT = { ok: "OK", watch: "Watch", danger: "Act now" };
  const LEVEL_RANK = { ok: 0, watch: 1, danger: 2 };
  const SYSTEM_NAME = {};
  CHM.SYSTEMS.forEach((s) => { SYSTEM_NAME[s.id] = s.name; });

  const day = CHM.MISSION.currentDay;
  const state = {
    range: CHM.store.get("vitalsRange", "7"),
    showMore: CHM.store.get("vitalsShowMore", false),
    labsFlaggedOnly: false,
    openKey: null,
    swInfo: null,
    score: null,
  };
  if (!(state.range in RANGES)) state.range = "7";

  // ----- Small helpers -----
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.append(c));
    return node;
  }
  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }
  function pill(level, title) {
    return el("span", { class: "pill pill-" + level, title: title || null, text: LEVEL_TEXT[level] || level });
  }

  // Format a vital value with its unit (sleep as "5 h 40 min")
  function fmtVital(key, v) {
    const def = CHM.VITALS[key];
    if (key === "sleepHours") {
      const h = Math.floor(v);
      const m = Math.round((v - h) * 60);
      return m === 60 ? (h + 1) + " h" : h + " h " + String(m).padStart(2, "0") + " min";
    }
    return v.toFixed(def.decimals) + (def.unit.startsWith("/") || def.unit === "%" || def.unit === "°C" ? "" : " ") + def.unit;
  }
  // up to 2 decimals (lab values), or exactly `decimals` when given (vitals)
  function fmtNum(v, decimals) {
    return decimals === undefined
      ? Number(v).toLocaleString("en-GB", { maximumFractionDigits: 2 })
      : Number(v).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function isBad(key, v, b) {
    const dir = CHM.VITALS[key].bad;
    if (dir === "high") return v > b.high;
    if (dir === "low") return v < b.low;
    return v > b.high || v < b.low;
  }
  function windowed(readings) {
    const n = RANGES[state.range];
    return n === Infinity ? readings : readings.slice(-n);
  }

  // ----- Charts (plain SVG, no library) -----
  function sparkline(key, rows, b, level) {
    const W = 140, H = 34, P = 3;
    const vals = rows.map((r) => r[key]);
    const lo = Math.min(...vals, b.low), hi = Math.max(...vals, b.high);
    const pad = (hi - lo) * 0.1 || 1;
    const y = (v) => H - P - ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (H - 2 * P);
    const x = (i) => P + (rows.length === 1 ? 0 : (i / (rows.length - 1)) * (W - 2 * P));

    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark", role: "img",
      "aria-label": CHM.VITALS[key].label + " trend, " + rows.length + " days" });
    s.append(svg("rect", { class: "chart-band", x: 0, width: W, y: y(b.high), height: Math.max(1, y(b.low) - y(b.high)) }));
    s.append(svg("polyline", { class: "chart-line", points: vals.map((v, i) => x(i) + "," + y(v)).join(" ") }));
    const last = vals.length - 1;
    s.append(svg("circle", { class: "chart-dot is-today" + (level !== "ok" ? " is-bad" : ""), cx: x(last), cy: y(vals[last]), r: 3 }));
    return s;
  }

  function detailChart(key, readings, rows, b) {
    const def = CHM.VITALS[key];
    const W = 720, H = 230, L = 52, R = 12, T = 12, B = 28;
    const vals = rows.map((r) => r[key]);
    const limits = [def.hardHigh, def.hardLow].filter((v) => v !== undefined);
    let lo = Math.min(...vals, b.low), hi = Math.max(...vals, b.high);
    limits.forEach((v) => { if (Math.abs(v - (lo + hi) / 2) < (hi - lo) * 2) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    const pad = (hi - lo) * 0.12 || 1;
    lo -= pad; hi += pad;
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const firstDay = rows[0].day, lastDay = rows[rows.length - 1].day;
    const x = (d) => L + (lastDay === firstDay ? 0 : ((d - firstDay) / (lastDay - firstDay)) * (W - L - R));

    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": def.label + " for mission days " + firstDay + " to " + lastDay });

    // baseline days (1–14) shaded, when visible
    const bEnd = CHM.MISSION.baselineDays;
    if (firstDay <= bEnd) {
      const x2 = x(Math.min(bEnd, lastDay));
      s.append(svg("rect", { class: "chart-baseline-zone", x: L, y: T, width: Math.max(0, x2 - L), height: H - T - B }));
      const t = svg("text", { class: "chart-axis", x: L + 4, y: T + 12 }); t.textContent = "baseline days"; s.append(t);
    }

    // y grid + labels
    for (let i = 0; i <= 4; i++) {
      const v = lo + (i / 4) * (hi - lo);
      s.append(svg("line", { class: "chart-grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      const t = svg("text", { class: "chart-axis", x: L - 6, y: y(v) + 4, "text-anchor": "end" });
      t.textContent = key === "sleepHours" ? v.toFixed(1) : fmtNum(v, def.decimals);
      s.append(t);
    }
    // normal band + mean
    s.append(svg("rect", { class: "chart-band", x: L, width: W - L - R, y: y(b.high), height: Math.max(1, y(b.low) - y(b.high)) }));
    s.append(svg("line", { class: "chart-mean", x1: L, x2: W - R, y1: y(b.mean), y2: y(b.mean) }));
    // hard safety limits
    limits.forEach((v) => {
      if (v < lo || v > hi) return;
      s.append(svg("line", { class: "chart-limit", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      const t = svg("text", { class: "chart-axis", x: W - R, y: y(v) - 4, "text-anchor": "end" });
      t.textContent = "safety limit " + v; s.append(t);
    });
    // line + dots
    s.append(svg("polyline", { class: "chart-line", points: rows.map((r) => x(r.day) + "," + y(r[key])).join(" ") }));
    const showAllDots = rows.length <= 45;
    rows.forEach((r, i) => {
      const bad = r.day > bEnd && isBad(key, r[key], b);
      const today = i === rows.length - 1;
      if (!showAllDots && !bad && !today) return;
      const c = svg("circle", { class: "chart-dot" + (bad ? " is-bad" : "") + (today ? " is-today" : ""),
        cx: x(r.day), cy: y(r[key]), r: today ? 4.5 : 3 });
      const tt = svg("title"); tt.textContent = "Day " + r.day + ": " + fmtVital(key, r[key]); c.append(tt);
      s.append(c);
    });
    // x labels
    const ticks = Array.from(new Set([firstDay, Math.round((firstDay + lastDay) / 2), lastDay]));
    ticks.forEach((d) => {
      const t = svg("text", { class: "chart-axis", x: x(d), y: H - 8, "text-anchor": d === firstDay ? "start" : d === lastDay ? "end" : "middle" });
      t.textContent = "Day " + d; s.append(t);
    });
    return s;
  }

  // ----- Render: daily vitals table -----
  function renderVitals() {
    const score = state.score;
    const readings = score.readings;
    const rows = windowed(readings);
    const body = $("vitals-body");
    body.replaceChildren();
    $("trend-head").textContent = (state.range === "all" ? "Mission" : state.range + "-day") + " trend";

    // a flagged vital is never hidden, even when "show more" is off
    const more = MORE_VITALS.filter((k) => state.showMore ||
      (score.vitals.find((x) => x.key === k) || {}).level !== "ok");
    const keys = MAIN_VITALS.slice();
    if (more.length) keys.push(null, ...more); // null = group header

    keys.forEach((key) => {
      if (key === null) {
        body.append(el("tr", { class: "group-row" }, [el("td", { colspan: 5, text: "More tracked vitals" })]));
        return;
      }
      const v = score.vitals.find((x) => x.key === key);
      if (!v) return;
      const delta = v.today - v.baseline.mean;
      const deltaText = (delta >= 0 ? "+" : "−") + (key === "sleepHours"
        ? Math.round(Math.abs(delta) * 60) + " min"
        : fmtNum(Math.abs(delta), v.def.decimals) + " " + v.def.unit) + " vs normal";

      const tr = el("tr", {
        class: "vital-row is-" + v.level + (state.openKey === key ? " is-selected" : ""),
        tabindex: 0, "data-key": key, "aria-label": v.def.label + ": " + LEVEL_TEXT[v.level] + ". " + v.reason,
      }, [
        el("td", {}, [el("span", { class: "vital-name", text: v.def.label }),
                      v.level !== "ok" ? el("span", { class: "vital-reason", text: v.reason }) : ""]),
        el("td", {}, [el("span", { class: "vital-now is-" + v.level, text: fmtVital(key, v.today) }),
                      el("span", { class: "vital-delta is-" + v.level, text: deltaText })]),
        el("td", { class: "vital-normal", text: key === "sleepHours"
          ? v.baseline.low.toFixed(1) + "–" + v.baseline.high.toFixed(1) + " h"
          : fmtNum(v.baseline.low, v.def.decimals) + "–" + fmtNum(v.baseline.high, v.def.decimals) + " " + v.def.unit }),
        el("td", {}, [sparkline(key, rows, v.baseline, v.level)]),
        el("td", {}, [pill(v.level, v.reason)]),
      ]);
      body.append(tr);
    });
  }

  // ----- Render: detail panel for one vital -----
  function renderDetail() {
    const panel = $("detail");
    if (!state.openKey) { panel.hidden = true; return; }
    const score = state.score;
    const v = score.vitals.find((x) => x.key === state.openKey);
    if (!v) { panel.hidden = true; return; }
    const rows = windowed(score.readings);
    const b = v.baseline;

    panel.hidden = false;
    panel.className = "card mb-4 detail is-" + v.level;
    $("detail-title").textContent = v.def.label + " · " + (state.range === "all" ? "whole mission" : "last " + state.range + " days");
    $("detail-chart").replaceChildren(detailChart(v.key, score.readings, rows, b));

    const daysOut = rows.filter((r) => r.day > CHM.MISSION.baselineDays && isBad(v.key, r[v.key], b)).length;
    const stats = [
      ["Today", fmtVital(v.key, v.today)],
      ["Your normal", v.key === "sleepHours" ? b.mean.toFixed(1) + " h ± " + (b.sd * 2).toFixed(1)
        : fmtNum(b.mean, v.def.decimals) + " ± " + fmtNum(b.sd * 2, v.def.decimals) + " " + v.def.unit],
      ["Days in a row off", String(v.streak)],
      ["Days off in this view", daysOut + " of " + rows.length],
    ];
    $("detail-stats").replaceChildren(...stats.map(([k, val]) => el("div", {}, [el("dt", { text: k }), el("dd", { text: val })])));

    const action = CHM.ACTIONS[v.key];
    $("detail-action").replaceChildren(
      el("strong", { text: v.level === "ok" ? "All good. " : "What to do: " }),
      document.createTextNode(v.level === "ok" ? v.reason + "." : action || v.reason)
    );
  }

  // ----- Render: radiation -----
  function renderRadiation() {
    const r = state.score.systems.find((s) => s.id === "radiation");
    $("rad-dose").textContent = fmtNum(r.dose, 0);
    $("rad-limit").textContent = fmtNum(r.limit, 0);
    const pillEl = $("rad-pill");
    pillEl.className = "pill pill-" + r.level; pillEl.textContent = LEVEL_TEXT[r.level]; pillEl.title = r.reason;

    const bar = $("rad-bar");
    const pct = Math.min(100, r.pct);
    bar.className = "progress" + (r.level !== "ok" ? " is-" + r.level : "");
    bar.setAttribute("aria-valuenow", Math.round(pct));
    bar.firstElementChild.style.width = pct.toFixed(1) + "%";

    const daysLeft = r.ratePerDay > 0 ? Math.floor((r.limit - r.dose) / r.ratePerDay) : Infinity;
    $("rad-rate").textContent = Math.round(r.pct) + "% of limit · " + r.ratePerDay.toFixed(2) + " mSv/day (last 7 days)" +
      (isFinite(daysLeft) ? " · limit reached in about " + fmtNum(daysLeft, 0) + " days at this rate" : "");

    const info = state.swInfo;
    if (!info) { $("rad-sw").textContent = "Checking NASA space weather…"; return; }
    const src = { live: "Live NASA DONKI", backup: "Saved NASA DONKI data (offline)", demo: "Demo mode" }[info.source];
    const bits = [src + ": " + (info.sepActive ? "solar particle event in progress" : "no solar particle event")];
    if (info.strongestFlare) bits.push("strongest flare this week " + info.strongestFlare.class);
    if (info.radiationBeltAlert) bits.push("radiation-belt electrons elevated");
    $("rad-sw").textContent = bits.join(" · ") + ".";
  }

  function renderSpaceWeatherBanner() {
    const ev = CHM.getSpaceWeather();
    $("sw-banner").hidden = !(ev && ev.active);
    if (ev && ev.active) $("sw-text").textContent = ev.message;
  }

  // ----- Render: cabin -----
  function renderCabin() {
    const c = CHM.scoreCabin(CHM.getCabin());
    const p = $("cabin-pill");
    p.className = "pill pill-" + c.overall; p.textContent = LEVEL_TEXT[c.overall];
    $("cabin-strip").replaceChildren(...Object.keys(CHM.CABIN_LIMITS).map((k) => {
      const it = c[k];
      const dec = k === "humidity" ? 0 : 1;
      return el("div", { class: "cabin-item is-" + it.level }, [
        el("span", { class: "label", text: it.label }),
        el("span", { class: "value", text: fmtNum(it.value, dec) + " " + it.unit }),
      ]);
    }));
    return c;
  }

  // ----- Render: blood tests (NASA) -----
  function renderLabs() {
    const labs = state.score.labs || { draw: null, tests: [] };
    const body = $("labs-body");
    body.replaceChildren();

    if (!labs.draw) {
      $("labs-when").textContent = "No blood test yet this mission.";
      body.append(el("tr", { class: "labs-empty" }, [el("td", { colspan: 5, text: "No results" })]));
      return;
    }
    const d = labs.draw;
    const ago = day - d.day;
    $("labs-when").textContent = "Last draw: mission day " + d.day + (ago > 0 ? " (" + ago + " days ago)" : " (today)") +
      " · NASA sample " + d.nasa;

    const order = { cardio: 0, immune: 1, bone: 2 };
    let tests = labs.tests.slice().sort((a, b) =>
      (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) || (order[a.def.system] - order[b.def.system]));
    if (state.labsFlaggedOnly) tests = tests.filter((t) => t.level !== "ok");
    if (!tests.length) {
      body.append(el("tr", { class: "labs-empty" }, [el("td", { colspan: 5, text: "Nothing flagged on the last draw." })]));
      return;
    }

    tests.forEach((t) => {
      let compared;
      if (t.def.rule === "range") {
        if (t.min !== null && t.max !== null) compared = fmtNum(t.min) + "–" + fmtNum(t.max) + " " + t.def.unit + " (lab range)";
        else if (t.max !== null) compared = "below " + fmtNum(t.max) + " " + t.def.unit;
        else if (t.min !== null) compared = "above " + fmtNum(t.min) + " " + t.def.unit;
        else compared = "no range given";
      } else {
        compared = t.baseline
          ? "pre-flight avg " + fmtNum(t.baseline, 1) + " → " + fmtNum(t.fold, 1) + "×"
          : "no pre-flight value";
      }
      body.append(el("tr", { class: "is-" + t.level }, [
        el("td", {}, [el("span", { text: t.def.label }),
                      t.level !== "ok" ? el("span", { class: "lab-note", text: t.reason }) : ""]),
        el("td", { text: fmtNum(t.value) + " " + t.def.unit }),
        el("td", { class: "lab-system", text: compared }),
        el("td", { class: "lab-system", text: SYSTEM_NAME[t.def.system] || t.def.system }),
        el("td", {}, [t.suspectSample ? el("span", { class: "pill pill-info", title: t.reason, text: "Re-test" }) : pill(t.level, t.reason)]),
      ]));
    });
  }

  // ----- Render: suggested actions (tick off when done) -----
  function renderActions(cabinStatus) {
    const list = CHM.suggestActions(state.score, cabinStatus);
    const done = CHM.getActionsDone(crew.id, day);
    const ul = $("action-list");
    ul.replaceChildren();
    if (!list.length) {
      ul.append(el("li", { class: "action-none", text: "Nothing to do right now. Keep up the daily tests." }));
    }
    list.forEach((a) => {
      const id = "act-" + a.id;
      const isDone = done.includes(a.id);
      const box = el("input", { type: "checkbox", id, checked: isDone ? "checked" : null });
      box.addEventListener("change", () => {
        CHM.toggleActionDone(crew.id, day, a.id);
        renderActions(cabinStatus);
      });
      ul.append(el("li", { class: "action-item is-" + a.level + (isDone ? " is-done" : "") }, [box, el("label", { for: id, text: a.text })]));
    });
    const left = list.filter((a) => !done.includes(a.id)).length;
    $("actions-count").textContent = list.length ? left + " of " + list.length + " to do" : "";
  }

  // ----- Header line -----
  function renderOverall() {
    const score = state.score;
    const shown = score.vitals;
    const flaggedVitals = shown.filter((v) => v.level !== "ok");
    const flaggedLabs = (score.labs ? score.labs.tests : []).filter((t) => t.level !== "ok");
    const urgent = shown.some((v) => v.level === "danger") ||
      score.systems.some((s) => s.id === "radiation" && s.level === "danger");
    const parts = [];
    parts.push(flaggedVitals.length ? flaggedVitals.length + " vital" + (flaggedVitals.length > 1 ? "s" : "") + " to watch" : "All vitals within your normal");
    if (flaggedLabs.length) parts.push(flaggedLabs.length + " blood result" + (flaggedLabs.length > 1 ? "s" : "") + " flagged");
    $("overall-line").textContent = parts.join(" · ") + ". " + (urgent ? "Something needs action now." : "Nothing urgent.");
  }

  // ----- Report to flight surgeon (goes into the Comms queue) -----
  const reportKey = "vitalsReport:" + crew.id + ":" + day;
  function buildReport() {
    const s = state.score;
    const lines = ["Vitals report · " + crew.role + " (" + crew.id + ") · mission day " + day, ""];
    s.vitals.forEach((v) => {
      lines.push("- " + v.def.label + ": " + fmtVital(v.key, v.today) + " [" + LEVEL_TEXT[v.level] + "]" + (v.level !== "ok" ? " – " + v.reason : ""));
    });
    const r = s.systems.find((x) => x.id === "radiation");
    lines.push("- Radiation: " + fmtNum(r.dose, 0) + " of " + r.limit + " mSv (" + Math.round(r.pct) + "%) [" + LEVEL_TEXT[r.level] + "]");
    if (s.labs && s.labs.draw) {
      const flagged = s.labs.tests.filter((t) => t.level !== "ok");
      lines.push("", "Blood test, day " + s.labs.draw.day + ": " + (flagged.length ? "" : "all within limits"));
      flagged.forEach((t) => lines.push("- " + t.reason));
    }
    return lines.join("\n");
  }
  function renderReportButton() {
    const sent = CHM.store.get(reportKey, false);
    $("send-report").disabled = !!sent;
    $("report-status").textContent = sent
      ? "Sent to the Comms queue today. It reaches Earth about " + CHM.MISSION.oneWayDelayMin + " min after the next window."
      : "";
  }

  // ----- Everything -----
  function rescore() {
    state.score = CHM.scoreCrewMember(crew.id, {
      spaceWeather: CHM.getSpaceWeather(),
      symptoms: CHM.store.get("symptoms", CHM.SAMPLE_SYMPTOMS),
    });
  }
  function renderAll() {
    document.querySelectorAll(".range-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === state.range)));
    $("show-more").checked = state.showMore;
    renderSpaceWeatherBanner();
    renderOverall();
    renderVitals();
    renderDetail();
    renderRadiation();
    const cabin = renderCabin();
    renderLabs();
    renderActions(cabin);
    renderReportButton();
  }

  // ----- Events -----
  $("crew-role").textContent = crew.role + " (" + crew.id + ")";
  $("mission-day").textContent = "Mission day " + day;
  $("logout-btn").addEventListener("click", () => CHM.logout());

  document.querySelectorAll(".range-btn").forEach((btn) => btn.addEventListener("click", () => {
    state.range = btn.dataset.range;
    CHM.store.set("vitalsRange", state.range);
    renderAll();
  }));

  $("show-more").addEventListener("change", (e) => {
    state.showMore = e.target.checked;
    CHM.store.set("vitalsShowMore", state.showMore);
    if (!state.showMore && MORE_VITALS.includes(state.openKey)) state.openKey = null;
    renderAll();
  });

  $("labs-flagged-only").addEventListener("change", (e) => { state.labsFlaggedOnly = e.target.checked; renderLabs(); });

  function openRow(key) {
    state.openKey = state.openKey === key ? null : key;
    renderVitals();
    renderDetail();
    if (state.openKey) $("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  $("vitals-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr.vital-row");
    if (tr) openRow(tr.dataset.key);
  });
  $("vitals-body").addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr.vital-row");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openRow(tr.dataset.key); }
  });
  $("detail-close").addEventListener("click", () => {
    const key = state.openKey;
    state.openKey = null; renderVitals(); renderDetail();
    const row = document.querySelector('tr.vital-row[data-key="' + key + '"]');
    if (row) row.focus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.openKey) $("detail-close").click();
  });

  $("send-report").addEventListener("click", () => {
    CHM.addToQueue({
      kind: "vitals-report",
      from: crew.id,
      to: "Flight surgeon",
      subject: "Vitals report · day " + day,
      body: buildReport(),
      urgent: state.score.overall === "danger",
    });
    CHM.store.set(reportKey, true);
    renderReportButton();
  });

  // Deep link: vitals.html?vital=restingHR opens that chart (Home tiles can link here)
  const wanted = new URLSearchParams(location.search).get("vital");
  if (wanted && CHM.VITALS[wanted]) {
    state.openKey = wanted;
    if (MORE_VITALS.includes(wanted)) state.showMore = true;
  }

  // First draw with what we have, then again once space weather is checked
  rescore();
  renderAll();
  CHM.refreshSpaceWeather().then((info) => {
    state.swInfo = info;
    rescore();
    renderAll();
  });

})(window.CHM);