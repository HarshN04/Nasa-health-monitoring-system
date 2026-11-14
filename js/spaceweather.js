// =========================================================
// spaceweather.js — live NASA DONKI space weather.
//
// DONKI moved on 30 Sep 2026: api.nasa.gov/DONKI no longer returns
// data. The new address needs NO API key:
//   https://ccmc.gsfc.nasa.gov/DONKI-API/get/<product>
// Date ranges must be 30 days or less.
//
// What it does:
//   • SEP (solar particle event) in the last 2 days → sets the shared
//     space-weather event (session.js), so Home shows the red banner
//     and scoring.js puts Radiation at "Act now" (shelter).
//   • No SEP → clears it.
//   • Request fails → uses data/space-weather-backup.js.
//   • Demo switch: add ?sep=1 to the page URL to force an event,
//     ?sep=0 to force none (handy when presenting).
//
// Load after session.js. Then on a page:
//   CHM.refreshSpaceWeather().then(function (info) { ...render... });
// =========================================================

window.CHM = window.CHM || {};

(function (CHM) {

  CHM.DONKI_BASE = "https://ccmc.gsfc.nasa.gov/DONKI-API/get/";
  CHM.SEP_ACTIVE_HOURS = 48;   // an SEP this recent counts as "now"

  function ymd(d) { return d.toISOString().slice(0, 10); }

  function getJson(product, days) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 864e5);
    const url = CHM.DONKI_BASE + product + "?startDate=" + ymd(start) + "&endDate=" + ymd(end);
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error("DONKI " + r.status);
      return r.json(); // an HTML page (old address) would throw here, which is what we want
    });
  }

  function summarise(sep, flares, notices, source) {
    const now = Date.now();
    const recent = sep.filter((e) => now - Date.parse(e.eventTime) < CHM.SEP_ACTIVE_HOURS * 3600e3);
    return {
      source,                                   // "live" | "backup" | "demo"
      sepActive: recent.length > 0,
      latestSep: recent[recent.length - 1] || null,
      flares,                                   // [{ id, peak, class }]
      strongestFlare: flares.slice().sort((a, b) => flareRank(b.class) - flareRank(a.class))[0] || null,
      radiationBeltAlert: notices.some((n) => n.type === "RBE"),
      notices,                                  // [{ type, id, issued, summary }]
    };
  }

  // "M3.5" → number so flares can be compared (X > M > C > B > A)
  function flareRank(cls) {
    const letter = { A: 0, B: 1, C: 2, M: 3, X: 4 }[(cls || "A")[0]] || 0;
    return letter * 10 + (parseFloat(cls.slice(1)) || 0);
  }

  function apply(info) {
    if (info.sepActive) {
      CHM.setSpaceWeather({
        active: true,
        type: "SEP",
        message: "Solar particle event (NASA DONKI). Move to the shielded area now.",
        since: info.latestSep ? info.latestSep.eventTime : new Date().toISOString(),
      });
    } else {
      CHM.clearSpaceWeather();
    }
    CHM.spaceWeatherInfo = info;
    return info;
  }

  CHM.refreshSpaceWeather = function () {
    const demo = new URLSearchParams(location.search).get("sep");
    if (demo === "1" || demo === "0") {
      const fake = demo === "1" ? [{ sepID: "DEMO-SEP", eventTime: new Date().toISOString() }] : [];
      return Promise.resolve(apply(summarise(fake, [], [], "demo")));
    }

    return Promise.all([getJson("SEP", 7), getJson("FLR", 7), getJson("notifications", 7)])
      .then(([sep, flr, notes]) => apply(summarise(
        sep,
        flr.map((f) => ({ id: f.flrID, peak: f.peakTime, class: f.classType })),
        notes.map((n) => ({ type: n.messageType, id: n.messageID, issued: n.messageIssueTime, summary: "" })),
        "live")))
      .catch(() => {
        const b = CHM.SPACE_WEATHER_BACKUP || { sep: [], flares: [], notices: [] };
        // backup is old, so its SEPs are never "now": banner stays off
        return apply(summarise(b.sep, b.flares, b.notices, "backup"));
      });
  };

})(window.CHM);
