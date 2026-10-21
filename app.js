import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { artOf } from "./arte.js";

const firebaseConfig = {
  apiKey: "AIzaSyAQPaROMnO7HiqxWFotmcdMGNSPxxJsoUs",
  authDomain: "sala-expedientes.firebaseapp.com",
  projectId: "sala-expedientes",
  storageBucket: "sala-expedientes.firebasestorage.app",
  messagingSenderId: "167572646730",
  appId: "1:167572646730:web:fa7aaab5c271cb30e3afb3"
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
setPersistence(auth, browserLocalPersistence).catch(() => {});
let db;
try { db = initializeFirestore(fb, { localCache: persistentLocalCache() }); }
catch (e) { db = initializeFirestore(fb, {}); }

/* ===== Estado ===== */
let USER = null;
let CASOS = [];          // casos cargados (objetos completos)
let PROG = {};           // progreso por id de caso
let CASE = null;         // caso abierto
const UI = { view: "home", tab: "expediente", threadMode: false, sel: null, confirm: null, err: "", revealAsk: false, accName: "", accIds: [], loading: true, loginErr: "" };

const fresh = () => ({ status: "nuevo", intento: 1, pinned: ["victima"], pos: { victima: { x: 40, y: 40 } }, links: [], notas: "", citas: [], estado: {}, leidos: [], vistos: [], acusados: [] });
const S = () => PROG[CASE.id] || (PROG[CASE.id] = fresh());

const timers = {};
function save(id = CASE && CASE.id, now = false) {
  if (!id || !USER) return;
  clearTimeout(timers[id]);
  const run = () => setDoc(doc(db, "usuarios", USER.uid, "progreso", id), { json: JSON.stringify(PROG[id]), actualizado: serverTimestamp() })
    .catch(e => toast("No se pudo guardar: " + msgErr(e)));
  if (now) run(); else timers[id] = setTimeout(run, 700);
}
document.addEventListener("visibilitychange", () => { if (document.hidden) Object.keys(timers).forEach(id => save(id, true)); });

/* ===== Utilidades ===== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
const ini = n => n.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
const P = id => CASE.personas.find(p => p.id === id);
const E = id => CASE.evidencias.find(e => e.id === id);
const PALETA = ["#d8b24a", "#7a8fa6", "#d17a52", "#8a6aa8", "#9b7a54", "#6f8f7a", "#e3cf8a", "#a58a6a", "#7fa3b8", "#b8706f"];
const color = id => { const i = CASE.personas.findIndex(p => p.id === id); return PALETA[(i < 0 ? 0 : i) % PALETA.length]; };
const conInterrogatorio = () => CASE.personas.filter(p => (CASE.interrogatorios || {})[p.id]);
const unlocked = () => { const c = conInterrogatorio(); return c.length === 0 || c.every(p => S().leidos.includes(p.id)); };
const artHTML = e => e.img ? `<img src="${esc(e.img)}" alt="${esc(e.titulo)}">` : artOf(e.art);
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
function msgErr(e) {
  const c = (e && e.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-email")) return "Correo o contraseña incorrectos.";
  if (c.includes("too-many-requests")) return "Demasiados intentos. Espera unos minutos.";
  if (c.includes("network")) return "Sin conexión. Revisa tu internet.";
  if (c.includes("permission-denied")) return "Sin permiso en la base de datos. Revisa las reglas de Firestore.";
  return (e && e.message) || "Error desconocido.";
}
function avatar(id, cls = "") { const p = P(id); return `<div class="avatar ${cls}" style="background:${color(id)}">${esc(ini(p.nombre))}</div>`; }
const ST_LABEL = { sospechoso: "Sospechoso", descartado: "Descartado", clave: "Clave" };
const ST_NEXT = { sospechoso: "clave", clave: "descartado", descartado: "sospechoso" };
function statusChip(pr) {
  const st = pr ? pr.status : "nuevo";
  return { nuevo: '<span class="chip tag">Nuevo</span>', en_curso: `<span class="chip">En curso · intento ${pr && pr.intento}</span>`, fallado: '<span class="chip bad">Acusación fallida</span>', resuelto: '<span class="chip ok">Resuelto</span>', revelado: '<span class="chip">Cerrado · solución vista</span>' }[st];
}
const nombres = ids => ids.map(i => P(i).nombre).join(" y ");

/* ===== Datos ===== */
async function cargarTodo() {
  UI.loading = true; render();
  try {
    const [cs, ps] = await Promise.all([getDocs(collection(db, "casos")), getDocs(collection(db, "usuarios", USER.uid, "progreso"))]);
    CASOS = []; cs.forEach(d => { try { CASOS.push(JSON.parse(d.data().json)); } catch (e) {} });
    CASOS.sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99) || a.titulo.localeCompare(b.titulo));
    PROG = {}; ps.forEach(d => { try { PROG[d.id] = Object.assign(fresh(), JSON.parse(d.data().json)); } catch (e) {} });
  } catch (e) { toast(msgErr(e)); }
  UI.loading = false; render();
}

