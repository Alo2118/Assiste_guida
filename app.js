// ============================================================
//  PROGRAMMA PRINCIPALE
//  Ciclo: fotogramma -> riconoscimento -> distanza -> ACC -> schermo
// ============================================================

import { CONFIG } from './config.js';
import * as distanza from './distance.js';
import { Tracciatore, sceglieVeicoloDavanti, inCorsia, calcolaACC } from './acc.js';
import { gps, avviaGPS, schermoSempreAcceso, schermoInteroOrizzontale, sbloccaAudio, bip } from './dispositivo.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('disegno'), ctx = canvas.getContext('2d');

// ---------- Stato dell'app (salvato sul telefono) ----------
const PREF = 'preferenze-v1';
const pref = Object.assign(
  { accAttivo: false, vImpostataKmh: 90, intervalloIdx: 1, mostraTutti: false, manuale: false, vManualeKmh: 50, motore: CONFIG.motorePreferito },
  leggi(PREF),
);
function leggi(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } }
function salvaPref() { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch { /* ignora */ } }

let modello = null;
const tracciatore = new Tracciatore();
let ultimoLead = null;           // ultimo veicolo davanti (serve alla calibrazione)
let fps = 0, msModello = 0, motore = '';

// Immagine ritagliata (solo la zona della strada) da passare al modello
const ritaglio = document.createElement('canvas');
const ctxRitaglio = ritaglio.getContext('2d', { willReadFrequently: false });

// ---------- Avvio ----------
// Registra il "service worker": rende l'app installabile e usabile offline.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

$('bAvvia').onclick = async () => {
  sbloccaAudio();
  schermoInteroOrizzontale();
  schermoSempreAcceso();
  avviaGPS();
  $('bAvvia').disabled = true;
  try {
    $('caricamento').textContent = 'Avvio fotocamera…';
    await avviaFotocamera();
    $('caricamento').textContent = 'Caricamento modello (la prima volta può richiedere un po\')…';
    motore = await scegliMotore();
    modello = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: 'vendor/model/model.json' });
    $('inizio').classList.add('nascosto');
    ciclo();
  } catch (e) {
    $('caricamento').textContent = 'Errore: ' + (e.message || e) + '. Hai dato il permesso alla fotocamera?';
    $('bAvvia').disabled = false;
  }
};

// Prova i motori di calcolo dal più veloce: WebGPU -> WebGL -> CPU.
async function scegliMotore() {
  const ordine = pref.motore && pref.motore !== 'auto' ? [pref.motore, 'webgl', 'cpu'] : ['webgpu', 'webgl', 'cpu'];
  for (const m of ordine) {
    if (m === 'webgpu' && !navigator.gpu) continue;
    try { if (await tf.setBackend(m)) { await tf.ready(); return m; } } catch { /* prova il prossimo */ }
  }
  return tf.getBackend();
}

async function avviaFotocamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: CONFIG.risoluzione.width }, height: { ideal: CONFIG.risoluzione.height } },
  });
  video.srcObject = stream;
  await video.play();
}

// ---------- Ciclo principale ----------
async function ciclo() {
  let tPrec = performance.now();
  for (;;) {
    const W = video.videoWidth, H = video.videoHeight;
    if (W && H) {
      if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
      const t0 = performance.now();
      const rilevati = await rileva(W, H);
      msModello = 0.8 * msModello + 0.2 * (performance.now() - t0);
      elabora(rilevati, W, H, performance.now());
    }
    const ora = performance.now();
    fps = 0.9 * fps + 0.1 * (1000 / Math.max(1, ora - tPrec));
    tPrec = ora;
    await new Promise(requestAnimationFrame);
  }
}

// Analizza solo la zona della strada e riporta i riquadri sull'immagine intera.
async function rileva(W, H) {
  const z = CONFIG.zonaAnalisi;
  const sx = Math.round(z.x * W), sy = Math.round(z.y * H);
  const sw = Math.round(z.w * W), sh = Math.round(z.h * H);
  if (ritaglio.width !== sw) { ritaglio.width = sw; ritaglio.height = sh; }
  ctxRitaglio.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const soglia = Math.min(CONFIG.sogliaVeicoli, CONFIG.sogliaConfidenza);
  const grezzi = await modello.detect(ritaglio, 20, soglia);
  const risultato = [];
  for (const o of grezzi) {
    const eVeicolo = CONFIG.veicoli.includes(o.class);
    if (!eVeicolo && !CONFIG.ostacoli.includes(o.class)) continue;
    if (o.score < (eVeicolo ? CONFIG.sogliaVeicoli : CONFIG.sogliaConfidenza)) continue;
    const [x, y, w, h] = o.bbox;
    risultato.push({
      class: o.class, score: o.score,
      bbox: [x + sx, y + sy, w, h],
      tagliatoLati: x < 2 || x + w > sw - 2,
      tagliatoSotto: y + h > sh - 2,
    });
  }
  return risultato;
}

