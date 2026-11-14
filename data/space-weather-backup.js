// =========================================================
// space-weather-backup.js — saved copy of NASA DONKI data.
// Used by spaceweather.js only when the live request fails
// (no internet at the venue, CORS, server down).
// Source: CCMC DONKI API https://ccmc.gsfc.nasa.gov/DONKI-API/get/
// Notice summaries are short paraphrases, not NASA's full text.
// =========================================================

window.CHM = window.CHM || {};
window.CHM.SPACE_WEATHER_BACKUP = {
 "fetched": "2026-11-14T08:00Z",
 "source": "NASA CCMC DONKI API - https://ccmc.gsfc.nasa.gov/DONKI-API/get/",
 "sep": [],
 "flares": [
  {
   "id": "2026-10-16T15:38:00-FLR-001",
   "peak": "2026-10-16T15:42Z",
   "class": "M1.3"
  },
  {
   "id": "2026-10-19T08:54:00-FLR-001",
   "peak": "2026-10-19T09:03Z",
   "class": "M1.6"
  },
  {
   "id": "2026-10-23T03:43:00-FLR-001",
   "peak": "2026-10-23T03:55Z",
   "class": "C1.3"
  },
  {
   "id": "2026-10-26T08:21:00-FLR-001",
   "peak": "2026-10-26T08:38Z",
   "class": "C1.9"
  },
  {
   "id": "2026-10-26T18:17:00-FLR-001",
   "peak": "2026-10-26T18:40Z",
   "class": "C2.8"
  },
  {
   "id": "2026-11-05T18:21:00-FLR-001",
   "peak": "2026-11-05T18:33Z",
   "class": "M3.5"
  },
  {
   "id": "2026-11-07T12:26:00-FLR-001",
   "peak": "2026-11-07T12:43Z",
   "class": "M1.2"
  },
  {
   "id": "2026-11-07T17:11:00-FLR-001",
   "peak": "2026-11-07T17:17Z",
   "class": "M1.4"
  },
  {
   "id": "2026-11-07T18:21:00-FLR-001",
   "peak": "2026-11-07T18:42Z",
   "class": "M1.9"
  },
  {
   "id": "2026-11-08T07:33:00-FLR-001",
   "peak": "2026-11-08T07:46Z",
   "class": "M1.7"
  },
  {
   "id": "2026-11-08T15:29:00-FLR-001",
   "peak": "2026-11-08T15:37Z",
   "class": "M1.1"
  },
  {
   "id": "2026-11-08T18:15:00-FLR-001",
   "peak": "2026-11-08T18:27Z",
   "class": "M1.1"
  },
  {
   "id": "2026-11-11T21:06:00-FLR-001",
   "peak": "2026-11-11T21:21Z",
   "class": "M1.7"
  }
 ],
 "notices": [
  {
   "type": "RBE",
   "id": "20261108-AL-001",
   "issued": "2026-11-08T21:18Z",
   "summary": "Outer radiation belt electron flux elevated; GOES >2.0 MeV above 1000 pfu from 21:10Z"
  },
  {
   "type": "RBE",
   "id": "20261108-AL-002",
   "issued": "2026-11-08T21:28Z",
   "summary": "Same enhancement, linked to coronal hole high-speed stream; solar wind ~700 km/s"
  },
  {
   "type": "CME",
   "id": "20261110-AL-001",
   "issued": "2026-11-10T13:06Z",
   "summary": "C-type CME ~726 km/s, glancing blow to Mars and Psyche, minor to STEREO A"
  },
  {
   "type": "CME",
   "id": "20261110-AL-002",
   "issued": "2026-11-10T16:29Z",
   "summary": "C-type CME ~974 km/s, glancing blow to STEREO A ~2026-11-12T14:00Z"
  },
  {
   "type": "RBE",
   "id": "20261110-AL-003",
   "issued": "2026-11-10T21:31Z",
   "summary": "Electron enhancement continues; >1000 pfu again from 06:10Z; solar wind ~600 km/s"
  },
  {
   "type": "Report",
   "id": "20261111-7D-001",
   "issued": "2026-11-11T21:02Z",
   "summary": "Weekly summary Nov 4-10: moderate solar activity, minor geomagnetic activity, elevated electrons, low-to-moderate outlook"
  },
  {
   "type": "RBE",
   "id": "20261112-AL-001",
   "issued": "2026-11-12T21:30Z",
   "summary": "Electron enhancement remains; >1000 pfu again from 07:35Z; solar wind ~430 km/s"
  },
  {
   "type": "CME",
   "id": "20261113-AL-001",
   "issued": "2026-11-13T16:25Z",
   "summary": "C-type CME ~525 km/s, minor/glancing impacts on OSIRIS-APEX, Europa Clipper, Parker Solar Probe"
  }
 ]
};