function validarCaso(c) {
  const fallas = [];
  if (!c || typeof c !== "object") return ["El archivo no es un caso."];
  ["id", "titulo", "victima", "personas", "evidencias", "culpables", "solucion"].forEach(k => { if (!c[k]) fallas.push("Falta el campo " + k); });
  if (c.id && !/^[a-z0-9-]+$/.test(c.id)) fallas.push("El id solo puede tener minúsculas, números y guiones.");
  if (Array.isArray(c.culpables) && Array.isArray(c.personas)) c.culpables.forEach(id => { if (!c.personas.some(p => p.id === id)) fallas.push("Culpable desconocido: " + id); });
  return fallas;
}
async function importarArchivos(files) {
  let ok = 0;
  for (const f of files) {
    try {
      const data = JSON.parse(await f.text());
      const lista = Array.isArray(data) ? data : [data];
      for (const c of lista) {
        const fallas = validarCaso(c);
        if (fallas.length) { toast(`${f.name}: ${fallas[0]}`); continue; }
        await setDoc(doc(db, "casos", c.id), { titulo: c.titulo, orden: c.orden ?? 99, json: JSON.stringify(c), actualizado: serverTimestamp() });
        ok++;
      }
    } catch (e) { toast(`${f.name}: ${e instanceof SyntaxError ? "el archivo no es JSON válido" : msgErr(e)}`); }
  }
  if (ok) { toast(ok === 1 ? "Caso importado" : `${ok} casos importados`); await cargarTodo(); }
}
$("#importfile").addEventListener("change", e => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) importarArchivos(fs); });

/* ===== Render ===== */
function render() {
  const app = $("#app");
  if (!USER) { app.innerHTML = vLogin(); bindLogin(); return; }
  if (UI.view === "home" || !CASE) { app.innerHTML = vHome(); bindHome(); return; }
  const st = S().status;
  if (st === "revelado" || st === "resuelto" || st === "fallado") { app.innerHTML = caseHeader() + vResultado(); bindResultado(); return; }
  app.innerHTML = caseHeader() + `<div id="tabview">${tabView()}</div>` + tabs();
  bindCase();
}

function vLogin() {
  return `<div class="wrap"><div class="login">
  <div class="brand" style="margin:0"><div class="badge">S</div><h1>Sala de Expedientes</h1></div>
  <p class="muted">Acceso restringido. Ingresa con tu cuenta de detective.</p>
  <form id="loginform" novalidate>
   <label for="lemail">Correo<input class="input" id="lemail" type="email" autocomplete="username" inputmode="email" required></label>
   <label for="lpass">Contraseña<input class="input" id="lpass" type="password" autocomplete="current-password" required></label>
   <button class="btn primary" id="lgo" type="submit">Entrar</button>
   <div class="err" id="lerr">${esc(UI.loginErr)}</div>
  </form></div></div>`;
}
function bindLogin() {
  $("#loginform").addEventListener("submit", async e => {
    e.preventDefault();
    const em = $("#lemail").value.trim(), pw = $("#lpass").value;
    if (!em || !pw) { $("#lerr").textContent = "Escribe tu correo y contraseña."; return; }
    $("#lgo").disabled = true; $("#lgo").textContent = "Entrando...";
    try { await signInWithEmailAndPassword(auth, em, pw); UI.loginErr = ""; }
    catch (err) { UI.loginErr = msgErr(err); render(); }
  });
}

