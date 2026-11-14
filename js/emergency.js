// =========================================================
// emergency.js — raise an emergency WITHOUT a PIN.
// Used by the Login screen so any crew member can call for help when
// someone is incapacitated and cannot check in themselves.
// Load order: data.js → session.js → secure.js → emergency.js → <page>.js
//
// The emergency goes into the same outgoing queue as the Comms page
// (CHM.store "queue"), marked urgent, so it is sent first in the next
// contact window. It is sealed for Earth when the tablet is set up, and
// written to the activity log as "raised without PIN".
// =========================================================

window.CHM = window.CHM || {};

(function (CHM) {
  "use strict";

  var EVERYONE = "CREW";

  // Things the reporter can tick (one), shown on the Login emergency form.
  CHM.EMERGENCY_REASONS = [
    "Unconscious / not responding",
    "Not breathing normally",
    "Severe bleeding",
    "Chest pain",
    "Seizure",
    "Other"
  ];

  // about: "PLT", "CREW" (several / not sure who) or a list like ["PLT", "MS1"]
  function nameFor(about) {
    if (Array.isArray(about)) {
      var names = about.map(nameFor);
      return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    }
    if (about === EVERYONE) return "Crew (several / not sure who)";
    var c = CHM.getCrew(about);
    return c ? c.role : "Crew member";
  }

  // Uses the Comms page's mission clock if it exists, so the item sorts with the rest.
  function missionNow() {
    var clock = CHM.store.get("commsClock", null);
    return clock && clock.sim ? clock.sim : Date.now();
  }

  // opts: { about: "PLT" | "CREW" | ["PLT", "MS1", …], reason: "…" (optional) }
  // Resolves to the queued item.
  CHM.raiseEmergency = function (opts) {
    var S = CHM.secure;
    var several = Array.isArray(opts.about);
    var who = nameFor(opts.about);
    var reason = opts.reason || "";
    var title = "EMERGENCY · " + who + (several ? " need help" : " needs help") + (reason ? " — " + reason : "");
    var mergeKey = "emergency:" + (several ? opts.about.slice().sort().join("+") : opts.about);
    var queue = CHM.store.get("queue", []);

    // Pressed again for the same person while still waiting: merge, don't duplicate.
    var same = queue.filter(function (i) { return i.merge === mergeKey && i.status === "waiting"; })[0];
    if (same) {
      same.count = (same.count || 1) + 1;
      if (reason && same.title.indexOf(reason) < 0) same.title += " · " + reason;
      CHM.store.set("queue", queue);
      return log("EMERGENCY repeated without PIN for " + who).then(function () { return same; });
    }

    var item = {
      id: Date.now() + Math.random(),
      kind: "emergency",
      title: title,
      to: "Flight surgeon + Mission control",
      about: opts.about,
      crew: null,
      reporter: "No PIN · raised from the check-in screen",
      bytes: 800,
      sentBytes: 0,
      urgent: true,
      held: false,
      count: 1,
      status: "waiting",
      created: missionNow(),
      merge: mergeKey,
      sealed: null
    };
    queue.push(item);
    CHM.store.set("queue", queue);

    var sealing = S && S.canSeal()
      ? S.seal({
          title: title, to: item.to, about: who, reason: reason || "not given",
          raisedBy: "unverified (no PIN, check-in screen)",
          missionDay: CHM.MISSION.currentDay, raisedUtc: new Date(item.created).toISOString()
        }).then(function (sealed) {
          // Re-read: another page may have changed the queue meanwhile.
          var q = CHM.store.get("queue", []);
          q.forEach(function (i) { if (i.id === item.id) { i.sealed = sealed; item.sealed = sealed; } });
          CHM.store.set("queue", q);
        })
      : Promise.resolve();

    return sealing
      .then(function () { return log("EMERGENCY raised without PIN for " + who + (reason ? ": " + reason : "")); })
      .then(function () { return item; });
  };

  function log(event) {
    var S = CHM.secure;
    return S && S.supported ? S.log(null, event) : Promise.resolve();
  }

  // Info for the "what happens next" message.
  CHM.emergencyNextStep = function () {
    var clock = CHM.store.get("commsClock", null) || { preset: "windows" };
    var delay = CHM.MISSION.oneWayDelayMin;
    var reply = "Earth is " + delay + " min away one way, so the earliest reply is about " + (delay * 2) + " min after it is sent.";
    if (clock.preset === "blackout") return "There is no contact with Earth right now (blackout). It goes out first when contact is back. " + reply;
    return "It is first in the queue and goes out the moment the Earth link is open. " + reply;
  };
})(window.CHM);
