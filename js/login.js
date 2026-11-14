// =========================================================
// login.js — Screen 1: "Who is checking in?"
// Crew picker + 4-digit PIN, the "Forgot PIN?" reset, and the
// no-PIN Emergency for when a crew member is incapacitated.
// Load order: data.js → session.js → secure.js → emergency.js → login.js
//
// PIN check:
//   tablet set up (setup.html) → salted hash from secure.js
//   not set up yet             → demo PINs in data.js (CHM.login)
//
// Wrong-PIN rule (per crew member, saved so a reload doesn't reset it):
//   5 wrong tries  → wait 30 s before the next try
//   10 wrong tries → locked; reset with the commander + recovery code
// =========================================================

(function (CHM) {
  "use strict";

  // Page to open after a good check-in. Change to the Home page when it exists.
  var NEXT_PAGE = "comms.html";

  var DELAY_AFTER = 5;
  var LOCK_AFTER = 10;
  var DELAY_MS = 30 * 1000;

  var S = CHM.secure;
  var $ = function (id) { return document.getElementById(id); };

  var form = $("form"), crewBox = $("crew"), pin = $("pin"), go = $("go"), msg = $("msg");
  var forgot = $("forgot"), demoNote = $("demo-note");
  var resetForm = $("reset");

  var selected = null;
  var timer = null;
  var checking = false;

  var setUp = S && S.supported && S.isSetUp();

  // ----- Wrong-try counter -----
  function triesKey(id) { return "pinTries:" + id; }
  function getTries(id) { return CHM.store.get(triesKey(id), { count: 0, waitUntil: 0 }); }
  function setTries(id, t) { CHM.store.set(triesKey(id), t); }

  function say(el, text, ok) { el.textContent = text; el.className = ok ? "msg ok" : "msg"; }

  function shake(el) {
    el.classList.remove("shake");
    void el.offsetWidth; // restart the animation
    el.classList.add("shake");
  }

  function digitsOnly(input) {
    input.addEventListener("input", function () {
      var clean = input.value.replace(/\D/g, "").slice(0, 4);
      if (clean !== input.value) input.value = clean;
    });
  }

  // Shows lock / wait state for the chosen crew member and enables the button.
  function refresh() {
    clearTimeout(timer);
    forgot.hidden = !(setUp && selected);
    if (!selected) { go.disabled = false; return; }

    var t = getTries(selected.id);
    if (t.count >= LOCK_AFTER) {
      go.disabled = true;
      pin.disabled = true;
      say(msg, selected.role + " is locked after " + LOCK_AFTER + " wrong PINs." +
        (setUp ? " Use “Forgot PIN?” with the commander." : " Ask the commander to reset it."));
      return;
    }
    pin.disabled = false;

    var left = t.waitUntil - Date.now();
    if (left > 0) {
      go.disabled = true;
      say(msg, "Too many wrong PINs. Try again in " + Math.ceil(left / 1000) + " s.");
      timer = setTimeout(refresh, 1000);
      return;
    }
    go.disabled = checking;
    if (/^Too many/.test(msg.textContent)) say(msg, "");
  }

  // ----- Crew picker -----
  function choose(btn) {
    var buttons = crewBox.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i] === btn ? "true" : "false");
    }
    selected = CHM.getCrew(btn.dataset.id);
    pin.value = "";
    say(msg, "");
    refresh();
    if (!pin.disabled) pin.focus();
  }

  CHM.CREW.forEach(function (c) {
    var b = document.createElement("button");
    b.type = "button";
    b.dataset.id = c.id;
    b.textContent = c.role;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", function () { choose(b); });
    crewBox.appendChild(b);
  });

  digitsOnly(pin);

  function checkPin(id, value) {
    if (setUp) return S.verifyPin(id, value);
    return Promise.resolve(CHM.getCrew(id).pin === value);
  }

  // ----- Check in -----
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!selected) { say(msg, "Choose who is checking in first."); shake(form); return; }
    if (go.disabled) return;
    if (pin.value.length !== 4) { say(msg, "Enter your 4-digit PIN."); shake(form); pin.focus(); return; }

    var who = selected;
    checking = true;
    go.disabled = true;
    go.textContent = "Checking…";

    checkPin(who.id, pin.value).then(function (ok) {
      checking = false;
      go.textContent = "Check in";

      if (ok) {
        setTries(who.id, { count: 0, waitUntil: 0 });
        CHM.store.set("currentCrew", who.id);
        say(msg, "Checked in as " + who.role + ".", true);
        var done = S && S.supported ? S.log(who.id, "Checked in") : Promise.resolve();
        done.then(function () { if (NEXT_PAGE) location.href = NEXT_PAGE; });
        return;
      }

      var t = getTries(who.id);
      t.count += 1;
      if (t.count >= DELAY_AFTER && t.count < LOCK_AFTER) t.waitUntil = Date.now() + DELAY_MS;
      setTries(who.id, t);
      if (S && S.supported) S.log(who.id, "Wrong PIN (" + t.count + ")");

      pin.value = "";
      shake(form);
      if (t.count < LOCK_AFTER) {
        var left = LOCK_AFTER - t.count;
        say(msg, "Wrong PIN. " + left + (left === 1 ? " try" : " tries") + " left before lock.");
      }
      refresh();
      if (!pin.disabled) pin.focus();
    });
  });

  // ----- Forgot PIN: commander's PIN + sealed recovery code → new PIN -----
  var resetMsg = $("reset-msg"), resetGo = $("reset-go");
  ["cdr-pin", "np", "np2"].forEach(function (id) { digitsOnly($(id)); });

  forgot.addEventListener("click", function () {
    if (!selected) return;
    var isCdr = selected.id === "CDR";
    $("reset-who").textContent = selected.role;
    $("cdr-field").hidden = isCdr;
    var steps = isCdr
      ? ["Open the sealed envelope with your recovery code.", "Type the code and choose a new PIN."]
      : ["Ask the commander to type their PIN.", "Open the sealed envelope with your recovery code.", "Type the code and choose a new PIN."];
    var ol = $("reset-steps");
    ol.textContent = "";
    steps.forEach(function (s) { var li = document.createElement("li"); li.textContent = s; ol.appendChild(li); });
    ["cdr-pin", "rc", "np", "np2"].forEach(function (id) { $(id).value = ""; });
    say(resetMsg, "");
    form.hidden = true;
    resetForm.hidden = false;
    (isCdr ? $("rc") : $("cdr-pin")).focus();
  });

  $("reset-cancel").addEventListener("click", function () {
    resetForm.hidden = true;
    form.hidden = false;
    refresh();
  });

  resetForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var who = selected, isCdr = who.id === "CDR";
    var cdrPin = $("cdr-pin").value, code = $("rc").value, np = $("np").value, np2 = $("np2").value;

    if (!isCdr && cdrPin.length !== 4) { say(resetMsg, "The commander needs to type their PIN."); return; }
    if (code.replace(/[^A-Za-z0-9]/g, "").length !== 20) { say(resetMsg, "The recovery code has 20 letters and numbers."); return; }
    var weak = S.weakPin(np);
    if (weak) { say(resetMsg, "New PIN: " + weak); return; }
    if (np !== np2) { say(resetMsg, "The two new PINs do not match."); return; }

    resetGo.disabled = true;
    resetGo.textContent = "Checking…";
    var cdrOk = isCdr ? Promise.resolve(true) : S.verifyPin("CDR", cdrPin);

    Promise.all([cdrOk, S.verifyRecovery(who.id, code)]).then(function (r) {
      if (!r[0] || !r[1]) {
        resetGo.disabled = false;
        resetGo.textContent = "Set new PIN";
        say(resetMsg, !r[0] ? "Commander's PIN is wrong." : "That recovery code does not match.");
        shake(resetForm);
        S.log(who.id, "PIN reset refused");
        return;
      }
      return S.setPin(who.id, np).then(function () {
        setTries(who.id, { count: 0, waitUntil: 0 });
        return S.log(who.id, "PIN reset with commander and recovery code");
      }).then(function () {
        resetGo.disabled = false;
        resetGo.textContent = "Set new PIN";
        resetForm.hidden = true;
        form.hidden = false;
        demoNote.textContent = "";
        pin.value = "";
        refresh();
        say(msg, "New PIN set for " + who.role + ". Check in with it now.", true);
        pin.focus();
      });
    });
  });

  // ----- Emergency without PIN (js/emergency.js) -----
  // Any crew member can raise it for someone who is incapacitated.
  var emerg = $("emerg"), emergDone = $("emerg-done");
  var emergWho = $("emerg-who"), emergWhy = $("emerg-why"), emergMsg = $("emerg-msg"), emergSend = $("emerg-send");
  var emergAbout = null, emergReason = "";

  function pressOne(box, btn) {
    var all = box.querySelectorAll("button");
    for (var i = 0; i < all.length; i++) all[i].setAttribute("aria-pressed", all[i] === btn ? "true" : "false");
  }

  function pickButton(box, label, onPick, extraClass) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-pressed", "false");
    if (extraClass) b.className = extraClass;
    b.addEventListener("click", function () { pressOne(box, b); onPick(); });
    box.appendChild(b);
    return b;
  }

  CHM.CREW.forEach(function (c) {
    pickButton(emergWho, c.role, function () { emergAbout = c.id; say(emergMsg, ""); });
  });
  pickButton(emergWho, "Several / not sure who", function () { emergAbout = "CREW"; say(emergMsg, ""); }, "wide");

  CHM.EMERGENCY_REASONS.forEach(function (r) {
    var b = pickButton(emergWhy, r, function () {
      // Tapping the chosen reason again clears it (it is optional).
      if (emergReason === r) { emergReason = ""; b.setAttribute("aria-pressed", "false"); }
      else emergReason = r;
    });
  });

  function showEmergency() {
    emergAbout = null;
    emergReason = "";
    pressOne(emergWho, null);
    pressOne(emergWhy, null);
    say(emergMsg, "");
    emergSend.disabled = false;
    emergSend.textContent = "Send emergency";
    form.hidden = true;
    resetForm.hidden = true;
    emergDone.hidden = true;
    emerg.hidden = false;
    emergWho.querySelector("button").focus();
  }

  function backToCheckIn() {
    emerg.hidden = true;
    emergDone.hidden = true;
    form.hidden = false;
    refresh();
  }

  $("emerg-open").addEventListener("click", showEmergency);
  $("emerg-cancel").addEventListener("click", backToCheckIn);
  $("emerg-back").addEventListener("click", backToCheckIn);

  emerg.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!emergAbout) { say(emergMsg, "Choose who needs help."); shake(emerg); return; }

    emergSend.disabled = true;
    emergSend.textContent = "Sending…";

    CHM.raiseEmergency({ about: emergAbout, reason: emergReason }).then(function (item) {
      var who = emergAbout === "CREW" ? "the crew" : CHM.getCrew(emergAbout).role;
      $("done-what").textContent = "Emergency for " + who + (emergReason ? " (" + emergReason.toLowerCase() + ")" : "") +
        (item.count > 1 ? ". Already in the queue; marked as raised " + item.count + " times." : " is at the front of the queue to Earth.");
      $("done-next").textContent = CHM.emergencyNextStep();
      emerg.hidden = true;
      emergDone.hidden = false;
      emergDone.focus();
    }, function (err) {
      emergSend.disabled = false;
      emergSend.textContent = "Send emergency";
      say(emergMsg, "Could not queue the emergency: " + (err && err.message ? err.message : err));
    });
  });

  // ----- Footer note -----
  if (!setUp) {
    demoNote.innerHTML = "";
    demoNote.appendChild(document.createTextNode("Demo PINs: " + CHM.CREW.map(function (c) {
      return c.short + " " + c.pin;
    }).join(" · ") + " · "));
    var a = document.createElement("a");
    a.href = "setup.html";
    a.textContent = "Set up this tablet";
    demoNote.appendChild(a);
  } else if (S.usesDemoPins()) {
    demoNote.textContent = "Demo PINs: " + CHM.CREW.map(function (c) {
      return c.short + " " + S.DEMO_PINS[c.id];
    }).join(" · ");
  }

  // Start with whoever is already checked in, if anyone.
  var current = CHM.getCurrentCrewId();
  if (current) {
    var btn = crewBox.querySelector('[data-id="' + current + '"]');
    if (btn) choose(btn);
  }

  form.hidden = false;
})(window.CHM);