function vHome() {
  const lista = UI.loading ? `<p class="muted">Cargando casos...</p>` : CASOS.length ? CASOS.map((c, i) => {
    const pr = PROG[c.id];
    return `<button class="case" data-open="${esc(c.id)}"><div class="folder">${esc(c.numero || "#" + String(i + 1).padStart(2, "0"))}</div>
     <div><h3>${esc(c.titulo)}</h3><div class="muted" style="font-size:13px">${esc(c.exp || "")}</div>
     <div class="meta"><span class="chip">${esc(c.dificultad || "—")}</span><span class="chip">${c.personas.length} personas</span><span class="chip">${c.evidencias.length} evidencias</span>${statusChip(pr)}</div></div></button>`;
  }).join("") : `<div class="empty"><b>No hay casos todavía.</b><p class="muted">Importa el archivo .json de un caso para empezar. Los casos se guardan en tu base de datos privada, no en el código de la página.</p><div><button class="btn primary" data-import>Importar caso</button></div></div>`;
  return `<div class="wrap">
  <div class="brand"><div class="badge">S</div><h1>Sala de Expedientes</h1></div>
  <p class="intro">Revisa la evidencia, arma tu tablero y acusa. Tienes un solo intento por partida.</p>
  <div class="cases">${lista}</div>
  <div class="foot">
   <div class="row"><button class="btn" data-import>Importar caso (.json)</button><button class="btn" id="logout">Cerrar sesión</button></div>
   <div class="row">Sesión: ${esc(USER.email)}</div>
  </div></div>`;
}
function bindHome() {
  document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => abrirCaso(b.dataset.open));
  document.querySelectorAll("[data-import]").forEach(b => b.onclick = () => $("#importfile").click());
  $("#logout").onclick = () => signOut(auth);
}
function abrirCaso(id) {
  CASE = CASOS.find(c => c.id === id); if (!CASE) return;
  const s = S(); if (s.status === "nuevo") { s.status = "en_curso"; save(); }
  Object.assign(UI, { view: "case", tab: "expediente", threadMode: false, sel: null, confirm: null, err: "", revealAsk: false, accName: "" });
  render(); scrollTo(0, 0);
}

function caseHeader() {
  return `<div class="wrap" style="padding-bottom:0"><div class="top">
  <button class="back" id="back" aria-label="Volver a los casos"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>
  <div class="t"><div class="label">${esc(CASE.exp || "")}</div><h2>${esc(CASE.titulo)}</h2></div>
  <div class="status">${statusChip(S())}</div></div></div>`;
}
const ICONS = {
  expediente: '<svg viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h6"/></svg>',
  evidencia: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/></svg>',
  tablero: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="15" rx="1"/><circle cx="8" cy="9" r="1.4"/><circle cx="16" cy="14" r="1.4"/><path d="M8 9l8 5"/></svg>',
  notas: '<svg viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5z"/><path d="M9 10h6M9 14h6M9 18h3"/></svg>',
  acusar: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/></svg>'
};
function tabs() {
  const t = [["expediente", "Expediente"], ["evidencia", "Evidencia"], ["tablero", "Tablero"], ["notas", "Notas"], ["acusar", "Acusar"]];
  const hayLock = CASE.evidencias.some(e => e.lock);
  const dot = hayLock && unlocked() && !S().vistos.includes("nuevas");
  return `<nav class="tabs"><div class="in">${t.map(([k, l]) => `<button data-tab="${k}" class="${UI.tab === k ? "on" : ""}">${ICONS[k]}${k === "evidencia" && dot ? '<span class="dot"></span>' : ""}<span>${l}</span></button>`).join("")}</div></nav>`;
}
function tabView() { return { expediente: vExp, evidencia: vEv, tablero: vBoard, notas: vNotas, acusar: vAcusar }[UI.tab](); }