function elabora(oggetti, W, H, t) {
  for (const o of oggetti) {
    o.distanza = distanza.stima(o, W, H);
    o.laterale = distanza.lateraleMetri(o, o.distanza, W);
  }

  // Nostra velocità: GPS oppure velocità finta per le prove
  const gpsRecente = gps.velocita != null && Date.now() - gps.aggiornato < 3000;
  const vEgo = pref.manuale ? pref.vManualeKmh / 3.6 : (gpsRecente ? gps.velocita : null);

  // Inseguimento di tutti gli oggetti e scelta del veicolo davanti
  const tracce = tracciatore.aggiorna(oggetti, t, vEgo);
  const lead = sceglieVeicoloDavanti(tracce);
  ultimoLead = lead;

  const acc = calcolaACC(vEgo ?? 0, pref.vImpostataKmh / 3.6, CONFIG.intervalliTempo[pref.intervalloIdx], lead);

  // Ostacoli (pedoni, bici, animali) nella nostra corsia (un po' allargata) e vicini
  const ostacolo = tracce.find((tr) => CONFIG.ostacoli.includes(tr.classe) && tr.distanza < 25 && inCorsia(tr, 1.4));
  if (ostacolo && acc.livello === 'ok') { acc.livello = 'attenzione'; acc.messaggio = nomeIt(ostacolo.classe) + ' davanti'; }

  disegna(tracce, lead, W, H);
  aggiornaSchermo(vEgo, gpsRecente, lead, acc);
  if (acc.livello !== 'ok') bip(acc.livello);
}

