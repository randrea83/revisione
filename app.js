// Quiz Revisione Legale - versione smartphone (statica, funziona offline).
// Dati: domande.json, generato dall'app per PC con esporta_smartphone.py.
// Stato salvato sul telefono (localStorage): storico dei test, test in corso, preferenze.
"use strict";

const CHIAVI = { storico: "qr_storico", bozza: "qr_bozza", pref: "qr_pref" };
const MAX_STORICO = 300;
const LETTERE = ["A", "B", "C", "D"];
const ETICHETTE_DIFFICOLTA = { 1: "Facile", 2: "Media", 3: "Difficile" };

let DATI = null;          // { versione, generato, domande: [...] }
const PER_ID = new Map(); // id -> domanda
const vista = document.getElementById("vista");

// ----------------------------------------------------------------------
// Utilità
// ----------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const it = (n, dec = 0) => Number(n).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const dataIt = (iso) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function leggi(chiave, predefinito) {
  try { const v = localStorage.getItem(chiave); return v ? JSON.parse(v) : predefinito; } catch (e) { return predefinito; }
}
function scrivi(chiave, valore) {
  try { localStorage.setItem(chiave, JSON.stringify(valore)); } catch (e) { toast("Memoria del telefono non disponibile: i dati non verranno salvati."); }
}
function cancella(chiave) { try { localStorage.removeItem(chiave); } catch (e) { /* niente */ } }

function mescola(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

let timerToast = null;
function toast(messaggio) {
  const el = document.getElementById("toast");
  el.textContent = messaggio;
  el.classList.add("visibile");
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove("visibile"), 3000);
}

function conferma(testo, etichettaSi = "Conferma") {
  const dlg = document.getElementById("dialogo");
  document.getElementById("dialogoTesto").textContent = testo;
  document.getElementById("dialogoSi").textContent = etichettaSi;
  return new Promise((risolvi) => {
    const fine = (esito) => { dlg.close(); risolvi(esito); };
    document.getElementById("dialogoSi").onclick = () => fine(true);
    document.getElementById("dialogoNo").onclick = () => fine(false);
    dlg.oncancel = () => risolvi(false);
    dlg.showModal();
  });
}

/** Imposta titolo, pulsante indietro, voce attiva del menu e modalità test. */
function imposta(titolo, { indietro = null, voce = "", inTest = false } = {}) {
  document.getElementById("titolo").textContent = titolo;
  const btn = document.getElementById("btnIndietro");
  btn.hidden = !indietro;
  btn.onclick = indietro;
  document.body.classList.toggle("in-test", inTest);
  document.querySelectorAll(".menu-basso a").forEach((a) => a.classList.toggle("attiva", a.dataset.voce === voce));
  window.scrollTo(0, 0);
}

// ----------------------------------------------------------------------
// Estrazione delle domande
// ----------------------------------------------------------------------

/**
 * Domande che rispettano i filtri.
 * tema: "" nessun filtro · "*" tutte le domande collegate a un tema d'esame ·
 *       "!" solo quelle scritte apposta per l'esame · altrimenti il nome di un tema.
 */
function filtra(f) {
  return DATI.domande.filter((d) =>
    (!f.aree.length || f.aree.includes(d.a)) &&
    (!f.difficolta || d.d === Number(f.difficolta)) &&
    (!f.norma || d.n === f.norma) &&
    (!f.tema || (f.tema === "*" ? !!d.t : f.tema === "!" ? d.e : d.t === f.tema)));
}

/** Estrae n domande; con "equilibrata" ogni area pesa in proporzione (metodo dei resti maggiori). */
function estrai(n, pool, equilibrata) {
  n = Math.min(n, pool.length);
  const perArea = {};
  pool.forEach((d) => (perArea[d.a] ||= []).push(d.id));
  const aree = Object.keys(perArea);
  if (!equilibrata || aree.length < 2) return mescola(pool.map((d) => d.id)).slice(0, n);
  const quote = aree.map((a) => ({ a, q: (n * perArea[a].length) / pool.length }));
  quote.forEach((x) => (x.k = Math.floor(x.q)));
  let resto = n - quote.reduce((s, x) => s + x.k, 0);
  quote.sort((x, y) => (y.q - y.k) - (x.q - x.k)).forEach((x) => { if (resto > 0) { x.k++; resto--; } });
  return mescola(quote.flatMap((x) => mescola(perArea[x.a]).slice(0, x.k)));
}

