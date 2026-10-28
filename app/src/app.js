/* S. Másson — brú við Android (Capacitor).
   Hlaðið á undan kóða kortsins. Gerir ekkert í venjulegum vafra. */
(function () {
  "use strict";
  const C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== "function" || !C.isNativePlatform()) return;
  window.RK_APP = true;
  if (typeof C.registerPlugin !== "function") {
    window.addEventListener("load", () => window.RK && window.RK.toast("Villa í appinu: Capacitor kjarni hlóðst ekki. Másson activate virkar ekki.", 10000));
    return;
  }

  const BG = C.registerPlugin("BackgroundGeolocation");
  // Sækja gögn framhjá CORS-takmörkunum vafrans (t.d. landeignaskrá HMS)
  const HTTP = C.registerPlugin("CapacitorHttp");
  window.__nativeGet = async (url) => {
    const r = await HTTP.get({ url, responseType: "json", connectTimeout: 30000, readTimeout: 60000 });
    if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status);
    return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  };
  // Kortaflís sótt í gegnum síma (ef vafrahlutinn má það ekki)
  window.__nativeBlob = async (url) => {
    const r = await HTTP.get({ url, responseType: "blob", connectTimeout: 20000, readTimeout: 30000 });
    if (r.status < 200 || r.status >= 300) throw new Error("HTTP " + r.status);
    const bin = atob(r.data), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: "image/png" });
  };
  const LN = C.registerPlugin("LocalNotifications");
  const get = (k, d) => { try { const v = localStorage.getItem("rk:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem("rk:" + k, JSON.stringify(v)); } catch (e) {} };
  const dur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} mín` : `${Math.floor(m / 60)} klst ${m % 60} mín`; };
  const toast = (t, ms) => { if (window.RK) window.RK.toast(t, ms); };

  let hunt = get("hunt", false), huntStart = get("huntStart", 0);
  const masson = () => (get("set", {}) || {}).masson !== false;
  const disp = n => (window.__dispName ? window.__dispName(n) : n);

  /* ---------- Staðsetning: navigator.geolocation keyrir á GPS-þjónustu símans ---------- */
  const subs = new Map();
  let nextId = 1, bgId = null, bgBusy = Promise.resolve(), endT = null, bgSaver = false;

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
        toast("Leyfðu staðsetningu: Stillingar → Forrit → S. Másson → Heimildir → Staðsetning.", 9000);
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
      // Sparnaðarhamur: GPS mælir sjaldnar (á um 40 m fresti í ferð)
      const saver = !!(window.__saverActive && window.__saverActive());
      bgSaver = saver;
      const opts = hunt
        ? { backgroundTitle: masson() ? "Másson er virkur" : "Tracking virkt", backgroundMessage: "Fylgist með bannsvæðum. Ýttu til að opna kortið.",
            requestPermissions: true, stale: false, distanceFilter: saver ? 40 : 15 }
        : { requestPermissions: true, stale: false, distanceFilter: saver ? 25 : 5 };
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
  const restart = () => { stop(); zoneLast = ""; return start(); };
  window.__onSaver = on => { if (bgId && !!on !== bgSaver) restart(); };

  const geo = navigator.geolocation || {};
  try {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      watchPosition(s, e) { const id = nextId++; subs.set(id, { s, e }); start(); return id; },
      clearWatch(id) {
        subs.delete(id);
        if (!subs.size) {
          // Bíða aðeins: kortið skiptir stundum um GPS-áskrift (slökkt og kveikt strax aftur)
          clearTimeout(endT);
          endT = setTimeout(() => {
            if (subs.size) return;
            stop();
            if (hunt && window.RK) { window.RK.setHunt(false); toast((masson() ? "Másson" : "Tracking") + " lokið því slökkt var á GPS."); }
          }, 2500);
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
  window.__notify = (title, body) => notify(title, body, "almennt");
  // Kallað úr kortinu þegar staða breytist (0 öruggt … 5 innan bannsvæðis)
  let zoneLast = "", zoneAt = 0;
  window.__onLevel = (level, prev, title, sub, cls) => {
    // Táknið og liturinn í Másson-tilkynningunni: grænt ✓, rautt ✕, gult ?
    if (hunt && bgId) {
      const kind = cls === "heimilt" ? "ok" : cls === "bann" ? "bann" : "q";
      const icon = kind === "ok" ? "✅" : kind === "bann" ? "⛔" : (cls === "leyfi" || cls === "athuga" || cls === "near") ? "⚠️" : "❔";
      const paused = !!(window.RK && window.RK.isPaused && window.RK.isPaused());
      const t = `${icon} ${title}`, key = kind + "|" + t + "|" + sub + "|" + paused;
      if (key !== zoneLast || Date.now() - zoneAt > 90000) {
        zoneLast = key; zoneAt = Date.now();
        try { F.zone({ kind, title: t, text: sub, paused }).catch(() => {}); } catch (e) {}
      }
    }
    if (!hunt || prev == null) return;
    if (level > prev && level >= 2 && document.visibilityState !== "visible") notify(title, sub, "vidvaranir");
  };

  /* ---------- Veiðihamur (kortið á rofann og slóðina; hér er GPS í bakgrunni) ---------- */
  window.__beforeHunt = async () => {
    try { await LN.requestPermissions(); } catch (e) {}
    await ensureChannels();
  };
  window.__onHunt = (on) => {
    hunt = on;
    if (on) huntStart = Date.now();
    restart();
    syncFriends();
  };
  // Másson-hamur kveiktur eða slökktur: tilkynningin í bakgrunni og gælunöfnin í Java
  window.__onMasson = () => { syncFriends(); renderFriends(); if (hunt && bgId) restart(); };
  function injectUI() {
    initFriends();
  }

  /* ---------- Finna félaga ---------- */
  const F = C.registerPlugin("Felagar");
  // Sameiginleg stigatafla: dulkóðað á hóprás (Java sér um dulkóðun og tilkynningar í bakgrunni)
  window.__groupSend = msg => F.groupSend({ msg: JSON.stringify(msg) }).catch(() => {});
  window.__groupFetch = since => F.groupFetch({ since });
  window.__listenUntil = until => F.listenUntil({ until }).catch(() => {});
  F.addListener("group", m => { if (window.__onGroupMsg) window.__onGroupMsg(m, true); }).catch(() => {});
  // Takkarnir í Másson-tilkynningunni (Pása / Halda áfram / Ljúka ferð)
  async function drainHuntAction() {
    let a = null;
    try { a = (await F.takeHuntAction()).a; } catch (e) {}
    const R = window.RK; if (!a || !R) return;
    if (a === "pause") R.setPause(true);
    else if (a === "resume") R.setPause(false);
    else if (a === "stop" && R.isHunting()) R.setHunt(false);
  }
  F.addListener("huntAction", () => drainHuntAction()).catch(() => {});
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") drainHuntAction(); });
  setTimeout(drainHuntAction, 1500);
  window.__onPause = paused => { zoneLast = ""; try { F.huntPaused({ paused }).catch(() => {}); } catch (e) {} };
  const fstate = {};   // síðustu 7 tölustafir -> {state, t}
  const last7 = p => { const d = String(p || "").replace(/[^0-9]/g, ""); return d.length <= 7 ? d : d.slice(-7); };
  const escH = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function friends() { const a = get("friends", []); return Array.isArray(a) ? a : []; }
  function syncFriends() {
    try {
      const mc = window.__massonCfg ? window.__massonCfg() : { masson: masson(), nicks: "" };
      F.configure({ myPhone: get("myPhone", ""), myName: get("me", ""), group: get("group", ""),
                    autoReply: get("autoReply", true), hunt, friends: friends(), masson: mc.masson, nicks: mc.nicks }).catch(() => {});
    } catch (e) {}
  }
  function takeLocation(it, focus) {
    const R = window.RK; if (!R) return;
    const p = R.addRemotePoint({ lat: it.lat, lon: it.lon, acc: it.acc, ts: it.ts * 1000, type: "ping", from: it.name });
    const k = last7(it.phone);
    const waited = fstate[k] && fstate[k].state !== "done";
    fstate[k] = { state: "done", t: Date.now(), via: it.via };
    if (focus || waited) { R.closeSheet(); R.setTab("map"); R.showRemote(p, false); }
    renderFriends();
  }
  async function pullPending(focus) {
    try { const r = await F.getPending(); (r.items || []).forEach(it => takeLocation(it, focus)); } catch (e) {}
  }

  let fsheet = null, permState = null;
  function buildSheet() {
    // Listinn fer á Félaga-síðuna, uppsetningin í Stillingar
    const top = document.getElementById("friendsApp");
    top.innerHTML = `
  <p class="note" id="fIntro" style="margin:0 4px 10px"></p>
  <div class="group" id="fList"></div>`;
    fsheet = document.getElementById("setFriendsApp");
    fsheet.innerHTML = `
  <div class="group"><div class="ginner">
    <label class="f">Nafnið þitt<input type="text" id="fMe" maxlength="24" placeholder="t.d. Grétar"></label>
    <label class="f">Símanúmerið þitt<input type="text" id="fPhone" inputmode="tel" maxlength="16" placeholder="t.d. 8201234"></label>
    <label class="f">Hópkóði (sami hjá öllum í hópnum)<input type="text" id="fGroup" maxlength="40" autocapitalize="off" autocomplete="off" placeholder="t.d. rjupa-K7Q2M"></label>
    <div class="row"><button class="btn sec" id="fGen" type="button">Búa til kóða</button><button class="btn sec" id="fCopy" type="button">Afrita kóða</button></div>
    <label class="setrow"><div class="t"><b>Svara félögum sjálfkrafa</b><span>Síminn sendir staðsetninguna þegar félagi á listanum biður um hana.</span></div><input type="checkbox" class="tog" id="fAuto"></label>
  </div></div>

  <div class="group" style="margin-top:8px"><div class="ginner">
    <b>Bæta við félaga</b>
    <div class="row">
      <input type="text" id="fNewName" maxlength="24" placeholder="Nafn">
      <input type="text" id="fNewPhone" inputmode="tel" maxlength="16" placeholder="Símanúmer">
    </div>
    <button class="btn" id="fAdd" type="button">Bæta við</button>
    <p class="msg" id="fMsg"></p>
    <div id="fManage"></div>
  </div></div>

  <div class="group" style="margin-top:8px"><div class="ginner" id="fPerm"></div></div>
  <p class="note" style="margin:10px 4px 0">Á netinu fara beiðnir og staðsetningar dulkóðaðar með hópkóðanum um ntfy.sh. Ef ekkert svar kemur innan 25 sekúndna er sent SMS. SMS-in sjást líka í skilaboðaforriti símans.</p>`;
    const $ = id => document.getElementById(id);
    $("fMe").value = get("me", ""); $("fPhone").value = get("myPhone", ""); $("fGroup").value = get("group", "");
    $("fAuto").checked = get("autoReply", true);
    $("fMe").oninput = () => { set("me", $("fMe").value.trim()); syncFriends(); const pm = document.getElementById("myName"); if (pm) pm.value = $("fMe").value; };
    $("fPhone").oninput = () => { set("myPhone", $("fPhone").value.trim()); syncFriends(); renderFriends(); if (window.__massonRefresh) window.__massonRefresh(); };
    $("fGroup").oninput = () => { set("group", $("fGroup").value.trim()); syncFriends(); renderFriends(); if (window.__massonRefresh) window.__massonRefresh(); };
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
  }

  function stateText(f) {
    const s = fstate[last7(f.phone)];
    const R = window.RK, lp = R && R.lastFrom(f.name);
    if (s && s.state === "ntfy" && Date.now() - s.t < 30000) return "Spyr um netið…";
    if (s && s.state === "sms" && Date.now() - s.t < 180000) return "SMS sent, bíð eftir svari…";
    if (lp) { const rel = R.relFromMe(lp); return `Síðast ${R.ago(lp.ts)}${rel ? " · " + rel.text : ""}`; }
    return f.phone;
  }
  const AV = [["#EFE8FA", "#6A3FB5"], ["#E4EEF8", "#1F5F9E"], ["#E7F0E1", "#3E5A1E"], ["#FBEAE0", "#9A3C0B"]];
  function renderFriends() {
    if (!fsheet) return;
    const list = friends(), box = document.getElementById("fList"), intro = document.getElementById("fIntro");
    const ready = get("myPhone", "") && get("group", "");
    intro.textContent = !list.length ? "Engir félagar enn. Þeir sem ganga í hópinn birtast hér sjálfkrafa."
      : ready ? "Ýttu á Finna. Félaginn þarf ekki að snerta símann, hann svarar sjálfkrafa."
      : "Settu inn símanúmerið þitt og hópkóða í Stillingum. Án þeirra er bara notað SMS.";
    box.hidden = !list.length;
    box.innerHTML = "";
    list.forEach((f, i) => {
      const [bg, fg] = AV[i % AV.length];
      const st = fstate[last7(f.phone)];
      const busy = st && ((st.state === "ntfy" && Date.now() - st.t < 30000) || (st.state === "sms" && Date.now() - st.t < 180000));
      const row = document.createElement("div"); row.className = "ptrow"; row.style.cursor = "default";
      row.innerHTML = `<span class="dotp" style="width:40px;height:40px;background:${bg};color:${fg};font-weight:700;font-size:16px">${escH((disp(f.name) || "?").charAt(0).toUpperCase())}</span><div class="t"><b>${escH(disp(f.name))}</b><span>${escH(stateText(f))}</span></div>`;
      const go = document.createElement("button"); go.type = "button"; go.textContent = busy ? "Bíð" : "Finna";
      go.className = busy ? "btn sec" : "btn"; go.disabled = !!busy;
      go.style.cssText = "padding:9px 18px;border-radius:20px;flex:none";
      go.onclick = () => findFriend(f);
      row.appendChild(go); box.appendChild(row);
    });
    const man = document.getElementById("fManage");
    if (man) {
      man.innerHTML = "";
      for (const f of list) {
        const r = document.createElement("div"); r.className = "setrow";
        r.innerHTML = `<div class="t"><b>${escH(f.name)}</b><span>${escH(f.phone)}</span></div>`;
        const del = document.createElement("button"); del.className = "del"; del.type = "button"; del.textContent = "✕";
        del.setAttribute("aria-label", "Fjarlægja " + f.name);
        del.onclick = () => {
          if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Eyða?"; setTimeout(() => { if (del.isConnected) { del.dataset.armed = ""; del.textContent = "✕"; } }, 3000); return; }
          set("friends", friends().filter(x => last7(x.phone) !== last7(f.phone))); syncFriends(); renderFriends();
        };
        r.appendChild(del); man.appendChild(r);
      }
    }
  }
  async function renderPerm() {
    if (!fsheet) return;
    const box = document.getElementById("fPerm");
    try { permState = await F.status(); } catch (e) { permState = null; }
    const st = permState || {};
    box.innerHTML = `
      <div class="setrow"><div class="t"><b>SMS ${st.sms ? "✓" : "✗"}</b><span>${st.sms ? "Leyft" : "Þarf til að biðja og svara með SMS"}</span></div>${st.sms ? "" : '<button class="btn sec" id="fSms" type="button">Leyfa</button>'}</div>
      <div class="setrow"><div class="t"><b>Staðsetning alltaf ${st.backgroundLocation ? "✓" : "✗"}</b><span>${st.backgroundLocation ? "Leyft: getur svarað þó appið sé lokað" : "Án þess svarar síminn bara þegar Másson er virkur. Veldu Heimildir → Staðsetning → Leyfa alltaf."}</span></div>${st.backgroundLocation ? "" : '<button class="btn sec" id="fBg" type="button">Opna stillingar</button>'}</div>`;
    const b1 = box.querySelector("#fSms"); if (b1) b1.onclick = async () => { try { await F.requestSms(); } catch (e) {} renderPerm(); };
    const b2 = box.querySelector("#fBg"); if (b2) b2.onclick = () => F.openSettings().catch(() => {});
  }
  async function findFriend(f) {
    const k = last7(f.phone);
    if (window.__onFind) try { window.__onFind(f.phone); } catch (e) {}
    if (!(permState && permState.sms)) { try { permState = await F.requestSms(); } catch (e) {} }
    try {
      const r = await F.find({ phone: f.phone, name: f.name });
      fstate[k] = { state: r.via, t: Date.now() };
      toast(r.via === "ntfy" ? `Spyr ${disp(f.name)} um netið. SMS fer ef ekkert svar kemur.` : `SMS sent til ${disp(f.name)}.`, 5000);
    } catch (e) { toast("Tókst ekki: " + (e.message || e), 6000); }
    renderFriends();
  }
  // Hópskráning úr Hópnum: uppfæra reitina í Stillingum og Java
  window.__groupChanged = () => {
    const $ = id => document.getElementById(id);
    if ($("fMe")) { $("fMe").value = get("me", ""); $("fPhone").value = get("myPhone", ""); $("fGroup").value = get("group", ""); }
    syncFriends(); renderFriends();
  };
  // Félagar í hópnum bætast sjálfkrafa á listann (nafn og númer koma dulkóðuð á hóprásinni)
  window.__addGroupFriend = (name, phone) => {
    const k = last7(phone);
    if (!name || k.length < 7 || k === last7(get("myPhone", ""))) return;
    const list = friends(), f = list.find(x => last7(x.phone) === k);
    if (f && (!f.auto || f.name === name)) return;
    if (f) f.name = name; else list.push({ name, phone, auto: true });
    set("friends", list); syncFriends(); renderFriends();
  };
  window.__findByPhone = (phone, name) => {
    const f = friends().find(x => last7(x.phone) === last7(phone)) || { name: name || phone, phone };
    findFriend(f);
  };
  function initFriends() {
    buildSheet(); renderFriends(); renderPerm();
    window.__onFriendsTab = () => { renderFriends(); renderPerm(); };
    F.addListener("location", it => takeLocation(it, false)).catch(() => {});
    F.addListener("status", s => { if (fstate[s.phone]) { fstate[s.phone] = { state: s.state, t: Date.now() }; renderFriends(); } }).catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { pullPending(true); renderPerm(); } });
    syncFriends();
    pullPending(true);
    setInterval(() => { const pg = document.getElementById("pgFriends"); if (pg && !pg.hidden) renderFriends(); }, 5000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(injectUI, 0));
  else setTimeout(injectUI, 0);
})();