// ---------- Disegno sopra al video ----------
function disegna(tracce, lead, W, H) {
  ctx.clearRect(0, 0, W, H);

  // Zona analizzata (rettangolo tenue)
  const z = CONFIG.zonaAnalisi;
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.strokeRect(z.x * W, z.y * H, z.w * W, z.h * H);

  // Nostra corsia in prospettiva (solo se l'orizzonte è calibrato)
  const yo = distanza.orizzontePx(H);
  if (yo != null) {
    const f = distanza.focalePx(W), hTel = distanza.altezzaTelefono();
    ctx.setLineDash([12, 12]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    for (const lato of [-1, 1]) {
      const xm = -CONFIG.spostamentoTelefono + lato * CONFIG.semiCorsiaMetri;
      [4, 80].forEach((d, i) => {
        const px = W / 2 + xm * f / d, py = yo + f * hTel / d;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  ctx.font = `bold ${Math.round(H / 26)}px system-ui`;
  for (const tr of tracce) {
    const eLead = tr === lead, ostacolo = CONFIG.ostacoli.includes(tr.classe);
    if (!eLead && !pref.mostraTutti && !ostacolo) continue;
    const [x, y, w, h] = tr.bbox;
    ctx.lineWidth = eLead ? 5 : 2;
    ctx.strokeStyle = eLead ? '#22c55e' : ostacolo ? '#facc15' : tr.contromano ? '#60a5fa' : 'rgba(255,255,255,0.6)';
    ctx.strokeRect(x, y, w, h);
    const testo = `${tr.distanza.toFixed(0)} m${tr.contromano ? ' ⇄' : ''}`;
    const tw = ctx.measureText(testo).width;
    // Etichetta sotto al riquadro (in alto finirebbe sotto ai pannelli)
    const ly = Math.min(y + h, H - H / 22);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, ly, tw + 12, H / 22);
    ctx.fillStyle = '#fff'; ctx.fillText(testo, x + 6, ly + H / 22 - 8);
  }
}

// ---------- Aggiornamento pannelli ----------
function aggiornaSchermo(vEgo, gpsRecente, lead, acc) {
  $('vEgo').textContent = vEgo == null ? '--' : Math.round(vEgo * 3.6);
  $('fonteVel').textContent = pref.manuale ? 'velocità MANUALE (prova)'
    : gpsRecente ? `GPS ±${Math.round(gps.precisione)} m` : 'GPS in attesa…';

  if (lead) {
    $('dLead').textContent = lead.distanza.toFixed(0);
    const rel = Math.round(lead.velRel * 3.6);
    const parti = [`${rel > 0 ? '+' : ''}${rel} km/h`];
    if (acc.tempoDistanza != null) parti.push(`${acc.tempoDistanza.toFixed(1)} s`);
    if (acc.ttc != null && acc.ttc < 10) parti.push(`impatto ${acc.ttc.toFixed(1)} s`);
    $('infoLead').textContent = parti.join(' · ');
  } else {
    $('dLead').textContent = '--';
    $('infoLead').textContent = 'nessun veicolo';
  }

  const box = $('consiglio');
  $('vImpostata').textContent = pref.vImpostataKmh;
  $('intervallo').textContent = CONFIG.intervalliTempo[pref.intervalloIdx];
  if (pref.accAttivo) {
    box.className = acc.azione;
    $('azione').textContent = acc.azione;
    $('vObiettivo').textContent = Math.round(acc.vObiettivo * 3.6);
  } else {
    box.className = 'spento';
    $('azione').textContent = 'ACC SPENTO';
    $('vObiettivo').textContent = '--';
  }

  // Gli avvisi di collisione restano attivi anche con ACC spento
  const avv = $('avviso');
  avv.className = acc.livello === 'ok' ? 'nascosto' : acc.livello;
  avv.textContent = acc.messaggio;

  $('stato').textContent = `${fps.toFixed(0)} fps · ${motore} ${msModello.toFixed(0)} ms · ${distanza.calibrato() ? 'calibrato' : 'NON calibrato'}`;
}

const NOMI = { person: 'Pedone', bicycle: 'Bici', dog: 'Animale', cat: 'Animale', horse: 'Animale', cow: 'Animale' };
const nomeIt = (c) => NOMI[c] || 'Ostacolo';

// ---------- Pulsanti ----------
function aggiornaPulsanti() { $('bAcc').classList.toggle('attivo', pref.accAttivo); salvaPref(); }
$('bAcc').onclick = () => { pref.accAttivo = !pref.accAttivo; aggiornaPulsanti(); };
$('bPiu').onclick = () => { pref.vImpostataKmh = Math.min(150, pref.vImpostataKmh + 5); salvaPref(); };
$('bMeno').onclick = () => { pref.vImpostataKmh = Math.max(30, pref.vImpostataKmh - 5); salvaPref(); };
$('bIntervallo').onclick = () => { pref.intervalloIdx = (pref.intervalloIdx + 1) % CONFIG.intervalliTempo.length; salvaPref(); };
aggiornaPulsanti();

// Finestre di dialogo
document.querySelectorAll('dialog .chiudi').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });

$('bCalibra').onclick = () => { $('esitoCal').textContent = ''; $('dCalibra').showModal(); };
$('bCalibraOra').onclick = () => {
  const d = parseFloat($('iDistanzaCal').value);
  if (!ultimoLead) { $('esitoCal').textContent = 'Nessun veicolo al centro: riprova.'; return; }
  if (!(d >= 3 && d <= 40)) { $('esitoCal').textContent = 'Distanza non valida (3–40 m).'; return; }
  const r = distanza.calibra({ bbox: ultimoLead.bbox, class: ultimoLead.classe }, d, video.videoWidth, video.videoHeight);
  if (!r.ok) {
    $('esitoCal').textContent = `Risultato non plausibile (${r.fovGradi.toFixed(0)}°): l'auto deve essere vista da dietro, intera e al centro. Controlla la distanza e riprova.`;
    return;
  }
  tracciatore.reset();
  $('esitoCal').textContent = `Fatto. Angolo di visione calcolato: ${r.fovGradi.toFixed(0)}° (normale tra 55° e 80°).`;
};
$('bResetCal').onclick = () => { distanza.resetCalibrazione(); $('esitoCal').textContent = 'Calibrazione cancellata.'; };

$('bImpostazioni').onclick = () => {
  $('iAltezza').value = distanza.altezzaTelefono();
  $('iTutti').checked = pref.mostraTutti;
  $('iManuale').checked = pref.manuale;
  $('iVManuale').value = pref.vManualeKmh;
  $('iMotore').value = pref.motore;
  $('vManualeTesto').textContent = pref.vManualeKmh;
  $('dImpostazioni').showModal();
};
$('iAltezza').onchange = (e) => { const v = parseFloat(e.target.value); if (v > 0.3 && v < 3) distanza.setAltezzaTelefono(v); };
$('iTutti').onchange = (e) => { pref.mostraTutti = e.target.checked; salvaPref(); };
$('iMotore').onchange = (e) => { pref.motore = e.target.value; salvaPref(); };
$('iManuale').onchange = (e) => { pref.manuale = e.target.checked; salvaPref(); };
$('iVManuale').oninput = (e) => { pref.vManualeKmh = +e.target.value; $('vManualeTesto').textContent = e.target.value; salvaPref(); };