function descriviFiltri(f) {
  const parti = [f.aree.length ? f.aree.join(", ") : "Tutte le aree"];
  if (f.norma) parti.push(f.norma);
  if (f.difficolta) parti.push(ETICHETTE_DIFFICOLTA[f.difficolta]);
  if (f.tema === "*") parti.push("temi d'esame");
  else if (f.tema === "!") parti.push("domande d'esame");
  else if (f.tema) parti.push(`tema: ${f.tema}`);
  return parti.join(" · ");
}

function avviaTest(ids, descrizione, opzioni) {
  const bozza = { id: Date.now(), inizio: new Date().toISOString(), ids, risposte: {}, corrente: 0, descrizione,
                  immediata: !!opzioni.immediata, fonte: !!opzioni.fonte };
  scrivi(CHIAVI.bozza, bozza);
  location.hash = "#/test";
}

// ----------------------------------------------------------------------
// Schermata: nuovo test
// ----------------------------------------------------------------------

function ordinaNorme(a, b) {
  const peso = (n) => n.startsWith("D.Lgs. 39") ? 0 : n.startsWith("Reg.") ? 1 : n === "Codice civile" ? 2
    : n.startsWith("ISA") ? 3 : n.startsWith("SA ") ? 4 : n.startsWith("ISQM") ? 5 : n.startsWith("SSAE") ? 6 : 7;
  const num = (n) => parseInt((n.match(/\d+/) || ["0"])[0], 10);
  return peso(a) - peso(b) || num(a) - num(b) || a.localeCompare(b, "it");
}

