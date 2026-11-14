// =========================================================
// bot.js — Medi-Bot, the crew health assistant.
//
// A small offline chatbot that explains the astronaut's OWN
// data in plain words. It does not use AI or the internet:
// every answer is built from the same numbers and rules the
// rest of the app uses (data.js + scoring.js + labs.js).
//
// Medi-Bot is NOT a doctor:
//  • it never names, suggests or doses medication
//  • it never says "you are fit" or diagnoses anything
//  • anything serious → flight surgeon / Emergency button
//
// Load order on every page (after the page's own script):
//   data.js → session.js → scoring.js → (labs.js) → <page>.js → bot.js
// and add  <link rel="stylesheet" href="css/bot.css">  in <head>.
// =========================================================

window.CHM = window.CHM || {};

(function (CHM) {

  const BOT_NAME = "Medi-Bot";
  const RANK = { ok: 0, watch: 1, danger: 2 };
  const LEVEL_WORD = { ok: "OK", watch: "Watch", danger: "Act now" };

  // Questions shown as buttons
  const SUGGESTIONS = [
    "Summarize my health this week.",
    "Why is my heart rate elevated?",
    "Is my fatigue related to my sleep?",
    "What should I do before my EVA?",
    "What if I skip sleep tonight?",
    "Am I fit for duty today?",
  ];

  // ---------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------
  function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

  // Pearson correlation (used for "does short sleep go with slow reactions?")
  function correlation(a, b) {
    const ma = mean(a), mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  // "6 h 40 min" for sleep, "63 bpm" for the rest
  function fmt(key, value) {
    const def = CHM.VITALS[key];
    if (key === "sleepHours") {
      const h = Math.floor(value);
      const m = Math.round((value - h) * 60);
      return m === 60 ? (h + 1) + " h" : h + " h " + String(m).padStart(2, "0") + " min";
    }
    return value.toFixed(def.decimals) + (def.unit === "%" || def.unit === "/5" ? "" : " ") + def.unit;
  }
  function fmtRange(key, b) {
    const def = CHM.VITALS[key];
    if (key === "sleepHours") return b.low.toFixed(1) + "–" + b.high.toFixed(1) + " h";
    return b.low.toFixed(def.decimals) + "–" + b.high.toFixed(def.decimals) + (def.unit === "%" || def.unit === "/5" ? "" : " ") + def.unit;
  }
  function lc(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  // Is a value on the bad side of the person's normal range?
  function offNormal(key, value, b) {
    const bad = CHM.VITALS[key].bad;
    return bad === "high" ? value > b.high : bad === "low" ? value < b.low : (value > b.high || value < b.low);
  }

  // ---------------------------------------------------------
  // Everything Medi-Bot knows right now (fresh each question)
  // ---------------------------------------------------------
  function snapshot(crewId) {
    const symptoms = (CHM.store.get("symptoms", []) || []).concat(CHM.SAMPLE_SYMPTOMS || []);
    const spaceWeather = CHM.getSpaceWeather ? CHM.getSpaceWeather() : null;
    const score = CHM.scoreCrewMember(crewId, { spaceWeather: spaceWeather, symptoms: symptoms });
    const cabin = CHM.scoreCabin ? CHM.scoreCabin(CHM.getCabin()) : null;
    const readings = score.readings;
    const vital = (key) => score.vitals.find((v) => v.key === key);
    const day = CHM.MISSION.currentDay;
    const openSymptoms = symptoms.filter((s) => s.crewId === crewId && !s.resolved && s.day >= day - 2);
    const actions = CHM.suggestActions(score, cabin);
    const tests = CHM.testsDueToday ? CHM.testsDueToday(crewId) : [];
    return {
      crew: CHM.getCrew(crewId), score, cabin, readings, vital, day, spaceWeather,
      openSymptoms, actions, tests,
      week: readings.slice(-7),
      radiation: score.systems.find((s) => s.id === "radiation"),
      flagged: score.vitals.filter((v) => v.level !== "ok").sort((a, b) => RANK[b.level] - RANK[a.level]),
    };
  }

  // Average of the last n days for one vital
  function recentAvg(s, key, n) { return mean(s.readings.slice(-n).map((r) => r[key])); }

  // Sleep debt over the last 7 nights, against their own normal
  function sleepDebt(s) {
    const b = s.vital("sleepHours").baseline;
    return s.week.reduce((sum, r) => sum + Math.max(0, b.mean - r.sleepHours), 0);
  }

  // One line describing a vital today: value, normal range, status
  function vitalLine(s, key) {
    const v = s.vital(key);
    const word = v.level === "ok" ? "within your normal" : lc(v.reason.replace(v.def.label + " ", ""));
    return { level: v.level, text: "**" + v.def.label + ":** " + fmt(key, v.today) + " (" + word + "; normal " + fmtRange(key, v.baseline) + ")" };
  }

  // ---------------------------------------------------------
  // Answers. Each returns a list of blocks:
  //   { p: "text with **bold**" }
  //   { list: [{ level, text }] }   (level = ok/watch/danger/info)
  //   { links: [{ href, text }] }
  //   { note: "small grey text" }
  // ---------------------------------------------------------
  const SURGEON = { note: "Medi-Bot is a monitoring aid, not a doctor. For medical decisions, talk to the flight surgeon." };

  function answerSummary(s) {
    const out = [];
    const overall = s.score.overall;
    const head = overall === "ok"
      ? "This week looks steady. Everything is within your own normal range."
      : overall === "watch"
        ? "Mostly steady this week, with " + s.score.systems.filter((x) => x.level !== "ok").length + " area(s) to watch."
        : "Something needs attention **now**. See the red item below.";
    out.push({ p: "**Your week (days " + s.week[0].day + "–" + s.day + "):** " + head });

    out.push({ list: s.score.systems.map((sys) => ({ level: sys.level, text: "**" + sys.name + ":** " + sys.reason })) });

    const avgLine = (key) => {
      const b = s.vital(key).baseline;
      const avg = recentAvg(s, key, 7);
      const diff = avg - b.mean;
      const dir = Math.abs(diff) < b.sd * 0.5 ? "about your usual" : (diff > 0 ? "above" : "below") + " your usual " + fmt(key, b.mean);
      return CHM.VITALS[key].label + " averaged " + fmt(key, avg) + ", " + dir;
    };
    out.push({ p: "7-day averages: " + ["restingHR", "sleepHours", "mood"].map(avgLine).join(". ") + "." });

    if (s.actions.length) {
      out.push({ p: "**Suggested next steps:**" });
      out.push({ list: s.actions.slice(0, 4).map((a) => ({ level: a.level, text: a.text })) });
    }
    const due = s.tests.filter((t) => !t.done);
    if (due.length) out.push({ p: "You still have " + due.length + " test(s) due today." });
    out.push({ links: [{ href: "vitals.html", text: "Open Vitals" }, { href: "history.html", text: "Open History" }] });
    return out;
  }

  function answerHeartRate(s) {
    const hr = s.vital("restingHR");
    const out = [];
    const elevated = offNormal("restingHR", hr.today, hr.baseline);

    if (!elevated && hr.level === "ok") {
      out.push({ p: "Your resting heart rate today is **" + fmt("restingHR", hr.today) + "**, which is inside your normal range (" +
        fmtRange("restingHR", hr.baseline) + "). It isn't elevated by your own standard." });
      out.push({ p: "If it *feels* fast right now, re-measure after 10 minutes of quiet rest. Exercise, caffeine, stress and not drinking enough water can all raise it for a while." });
      return out;
    }

    out.push({ p: "Your resting heart rate today is **" + fmt("restingHR", hr.today) + "**, against your usual " + fmt("restingHR", hr.baseline.mean) +
      (hr.streak > 1 ? ". It has been above your normal for **" + hr.streak + " days in a row**." : ".") });

    // Look for things in the data that often go along with a raised heart rate
    const clues = [];
    const sleep = s.vital("sleepHours");
    const sleep3 = recentAvg(s, "sleepHours", 3);
    if (sleep3 < sleep.baseline.low) clues.push({ level: "watch", text: "**Short sleep:** you averaged " + fmt("sleepHours", sleep3) + " over the last 3 nights (usual " + fmt("sleepHours", sleep.baseline.mean) + "). Poor sleep commonly raises resting heart rate." });
    const hrv = s.vital("hrv");
    if (offNormal("hrv", hrv.today, hrv.baseline)) clues.push({ level: "watch", text: "**Low heart rate variability** (" + fmt("hrv", hrv.today) + "). That often means your body hasn't fully recovered, from stress, workload or poor sleep." });
    const temp = s.vital("skinTemp");
    if (offNormal("skinTemp", temp.today, temp.baseline)) clues.push({ level: "watch", text: "**Skin temperature is up** (" + fmt("skinTemp", temp.today) + "). If you feel unwell, report a symptom." });
    if (s.openSymptoms.length) clues.push({ level: "watch", text: "**Recent symptom:** " + s.openSymptoms.map((x) => x.symptom.toLowerCase()).join(", ") + "." });
    if (s.cabin && s.cabin.co2.level !== "ok") clues.push({ level: s.cabin.co2.level, text: "**Cabin CO₂ is high** (" + s.cabin.co2.value.toFixed(1) + " mmHg)." });
    const mood = s.vital("mood");
    if (offNormal("mood", mood.today, mood.baseline)) clues.push({ level: "watch", text: "**Mood score is low** (" + fmt("mood", mood.today) + "). Stress can show up in your heart rate." });

    if (clues.length) {
      out.push({ p: "Things in your data that **may** be linked:" });
      out.push({ list: clues });
    } else {
      out.push({ p: "I can't see an obvious link in your other readings. Things that commonly raise it, like hydration, exercise timing, caffeine and stress, aren't tracked here." });
    }
    out.push({ p: "**What you can do:** " + CHM.ACTIONS.restingHR + "." + (clues.some((c) => c.text.indexOf("Short sleep") > -1) ? " " + CHM.ACTIONS.sleepHours + "." : "") });
    if (hr.level === "danger") out.push({ p: "⚠ This is far outside your normal. **Contact the flight surgeon now**, or use the Emergency button if you feel chest pain, dizziness or shortness of breath." });
    else if (hr.level === "watch") out.push({ p: "Because it has lasted " + hr.streak + " days, it's worth flagging to the flight surgeon at your next comms window." });
    out.push({ links: [{ href: "vitals.html", text: "See heart rate trend" }, { href: "comms.html", text: "Message flight surgeon" }] });
    out.push(SURGEON);
    return out;
  }

  function answerFatigueSleep(s) {
    const out = [];
    const sleep = s.vital("sleepHours");
    const sleep7 = recentAvg(s, "sleepHours", 7);
    const debt = sleepDebt(s);
    const shortSleep = sleep7 < sleep.baseline.mean - sleep.baseline.sd || recentAvg(s, "sleepHours", 3) < sleep.baseline.low;

    // Fatigue signs we can measure: slower reactions, lower mood
    const reaction = s.vital("reactionMs");
    const mood = s.vital("mood");
    const signs = [];
    if (offNormal("reactionMs", reaction.today, reaction.baseline)) signs.push({ level: reaction.level === "ok" ? "watch" : reaction.level, text: "**Reaction time** is slower: " + fmt("reactionMs", reaction.today) + " (usual " + fmt("reactionMs", reaction.baseline.mean) + ")" });
    if (offNormal("mood", mood.today, mood.baseline)) signs.push({ level: mood.level === "ok" ? "watch" : mood.level, text: "**Mood score** is lower: " + fmt("mood", mood.today) + " (usual " + fmt("mood", mood.baseline.mean) + ")" });

    // Do short nights line up with slow reactions over the last 2 weeks?
    const last14 = s.readings.slice(-14);
    const r = correlation(last14.map((x) => x.sleepHours), last14.map((x) => x.reactionMs));

    out.push({ p: "**Sleep:** you averaged " + fmt("sleepHours", sleep7) + " a night this week, against your usual " + fmt("sleepHours", sleep.baseline.mean) +
      (debt >= 1 ? ". That's about **" + debt.toFixed(1) + " h of sleep debt** over 7 nights." : ".") });
    if (signs.length) { out.push({ p: "**Fatigue signs in your data:**" }); out.push({ list: signs }); }

    if (shortSleep && signs.length) {
      out.push({ p: "**Likely yes.** Your sleep dropped and your fatigue signs got worse at the same time" +
        (r < -0.4 ? ". Over the last 2 weeks, your shorter nights were followed by slower reaction times." : ".") +
        " Fixing sleep is the first thing to try." });
    } else if (shortSleep) {
      out.push({ p: "**Possibly.** You're short on sleep, but your reaction time and mood are still in your normal range. Sleep is still the first thing to fix, before it starts to show." });
    } else if (signs.length) {
      out.push({ p: "**Probably not mainly sleep.** Your sleep looks normal, so the fatigue may have another cause, such as workload, stress, cabin CO₂ or getting ill. Reporting a symptom helps the flight surgeon see the full picture." });
    } else {
      out.push({ p: "Your sleep and fatigue measures all look normal. If you still *feel* tired, that's worth logging. How you feel counts even when the numbers look fine." });
    }

    const steps = [];
    if (shortSleep) steps.push({ level: "info", text: CHM.ACTIONS.sleepHours });
    if (signs.some((x) => x.text.indexOf("Reaction") > -1)) steps.push({ level: "info", text: CHM.ACTIONS.reactionMs });
    if (signs.some((x) => x.text.indexOf("Mood") > -1)) steps.push({ level: "info", text: CHM.ACTIONS.mood });
    if (steps.length) { out.push({ p: "**What you can do:**" }); out.push({ list: steps }); }
    out.push({ links: [{ href: "tests.html", text: "Log sleep / reaction test" }, { href: "symptoms.html", text: "Report fatigue" }] });
    out.push(SURGEON);
    return out;
  }

  function answerEva(s) {
    const out = [];
    const check = [];
    const radiation = s.radiation;

    if (s.spaceWeather && s.spaceWeather.active) {
      out.push({ p: "⚠ **A solar particle event is active. No EVA.** Stay in the shielded area until the all-clear." });
    }

    out.push({ p: "Here's your **pre-EVA health check** from today's readings:" });
    ["restingHR", "systolic", "spo2", "skinTemp", "reactionMs"].forEach((k) => check.push(vitalLine(s, k)));
    const lastNight = s.readings[s.readings.length - 1].sleepHours;
    const sleepB = s.vital("sleepHours").baseline;
    check.push({ level: lastNight < sleepB.low ? "watch" : "ok", text: "**Sleep last night:** " + fmt("sleepHours", lastNight) + (lastNight < sleepB.low ? ", short. EVAs are long and demanding." : ", fine.") });
    check.push({ level: radiation.level, text: "**Radiation:** " + radiation.dose.toFixed(0) + " of " + radiation.limit + " mSv (" + Math.round(radiation.pct) + "% of your mission limit)" });
    if (s.cabin) check.push({ level: s.cabin.co2.level, text: "**Cabin CO₂:** " + s.cabin.co2.value.toFixed(1) + " mmHg" });
    if (s.openSymptoms.length) check.push({ level: "watch", text: "**Open symptom:** " + s.openSymptoms.map((x) => x.symptom.toLowerCase()).join(", ") });
    out.push({ list: check });

    const issues = check.filter((c) => c.level !== "ok");
    out.push({ p: issues.length
      ? "**" + issues.length + " item(s) flagged.** Send these to the flight surgeon before the EVA go/no-go."
      : "Nothing flagged in your health data." });

    out.push({ p: "**General prep** (always follow your mission's EVA procedures first):" });
    out.push({ list: [
      { level: "info", text: "Drink water and eat beforehand. EVAs can last 6 to 8 hours." },
      { level: "info", text: "Do your prebreathe protocol exactly as scheduled by mission control." },
      { level: "info", text: "Do suit and tether checks with your EVA buddy." },
      { level: "info", text: "Check the space weather forecast before you go out." },
      { level: "info", text: "Tell the crew how you're feeling. Mention even small things, like a headache or tiredness." },
    ] });
    out.push({ note: "The EVA go/no-go is decided by the flight surgeon and flight director, not by Medi-Bot." });
    return out;
  }

  function answerSkipSleep(s) {
    const out = [];
    const debt = sleepDebt(s);
    const reaction = s.vital("reactionMs");
    const already = debt >= 2 || offNormal("reactionMs", reaction.today, reaction.baseline);

    out.push({ p: "Missing a night's sleep usually means that the next day:" });
    out.push({ list: [
      { level: "watch", text: "**Slower reactions and more attention lapses.** Studies compare it to being slightly drunk." },
      { level: "watch", text: "**Poorer judgment and memory**, which matters for complex or critical tasks." },
      { level: "watch", text: "**Lower mood and more irritability**, which can cause friction in a small crew." },
      { level: "watch", text: "**Higher resting heart rate and weaker immunity** if it keeps happening." },
    ] });
    out.push({ p: already
      ? "**For you it would hit harder:** you already have about " + debt.toFixed(1) + " h of sleep debt this week" +
        (offNormal("reactionMs", reaction.today, reaction.baseline) ? ", and your reaction time is already slower than usual." : ".")
      : "Your sleep has been close to normal this week, so you'd recover faster than if you were already short. One night still has a real cost." });
    out.push({ p: "**My suggestion:** don't skip it if you can avoid it. If the schedule forces it, tell the flight director and flight surgeon, avoid EVA and other critical tasks the next day, and get back to your normal sleep window as soon as you can." });
    out.push({ list: [{ level: "info", text: CHM.ACTIONS.sleepHours }] });
    out.push(SURGEON);
    return out;
  }

  function answerFitForDuty(s) {
    const out = [];
    const problems = s.score.systems.filter((x) => x.level !== "ok").sort((a, b) => RANK[b.level] - RANK[a.level]);
    const due = s.tests.filter((t) => !t.done);

    if (!problems.length) {
      out.push({ p: "**Nothing in your data needs review today.** All your body systems are within your own normal range." });
    } else {
      const danger = problems.some((p) => p.level === "danger");
      out.push({ p: danger
        ? "⚠ **There's an Act now item.** Talk to the flight surgeon **before** starting critical tasks today."
        : "**" + problems.length + " area(s) should be reviewed** before you take on demanding tasks:" });
      out.push({ list: problems.map((p) => ({ level: p.level, text: "**" + p.name + ":** " + p.reason })) });
    }
    if (due.length) out.push({ p: "You haven't done " + due.length + " of today's tests yet (" + due.map((t) => t.name.toLowerCase()).join(", ") + "). Finishing them gives a more complete picture." });
    out.push({ links: [{ href: "tests.html", text: "Do today's tests" }, { href: "comms.html", text: "Message flight surgeon" }] });
    out.push({ note: "I can't clear you for duty. Medi-Bot only reports your data, and the fit-for-duty decision belongs to the flight surgeon." });
    return out;
  }

  // "What's my blood pressure?" etc.
  const VITAL_WORDS = {
    restingHR: /heart ?rate|pulse|\bbpm\b|\bhr\b/,
    hrv: /\bhrv\b|variability/,
    systolic: /blood pressure|\bbp\b|systolic/,
    spo2: /oxygen|spo2|sp02|saturation/,
    bodyMass: /weight|body ?mass|\bmass\b/,
    skinTemp: /temp|fever/,
    sleepHours: /sleep/,
    mood: /mood|stress|feel(ing)? (down|low|sad)/,
    reactionMs: /reaction/,
  };
  function answerVital(s, key) {
    const v = s.vital(key);
    const week = s.week.map((r) => r[key]);
    const trend = week[week.length - 1] - week[0];
    const out = [];
    out.push({ list: [vitalLine(s, key)] });
    out.push({ p: "Over the last 7 days it went from " + fmt(key, week[0]) + " to " + fmt(key, week[week.length - 1]) +
      (Math.abs(trend) < v.baseline.sd ? ", fairly steady." : trend > 0 ? ", trending up." : ", trending down.") });
    if (v.level !== "ok") out.push({ p: "**Suggested:** " + CHM.ACTIONS[key] + "." });
    out.push({ links: [{ href: "vitals.html", text: "See full trend" }] });
    return out;
  }

  function answerRadiation(s) {
    const r = s.radiation;
    const out = [{ list: [{ level: r.level, text: "**Radiation dose:** " + r.dose.toFixed(0) + " of " + r.limit + " mSv (" + Math.round(r.pct) + "% of your mission limit), about " + r.ratePerDay.toFixed(2) + " mSv a day" }] }];
    if (s.spaceWeather && s.spaceWeather.active) out.push({ p: "⚠ **A solar particle event is active.** " + CHM.ACTIONS.shelter + "." });
    return out;
  }

  // ---------------------------------------------------------
  // Safety answers
  // ---------------------------------------------------------
  function answerMedication() {
    return [
      { p: "I can't recommend, name or dose any medication. I'm not a doctor, and medicines in space need the flight surgeon's approval." },
      { p: "Tell the flight surgeon what you're feeling. They can tell you what's safe to take from the onboard medical kit." },
      { links: [{ href: "comms.html", text: "Message flight surgeon" }, { href: "symptoms.html", text: "Report a symptom" }] },
    ];
  }
  function answerEmergency() {
    return [
      { p: "⚠ **This sounds urgent. Press the red Emergency button now** and alert your crewmates." },
      { p: "Don't wait for a chat reply. I can't help with emergencies." },
      { links: [{ href: "symptoms.html?emergency=1", text: "Start emergency" }] },
    ];
  }
  function answerHelp(s) {
    return [
      { p: "Hello, " + s.crew.role + "! I'm " + BOT_NAME + ". I explain your health data in plain words. Ask me about your week, heart rate, sleep and fatigue, EVA prep or a single reading, like blood pressure or radiation." },
      { note: "I'm not a doctor: I can't diagnose, clear you for duty or suggest medication." },
    ];
  }
  function answerFallback() {
    return [{ p: "Sorry, I didn't catch that. I can answer questions about your own readings. Try one of these:" }, { suggest: true }];
  }

  // ---------------------------------------------------------
  // Working out what was asked (simple keyword matching)
  // ---------------------------------------------------------
  function reply(text, crewId) {
    const q = " " + text.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ") + " ";
    const s = snapshot(crewId);

    if (/chest pain|cant breathe|can not breathe|cannot breathe|short(ness)? of breath|faint(ed|ing)?|unconscious|passed out|bleeding|seizure|emergency/.test(q)) return answerEmergency();
    if (/\b(meds?|medic(ation|ine)s?|pills?|tablets?|drugs?|dosage|prescri\w*|ibuprofen|paracetamol|acetaminophen|aspirin|melatonin|antibiotics?|painkillers?|sleeping pills?|diagnos\w*)\b/.test(q) ||
        (/\bdose\b/.test(q) && !/radiation|msv|sievert/.test(q))) return answerMedication();
    if (/skip|miss|stay up|all ?nighter|no sleep|without sleep|pull an/.test(q) && /sleep|night|all ?nighter/.test(q)) return answerSkipSleep(s);
    if (/\beva\b|spacewalk|space walk|extravehicular/.test(q)) return answerEva(s);
    if (/fit for|\bfit\b|duty|ready (for|to) work|cleared|good to go/.test(q)) return answerFitForDuty(s);
    if (/summar|this week|overview|how am i|how is my health|hows my health|my health|status/.test(q)) return answerSummary(s);
    if (/fatigue|tired|exhaust|sleepy|drowsy|no energy|worn out/.test(q)) return answerFatigueSleep(s);
    if (/(heart ?rate|pulse|\bhr\b|heart).*(high|elevat|up|fast|racing|raised)|(high|elevat|fast|racing|raised).*(heart ?rate|pulse|\bhr\b)|why.*(heart|pulse)/.test(q)) return answerHeartRate(s);
    if (/radiation|\bdose\b|msv|solar|space weather/.test(q)) return answerRadiation(s);
    for (const key of Object.keys(VITAL_WORDS)) {
      if (VITAL_WORDS[key].test(q)) return key === "sleepHours" && /relat|cause|because|why/.test(q) ? answerFatigueSleep(s) : answerVital(s, key);
    }
    if (/\b(hi|hello|hey|help|what can you do|who are you)\b/.test(q)) return answerHelp(s);
    if (/\b(thanks|thank you|thx|cheers)\b/.test(q)) return [{ p: "You're welcome. Take care up there! 🚀" }];
    return answerFallback();
  }

  // ---------------------------------------------------------
  // Building the panel
  // ---------------------------------------------------------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "text") node.textContent = v;
      else if (k === "class") node.className = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => node.append(c));
    return node;
  }

  // "**bold** text" → safe DOM nodes (no innerHTML)
  function rich(text) {
    const frag = document.createDocumentFragment();
    text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).forEach((part) => {
      if (/^\*\*.+\*\*$/.test(part)) frag.append(el("strong", { text: part.slice(2, -2) }));
      else if (/^\*.+\*$/.test(part)) frag.append(el("em", { text: part.slice(1, -1) }));
      else if (part) frag.append(document.createTextNode(part));
    });
    return frag;
  }

  const ROBOT_SVG =
    '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
      '<line x1="24" y1="5" x2="24" y2="12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
      '<circle cx="24" cy="5" r="3" fill="var(--red)"/>' +
      '<ellipse cx="24" cy="29" rx="19" ry="14" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
      '<rect x="12" y="21" width="24" height="15" rx="7.5" fill="currentColor" opacity=".16"/>' +
      '<circle cx="18.5" cy="28" r="3.2" fill="currentColor"/><circle cx="29.5" cy="28" r="3.2" fill="currentColor"/>' +
      '<path d="M20 33.5q4 2.6 8 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<line x1="3.5" y1="28" x2="5" y2="28" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
      '<line x1="43" y1="28" x2="44.5" y2="28" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
    '</svg>';

  function init() {
    if (!CHM.getCurrentCrewId || !CHM.scoreCrewMember) return; // needs session.js + scoring.js
    const crewId = CHM.getCurrentCrewId();
    if (!crewId) return;                                          // not logged in → no bot

    const HISTORY_KEY = "chat:" + crewId;
    const OPEN_KEY = "chatOpen";

    // ----- Floating robot button -----
    const fab = el("button", { type: "button", class: "chat-fab", "aria-controls": "chat-panel", "aria-expanded": "false", "aria-label": "Open " + BOT_NAME + " assistant", title: "Ask " + BOT_NAME });
    fab.innerHTML = ROBOT_SVG;

    // ----- Side panel -----
    const log = el("div", { class: "chat-log", id: "chat-log", role: "log", "aria-live": "polite", "aria-label": "Conversation" });
    const input = el("input", { type: "text", class: "chat-input", id: "chat-input", placeholder: "Type a question…", autocomplete: "off", maxlength: "300", "aria-label": "Message " + BOT_NAME });
    const send = el("button", { type: "submit", class: "chat-send", "aria-label": "Send" });
    send.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    const form = el("form", { class: "chat-form" }, [input, send]);
    const close = el("button", { type: "button", class: "chat-close", "aria-label": "Close " + BOT_NAME });
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const clear = el("button", { type: "button", class: "chat-clear", text: "Clear" });
    const avatar = el("span", { class: "chat-avatar", "aria-hidden": "true" });
    avatar.innerHTML = ROBOT_SVG;

    const panel = el("aside", { class: "chat-panel", id: "chat-panel", "aria-label": BOT_NAME + " assistant", hidden: "" }, [
      el("header", { class: "chat-head" }, [
        avatar,
        el("div", { class: "chat-title" }, [
          el("strong", { text: BOT_NAME }),
          el("span", { text: "Health assistant · offline" }),
        ]),
        clear, close,
      ]),
      log,
      el("div", { class: "chat-foot" }, [
        form,
        el("p", { class: "chat-disclaimer", text: "Not a doctor. No diagnoses or medication advice. For medical decisions, contact the flight surgeon." }),
      ]),
    ]);

    document.body.append(fab, panel);

    // ----- Rendering messages -----
    function renderBot(blocks) {
      const msg = el("div", { class: "chat-msg chat-bot" });
      blocks.forEach((b) => {
        if (b.p) msg.append(el("p", {}, [rich(b.p)]));
        if (b.note) msg.append(el("p", { class: "chat-note", text: b.note }));
        if (b.list) {
          msg.append(el("ul", { class: "chat-list" }, b.list.map((item) =>
            el("li", { class: "lvl-" + item.level }, [
              el("span", { class: "chat-dot", title: LEVEL_WORD[item.level] || "", "aria-label": LEVEL_WORD[item.level] ? LEVEL_WORD[item.level] + ":" : "" }),
              el("span", {}, [rich(item.text)]),
            ]))));
        }
        if (b.links) msg.append(el("div", { class: "chat-links" }, b.links.map((l) => el("a", { href: l.href, class: "chat-link", text: l.text + " →" }))));
        if (b.suggest) msg.append(suggestionChips());
      });
      log.append(msg);
    }
    function renderUser(text) { log.append(el("div", { class: "chat-msg chat-user", text: text })); }

    function suggestionChips() {
      return el("div", { class: "chat-suggest" }, SUGGESTIONS.map((q) => {
        const b = el("button", { type: "button", class: "chip chat-chip", text: q });
        b.addEventListener("click", () => ask(q));
        return b;
      }));
    }

    function scrollDown() { log.scrollTop = log.scrollHeight; }

    // ----- History (kept per crew member, so it survives page changes) -----
    let history = CHM.store.get(HISTORY_KEY, []);   // [{ from: "user", text }]
    function save() { CHM.store.set(HISTORY_KEY, history.slice(-40)); }

    function greet() {
      renderBot(answerHelp(snapshot(crewId)).concat([{ p: "Try asking:" }, { suggest: true }]));
    }
    function restore() {
      log.textContent = "";
      greet();
      // Only questions are saved; answers are rebuilt from today's data
      history.forEach((h) => {
        renderUser(h.text);
        try { renderBot(reply(h.text, crewId)); } catch (e) { console.error(e); }
      });
      scrollDown();
    }

    // ----- Asking a question -----
    let busy = false;
    function ask(text) {
      text = text.trim();
      if (!text || busy) return;
      busy = true;
      renderUser(text);
      history.push({ from: "user", text: text });
      save();
      input.value = "";
      const typing = el("div", { class: "chat-msg chat-bot chat-typing", "aria-label": BOT_NAME + " is typing" }, [el("span"), el("span"), el("span")]);
      log.append(typing);
      scrollDown();
      setTimeout(() => {
        typing.remove();
        let blocks;
        try { blocks = reply(text, crewId); }
        catch (e) { console.error(e); blocks = [{ p: "Sorry, I couldn't read your data just now. Please try again or check the Vitals page." }]; }
        renderBot(blocks);
        scrollDown();
        busy = false;
        input.focus();
      }, 450);
    }

    form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });

    // ----- Open / close -----
    function setOpen(open, focus) {
      panel.hidden = !open;
      document.body.classList.toggle("chat-open", open);
      fab.setAttribute("aria-expanded", String(open));
      CHM.store.set(OPEN_KEY, open);
      if (open) { scrollDown(); if (focus) input.focus(); }
      else if (focus) fab.focus();
    }
    fab.addEventListener("click", () => setOpen(true, true));
    close.addEventListener("click", () => setOpen(false, true));
    clear.addEventListener("click", () => { history = []; save(); restore(); input.focus(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden && panel.contains(document.activeElement)) setOpen(false, true);
    });

    restore();
    if (CHM.store.get(OPEN_KEY, false)) setOpen(true, false); // stay open when moving between pages
  }

  // Expose for testing in the console: CHM.chatReply("Am I fit for duty today?")
  CHM.chatReply = function (text, crewId) { return reply(text, crewId || CHM.getCurrentCrewId()); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.CHM);