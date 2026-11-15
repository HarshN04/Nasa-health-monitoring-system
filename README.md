# Crew Health Monitor — Astronaut Health Monitoring System

Our entry for the **NASA Space Apps Challenge 2026 (Mauritius)**, challenge
*"Create Health Monitoring Software for Astronauts on Space Missions"*.

A tablet-style web app for a deep-space crew. Each astronaut checks in with a PIN,
sees their own health at a glance (**OK / Watch / Act now**), does short daily tests,
reports symptoms, and queues messages to the flight surgeon on Earth over a
delayed, on-and-off link. It runs fully offline in the browser: no server, no
libraries, no build step.

> ⚠️ This is a hackathon prototype, not a medical device. The app (and Medi-Bot)
> never diagnoses and never names or suggests medication. Anything serious points
> to the flight surgeon or the Emergency button.

---

## Quick start

1. Clone or download the repo.
2. Open `index.html` (it redirects to `login.html`).
   - For the PIN/encryption features (`secure.js` uses Web Crypto), serve the folder
     over `http://localhost` or `https://`, for example:
     ```bash
     python -m http.server 8000
     # then open http://localhost:8000
     ```
   - Opened straight from the folder (`file://`) everything else still works:
     data files are `.js`, not `.json`, for that reason.
3. Log in with a demo crew member (used until the tablet is set up on `setup.html`):

| Crew | Role | Demo PIN |
|------|------|----------|
| CDR | Commander | 1111 |
| PLT | Pilot | 2222 |
| MS1 | Specialist 1 | 3333 |
| MS2 | Specialist 2 | 4444 |

**Presenting tip:** add `?sep=1` to a page URL to force a solar particle event
(red banner, Radiation → Act now), or `?sep=0` to force none.

---

## Pages

| Page | File | What it does |
|------|------|--------------|
| Login | `login.html` | Pick crew member + 4-digit PIN. 5 wrong tries → 30 s wait, 10 → locked (reset with commander + recovery code). **No-PIN Emergency** for an incapacitated crew member. |
| Tablet setup | `setup.html` | One-time setup by the commander: a PIN per crew member, then recovery codes shown once. |
| Home | `home.html` | Overall status and one tile per system: Cardio, Bone & muscle, Immune, Behavioral, Radiation. Space-weather banner. |
| Vitals | `vitals.html` | Resting HR, HRV, SpO₂, blood pressure, skin temp, sleep (+ body mass, mood, reaction time) with 7 / 30 / all-day trend charts. |
| Tests | `tests.html` | Daily and weekly tests (mood check-in, sleep log, reaction time, BP, body mass, wellbeing quiz), plus a crew-state demo from real NASA physiological data. |
| Report a symptom | `symptoms.html` | Guided symptom report with severity, duration, and safe self-care steps only. |
| History & Notes | `history.html` | Timeline of alerts, symptoms, tests and messages, plus personal notes. |
| Comms to Earth | `comms.html` | Simulated delayed link (see below). |
| Medi-Bot | on every page | Robot button bottom-right opens a chat panel that explains *your own* data in plain words. Offline, rule-based, no AI. |

`template.html` is the starting point for a new page.

---

## How the scoring works (`js/scoring.js`, `js/labs.js`)

- Every astronaut is compared to **their own normal**: mean ± 2 SD of the first
  14 mission days (baseline).
- **Watch** = outside normal in the bad direction **3+ days in a row**.
- **Act now** = past a hard limit, or **4+ SD** from normal today.
- **Radiation** only adds up, so it is compared to the mission dose limit
  (Watch at 75 %, Act now at 100 % of 600 mSv).
- **Blood tests** (real NASA data): Watch if outside the lab's own range for that
  person, or ≥ 2× their pre-flight average when no range exists. If most of the
  crew are flagged on the same test and draw, the app says *re-test* (likely a
  sample problem). Labs alone never trigger Act now.