function vistaHome() {
  imposta("Quiz Revisione", { voce: "home" });
  const pref = leggi(CHIAVI.pref, { numero: 20, aree: [], difficolta: "", norma: "", tema: "", equilibrata: true, immediata: false, fonte: false });
  const conta = (fn) => { const m = new Map(); DATI.domande.forEach((d) => { const k = fn(d); if (k) m.set(k, (m.get(k) || 0) + 1); }); return m; };
  const aree = conta((d) => d.a), norme = conta((d) => d.n), temi = conta((d) => d.t);
  const nTemi = DATI.domande.filter((d) => d.t).length, nEsame = DATI.domande.filter((d) => d.e).length;
  const bozza = leggi(CHIAVI.bozza, null);

  vista.innerHTML = `
    ${bozza ? `<div class="scheda" style="border-left:4px solid #ffc107">
      <h2>Hai un test in corso</h2>
      <p class="mb-3 small text-muted">${it(Object.keys(bozza.risposte).length)} risposte su ${it(bozza.ids.length)} · ${esc(bozza.descrizione)}</p>
      <div class="d-flex gap-2"><a class="btn btn-primary flex-fill" href="#/test">Riprendi</a>
      <button class="btn btn-outline-secondary flex-fill" id="annullaBozza">Abbandona</button></div></div>` : ""}
    <form class="scheda" id="formTest">
      <h2>Nuovo test</h2>
      <span class="etichetta">Numero di domande</span>
      <div class="pillole mb-3">${[10, 20, 30, 50, 100].map((n) => `
        <input type="radio" name="numero" id="n${n}" value="${n}" ${n === Number(pref.numero) ? "checked" : ""}><label for="n${n}">${n}</label>`).join("")}
      </div>
      <span class="etichetta">Aree <span class="fw-normal text-muted">(nessuna = tutte)</span></span>
      ${[...aree].sort().map(([a, n], i) => `<div class="form-check mb-1">
        <input class="form-check-input" type="checkbox" name="aree" value="${esc(a)}" id="ar${i}" ${pref.aree.includes(a) ? "checked" : ""}>
        <label class="form-check-label" for="ar${i}">${esc(a)} <span class="text-muted small">(${it(n)})</span></label></div>`).join("")}
      <label class="etichetta mt-3" for="norma">Norma o principio</label>
      <select class="form-select mb-3" id="norma" name="norma"><option value="">Tutti</option>
        ${[...norme.keys()].sort(ordinaNorme).map((n) => `<option value="${esc(n)}" ${n === pref.norma ? "selected" : ""}>${esc(n)} (${it(norme.get(n))})</option>`).join("")}
      </select>
      <label class="etichetta" for="tema">Temi chiesti all'esame</label>
      <select class="form-select mb-3" id="tema" name="tema">
        <option value="">Nessun filtro</option>
        <option value="*" ${pref.tema === "*" ? "selected" : ""}>Tutte le domande sui temi d'esame (${it(nTemi)})</option>
        <option value="!" ${pref.tema === "!" ? "selected" : ""}>Solo domande scritte per l'esame (${it(nEsame)})</option>
        <optgroup label="Un tema specifico">
        ${[...temi.keys()].map((t) => `<option value="${esc(t)}" ${t === pref.tema ? "selected" : ""}>${esc(t)} (${it(temi.get(t))})</option>`).join("")}
        </optgroup>
      </select>
      <label class="etichetta" for="difficolta">Difficoltà</label>
      <select class="form-select mb-3" id="difficolta" name="difficolta"><option value="">Tutte</option>
        ${Object.entries(ETICHETTE_DIFFICOLTA).map(([k, v]) => `<option value="${k}" ${String(pref.difficolta) === k ? "selected" : ""}>${v}</option>`).join("")}
      </select>
      <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" role="switch" id="equilibrata" ${pref.equilibrata ? "checked" : ""}>
        <label class="form-check-label" for="equilibrata">Distribuisci tra le aree</label></div>
      <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" role="switch" id="immediata" ${pref.immediata ? "checked" : ""}>
        <label class="form-check-label" for="immediata">Modalità studio: correzione subito dopo ogni risposta</label></div>
      <div class="form-check form-switch mb-3"><input class="form-check-input" type="checkbox" role="switch" id="fonte" ${pref.fonte ? "checked" : ""}>
        <label class="form-check-label" for="fonte">Mostra la fonte durante il test</label></div>
      <p class="small text-muted mb-2" id="disponibili"></p>
      <button class="btn btn-primary btn-grande" type="submit">Estrai le domande e inizia</button>
    </form>
    <p class="text-center small text-muted">${it(DATI.domande.length)} domande · aggiornate al ${esc(DATI.generato)}</p>`;

  const form = document.getElementById("formTest");
  const leggiFiltri = () => ({
    numero: Number(form.querySelector("input[name=numero]:checked")?.value || 20),
    aree: [...form.querySelectorAll("input[name=aree]:checked")].map((x) => x.value),
    norma: form.norma.value, tema: form.tema.value, difficolta: form.difficolta.value,
    equilibrata: form.equilibrata.checked, immediata: form.immediata.checked, fonte: form.fonte.checked,
  });
  const aggiornaConteggio = () => {
    const n = filtra(leggiFiltri()).length;
    const el = document.getElementById("disponibili");
    el.textContent = `Domande disponibili con questi filtri: ${it(n)}`;
    el.classList.toggle("text-danger", n === 0);
  };
  form.addEventListener("change", aggiornaConteggio);
  aggiornaConteggio();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = leggiFiltri();
    scrivi(CHIAVI.pref, f);
    const pool = filtra(f);
    if (!pool.length) { toast("Nessuna domanda con questi filtri."); return; }
    if (leggi(CHIAVI.bozza, null) && !(await conferma("C'è un test in corso: iniziandone uno nuovo verrà abbandonato. Continuare?", "Nuovo test"))) return;
    const ids = estrai(f.numero, pool, f.equilibrata);
    if (ids.length < f.numero) toast(`Disponibili solo ${it(ids.length)} domande con questi filtri.`);
    avviaTest(ids, descriviFiltri(f), f);
  });

  document.getElementById("annullaBozza")?.addEventListener("click", async () => {
    if (await conferma("Abbandonare il test in corso? Le risposte date andranno perse.", "Abbandona")) {
      cancella(CHIAVI.bozza); vistaHome(); toast("Test abbandonato.");
    }
  });
}

