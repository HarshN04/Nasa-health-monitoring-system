// =========================================================
// setup.js — first-run tablet setup (done once by the commander).
//   Step 1: a PIN for each crew member (typed twice, easy PINs refused)
//   Step 2: recovery codes, shown once; must be sealed before finishing
// Load order: data.js → session.js → secure.js → setup.js
// =========================================================

(function (CHM) {
  "use strict";

  var S = CHM.secure;
  var $ = function (id) { return document.getElementById(id); };

  var vDone = $("v-done"), vPins = $("v-pins"), vCodes = $("v-codes");
  var pinsBox = $("pins"), pinMsg = $("pin-msg"), create = $("create");

  function show(view) {
    [vDone, vPins, vCodes].forEach(function (v) { v.hidden = v !== view; });
  }

  if (!S.supported) {
    $("unsupported").hidden = false;
    return;
  }

  // ----- Already set up -----
  function showDone() {
    var s = CHM.store.get("setup", null);
    if (s && s.created) $("done-when").textContent = " (" + new Date(s.created).toLocaleDateString() + ")";
    show(vDone);
  }

  $("reset-all").addEventListener("click", function () {
    if (!confirm("Erase the PINs, recovery codes and Earth key on this tablet? Items already sealed for Earth can no longer be opened.")) return;
    ["setup", "log", "currentCrew", "queue", "commsClock"].forEach(function (k) { CHM.store.remove(k); });
    CHM.CREW.forEach(function (c) { CHM.store.remove("pinTries:" + c.id); });
    location.reload();
  });

  // ----- Step 1: PIN rows, one per crew member -----
  var rows = CHM.CREW.map(function (c) {
    var who = document.createElement("span");
    who.className = "who";
    who.textContent = c.role;

    function pinBox(suffix, label) {
      var i = document.createElement("input");
      i.type = "password";
      i.className = "pin-input";
      i.inputMode = "numeric";
      i.maxLength = 4;
      i.autocomplete = "off";
      i.id = "pin-" + c.id + suffix;
      i.setAttribute("aria-label", c.role + " " + label);
      i.addEventListener("input", function () {
        var clean = i.value.replace(/\D/g, "").slice(0, 4);
        if (clean !== i.value) i.value = clean;
        i.classList.remove("bad");
      });
      return i;
    }

    var a = pinBox("", "PIN"), b = pinBox("-2", "PIN again");
    pinsBox.appendChild(who);
    pinsBox.appendChild(a);
    pinsBox.appendChild(b);
    return { crew: c, a: a, b: b };
  });

  $("demo-pins").addEventListener("click", function () {
    rows.forEach(function (r) {
      r.a.value = r.b.value = S.DEMO_PINS[r.crew.id];
      r.a.classList.remove("bad"); r.b.classList.remove("bad");
    });
    pinMsg.className = "msg";
    pinMsg.textContent = "Demo PINs filled: " + rows.map(function (r) { return r.crew.short + " " + S.DEMO_PINS[r.crew.id]; }).join(" · ");
  });

  function fail(input, text) {
    input.classList.add("bad");
    input.focus();
    pinMsg.className = "msg";
    pinMsg.textContent = text;
  }

  vPins.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var pins = {}, seen = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], role = r.crew.role;
      if (r.a.value.length !== 4) return fail(r.a, role + ": enter a 4-digit PIN.");
      var weak = S.weakPin(r.a.value);
      if (weak) return fail(r.a, role + ": " + weak + " Choose another PIN.");
      if (r.b.value !== r.a.value) return fail(r.b, role + ": the two PINs do not match.");
      if (seen[r.a.value]) return fail(r.a, role + ": each crew member needs a different PIN.");
      seen[r.a.value] = true;
      pins[r.crew.id] = r.a.value;
    }

    create.disabled = true;
    create.innerHTML = '<span class="busy" aria-hidden="true"></span> Creating keys…';
    pinMsg.className = "msg";
    pinMsg.textContent = "";

    S.setUp(pins).then(showCodes, function (err) {
      create.disabled = false;
      create.textContent = "Create keys and recovery codes";
      pinMsg.textContent = "Setup failed: " + (err && err.message ? err.message : err);
    });
  });

  // ----- Step 2: recovery codes -----
  function showCodes(codes) {
    rows.forEach(function (r) { r.a.value = r.b.value = ""; }); // don't leave PINs in the page
    var body = $("codes");
    body.textContent = "";
    CHM.CREW.forEach(function (c) {
      var tr = document.createElement("tr");
      var who = document.createElement("td");
      who.textContent = c.role;
      var code = document.createElement("td");
      code.className = "code";
      code.textContent = codes[c.id];
      tr.appendChild(who);
      tr.appendChild(code);
      body.appendChild(tr);
    });
    show(vCodes);
    $("sealed").focus();
  }

  $("print").addEventListener("click", function () { window.print(); });
  $("sealed").addEventListener("change", function () { $("finish").disabled = !this.checked; });

  $("finish").addEventListener("click", function () {
    $("codes").textContent = ""; // codes are never shown again
    S.log(null, "Recovery codes sealed with the commander").then(function () {
      location.href = "login.html";
    });
  });

  // ----- Start -----
  if (S.isSetUp()) showDone(); else { show(vPins); rows[0].a.focus(); }
})(window.CHM);
