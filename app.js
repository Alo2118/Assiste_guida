// ============================================================
//  PROGRAMMA PRINCIPALE
//  Ciclo: fotogramma -> riconoscimento -> distanza -> ACC -> schermo
// ============================================================

import { CONFIG } from './config.js';
import * as distanza from './distance.js';
import { sceglieVeicoloDavanti, Inseguitore, calcolaACC } from './acc.js';
import { gps, avviaGPS, schermoSempreAcceso, schermoInteroOrizzontale, sbloccaAudio, bip } from './dispositivo.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('disegno'), ctx = canvas.getContext('2d');

// ---------- Stato dell'app (salvato sul telefono) ----------
const PREF = 'preferenze-v1';
const pref = Object.assign(
  { accAttivo: false, vImpostataKmh: 90, intervalloIdx: 1, mostraTutti: false, manuale: false, vManualeKmh: 50 },
  leggi(PREF),
);
function leggi(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } }
function salvaPref() { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch { /* ignora */ } }

let modello = null;
const inseguitore = new Inseguitore();
let ultimoLead = null;           // ultimo veicolo davanti (serve alla calibrazione)
let fps = 0;

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
    await tf.setBackend('webgl').catch(() => tf.setBackend('cpu'));
    modello = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: 'vendor/model/model.json' });
    $('inizio').classList.add('nascosto');
    ciclo();
  } catch (e) {
    $('caricamento').textContent = 'Errore: ' + (e.message || e) + '. Hai dato il permesso alla fotocamera?';
    $('bAvvia').disabled = false;
  }
};

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
      const rilevati = await modello.detect(video, 20, CONFIG.sogliaConfidenza);
      elabora(rilevati, W, H, performance.now());
    }
    const ora = performance.now();
    fps = 0.9 * fps + 0.1 * (1000 / Math.max(1, ora - tPrec));
    tPrec = ora;
    await new Promise(requestAnimationFrame);
  }
}

function elabora(rilevati, W, H, t) {
  const interessanti = rilevati.filter((o) => CONFIG.veicoli.includes(o.class) || CONFIG.ostacoli.includes(o.class));
  for (const o of interessanti) o.distanza = distanza.stima(o, W, H);

  // Veicolo davanti e inseguimento
  const lead = sceglieVeicoloDavanti(interessanti, W);
  ultimoLead = lead;
  if (lead) inseguitore.aggiorna(lead.distanza, t);
  else if (inseguitore.perso(t)) inseguitore.reset();
  const leadValido = inseguitore.distanza != null ? { distanza: inseguitore.distanza, velRel: inseguitore.velRel } : null;

  // Nostra velocità: GPS oppure velocità finta per le prove
  const gpsRecente = gps.velocita != null && Date.now() - gps.aggiornato < 3000;
  const vEgo = pref.manuale ? pref.vManualeKmh / 3.6 : (gpsRecente ? gps.velocita : null);

  const acc = calcolaACC(vEgo ?? 0, pref.vImpostataKmh / 3.6, CONFIG.intervalliTempo[pref.intervalloIdx], leadValido);

  // Ostacoli (pedoni, bici, animali) nella nostra corsia e vicini
  const ostacolo = interessanti.find((o) => CONFIG.ostacoli.includes(o.class) && o.distanza < 25 && inCorsia(o, W));
  if (ostacolo && acc.livello === 'ok') { acc.livello = 'attenzione'; acc.messaggio = nomeIt(ostacolo.class) + ' davanti'; }

  disegna(interessanti, lead, W, H);
  aggiornaSchermo(vEgo, gpsRecente, leadValido, acc);
  if (acc.livello !== 'ok') bip(acc.livello);
}

function inCorsia(o, W) {
  const [x, , w] = o.bbox, semi = CONFIG.semiLarghezzaCorsia * W * 1.3;
  return x < W / 2 + semi && x + w > W / 2 - semi;
}

// ---------- Disegno sopra al video ----------
function disegna(oggetti, lead, W, H) {
  ctx.clearRect(0, 0, W, H);

  // Fascia della nostra corsia (linee tratteggiate)
  const semi = CONFIG.semiLarghezzaCorsia * W;
  ctx.setLineDash([12, 12]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.moveTo(W / 2 - semi, H * 0.35); ctx.lineTo(W / 2 - semi, H);
  ctx.moveTo(W / 2 + semi, H * 0.35); ctx.lineTo(W / 2 + semi, H); ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = `bold ${Math.round(H / 26)}px system-ui`;
  for (const o of oggetti) {
    const eLead = o === lead;
    if (!eLead && !pref.mostraTutti && !CONFIG.ostacoli.includes(o.class)) continue;
    const [x, y, w, h] = o.bbox;
    ctx.lineWidth = eLead ? 5 : 2;
    ctx.strokeStyle = eLead ? '#22c55e' : CONFIG.ostacoli.includes(o.class) ? '#facc15' : 'rgba(255,255,255,0.6)';
    ctx.strokeRect(x, y, w, h);
    const testo = `${o.distanza.toFixed(0)} m`;
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

  $('stato').textContent = `${fps.toFixed(0)} fps · ${distanza.calibrato() ? 'calibrato' : 'NON calibrato'}`;
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
  const r = distanza.calibra(ultimoLead, d, video.videoWidth, video.videoHeight);
  if (!r.ok) {
    $('esitoCal').textContent = `Risultato non plausibile (${r.fovGradi.toFixed(0)}°): l'auto deve essere vista da dietro, intera e al centro. Controlla la distanza e riprova.`;
    return;
  }
  inseguitore.reset();
  $('esitoCal').textContent = `Fatto. Angolo di visione calcolato: ${r.fovGradi.toFixed(0)}° (normale tra 55° e 80°).`;
};
$('bResetCal').onclick = () => { distanza.resetCalibrazione(); $('esitoCal').textContent = 'Calibrazione cancellata.'; };

$('bImpostazioni').onclick = () => {
  $('iAltezza').value = distanza.altezzaTelefono();
  $('iTutti').checked = pref.mostraTutti;
  $('iManuale').checked = pref.manuale;
  $('iVManuale').value = pref.vManualeKmh;
  $('vManualeTesto').textContent = pref.vManualeKmh;
  $('dImpostazioni').showModal();
};
$('iAltezza').onchange = (e) => { const v = parseFloat(e.target.value); if (v > 0.3 && v < 3) distanza.setAltezzaTelefono(v); };
$('iTutti').onchange = (e) => { pref.mostraTutti = e.target.checked; salvaPref(); };
$('iManuale').onchange = (e) => { pref.manuale = e.target.checked; salvaPref(); };
$('iVManuale').oninput = (e) => { pref.vManualeKmh = +e.target.value; $('vManualeTesto').textContent = e.target.value; salvaPref(); };
