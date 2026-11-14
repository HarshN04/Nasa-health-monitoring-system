// =========================================================
// secure.js — PINs, recovery codes, sealing for Earth, activity log.
// Uses the browser's built-in Web Crypto (no libraries, works offline).
// Needs a secure page: https:// or http://localhost.
// Load order: data.js → session.js → secure.js → <page>.js
//
// What it stores (via CHM.store, all in this browser only):
//   setup   { crew: { CDR: { salt, hash, rcSalt, rcHash }, ... },
//             groundPublic (JWK), earthPrivate (JWK, DEMO ONLY), demoPins, created }
//   log     [ { t, crew, event, prev, hash } ]  hash-chained, so edits show up
//
// In a real mission Earth would keep the private key and the tablet would
// only hold the public one. Here the private key is kept too, so the demo
// "Open as Earth" button can prove the sealing works.
// =========================================================

window.CHM = window.CHM || {};

(function (CHM) {
  "use strict";

  var ITERATIONS = 600000;              // PBKDF2 rounds: slow to guess
  var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O, 1/I/L, U
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var subtle = window.crypto && window.crypto.subtle;

  // Same 4 PINs the Setup page's "fill demo PINs" button uses.
  var DEMO_PINS = { CDR: "4826", PLT: "7391", MS1: "5063", MS2: "9147" };

  // ----- small helpers -----
  function b64(buf) {
    var s = "", bytes = new Uint8Array(buf);
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  function sha256(text) {
    return subtle.digest("SHA-256", enc.encode(text)).then(b64);
  }

  function stretch(secret, saltB64) {
    return subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: ITERATIONS }, key, 256);
      })
      .then(b64);
  }

  // Constant-time-ish compare so a wrong PIN does not leak how close it was.
  function same(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function normalizeCode(code) { return String(code).toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  function getSetup() { return CHM.store.get("setup", null); }
  function saveSetup(s) { CHM.store.set("setup", s); }

  // ----- public API -----
  var S = {};
  CHM.secure = S;

  S.DEMO_PINS = DEMO_PINS;
  S.supported = !!(subtle && window.isSecureContext);
  S.isSetUp = function () { return !!getSetup(); };
  S.usesDemoPins = function () { var s = getSetup(); return !!(s && s.demoPins); };

  // Easy PINs refused: same digit (1111), straight runs (1234, 9876),
  // repeated pairs (1212), years 1900–2099.
  S.weakPin = function (pin) {
    if (!/^\d{4}$/.test(pin)) return "Use exactly 4 digits.";
    var d = pin.split("").map(Number);
    if (d.every(function (x) { return x === d[0]; })) return "All 4 digits are the same.";
    var up = true, down = true;
    for (var i = 1; i < 4; i++) {
      if (d[i] !== d[i - 1] + 1) up = false;
      if (d[i] !== d[i - 1] - 1) down = false;
    }
    if (up || down) return "Digits in a row are too easy to guess.";
    if (pin.slice(0, 2) === pin.slice(2)) return "A repeated pair is too easy to guess.";
    var n = Number(pin);
    if (n >= 1900 && n <= 2099) return "Looks like a year.";
    return null;
  };

  S.newRecoveryCode = function () {
    var out = "";
    while (out.length < 20) {
      var b = randomBytes(1)[0];
      if (b < 240) out += CODE_ALPHABET[b % CODE_ALPHABET.length]; // 240 = 8×30, no bias
    }
    return out.match(/.{5}/g).join("-");
  };

  // pins: { CDR: "4826", ... }  →  resolves to { CDR: "ABCDE-…", ... } (shown once)
  S.setUp = function (pins) {
    var crew = {}, codes = {};
    var demo = Object.keys(DEMO_PINS).every(function (id) { return pins[id] === DEMO_PINS[id]; });

    var jobs = CHM.CREW.map(function (c) {
      var salt = b64(randomBytes(16)), rcSalt = b64(randomBytes(16));
      var code = S.newRecoveryCode();
      codes[c.id] = code;
      return Promise.all([stretch(pins[c.id], salt), stretch(normalizeCode(code), rcSalt)])
        .then(function (h) { crew[c.id] = { salt: salt, hash: h[0], rcSalt: rcSalt, rcHash: h[1] }; });
    });

    var keys = subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true, ["encrypt", "decrypt"]
    ).then(function (kp) {
      return Promise.all([subtle.exportKey("jwk", kp.publicKey), subtle.exportKey("jwk", kp.privateKey)]);
    });

    return Promise.all([keys].concat(jobs)).then(function (r) {
      saveSetup({
        crew: crew,
        groundPublic: r[0][0],
        earthPrivate: r[0][1],
        demoPins: demo,
        created: new Date().toISOString()
      });
      return S.log(null, "Tablet set up for " + CHM.CREW.length + " crew").then(function () { return codes; });
    });
  };

  S.verifyPin = function (crewId, pin) {
    var s = getSetup(), rec = s && s.crew[crewId];
    if (!rec) return Promise.resolve(false);
    return stretch(pin, rec.salt).then(function (h) { return same(h, rec.hash); });
  };

  S.verifyRecovery = function (crewId, code) {
    var s = getSetup(), rec = s && s.crew[crewId];
    if (!rec) return Promise.resolve(false);
    return stretch(normalizeCode(code), rec.rcSalt).then(function (h) { return same(h, rec.rcHash); });
  };

  S.setPin = function (crewId, pin) {
    var s = getSetup();
    var salt = b64(randomBytes(16));
    return stretch(pin, salt).then(function (h) {
      s.crew[crewId].salt = salt;
      s.crew[crewId].hash = h;
      s.demoPins = false;
      saveSetup(s);
    });
  };

  // ----- Sealing for Earth: fresh AES-GCM key per item, wrapped with Earth's public key -----
  S.canSeal = function () { var s = getSetup(); return !!(S.supported && s && s.groundPublic); };

  S.seal = function (obj) {
    var s = getSetup();
    var iv = randomBytes(12);
    var aesKey;
    return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"])
      .then(function (k) {
        aesKey = k;
        return subtle.encrypt({ name: "AES-GCM", iv: iv }, k, enc.encode(JSON.stringify(obj)));
      })
      .then(function (ct) {
        return Promise.all([
          ct,
          subtle.exportKey("raw", aesKey),
          subtle.importKey("jwk", s.groundPublic, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"])
        ]);
      })
      .then(function (r) {
        return subtle.encrypt({ name: "RSA-OAEP" }, r[2], r[1]).then(function (wrapped) {
          return { alg: "RSA-OAEP-2048 + AES-GCM-256", iv: b64(iv), key: b64(wrapped), data: b64(r[0]) };
        });
      });
  };

  S.openAsEarth = function (sealed) {
    var s = getSetup();
    return subtle.importKey("jwk", s.earthPrivate, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"])
      .then(function (priv) { return subtle.decrypt({ name: "RSA-OAEP" }, priv, unb64(sealed.key)); })
      .then(function (raw) { return subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]); })
      .then(function (k) { return subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, k, unb64(sealed.data)); })
      .then(function (pt) { return JSON.parse(dec.decode(pt)); });
  };

  // ----- Activity log: each entry includes the hash of the one before -----
  S.getLog = function () { return CHM.store.get("log", []); };

  S.log = function (crewId, event) {
    if (!subtle) return Promise.resolve();
    var log = S.getLog();
    var prev = log.length ? log[log.length - 1].hash : "start";
    var entry = { t: new Date().toISOString(), crew: crewId, event: event, prev: prev };
    return sha256(prev + "|" + entry.t + "|" + (crewId || "") + "|" + event).then(function (h) {
      entry.hash = h;
      log.push(entry);
      CHM.store.set("log", log);
    });
  };

  // Resolves to { ok, count, brokenAt } — brokenAt is the first entry that does not match.
  S.checkLog = function () {
    var log = S.getLog();
    var i = 0, prev = "start";
    function next() {
      if (i >= log.length) return Promise.resolve({ ok: true, count: log.length, brokenAt: -1 });
      var e = log[i];
      if (e.prev !== prev) return Promise.resolve({ ok: false, count: log.length, brokenAt: i });
      return sha256(e.prev + "|" + e.t + "|" + (e.crew || "") + "|" + e.event).then(function (h) {
        if (h !== e.hash) return { ok: false, count: log.length, brokenAt: i };
        prev = e.hash; i++;
        return next();
      });
    }
    return next();
  };
})(window.CHM);