function vExp() {
  const s = S(), v = CASE.victima, iv = conInterrogatorio(), read = iv.filter(p => s.leidos.includes(p.id)).length, hayLock = CASE.evidencias.some(e => e.lock);
  return `<div class="wrap" style="padding-top:4px">
  ${CASE.carta ? `<div class="sec" style="margin-top:6px"><div class="memo"><span class="stamp">CONFIDENCIAL</span>${CASE.carta.map(p => `<p>${esc(p)}</p>`).join("")}${CASE.firma ? `<p style="margin-top:14px">${esc(CASE.firma)}</p>` : ""}</div></div>` : ""}
  <div class="sec"><span class="label">Víctima</span>
   <div class="person"><div class="avatar" style="background:#c9b9a3">${esc(v.iniciales || ini(v.nombre))}</div><div style="min-width:0"><div class="n">${esc(v.nombre)}</div><div class="r">${esc(v.detalle || "")}</div></div><button class="pill ${s.pinned.includes("victima") ? "on" : ""}" data-pin="victima">${s.pinned.includes("victima") ? "En tablero" : "Fijar"}</button></div>
   ${v.datos ? `<div class="facts">${v.datos.map(([k, x]) => `<div class="fact"><span class="label">${esc(k)}</span><b>${esc(x)}</b></div>`).join("")}</div>` : ""}
  </div>
  <div class="sec"><span class="label">Personas de interés · toca el estado para cambiarlo</span><div class="people">
   ${CASE.personas.map(p => { const st = s.estado[p.id] || "sospechoso", pin = s.pinned.includes("p:" + p.id);
     return `<div class="person ${st}">${avatar(p.id)}<div style="min-width:0"><div class="n">${esc(p.nombre)}${p.edad ? ", " + p.edad : ""}</div><div class="r">${esc(p.rol || "")}</div>${p.detalles ? `<div class="r mono" style="font-size:11.5px">${p.detalles.map(esc).join(" · ")}</div>` : ""}</div>
     <div class="actions"><button class="pill st-${st}" data-st="${p.id}">${ST_LABEL[st]}</button><button class="pill ${pin ? "on" : ""}" data-pin="p:${p.id}">${pin ? "En tablero" : "Fijar"}</button></div></div>`; }).join("")}
  </div></div>
  ${CASE.cronologia ? `<div class="sec"><span class="label">Cronología conocida</span><ul class="timeline">${CASE.cronologia.map(([h, t]) => `<li><span class="h">${esc(h)}</span>${esc(t)}</li>`).join("")}</ul></div>` : ""}
  ${iv.length ? `<div class="sec"><span class="label">Interrogatorios</span>
   <div class="progress"><span class="mono">${read}/${iv.length}</span><div class="bar"><i style="width:${read / iv.length * 100}%"></i></div><span>${hayLock ? (read < iv.length ? "Lee todos para desbloquear nuevas pistas" : "Nuevas pistas desbloqueadas") : ""}</span></div>
   <p class="hint" style="margin-bottom:10px">Toca una respuesta para guardarla como cita en tus notas.</p>
   ${iv.map(p => `<details class="iv" data-iv="${p.id}"><summary>${avatar(p.id, "mini")}<b>${esc(p.nombre)}</b><span class="read">${s.leidos.includes(p.id) ? '<span class="chip ok">Leído</span>' : '<span class="chip">Sin leer</span>'}</span></summary>
    <div class="transcript">${CASE.interrogatorios[p.id].map(([q, a], i) => `<div class="q"><b>${esc(CASE.interrogador || "INSP.")}</b>${esc(q)}</div><div class="a"><b>${esc(p.nombre.split(" ")[0].toUpperCase())}</b><span class="hl ${s.citas.some(c => c.k === p.id + "|" + i) ? "on" : ""}" data-cite="${p.id}|${i}" role="button" tabindex="0">${esc(a)}</span></div>`).join("")}</div></details>`).join("")}
  </div>` : ""}</div>`;
}
function vEv() {
  const s = S(), un = unlocked();
  if (un && !s.vistos.includes("nuevas") && CASE.evidencias.some(e => e.lock)) { s.vistos.push("nuevas"); save(); }
  return `<div class="wrap" style="padding-top:4px"><p class="hint" style="margin-bottom:12px">${un ? "Toca una evidencia para examinarla y fijarla en el tablero." : "Las evidencias bloqueadas aparecen cuando termines de leer los interrogatorios."}</p><div class="evgrid">
  ${CASE.evidencias.map(e => { const locked = e.lock && !un, pin = s.pinned.includes("e:" + e.id);
    if (locked) return `<div class="ev locked"><div class="art"><span>BLOQUEADA</span></div><div class="cap"><span class="label">${esc((e.etq || "").split(" · ")[0])}</span><b>Pista pendiente</b></div></div>`;
    return `<button class="ev ${e.lock && !s.vistos.includes(e.id) ? "new" : ""}" data-ev="${e.id}">${pin ? '<span class="pin"></span>' : ""}<div class="art">${artHTML(e)}</div><div class="cap"><span class="label">${esc(e.etq || "")}</span><b>${esc(e.titulo)}</b></div></button>`; }).join("")}
  </div></div>`;
}
function cardHTML(id) {
  const s = S(), p = s.pos[id] || { x: 60, y: 60 }; let inner = "", cls = "";
  if (id === "victima") inner = `<div class="art">${artOf("victima")}</div><b>${esc(CASE.victima.nombre)}</b><small>VÍCTIMA</small>`;
  else if (id.startsWith("p:")) { const pp = P(id.slice(2)); if (!pp) return ""; const st = s.estado[pp.id] || "sospechoso"; cls = "person " + (st === "descartado" ? "descartado" : ""); inner = `<div class="art face">${avatar(pp.id)}</div><b>${esc(pp.nombre)}</b><small>${esc((pp.rol || "").split(",")[0].toUpperCase())}</small>`; }
  else { const e = E(id.slice(2)); if (!e) return ""; inner = `<div class="art">${artHTML(e)}</div><b>${esc(e.titulo)}</b><small>${esc((e.etq || "").split(" · ")[0])}</small>`; }
  return `<div class="bcard ${cls} ${UI.sel === id ? "sel" : ""}" data-card="${id}" style="left:${p.x}px;top:${p.y}px">${inner}</div>`;
}
function vBoard() {
  const s = S();
  return `<div class="wrap" style="padding-top:4px">
  <div class="boardbar"><button class="btn ${UI.threadMode ? "on" : ""}" id="thread">${UI.threadMode ? "Hilo rojo: activo" : "Hilo rojo"}</button>${s.links.length ? `<button class="btn" id="unthread">Quitar hilos (${s.links.length})</button>` : ""}<span class="hint">${UI.threadMode ? (UI.sel ? "Ahora toca la segunda tarjeta." : "Toca dos tarjetas para unirlas o separarlas.") : "Arrastra las tarjetas. Toca una para verla."}</span></div>
  <div class="boardwrap"><div class="board" id="board"><svg class="threads" id="threads"></svg>${s.pinned.map(cardHTML).join("")}</div></div>
  <p class="hint" style="margin-top:10px">Fija personas desde Expediente y objetos desde Evidencia. Tienes ${s.pinned.length} elementos en el tablero.</p></div>`;
}
function vNotas() {
  const s = S();
  return `<div class="wrap" style="padding-top:4px"><div class="sec" style="margin-top:4px"><span class="label">Citas guardadas</span>
  ${s.citas.length ? `<div class="quotes">${s.citas.map((c, i) => `<div class="quote"><div><b>${esc((P(c.p) || { nombre: "?" }).nombre.split(" ")[0])}:</b> ${esc(c.t)}</div><button data-unq="${i}" aria-label="Quitar cita">✕</button></div>`).join("")}</div>` : `<p class="hint" style="margin-bottom:14px">Todavía no guardas citas. En los interrogatorios, toca una respuesta para traerla aquí.</p>`}</div>
  <div class="sec"><span class="label">Libreta</span><textarea id="notas" placeholder="Horarios que no calzan, quién miente, qué falta comprobar...">${esc(s.notas)}</textarea><div class="saved" id="saved">Se guarda solo.</div></div></div>`;
}
function vAcusar() {
  const s = S(), multi = CASE.culpables.length > 1;
  return `<div class="wrap" style="padding-top:4px"><div class="accuse">
  <span class="label">Acusación formal</span><h3 class="disp" style="font-size:22px;font-weight:400;margin-top:4px">${esc(CASE.pregunta || "¿Quién es el culpable?")}</h3>
  <ul class="rules"><li><span>01</span>Escribe el nombre del responsable. No hay lista para elegir. Si crees que fue más de una persona, escribe todos los nombres separados por "y".</li><li><span>02</span>Tienes un solo intento. Si fallas, pierdes esta partida.</li><li><span>03</span>Después de perder puedes reintentar el caso o ver la solución. Si ves la solución, el caso queda cerrado para siempre.</li></ul>
  <div class="field"><input id="acc" autocomplete="off" autocapitalize="words" placeholder="Nombre del sospechoso" value="${esc(UI.accName)}"><button class="btn primary" id="accgo">Acusar</button></div>
  <div class="err" id="err">${esc(UI.err)}</div>
  ${UI.confirm === "accuse" ? `<div class="confirm"><div>Vas a acusar a <b>${esc(nombres(UI.accIds))}</b>. Es tu único intento en esta partida.</div><div class="row"><button class="btn danger" id="accyes">Confirmar acusación</button><button class="btn" id="accno">Seguir investigando</button></div></div>` : ""}
  </div><p class="hint" style="margin-top:12px">Partida actual: intento ${s.intento}.${multi ? "" : ""}</p></div>`;
}
function vResultado() {
  const s = S(), sol = CASE.solucion;
  const solHTML = `<div class="solution"><div class="memo"><span class="stamp">CASO CERRADO</span><h3>${esc(sol.resumen)}</h3>${sol.puntos ? `<ol>${sol.puntos.map(p => `<li>${esc(p)}</li>`).join("")}</ol>` : ""}${sol.motivo ? `<p style="margin-top:12px"><b>Motivo.</b> ${esc(sol.motivo)}</p>` : ""}${sol.extra ? `<p style="margin-top:12px">${esc(sol.extra)}</p>` : ""}</div></div>`;
  const acusado = s.acusado ? nombres(s.acusado) : "";
  if (s.status === "fallado") {
    return `<div class="wrap" style="padding-top:4px"><div class="result lost"><span class="label">Partida ${s.intento} · terminada</span><div class="big">Acusación equivocada</div><p>Acusaste a <b>${esc(acusado)}</b>, pero no es la respuesta correcta. El caso sigue abierto.</p>
    ${UI.revealAsk ? `<div class="confirm"><div>Si ves la solución, el caso queda cerrado y no vas a poder volver a jugarlo. ¿Seguro?</div><div class="row"><button class="btn danger" id="revyes">Sí, ver la solución</button><button class="btn" id="revno">No, mejor reintento</button></div></div>`
      : `<div class="row"><button class="btn primary" id="retry">Reintentar el caso</button><button class="btn" id="reveal">Ver la solución</button></div><p class="hint" style="margin-top:10px">Al reintentar conservas tu tablero y tus notas.</p>`}</div></div>`;
  }
  const top = s.status === "resuelto"
    ? `<div class="result won"><span class="label">Resuelto en el intento ${s.intento}</span><div class="big">¡Caso resuelto!</div><p>Acusaste a <b>${esc(acusado)}</b> y la evidencia te da la razón.</p></div>`
    : `<div class="result"><span class="label">Caso cerrado</span><div class="big disp">Solución revelada</div><p>Viste la solución, así que este caso ya no se puede volver a jugar.</p></div>`;
  return `<div class="wrap" style="padding-top:4px">${top}${solHTML}</div>`;
}