All thresholds live in `CHM.RULES` so they can be tuned in one place.

## Comms to Earth (`js/comms.js`)

- Sending only inside contact windows (02:20 and 14:20 UTC, 30 min each), at
  1,000 bytes/s in 4 KB chunks; unfinished items carry over to the next window.
- Urgent items go first, then oldest first. Repeated alerts are merged (×2, ×3…).
- Mood / behavioral items stay on board until the crew member presses Send.
- "Delivered" only once Earth's receipt is back (one-way delay × 2, 12 min each way).
- Every item is sealed for Earth with Web Crypto as soon as it is queued.

## Security (`js/secure.js`)

- PINs and recovery codes stored as salted PBKDF2 hashes (600,000 rounds).
- Messages sealed with Earth's public key. *Demo only:* the private key is kept on
  the tablet too, so the "Open as Earth" button can prove sealing works.
- Hash-chained activity log, so edits to past entries show up.
- All data stays in this browser (`localStorage`, prefix `chm:`).

---

## Data sources

| Data | Used for | Source |
|------|----------|--------|
| Inspiration4 blood tests (CBC, metabolic, cardiovascular & immune panels) | Lab layer on Home / Vitals | NASA OSDR [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569) (LSDS-7), [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575) (LSDS-8) → `data/crew-labs.js`, raw CSVs in `data/raw/` |
| Flight Crew Physiological Data for Crew State Monitoring (respiration + skin conductance, 68-min simulated flight) | Tests page crew-state demo | [data.nasa.gov](https://data.nasa.gov/dataset/flight-crew-physiological-data-for-crew-state-monitoring) → `data/crew-state-data.js` |
| DONKI space weather (solar particle events, flares) | Space-weather banner, Radiation | [CCMC DONKI API](https://ccmc.gsfc.nasa.gov/DONKI-API/get/) (live, no key) with offline fallback `data/space-weather-backup.js` |
| Daily vitals | Home, Vitals, Tests | **Simulated** in `js/data.js`, with a few problems built in so alerts have something to catch |

Note: DONKI moved off `api.nasa.gov/DONKI` on 30 Sep 2026; the app uses the new
CCMC address.

### Regenerating the crew-state data

```bash
pip install pandas numpy scipy
python tools/process_crew_data.py data/raw/5_LOFT.csv   # download the LOFT CSV first
# writes data/crew-state-data.js
```

---

## Project structure

```
├── index.html            → redirects to login.html
├── login.html  setup.html  home.html  vitals.html  tests.html
├── symptoms.html  history.html  comms.html  template.html
├── css/
│   ├── global.css        shared styles for app pages
│   ├── space.css         login / setup / comms screens
│   ├── bot.css           Medi-Bot
│   └── <page>.css        one file per page
├── js/
│   ├── data.js           mission, crew, systems, tests, simulated readings
│   ├── session.js        who is checked in + saved state (CHM.store)
│   ├── scoring.js        OK / Watch / Act now engine
│   ├── labs.js           blood-test scoring
│   ├── spaceweather.js   live DONKI + fallback
│   ├── secure.js         PINs, sealing, activity log
│   ├── emergency.js      no-PIN emergency
│   ├── bot.js            Medi-Bot
│   ├── space-bg.js       animated galaxy background
│   └── <page>.js         one file per page
├── data/                 generated data files + raw NASA CSVs
└── tools/
    └── process_crew_data.py
```

**Conventions:** each page has its own HTML, CSS and JS file, plus the shared
`global.css`. Everything hangs off one global object, `window.CHM`. Scripts load in
this order on every page:

```
space-bg.js → data.js → data/crew-labs.js → session.js → scoring.js → labs.js → <page>.js → bot.js
```

(Pages add `spaceweather.js`, `secure.js` etc. where needed; see each HTML file.)

---

## Team

NASA Space Apps Challenge 2026 — Mauritius.
