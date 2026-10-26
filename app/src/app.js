/* Rjúpnakort — brú við Android (Capacitor).
   Hlaðið á undan kóða kortsins. Gerir ekkert í venjulegum vafra. */
(function () {
  "use strict";
  const C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== "function" || !C.isNativePlatform()) return;
  window.RK_APP = true;

  const BG = C.registerPlugin("BackgroundGeolocation");
  const LN = C.registerPlugin("LocalNotifications");
  const get = (k, d) => { try { const v = localStorage.getItem("rk:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem("rk:" + k, JSON.stringify(v)); } catch (e) {} };
  const dur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} mín` : `${Math.floor(m / 60)} klst ${m % 60} mín`; };
  const toast = (t, ms) => { if (window.RK) window.RK.toast(t, ms); };

  let hunt = get("hunt", false), huntStart = get("huntStart", 0);

  /* ---------- Staðsetning: navigator.geolocation keyrir á GPS-þjónustu símans ---------- */
  const subs = new Map();
  let nextId = 1, bgId = null, bgBusy = Promise.resolve();

  function toPos(l) {
    return {
      coords: { latitude: l.latitude, longitude: l.longitude, accuracy: l.accuracy, altitude: l.altitude,
                altitudeAccuracy: l.altitudeAccuracy, heading: l.bearing, speed: l.speed },
      timestamp: l.time || Date.now()
    };
  }
  function onLoc(loc, err) {
    if (err) {
      if (err.code === "NOT_AUTHORIZED") {
        toast("Leyfðu staðsetningu: Stillingar → Forrit → Rjúpnakort → Heimildir → Staðsetning.", 9000);
        for (const s of subs.values()) try { s.e && s.e({ code: 1, message: err.message }); } catch (e) {}
      }
      return;
    }
    if (!loc) return;
    const p = toPos(loc);
    for (const s of subs.values()) try { s.s(p); } catch (e) {}
  }
  function start() {
    bgBusy = bgBusy.then(async () => {
      if (bgId || !subs.size) return;
      const opts = hunt
        ? { backgroundTitle: "Veiðihamur er virkur", backgroundMessage: "Fylgist með bannsvæðum. Ýttu til að opna kortið.",
            requestPermissions: true, stale: false, distanceFilter: 15 }
        : { requestPermissions: true, stale: false, distanceFilter: 5 };
      try { bgId = await BG.addWatcher(opts, onLoc); } catch (e) { bgId = null; }
    });
    return bgBusy;
  }
  function stop() {
    bgBusy = bgBusy.then(async () => {
      if (!bgId) return;
      const id = bgId; bgId = null;
      try { await BG.removeWatcher({ id }); } catch (e) {}
    });
    return bgBusy;
  }
  const restart = () => { stop(); return start(); };

  const geo = navigator.geolocation || {};
  try {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      watchPosition(s, e) { const id = nextId++; subs.set(id, { s, e }); start(); return id; },
      clearWatch(id) {
        subs.delete(id);
        if (!subs.size) {
          stop();
          if (hunt) { setHunt(false); toast("Veiðiham lokið því slökkt var á GPS."); }
        }
      },
      getCurrentPosition(s, e) {
        const id = this.watchPosition(p => { this.clearWatch(id); s(p); }, err => { this.clearWatch(id); e && e(err); });
      }
    }});
  } catch (e) { console.warn("Gat ekki tengt GPS-þjónustu", e, geo); }

  /* ---------- Tilkynningar ---------- */
  let chans = null;
  function ensureChannels() {
    if (!chans) chans = (async () => {
      try {
        await LN.createChannel({ id: "vidvaranir", name: "Viðvaranir um svæði", description: "Þegar þú nálgast eða ferð inn á bannsvæði",
                                 importance: 5, visibility: 1, vibration: true });
        await LN.createChannel({ id: "almennt", name: "Almennt", importance: 3, visibility: 1, vibration: false });
      } catch (e) {}
    })();
    return chans;
  }
  let nid = 1000;
  async function notify(title, body, channelId) {
    await ensureChannels();
    try {
      await LN.schedule({ notifications: [{ id: nid++, title, body, channelId: channelId || "vidvaranir",
        smallIcon: "ic_stat_rjupa", iconColor: "#E8590C", schedule: { at: new Date(Date.now() + 250), allowWhileIdle: true } }] });
    } catch (e) {}
  }
  // Kallað úr kortinu þegar staða breytist (0 öruggt … 5 innan bannsvæðis)
  window.__onLevel = (level, prev, title, sub) => {
    if (!hunt || prev == null) return;
    if (level > prev && level >= 2 && document.visibilityState !== "visible") notify(title, sub, "vidvaranir");
  };

  /* ---------- Veiðihamur ---------- */
  function setHunt(on) {
    hunt = on; set("hunt", on);
    if (on) { huntStart = Date.now(); set("huntStart", huntStart); }
    render();
  }
  let armed = false;
  async function toggle() {
    const R = window.RK;
    if (!hunt) {
      try { await LN.requestPermissions(); } catch (e) {}
      await ensureChannels();
      setHunt(true);
      if (R && !R.isGpsOn()) R.startGps(); else await restart();
      toast("Veiðihamur virkur. Viðvaranir virka líka með slökktan skjá.", 6000);
    } else {
      const b = document.getElementById("huntBtn");
      if (!armed) {
        armed = true; b.innerHTML = '<span class="d"></span>Ýttu aftur til að ljúka veiðiham';
        setTimeout(() => { armed = false; render(); }, 3000);
        return;
      }
      armed = false;
      const t = Date.now() - huntStart;
      setHunt(false);
      await restart();
      toast(`Veiðiham lokið eftir ${dur(t)}.`);
    }
  }
  function render() {
    const b = document.getElementById("huntBtn"); if (!b || armed) return;
    b.classList.toggle("on", hunt);
    b.innerHTML = hunt
      ? `<span class="d"></span><span class="tx">Veiðihamur · ${dur(Date.now() - huntStart)}</span><small>Ljúka</small>`
      : '<span class="d"></span><span class="tx">Hefja veiðiham</span>';
  }
  function injectUI() {
    const css = document.createElement("style");
    css.textContent = `
#huntBtn{pointer-events:auto;border:none;border-radius:999px;padding:10px 16px;background:var(--panel);color:var(--fg);
  box-shadow:var(--shadow);display:flex;align-items:center;gap:10px;font:600 15px var(--f-body);text-align:left}
#huntBtn .d{width:11px;height:11px;border-radius:50%;background:var(--muted);flex:none}
#huntBtn .tx{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#huntBtn small{font-weight:600;opacity:.85;border:1px solid currentColor;border-radius:999px;padding:2px 10px}
#huntBtn.on{background:var(--ok);color:#fff}
#huntBtn.on .d{background:#fff;animation:pulse 1.6s infinite}
@media (prefers-reduced-motion:reduce){#huntBtn.on .d{animation:none}}
.leaflet-bottom.leaflet-right{bottom:calc(env(safe-area-inset-bottom,0px) + 178px)}`;
    document.head.appendChild(css);
    const left = document.querySelector("#bottom .left");
    if (!left) return;
    const b = document.createElement("button");
    b.id = "huntBtn"; b.type = "button"; b.onclick = toggle;
    left.insertBefore(b, left.firstChild);
    render(); setInterval(render, 30000);
    // Í appinu er sparnaður sjálfvirkur: skjárinn slokknar og GPS heldur áfram í veiðiham
    if (hunt && window.RK && !window.RK.isGpsOn()) window.RK.startGps();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(injectUI, 0));
  else setTimeout(injectUI, 0);
})();