/* ===== Hoja de detalle ===== */
function openSheet(html) { closeSheet(); const d = document.createElement("div"); d.className = "scrim"; d.id = "scrim"; d.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`; d.onclick = e => { if (e.target === d) closeSheet(); }; document.body.appendChild(d); document.addEventListener("keydown", escClose); }
function closeSheet() { const d = $("#scrim"); if (d) d.remove(); document.removeEventListener("keydown", escClose); }
function escClose(e) { if (e.key === "Escape") closeSheet(); }
function evSheet(id) {
  const s = S(), e = E(id); if (e.lock && !s.vistos.includes(id)) { s.vistos.push(id); save(); }
  const pin = s.pinned.includes("e:" + id), yo = CASE.victima.nombre.split(" ")[0];
  let body = "";
  if (e.body) body += e.body.map(t => `<p>${esc(t)}</p>`).join("");
  if (e.chat) body += `<div class="chat">${e.chat.map(([w, h, t]) => `<div class="bub ${w === yo ? "me" : ""}"><small>${esc(w)} · ${esc(h)}</small>${esc(t)}</div>`).join("")}</div>`;
  if (e.doc) body += `<div class="doc">${e.doc.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>`;
  openSheet(`<div class="bigart">${artHTML(e)}</div><span class="label">${esc(e.etq || "")}${e.lugar ? " · " + esc(e.lugar) : ""}</span><h3>${esc(e.titulo)}</h3><div class="body">${body}</div>
  <div class="row"><button class="btn ${pin ? "" : "primary"}" id="sheetpin">${pin ? "Quitar del tablero" : "Fijar en el tablero"}</button><button class="btn" id="sheetclose">Cerrar</button></div>`);
  $("#sheetpin").onclick = () => { togglePin("e:" + id); closeSheet(); render(); toast(pin ? "Quitada del tablero" : "Fijada en el tablero"); };
  $("#sheetclose").onclick = closeSheet;
}
function personSheet(pid) {
  const p = P(pid), s = S(), st = s.estado[pid] || "sospechoso", iv = (CASE.interrogatorios || {})[pid] || [];
  openSheet(`<div style="display:flex;gap:12px;align-items:center">${avatar(pid)}<div style="min-width:0">${p.detalles ? `<span class="label">${p.detalles.map(esc).join(" · ")}</span>` : ""}<h3 style="margin:2px 0 0">${esc(p.nombre)}${p.edad ? ", " + p.edad : ""}</h3><div class="muted">${esc(p.rol || "")}</div></div></div>
  ${iv.length ? `<div class="transcript" style="padding:14px 0 0">${iv.map(([q, a]) => `<div class="q"><b>${esc(CASE.interrogador || "INSP.")}</b>${esc(q)}</div><div class="a">${esc(a)}</div>`).join("")}</div>` : ""}
  <div class="row"><button class="btn" id="pst">Estado: ${ST_LABEL[st]}</button><button class="btn" id="punpin">Quitar del tablero</button><button class="btn" id="sheetclose">Cerrar</button></div>`);
  $("#pst").onclick = () => { s.estado[pid] = ST_NEXT[st]; save(); closeSheet(); render(); };
  $("#punpin").onclick = () => { togglePin("p:" + pid); closeSheet(); render(); };
  $("#sheetclose").onclick = closeSheet;
}
function togglePin(id) {
  const s = S(), i = s.pinned.indexOf(id);
  if (i >= 0) { s.pinned.splice(i, 1); s.links = s.links.filter(l => l[0] !== id && l[1] !== id); }
  else { s.pinned.push(id); if (!s.pos[id]) { const n = s.pinned.length - 1; s.pos[id] = { x: 40 + (n % 6) * 152, y: 40 + Math.floor(n / 6) * 190 + (n % 2) * 14 }; } }
  save();
}

/* ===== Eventos del caso ===== */
function irTab(t) { Object.assign(UI, { tab: t, threadMode: false, sel: null, confirm: null, err: "" }); render(); scrollTo(0, 0); }
function bindCase() {
  $("#back").onclick = () => { UI.view = "home"; save(CASE.id, true); render(); scrollTo(0, 0); };
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => irTab(b.dataset.tab));
  const tv = $("#tabview");
  tv.querySelectorAll("[data-pin]").forEach(b => b.onclick = () => { const id = b.dataset.pin, was = S().pinned.includes(id); togglePin(id); render(); toast(was ? "Quitado del tablero" : "Fijado en el tablero"); });
  tv.querySelectorAll("[data-st]").forEach(b => b.onclick = () => { const s = S(), id = b.dataset.st; s.estado[id] = ST_NEXT[s.estado[id] || "sospechoso"]; save(); render(); });
  tv.querySelectorAll("details.iv").forEach(d => d.addEventListener("toggle", () => {
    if (!d.open) return; const s = S(), id = d.dataset.iv; if (s.leidos.includes(id)) return;
    s.leidos.push(id); save();
    d.querySelector(".read").innerHTML = '<span class="chip ok">Leído</span>';
    const iv = conInterrogatorio(), n = iv.filter(p => s.leidos.includes(p.id)).length, pr = tv.querySelector(".progress");
    pr.querySelector(".mono").textContent = n + "/" + iv.length; pr.querySelector(".bar i").style.width = (n / iv.length * 100) + "%";
    if (n === iv.length && CASE.evidencias.some(e => e.lock)) { pr.lastElementChild.textContent = "Nuevas pistas desbloqueadas"; toast("Nuevas pistas en Evidencia"); document.querySelector("nav.tabs").outerHTML = tabs(); document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => irTab(b.dataset.tab)); }
  }));
  tv.querySelectorAll("[data-cite]").forEach(el => {
    const f = () => { const [pid, i] = el.dataset.cite.split("|"), s = S(), k = pid + "|" + i, ix = s.citas.findIndex(c => c.k === k);
      if (ix >= 0) { s.citas.splice(ix, 1); el.classList.remove("on"); toast("Cita quitada"); }
      else { s.citas.push({ k, p: pid, t: CASE.interrogatorios[pid][+i][1] }); el.classList.add("on"); toast("Cita guardada en Notas"); }
      save(); };
    el.onclick = f; el.onkeydown = e => { if (e.key === "Enter") f(); };
  });
  tv.querySelectorAll("[data-ev]").forEach(b => b.onclick = () => { evSheet(b.dataset.ev); b.classList.remove("new"); });
  tv.querySelectorAll("[data-unq]").forEach(b => b.onclick = () => { S().citas.splice(+b.dataset.unq, 1); save(); render(); });
  const ta = $("#notas"); if (ta) ta.oninput = () => { S().notas = ta.value; save(); $("#saved").textContent = "Guardado."; };
  if (UI.tab === "tablero") bindBoard();
  if (UI.tab === "acusar") bindAccuse();
}
function drawThreads() {
  const svg = $("#threads"); if (!svg) return;
  const c = id => { const el = document.querySelector(`[data-card="${id}"]`); return el ? { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + 6 } : null; };
  svg.innerHTML = S().links.map(([a, b]) => { const A = c(a), B = c(b); return A && B ? `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>` : ""; }).join("");
}
function bindBoard() {
  const s = S(); drawThreads();
  $("#thread").onclick = () => { UI.threadMode = !UI.threadMode; UI.sel = null; render(); };
  const u = $("#unthread"); if (u) u.onclick = () => { s.links = []; save(); render(); };
  document.querySelectorAll(".bcard").forEach(el => {
    let sx, sy, ox, oy, moved = false, drag = false;
    el.addEventListener("pointerdown", e => { drag = true; moved = false; sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop; el.setPointerCapture(e.pointerId); el.style.zIndex = 5; });
    el.addEventListener("pointermove", e => { if (!drag) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 5) moved = true; if (!moved || UI.threadMode) return;
      el.style.left = Math.max(0, Math.min(980 - el.offsetWidth, ox + dx)) + "px"; el.style.top = Math.max(8, Math.min(760 - el.offsetHeight, oy + dy)) + "px"; drawThreads(); });
    el.addEventListener("pointerup", () => {
      if (!drag) return; drag = false; el.style.zIndex = ""; const id = el.dataset.card;
      if (moved && !UI.threadMode) { s.pos[id] = { x: el.offsetLeft, y: el.offsetTop }; save(); return; }
      if (UI.threadMode) {
        if (!UI.sel) { UI.sel = id; render(); return; }
        if (UI.sel !== id) { const a = UI.sel, ex = s.links.findIndex(l => (l[0] === a && l[1] === id) || (l[0] === id && l[1] === a)); if (ex >= 0) s.links.splice(ex, 1); else s.links.push([a, id]); save(); }
        UI.sel = null; render(); return;
      }
      if (id === "victima") return;
      if (id.startsWith("p:")) personSheet(id.slice(2)); else evSheet(id.slice(2));
    });
    el.addEventListener("pointercancel", () => { drag = false; el.style.zIndex = ""; });
  });
}
function identificar(texto) {
  const v = " " + norm(texto) + " ", hits = [];
  for (const p of CASE.personas) {
    const claves = [p.nombre, ...p.nombre.split(" ").filter(w => w.length > 2), ...(p.alias || [])].map(norm).filter(Boolean);
    if (claves.some(k => v.includes(" " + k + " "))) hits.push(p.id);
  }
  return hits;
}
function bindAccuse() {
  const inp = $("#acc");
  const go = () => {
    UI.accName = inp.value; const v = norm(inp.value);
    if (!v) { UI.err = "Escribe un nombre antes de acusar."; UI.confirm = null; return render(); }
    const vic = norm(CASE.victima.nombre).split(" ")[0];
    const hits = identificar(inp.value);
    if (!hits.length && (" " + v + " ").includes(" " + vic + " ")) { UI.err = `${CASE.victima.nombre} es la víctima. Escribe el nombre de otra persona.`; UI.confirm = null; return render(); }
    if (!hits.length) { UI.err = "No hay nadie con ese nombre en el expediente. Revisa cómo se escribe. Esto no gasta tu intento."; UI.confirm = null; return render(); }
    UI.err = ""; UI.accIds = hits; UI.confirm = "accuse"; render();
  };
  $("#accgo").onclick = go; inp.onkeydown = e => { if (e.key === "Enter") go(); };
  const y = $("#accyes"); if (y) y.onclick = () => {
    const s = S(), set = new Set(UI.accIds), ok = set.size === CASE.culpables.length && CASE.culpables.every(c => set.has(c));
    s.acusado = [...UI.accIds]; s.acusados.push({ intento: s.intento, ids: [...UI.accIds], ok }); s.status = ok ? "resuelto" : "fallado";
    save(CASE.id, true); Object.assign(UI, { confirm: null, accName: "" }); render(); scrollTo(0, 0);
  };
  const n = $("#accno"); if (n) n.onclick = () => { UI.confirm = null; render(); };
}
function bindResultado() {
  $("#back").onclick = () => { UI.view = "home"; UI.revealAsk = false; render(); scrollTo(0, 0); };
  const r = $("#retry"); if (r) r.onclick = () => { const s = S(); s.status = "en_curso"; s.intento++; s.acusado = null; save(CASE.id, true); UI.tab = "expediente"; render(); scrollTo(0, 0); toast("Nueva partida: intento " + s.intento); };
  const rv = $("#reveal"); if (rv) rv.onclick = () => { UI.revealAsk = true; render(); };
  const ry = $("#revyes"); if (ry) ry.onclick = () => { S().status = "revelado"; save(CASE.id, true); UI.revealAsk = false; render(); scrollTo(0, 0); };
  const rn = $("#revno"); if (rn) rn.onclick = () => { UI.revealAsk = false; render(); };
}

/* ===== Arranque ===== */
onAuthStateChanged(auth, u => {
  USER = u; CASE = null; UI.view = "home";
  if (u) cargarTodo(); else { CASOS = []; PROG = {}; render(); }
});
