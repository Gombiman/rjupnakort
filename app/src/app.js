/* Rjúpnakort — brú við Android (Capacitor).
   Hlaðið á undan kóða kortsins. Gerir ekkert í venjulegum vafra. */
(function () {
  "use strict";
  const C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== "function" || !C.isNativePlatform()) return;
  window.RK_APP = true;
  if (typeof C.registerPlugin !== "function") {
    window.addEventListener("load", () => window.RK && window.RK.toast("Villa í appinu: Capacitor kjarni hlóðst ekki. Veiðihamur óvirkur.", 10000));
    return;
  }

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
    syncFriends();
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
    initFriends();
  }

  /* ---------- Finna félaga ---------- */
  const F = C.registerPlugin("Felagar");
  const fstate = {};   // síðustu 7 tölustafir -> {state, t}
  const last7 = p => { const d = String(p || "").replace(/[^0-9]/g, ""); return d.length <= 7 ? d : d.slice(-7); };
  const escH = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function friends() { const a = get("friends", []); return Array.isArray(a) ? a : []; }
  function syncFriends() {
    try {
      F.configure({ myPhone: get("myPhone", ""), myName: get("me", ""), group: get("group", ""),
                    autoReply: get("autoReply", true), hunt, friends: friends() }).catch(() => {});
    } catch (e) {}
  }
  function takeLocation(it, focus) {
    const R = window.RK; if (!R) return;
    const p = R.addRemotePoint({ lat: it.lat, lon: it.lon, acc: it.acc, ts: it.ts * 1000, type: "ping", from: it.name });
    const k = last7(it.phone);
    const waited = fstate[k] && fstate[k].state !== "done";
    fstate[k] = { state: "done", t: Date.now(), via: it.via };
    if (focus || waited) { R.closeSheet(); R.showRemote(p, false); }
    renderFriends();
  }
  async function pullPending(focus) {
    try { const r = await F.getPending(); (r.items || []).forEach(it => takeLocation(it, focus)); } catch (e) {}
  }

  let fsheet = null, permState = null;
  function buildSheet() {
    fsheet = document.createElement("section");
    fsheet.className = "sheet"; fsheet.id = "friendSheet"; fsheet.hidden = true;
    fsheet.setAttribute("aria-label", "Félagar");
    fsheet.innerHTML = `
  <div class="grab"></div>
  <div class="sh-head"><h2>Félagar</h2><button class="x" type="button" data-fclose aria-label="Loka">×</button></div>
  <p class="note" id="fIntro" style="margin-top:8px"></p>
  <div id="fList" style="margin-top:8px"></div>
  <div class="row" style="margin-top:12px"><button class="btn sec" id="fLink" type="button">Senda ping-hlekk</button></div>

  <h3>Mínar upplýsingar</h3>
  <div class="card">
    <label class="f">Nafnið þitt<input type="text" id="fMe" maxlength="24" placeholder="t.d. Grétar"></label>
    <label class="f">Símanúmerið þitt<input type="text" id="fPhone" inputmode="tel" maxlength="16" placeholder="t.d. 8201234"></label>
    <label class="f">Hópkóði (sami hjá öllum í hópnum)<input type="text" id="fGroup" maxlength="40" autocapitalize="off" autocomplete="off" placeholder="t.d. rjupa-K7Q2M"></label>
    <div class="row"><button class="btn sec" id="fGen" type="button">Búa til kóða</button><button class="btn sec" id="fCopy" type="button">Afrita kóða</button></div>
    <label class="setrow" style="border-top:none"><div class="t"><b>Svara félögum sjálfkrafa</b><span>Síminn sendir staðsetninguna þegar félagi á listanum biður um hana.</span></div><input type="checkbox" class="tog" id="fAuto"></label>
  </div>

  <h3>Bæta við félaga</h3>
  <div class="card">
    <div class="row">
      <input type="text" id="fNewName" maxlength="24" placeholder="Nafn">
      <input type="text" id="fNewPhone" inputmode="tel" maxlength="16" placeholder="Símanúmer">
    </div>
    <button class="btn" id="fAdd" type="button">Bæta við</button>
    <p class="msg" id="fMsg"></p>
  </div>

  <h3>Leyfi</h3>
  <div class="card" id="fPerm"></div>
  <p class="note" style="margin-top:12px">Á netinu fara beiðnir og staðsetningar dulkóðaðar með hópkóðanum um ntfy.sh. Ef ekkert svar kemur innan 25 sekúndna er sent SMS. SMS-in sjást líka í skilaboðaforriti símans.</p>`;
    document.body.appendChild(fsheet);
    fsheet.querySelector("[data-fclose]").onclick = () => window.RK.closeSheet();
    const $ = id => fsheet.querySelector("#" + id);
    $("fMe").value = get("me", ""); $("fPhone").value = get("myPhone", ""); $("fGroup").value = get("group", "");
    $("fAuto").checked = get("autoReply", true);
    $("fMe").oninput = () => { set("me", $("fMe").value.trim()); syncFriends(); const pm = document.getElementById("myName"); if (pm) pm.value = $("fMe").value; };
    $("fPhone").oninput = () => { set("myPhone", $("fPhone").value.trim()); syncFriends(); renderFriends(); };
    $("fGroup").oninput = () => { set("group", $("fGroup").value.trim()); syncFriends(); renderFriends(); };
    $("fAuto").onchange = () => { set("autoReply", $("fAuto").checked); syncFriends(); };
    $("fGen").onclick = () => {
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c = "rjupa-";
      const r = new Uint32Array(8); crypto.getRandomValues(r); r.forEach(v => c += abc[v % abc.length]);
      $("fGroup").value = c; $("fGroup").oninput();
      toast("Nýr hópkóði búinn til. Sendu hann á félagana og láttu þá slá hann inn.", 7000);
    };
    $("fCopy").onclick = async () => {
      const v = $("fGroup").value.trim(); if (!v) return;
      try { await navigator.clipboard.writeText(v); toast("Hópkóðinn afritaður"); } catch (e) { $("fGroup").select(); }
    };
    $("fAdd").onclick = () => {
      const n = $("fNewName").value.trim(), ph = $("fNewPhone").value.trim();
      if (!n || last7(ph).length < 7) { $("fMsg").textContent = "Settu inn nafn og símanúmer (7 tölustafir eða fleiri)."; $("fMsg").className = "msg err"; return; }
      const list = friends().filter(f => last7(f.phone) !== last7(ph));
      list.push({ name: n, phone: ph }); set("friends", list); syncFriends();
      $("fNewName").value = ""; $("fNewPhone").value = ""; $("fMsg").textContent = `${n} bætt við.`; $("fMsg").className = "msg";
      renderFriends();
    };
    $("fLink").onclick = () => window.RK.openPing();
  }

  function stateText(f) {
    const s = fstate[last7(f.phone)];
    const R = window.RK, lp = R && R.lastFrom(f.name);
    if (s && s.state === "ntfy" && Date.now() - s.t < 30000) return "Spyr um netið…";
    if (s && s.state === "sms" && Date.now() - s.t < 180000) return "SMS sent, bíð eftir svari…";
    if (lp) { const rel = R.relFromMe(lp); return `Síðast ${R.ago(lp.ts)}${rel ? " · " + rel.text : ""}`; }
    return f.phone;
  }
  function renderFriends() {
    if (!fsheet) return;
    const list = friends(), box = fsheet.querySelector("#fList"), intro = fsheet.querySelector("#fIntro");
    const ready = get("myPhone", "") && get("group", "");
    intro.textContent = !list.length ? "Bættu við félögum hér fyrir neðan. Þeir þurfa líka appið og sama hópkóða."
      : ready ? "Ýttu á Finna. Félaginn þarf ekki að snerta símann sinn."
      : "Settu inn símanúmerið þitt og hópkóða hér fyrir neðan. Án þeirra er bara notað SMS.";
    box.innerHTML = "";
    for (const f of list) {
      const row = document.createElement("div"); row.className = "ptrow";
      row.innerHTML = `<span class="dotp" style="background:#9b4fc4"></span><div class="t"><b>${escH(f.name)}</b><span>${escH(stateText(f))}</span></div>`;
      const go = document.createElement("button"); go.className = "btn"; go.type = "button"; go.textContent = "Finna";
      go.style.padding = "8px 14px";
      go.onclick = () => findFriend(f);
      const del = document.createElement("button"); del.className = "del"; del.type = "button"; del.textContent = "✕";
      del.setAttribute("aria-label", "Fjarlægja " + f.name);
      del.onclick = () => {
        if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Eyða?"; setTimeout(() => { if (del.isConnected) { del.dataset.armed = ""; del.textContent = "✕"; } }, 3000); return; }
        set("friends", friends().filter(x => last7(x.phone) !== last7(f.phone))); syncFriends(); renderFriends();
      };
      row.appendChild(go); row.appendChild(del); box.appendChild(row);
    }
  }
  async function renderPerm() {
    if (!fsheet) return;
    const box = fsheet.querySelector("#fPerm");
    try { permState = await F.status(); } catch (e) { permState = null; }
    const st = permState || {};
    box.innerHTML = `
      <div class="setrow" style="border-top:none"><div class="t"><b>SMS ${st.sms ? "✓" : "✗"}</b><span>${st.sms ? "Leyft" : "Þarf til að biðja og svara með SMS"}</span></div>${st.sms ? "" : '<button class="btn sec" id="fSms" type="button">Leyfa</button>'}</div>
      <div class="setrow"><div class="t"><b>Staðsetning alltaf ${st.backgroundLocation ? "✓" : "✗"}</b><span>${st.backgroundLocation ? "Leyft: getur svarað þó appið sé lokað" : "Án þess svarar síminn bara þegar veiðihamur er virkur. Veldu Heimildir → Staðsetning → Leyfa alltaf."}</span></div>${st.backgroundLocation ? "" : '<button class="btn sec" id="fBg" type="button">Opna stillingar</button>'}</div>`;
    const b1 = box.querySelector("#fSms"); if (b1) b1.onclick = async () => { try { await F.requestSms(); } catch (e) {} renderPerm(); };
    const b2 = box.querySelector("#fBg"); if (b2) b2.onclick = () => F.openSettings().catch(() => {});
  }
  async function findFriend(f) {
    const k = last7(f.phone);
    if (!(permState && permState.sms)) { try { permState = await F.requestSms(); } catch (e) {} }
    try {
      const r = await F.find({ phone: f.phone, name: f.name });
      fstate[k] = { state: r.via, t: Date.now() };
      toast(r.via === "ntfy" ? `Spyr ${f.name} um netið. SMS fer ef ekkert svar kemur.` : `SMS sent til ${f.name}.`, 5000);
    } catch (e) { toast("Tókst ekki: " + (e.message || e), 6000); }
    renderFriends();
  }
  function openFriends() {
    if (!fsheet) buildSheet();
    renderFriends(); renderPerm();
    window.RK.openPanel(fsheet);
  }
  function initFriends() {
    const b = document.getElementById("btnPing");
    if (b) { b.textContent = "Félagar"; b.onclick = openFriends; }
    F.addListener("location", it => takeLocation(it, false)).catch(() => {});
    F.addListener("status", s => { if (fstate[s.phone]) { fstate[s.phone] = { state: s.state, t: Date.now() }; renderFriends(); } }).catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { pullPending(true); renderPerm(); } });
    syncFriends();
    pullPending(true);
    setInterval(() => { if (fsheet && !fsheet.hidden) renderFriends(); }, 5000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(injectUI, 0));
  else setTimeout(injectUI, 0);
})();