// ----------------------------------------------------------------------
// Schermata: test (una domanda alla volta)
// ----------------------------------------------------------------------

function htmlCorrezione(d, scelta) {
  return `
    <div class="box-fonte"><b>Fonte:</b> ${esc(d.f)}<div class="mt-1">${esc(d.s)}</div></div>
    ${d.r ? `<div class="box-sintesi"><b>In sintesi${d.n ? " · " + esc(d.n) + (d.ar ? ", art. " + esc(d.ar) : "") : ""}</b><div class="mt-1">${esc(d.r)}</div></div>` : ""}
    ${d.t ? `<span class="tema">Tema d'esame: ${esc(d.t)}</span>` : ""}`;
}

function htmlOpzioni(d, scelta, rivela) {
  return d.o.map((testo, i) => {
    let cls = "opzione";
    if (rivela) { if (i === d.c) cls += " giusta"; else if (i === scelta) cls += " sbagliata"; }
    else if (i === scelta) cls += " scelta";
    return `<button class="${cls}" data-i="${i}" ${rivela ? "disabled" : ""}><b>${LETTERE[i]}.</b>${esc(testo)}</button>`;
  }).join("");
}

function vistaTest() {
  const bozza = leggi(CHIAVI.bozza, null);
  if (!bozza) { location.hash = "#/"; return; }
  const ids = bozza.ids.filter((id) => PER_ID.has(id));
  if (!ids.length) { cancella(CHIAVI.bozza); location.hash = "#/"; return; }
  bozza.corrente = Math.min(bozza.corrente, ids.length - 1);

  imposta("Test", { inTest: true, indietro: () => { location.hash = "#/"; } });
  const i = bozza.corrente, d = PER_ID.get(ids[i]);
  const scelta = bozza.risposte[d.id];
  const rivela = bozza.immediata && scelta !== undefined;
  const date = Object.keys(bozza.risposte).length;

  vista.innerHTML = `
    <div class="progresso"><div style="width:${(date * 100) / ids.length}%"></div></div>
    <div class="meta">Domanda ${it(i + 1)} di ${it(ids.length)} · ${esc(d.a)} · risposte ${it(date)}/${it(ids.length)}</div>
    <div class="scheda">
      <div class="testo-domanda">${esc(d.q)}</div>
      ${bozza.fonte && !rivela ? `<div class="small text-muted mb-2">Fonte: ${esc(d.f)}</div>` : ""}
      <div id="opzioni">${htmlOpzioni(d, scelta, rivela)}</div>
      ${rivela ? `<div class="mt-2"><span class="esito ${scelta === d.c ? "ok" : "ko"}">${scelta === d.c ? "Corretta" : "Errata"}</span></div>${htmlCorrezione(d, scelta)}` : ""}
    </div>
    <details class="mb-2"><summary class="small text-muted">Vai a una domanda</summary>
      <div class="puntini">${ids.map((id, k) => `<button class="${bozza.risposte[id] !== undefined ? "data" : ""} ${k === i ? "corrente" : ""}" data-vai="${k}">${k + 1}</button>`).join("")}</div>
    </details>
    <div class="navigazione">
      <button class="btn btn-outline-secondary" id="prec" ${i === 0 ? "disabled" : ""}>&#8249; Precedente</button>
      ${i < ids.length - 1
        ? `<button class="btn btn-primary" id="succ">Successiva &#8250;</button>`
        : `<button class="btn btn-success" id="consegna">Consegna</button>`}
    </div>
    ${i < ids.length - 1 ? `<button class="btn btn-link w-100 text-muted" id="consegna">Consegna il test ora</button>` : ""}`;

  const vai = (k) => { bozza.corrente = k; scrivi(CHIAVI.bozza, bozza); vistaTest(); };
  document.getElementById("opzioni").addEventListener("click", (e) => {
    const btn = e.target.closest(".opzione");
    if (!btn || rivela) return;
    bozza.risposte[d.id] = Number(btn.dataset.i);
    scrivi(CHIAVI.bozza, bozza);
    if (bozza.immediata || i === ids.length - 1) vistaTest();
    else { vistaTest(); setTimeout(() => { if (leggi(CHIAVI.bozza, null)?.corrente === i) vai(i + 1); }, 280); }
  });
  document.getElementById("prec").onclick = () => vai(i - 1);
  document.getElementById("succ")?.addEventListener("click", () => vai(i + 1));
  document.querySelectorAll("[data-vai]").forEach((b) => (b.onclick = () => vai(Number(b.dataset.vai))));
  document.querySelectorAll("#consegna").forEach((b) => (b.onclick = () => consegna(bozza, ids)));
}

async function consegna(bozza, ids) {
  const mancanti = ids.filter((id) => bozza.risposte[id] === undefined).length;
  const testo = mancanti ? `Hai lasciato ${it(mancanti)} domande senza risposta: saranno contate come errate. Consegnare?` : "Hai risposto a tutte le domande. Consegnare il test?";
  if (!(await conferma(testo, "Consegna"))) return;
  const corrette = ids.filter((id) => bozza.risposte[id] === PER_ID.get(id).c).length;
  const prova = { id: bozza.id, data: new Date().toISOString(), ids, risposte: bozza.risposte, corrette, descrizione: bozza.descrizione };
  const storico = leggi(CHIAVI.storico, []);
  storico.unshift(prova);
  scrivi(CHIAVI.storico, storico.slice(0, MAX_STORICO));
  cancella(CHIAVI.bozza);
  toast("Test consegnato e corretto.");
  location.hash = `#/risultato/${prova.id}`;
}

