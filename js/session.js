// =========================================================
// session.js — who is checked in, plus small saved state
// (tests done, actions done, space weather) shared by pages.
// Everything is saved in the browser, so the app works offline.
// =========================================================

window.CHM = window.CHM || {};

(function (CHM) {

  const PREFIX = "chm:";

  // Safe storage: some browsers block localStorage on file://
  const memory = {};
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(PREFIX + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) {
        return key in memory ? memory[key] : fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
      catch (e) { memory[key] = value; }
    },
    remove(key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) { delete memory[key]; }
    },
  };
  CHM.store = store;

  // ----- Current crew member -----
  // Priority: ?crew=PLT in the URL → saved login → none.
  CHM.getCurrentCrewId = function () {
    const fromUrl = new URLSearchParams(location.search).get("crew");
    if (fromUrl && CHM.getCrew(fromUrl.toUpperCase())) {
      const id = fromUrl.toUpperCase();
      store.set("currentCrew", id);
      return id;
    }
    const saved = store.get("currentCrew", null);
    return saved && CHM.getCrew(saved) ? saved : null;
  };

  CHM.login = function (crewId, pin) {
    const crew = CHM.getCrew(crewId);
    if (!crew || crew.pin !== pin) return false;
    store.set("currentCrew", crewId);
    return true;
  };

  CHM.logout = function () {
    store.remove("currentCrew");
    location.href = "login.html";
  };

  // Call at the top of every page except login.
  // Sends the user to login.html if nobody is checked in.
  CHM.requireLogin = function () {
    const id = CHM.getCurrentCrewId();
    if (!id) {
      location.href = "login.html";
      return null;
    }
    return CHM.getCrew(id);
  };

  // ----- Tests completed today (Tests page writes, Home reads) -----
  function testsKey(crewId, day) { return "tests:" + crewId + ":" + day; }
  CHM.getTestsDone = function (crewId, day) { return store.get(testsKey(crewId, day), []); };
  CHM.markTestDone = function (crewId, day, testId) {
    const done = CHM.getTestsDone(crewId, day);
    if (!done.includes(testId)) done.push(testId);
    store.set(testsKey(crewId, day), done);
  };

  // ----- Suggested actions ticked off today -----
  function actionsKey(crewId, day) { return "actions:" + crewId + ":" + day; }
  CHM.getActionsDone = function (crewId, day) { return store.get(actionsKey(crewId, day), []); };
  CHM.toggleActionDone = function (crewId, day, actionId) {
    let done = CHM.getActionsDone(crewId, day);
    done = done.includes(actionId) ? done.filter((a) => a !== actionId) : done.concat(actionId);
    store.set(actionsKey(crewId, day), done);
    return done.includes(actionId);
  };

  // ----- Demo/testing: start one crew member's day again -----
  // Undoes everything this crew member did today on every page:
  //   tests done + results (Tests), actions ticked (Home/Vitals), vitals report sent,
  //   symptom reports (Symptoms), notes (History), shelter check-in, Medi-Bot chat,
  //   and their messages in the Comms queue, emergencies included.
  // Kept: the login, other crew members, the space weather event, the activity log.
  CHM.TEST_RESULT_KINDS = ["checkins", "sleep", "bp", "mass", "reaction"];   // saveResult() kinds in tests.js
  CHM.resetDay = function (crewId, day) {
    store.remove(testsKey(crewId, day));
    store.remove(actionsKey(crewId, day));
    store.remove("vitalsReport:" + crewId + ":" + day);
    CHM.TEST_RESULT_KINDS.forEach((kind) => {
      const key = kind + ":" + crewId;
      store.set(key, store.get(key, []).filter((r) => r.day !== day));
    });

    const notToday = (r) => !(r.crewId === crewId && r.day === day);
    store.set("symptoms", store.get("symptoms", []).filter(notToday));
    store.set("notes", store.get("notes", []).filter(notToday));
    store.set("shelterAcks", CHM.getShelterAcks().filter((id) => id !== crewId));
    store.remove("chat:" + crewId);   // Medi-Bot conversation (bot.js)

    // The mission day never changes, so everything in the queue is from today.
    // Also drops no-PIN emergencies raised about this crew member at check-in.
    store.set("queue", CHM.getQueue().filter((q) => queueOwner(q) !== crewId && ![].concat(q.about).includes(crewId)));
  };

  // Who a queue item belongs to (Comms reads "crew"; older items may only have "crewId")
  function queueOwner(q) { return q.crew !== undefined ? q.crew : q.crewId; }

  // ----- Space weather (DONKI). Shared by the whole crew. -----
  // { active: true, type: "SEP", message: "...", since: "ISO date" } or null
  CHM.getSpaceWeather = function () { return store.get("spaceWeather", null); };
  CHM.setSpaceWeather = function (event) { store.set("spaceWeather", event); };
  CHM.clearSpaceWeather = function () { store.remove("spaceWeather"); };

  // Crew members who have confirmed they are in the shelter
  CHM.getShelterAcks = function () { return store.get("shelterAcks", []); };
  CHM.ackShelter = function (crewId) {
    const acks = CHM.getShelterAcks();
    if (!acks.includes(crewId)) acks.push(crewId);
    store.set("shelterAcks", acks);
  };
  CHM.clearShelterAcks = function () { store.remove("shelterAcks"); };

  // ----- Outgoing queue to Earth (Comms page reads it) -----
  CHM.getQueue = function () { return store.get("queue", []); };
  CHM.addToQueue = function (item) {
    const q = CHM.getQueue();
    // Tag the sender so Comms, History and resetDay know whose item it is
    const crew = item.crew !== undefined ? item.crew : (item.crewId || CHM.getCurrentCrewId());
    q.push(Object.assign({ id: Date.now(), created: new Date().toISOString(), status: "waiting", crew: crew }, item));
    // urgent first
    q.sort((a, b) => (b.urgent === true) - (a.urgent === true));
    store.set("queue", q);
  };

})(window.CHM);