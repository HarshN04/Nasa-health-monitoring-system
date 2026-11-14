// =========================================================
// data.js — shared data for every page.
//
// Right now the readings are SIMULATED (realistic, with a few
// problems built in so the alerts have something to catch).
// On hackathon day, replace generateDailyReadings() with code
// that loads the NASA data (e.g. fetch("data/crew.json")) and
// keep the same shape: one object per day per crew member.
//
// Load order on every page:
//   data.js → session.js → scoring.js → <page>.js
// =========================================================

window.CHM = window.CHM || {};

(function (CHM) {

  // ----- Mission -----
  CHM.MISSION = {
    name: "Deep Space Transit",
    currentDay: 142,           // mission day shown in the app
    baselineDays: 14,          // days 1–14 build each person's "normal"
    oneWayDelayMin: 12,        // signal delay to Earth (Comms page)
    doseLimitMsv: 600,         // career limit, check against NASA-STD-3001
  };

  // ----- Crew roster (matches the Login screen) -----
  CHM.CREW = [
    { id: "CDR", role: "Commander",    short: "CDR", pin: "1111" },
    { id: "PLT", role: "Pilot",        short: "PLT", pin: "2222" },
    { id: "MS1", role: "Specialist 1", short: "MS1", pin: "3333" },
    { id: "MS2", role: "Specialist 2", short: "MS2", pin: "4444" },
  ];

  // ----- Body systems shown as tiles on Home -----
  CHM.SYSTEMS = [
    { id: "cardio",     name: "Cardio" },
    { id: "bone",       name: "Bone & muscle" },
    { id: "immune",     name: "Immune" },
    { id: "behavioral", name: "Behavioral" },
    { id: "radiation",  name: "Radiation" },
  ];

  // ----- Vitals: unit, which system, which direction is bad,
  //       minSd = smallest normal day-to-day spread (stops a very
  //       steady baseline from flagging tiny changes),
  //       and optional hard limits (always Act now past these) -----
  CHM.VITALS = {
    restingHR:    { label: "Resting heart rate",     unit: "bpm",  system: "cardio",     bad: "high", minSd: 3, decimals: 0 },
    hrv:          { label: "Heart rate variability", unit: "ms",   system: "cardio",     bad: "low",  minSd: 5, decimals: 0 },
    systolic:     { label: "Blood pressure (sys)",   unit: "mmHg", system: "cardio",     bad: "high", minSd: 5, decimals: 0, hardHigh: 160 },
    spo2:         { label: "Blood oxygen",           unit: "%",    system: "cardio",     bad: "low",  minSd: 1, decimals: 0, hardLow: 90 },
    bodyMass:     { label: "Body mass",              unit: "kg",   system: "bone",       bad: "low",  minSd: 0.5, decimals: 1 },
    skinTemp:     { label: "Skin temperature",       unit: "°C",   system: "immune",     bad: "high", minSd: 0.2, decimals: 1 },
    sleepHours:   { label: "Sleep",                  unit: "h",    system: "behavioral", bad: "low",  minSd: 0.5, decimals: 1 },
    mood:         { label: "Mood score",             unit: "/5",   system: "behavioral", bad: "low",  minSd: 0.3, decimals: 1 },
    reactionMs:   { label: "Reaction time",          unit: "ms",   system: "behavioral", bad: "high", minSd: 20, decimals: 0 },
  };

  // ----- Daily and weekly tests (Tests page uses the same list) -----
  CHM.TESTS = [
    { id: "mood",      name: "Mood and stress check-in",    minutes: 2, freq: "daily" },
    { id: "sleeplog",  name: "Sleep log",                   minutes: 1, freq: "daily" },
    { id: "reaction",  name: "Reaction-time test",          minutes: 3, freq: "daily" },
    { id: "bp",        name: "Blood pressure",              minutes: 3, freq: "weekly" },
    { id: "mass",      name: "Body mass",                   minutes: 2, freq: "weekly" },
    { id: "wellbeing", name: "Isolation and wellbeing quiz", minutes: 5, freq: "weekly" },
  ];
  CHM.WEEKLY_TEST_DAY = 0; // weekly tests are due when missionDay % 7 === 0

  // ----- Simulation -----
  // Small seeded random generator so everyone sees the same numbers.
  function seeded(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function noise(rand, size) { return (rand() + rand() + rand() - 1.5) * size; }

  // Each person's typical values, plus the problem built into their data.
  const PROFILES = {
    CDR: { restingHR: 62, hrv: 52, systolic: 116, spo2: 98, bodyMass: 78, skinTemp: 34.0, sleepHours: 7.0, mood: 4.2, reactionMs: 280, doseRate: 0.30,
           // last 4 days: heart rate creeping up, sleep short
           drift: (d, last) => (d > last - 4 ? { restingHR: +9, hrv: -9, sleepHours: -1.4 } : {}) },
    PLT: { restingHR: 58, hrv: 60, systolic: 112, spo2: 98, bodyMass: 72, skinTemp: 33.8, sleepHours: 7.3, mood: 4.4, reactionMs: 260, doseRate: 0.29,
           drift: () => ({}) },                                   // healthy
    MS1: { restingHR: 66, hrv: 45, systolic: 118, spo2: 97, bodyMass: 64, skinTemp: 34.1, sleepHours: 6.9, mood: 4.0, reactionMs: 300, doseRate: 0.34,
           // last 5 days: low mood, slower reactions
           drift: (d, last) => (d > last - 5 ? { mood: -1.0, reactionMs: +70, sleepHours: -0.9 } : {}) },
    MS2: { restingHR: 60, hrv: 55, systolic: 120, spo2: 98, bodyMass: 81, skinTemp: 33.9, sleepHours: 7.1, mood: 4.3, reactionMs: 275, doseRate: 0.36,
           // slow body-mass loss over the mission, faster recently
           drift: (d, last) => ({ bodyMass: -0.008 * d - (d > last - 10 ? 0.6 : 0) }) },
  };

  const NOISE = { restingHR: 1.5, hrv: 2.5, systolic: 2.5, spo2: 0.5, bodyMass: 0.25, skinTemp: 0.12, sleepHours: 0.25, mood: 0.15, reactionMs: 8 };

  function generateDailyReadings(crewId) {
    const p = PROFILES[crewId];
    const rand = seeded(crewId.charCodeAt(0) * 1000 + crewId.charCodeAt(2));
    const last = CHM.MISSION.currentDay;
    const days = [];
    let dose = 0;
    for (let d = 1; d <= last; d++) {
      const drift = p.drift(d, last);
      const row = { day: d };
      Object.keys(CHM.VITALS).forEach((k) => {
        row[k] = p[k] + (drift[k] || 0) + noise(rand, NOISE[k]);
      });
      row.spo2 = Math.min(100, row.spo2);
      row.mood = Math.max(1, Math.min(5, row.mood));
      dose += p.doseRate + noise(rand, 0.03);
      row.doseTotal = dose;                // mSv, cumulative
      days.push(row);
    }
    return days;
  }

  // Cabin environment, shared by the whole crew (EDA-style)
  CHM.CABIN_LIMITS = {
    co2:      { label: "CO₂",         unit: "mmHg", watchHigh: 4.0, dangerHigh: 6.0 },  // placeholders, verify
    temp:     { label: "Temperature", unit: "°C",   watchLow: 18, watchHigh: 27 },
    humidity: { label: "Humidity",    unit: "%",    watchLow: 25, watchHigh: 75 },
  };
  function generateCabin() {
    const rand = seeded(42);
    return { co2: 2.6 + rand() * 0.6, temp: 22 + rand(), humidity: 42 + rand() * 6 };
  }

  // ----- Public API used by the pages -----
  const cache = {};
  CHM.getReadings = function (crewId) {
    if (!cache[crewId]) cache[crewId] = generateDailyReadings(crewId);
    return cache[crewId];
  };
  CHM.getCabin = function () {
    if (!cache.cabin) cache.cabin = generateCabin();
    return cache.cabin;
  };
  CHM.getCrew = function (crewId) {
    return CHM.CREW.find((c) => c.id === crewId) || null;
  };

  // Symptom reports (the Symptoms page adds to this through storage)
  CHM.SAMPLE_SYMPTOMS = [
    { crewId: "CDR", day: 141, symptom: "Headache", severity: 2, resolved: true },
  ];

})(window.CHM);