// ----------------------------------------------------------------------
// Schermata: risultato
// ----------------------------------------------------------------------

function vistaRisultato(idProva) {
  const prova = leggi(CHIAVI.storico, []).find((p) => String(p.id) === String(idProva));
  if (!prova) { location.hash = "#/storico"; return; }
  imposta("Risultato", { voce: "storico", indietro: () => { location.hash = "#/storico"; } });
  const domande = prova.ids.map((id) => PER_ID.get(id)).filter(Boolean);
  const perc = prova.ids.length ? (prova.corrette * 100) / prova.ids.length : 0;
  const perArea = {};
  domande.forEach((d) => { const x = (perArea[d.a] ||= [0, 0]); x[1]++; if (prova.risposte[d.id] === d.c) x[0]++; });
  const sbagliate = domande.filter((d) => prova.risposte[d.id] !== d.c).map((d) => d.id);

  vista.innerHTML = `
    <div class="scheda text-center">
      <div class="punteggio ${perc >= 60 ? "text-success" : "text-danger"}">${it(perc, 1)}%</div>
      <div class="mt-1">${it(prova.corrette)} corrette su ${it(prova.ids.length)}</div>
      <div class="small text-muted mt-1">${dataIt(prova.data)} · ${esc(prova.descrizione)}</div>
    </div>
    <div class="scheda">
      ${Object.entries(perArea).sort().map(([a, [ok, tot]]) => `
        <div class="small d-flex justify-content-between mt-2"><span>${esc(a)}</span><span>${ok}/${tot}</span></div>
        <div class="barra-area"><div style="width:${(ok * 100) / tot}%;background:${ok / tot >= 0.6 ? "#198754" : "#dc3545"}"></div></div>`).join("")}
      <div class="d-flex gap-2 mt-3">
        ${sbagliate.length ? `<button class="btn btn-primary flex-fill" id="ripassa">Ripassa le ${it(sbagliate.length)} sbagliate</button>` : ""}
        <a class="btn btn-outline-secondary flex-fill" href="#/">Nuovo test</a>
      </div>
    </div>
    <div class="btn-group w-100 mb-3" role="group">
      <input type="radio" class="btn-check" name="filtro" id="fTutte" checked><label class="btn btn-outline-secondary" for="fTutte">Tutte</label>
      <input type="radio" class="btn-check" name="filtro" id="fErrate"><label class="btn btn-outline-secondary" for="fErrate">Solo errate</label>
    </div>
    <div id="elenco">${domande.map((d, k) => {
      const s = prova.risposte[d.id], ok = s === d.c;
      return `<div class="scheda ${ok ? "esito-ok" : ""}">
        <div class="d-flex justify-content-between gap-2 mb-2"><span class="small text-muted">${k + 1} · ${esc(d.g)}</span>
          <span class="esito ${ok ? "ok" : s === undefined ? "vuota" : "ko"}">${ok ? "Corretta" : s === undefined ? "Senza risposta" : "Errata"}</span></div>
        <div class="testo-domanda">${esc(d.q)}</div>
        ${htmlOpzioni(d, s, true)}
        ${htmlCorrezione(d, s)}
      </div>`;
    }).join("")}</div>
    ${domande.length < prova.ids.length ? `<p class="small text-muted">${it(prova.ids.length - domande.length)} domande non sono più presenti nella banca aggiornata.</p>` : ""}`;

  document.getElementById("fErrate").onchange = () => document.querySelectorAll(".esito-ok").forEach((x) => (x.hidden = true));
  document.getElementById("fTutte").onchange = () => document.querySelectorAll(".esito-ok").forEach((x) => (x.hidden = false));
  document.getElementById("ripassa")?.addEventListener("click", () => {
    const pref = leggi(CHIAVI.pref, {});
    avviaTest(mescola(sbagliate), "Ripasso delle domande sbagliate", { immediata: true, fonte: pref.fonte });
  });
}

// ----------------------------------------------------------------------
// Schermata: storico
// ----------------------------------------------------------------------

function vistaStorico() {
  imposta("Storico", { voce: "storico" });
  const storico = leggi(CHIAVI.storico, []);
  const media = storico.length ? storico.reduce((s, p) => s + (p.corrette * 100) / p.ids.length, 0) / storico.length : 0;
  // domande la cui ultima risposta è sbagliata
  const ultimo = new Map();
  [...storico].reverse().forEach((p) => p.ids.forEach((id) => ultimo.set(id, p.risposte[id] === PER_ID.get(id)?.c)));
  const daRipassare = [...ultimo].filter(([id, ok]) => !ok && PER_ID.has(id)).map(([id]) => id);

  vista.innerHTML = storico.length ? `
    <div class="scheda d-flex justify-content-around text-center">
      <div><div class="fs-4 fw-bold">${it(storico.length)}</div><div class="small text-muted">test svolti</div></div>
      <div><div class="fs-4 fw-bold">${it(media, 1)}%</div><div class="small text-muted">media</div></div>
      <div><div class="fs-4 fw-bold">${it(daRipassare.length)}</div><div class="small text-muted">da ripassare</div></div>
    </div>
    ${daRipassare.length ? `<button class="btn btn-primary btn-grande mb-3" id="ripassaTutto">Ripassa le domande sbagliate (${it(Math.min(daRipassare.length, 50))})</button>` : ""}
    <div class="scheda">${storico.map((p) => {
      const perc = (p.corrette * 100) / p.ids.length;
      return `<div class="voce-storico">
        <a class="flex-fill text-reset text-decoration-none" href="#/risultato/${p.id}">
          <div class="fw-semibold">${dataIt(p.data)}</div>
          <div class="small text-muted">${it(p.ids.length)} domande · ${esc(p.descrizione)}</div></a>
        <span class="esito ${perc >= 60 ? "ok" : "ko"}">${it(perc, 1)}%</span>
        <button class="btn btn-sm btn-outline-danger" data-elimina="${p.id}" aria-label="Elimina">&#10005;</button>
      </div>`;
    }).join("")}</div>
    <button class="btn btn-link text-danger w-100" id="svuota">Svuota lo storico</button>`
    : `<div class="scheda text-center text-muted">Nessun test svolto. <a href="#/">Inizia il primo</a>.</div>`;

  document.querySelectorAll("[data-elimina]").forEach((b) => (b.onclick = async () => {
    if (!(await conferma("Eliminare questo test dallo storico?", "Elimina"))) return;
    scrivi(CHIAVI.storico, leggi(CHIAVI.storico, []).filter((p) => String(p.id) !== b.dataset.elimina));
    vistaStorico(); toast("Test eliminato.");
  }));
  document.getElementById("svuota")?.addEventListener("click", async () => {
    if (!(await conferma("Eliminare tutti i test dallo storico? L'operazione non è reversibile.", "Svuota"))) return;
    cancella(CHIAVI.storico); vistaStorico(); toast("Storico svuotato.");
  });
  document.getElementById("ripassaTutto")?.addEventListener("click", () => {
    const pref = leggi(CHIAVI.pref, {});
    avviaTest(mescola(daRipassare).slice(0, 50), "Ripasso delle domande sbagliate", { immediata: true, fonte: pref.fonte });
  });
}

// ----------------------------------------------------------------------
// Schermata: informazioni
// ----------------------------------------------------------------------

function vistaInfo() {
  imposta("Informazioni", { voce: "info" });
  vista.innerHTML = `
    <div class="scheda">
      <h2>Quiz Revisione Legale</h2>
      <p class="small mb-1">Versione ${esc(DATI.versione)} · ${it(DATI.domande.length)} domande aggiornate al ${esc(DATI.generato)}.</p>
      <p class="small text-muted mb-0">Fonti: Codice civile, D.Lgs. 39/2010, Reg. UE 537/2014, ISA Italia, SA Italia, ISQM Italia, SSAE Italia, Codice di etica e indipendenza, OIC. Ogni domanda riporta la fonte normativa.</p>
    </div>
    <div class="scheda">
      <h2>Installare l'app sul telefono</h2>
      <p class="small mb-1"><b>Android (Chrome):</b> menu &#8942; in alto a destra → <i>Installa app</i> o <i>Aggiungi a schermata Home</i>.</p>
      <p class="small mb-0"><b>iPhone (Safari):</b> pulsante Condividi → <i>Aggiungi alla schermata Home</i>.</p>
    </div>
    <div class="scheda">
      <h2>Funzionamento offline e aggiornamenti</h2>
      <p class="small">Dopo la prima apertura l'app funziona anche senza connessione. Storico e test in corso restano salvati su questo telefono.</p>
      <p class="small">Quando le domande vengono aggiornate sul sito, l'app scarica la nuova versione alla prima apertura con la connessione attiva.</p>
      <button class="btn btn-outline-primary w-100" id="aggiorna">Controlla aggiornamenti ora</button>
    </div>`;
  document.getElementById("aggiorna").onclick = async () => {
    if (!navigator.onLine) { toast("Serve la connessione per controllare gli aggiornamenti."); return; }
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.update(); toast("Controllo eseguito: se c'è una nuova versione, l'app si ricarica."); }
    else location.reload();
  };
}

// ----------------------------------------------------------------------
// Avvio
// ----------------------------------------------------------------------

function router() {
  if (!DATI) return;
  const parti = (location.hash || "#/").slice(2).split("/");
  if (parti[0] === "test") vistaTest();
  else if (parti[0] === "risultato") vistaRisultato(parti[1]);
  else if (parti[0] === "storico") vistaStorico();
  else if (parti[0] === "info") vistaInfo();
  else vistaHome();
}

function aggiornaStatoRete() { document.getElementById("statoRete").hidden = navigator.onLine; }

async function avvia() {
  window.addEventListener("hashchange", router);
  window.addEventListener("online", aggiornaStatoRete);
  window.addEventListener("offline", aggiornaStatoRete);
  aggiornaStatoRete();
  try {
    const r = await fetch("domande.json");
    if (!r.ok) throw new Error(r.status);
    DATI = await r.json();
    DATI.domande.forEach((d) => PER_ID.set(d.id, d));
    router();
  } catch (e) {
    vista.innerHTML = `<div class="scheda text-center"><p class="text-danger fw-semibold">Impossibile caricare le domande.</p>
      <p class="small text-muted">Apri l'app almeno una volta con la connessione attiva.</p>
      <button class="btn btn-primary" onclick="location.reload()">Riprova</button></div>`;
  }
  if ("serviceWorker" in navigator) {
    // ricarica solo quando una versione nuova sostituisce quella già installata (non alla prima installazione)
    const giaInstallata = !!navigator.serviceWorker.controller;
    let ricaricata = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (ricaricata || !giaInstallata) return;
      ricaricata = true;
      toast("Domande aggiornate.");
      setTimeout(() => location.reload(), 800);
    });
    navigator.serviceWorker.register("sw.js").catch(() => { /* senza service worker l'app funziona solo online */ });
  }
}

avvia();
