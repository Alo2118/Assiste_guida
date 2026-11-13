// ============================================================
//  FUNZIONI DEL TELEFONO: GPS, schermo sempre acceso,
//  schermo intero, suoni e vibrazione.
// ============================================================

// ---------- GPS ----------
export const gps = {
  velocita: null,     // m/s, null se non disponibile
  precisione: null,   // metri
  aggiornato: 0,
};

export function avviaGPS() {
  if (!('geolocation' in navigator)) return;
  let precedente = null;
  navigator.geolocation.watchPosition((pos) => {
    const c = pos.coords;
    let v = c.speed;
    // Alcuni telefoni non forniscono la velocità: la calcoliamo dalle posizioni.
    if ((v == null || isNaN(v)) && precedente) {
      const dt = (pos.timestamp - precedente.timestamp) / 1000;
      if (dt > 0) v = distanzaMetri(precedente.coords, c) / dt;
    }
    precedente = pos;
    gps.velocita = v == null || isNaN(v) ? null : v;
    gps.precisione = c.accuracy;
    gps.aggiornato = Date.now();
  }, () => { gps.velocita = null; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
}

function distanzaMetri(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * r, dLon = (b.longitude - a.longitude) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Schermo ----------
let wakeLock = null;
export async function schermoSempreAcceso() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* non supportato */ }
}
// Il blocco si perde se l'app va in background: lo richiediamo al ritorno.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock) schermoSempreAcceso();
});

export async function schermoInteroOrizzontale() {
  try {
    await document.documentElement.requestFullscreen?.();
    await screen.orientation?.lock?.('landscape');
  } catch { /* non supportato: pazienza */ }
}

// ---------- Suoni e vibrazione ----------
let audio = null;
export function sbloccaAudio() {
  // I browser permettono l'audio solo dopo un tocco dell'utente.
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume?.();
}

let ultimoBip = 0;
export function bip(livello) {
  const ora = performance.now();
  const pausa = livello === 'pericolo' ? 250 : 900;
  if (!audio || ora - ultimoBip < pausa) return;
  ultimoBip = ora;
  const osc = audio.createOscillator(), vol = audio.createGain();
  osc.frequency.value = livello === 'pericolo' ? 1400 : 880;
  vol.gain.setValueAtTime(0.4, audio.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
  osc.connect(vol).connect(audio.destination);
  osc.start(); osc.stop(audio.currentTime + 0.2);
  if (livello === 'pericolo') navigator.vibrate?.(150);
}
