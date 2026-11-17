// ============================================================
//  STIMA DELLA DISTANZA (una sola fotocamera)
//  Questo modulo è separato apposta: in futuro, con due camere
//  (stereo), si sostituisce solo questo file mantenendo la stessa
//  funzione "stima(oggetto, larghezzaImg, altezzaImg)".
// ============================================================

import { CONFIG } from './config.js';

const CHIAVE = 'calibrazione-v1';

// Calibrazione salvata sul telefono. Valori "normalizzati" (divisi per la
// dimensione dell'immagine) così restano validi se cambia la risoluzione.
let cal = carica();
cal.altezza ??= 1.2;   // altezza tipica di un telefono sul cruscotto

function carica() {
  try { return JSON.parse(localStorage.getItem(CHIAVE)) || {}; } catch { return {}; }
}
function salva() {
  try { localStorage.setItem(CHIAVE, JSON.stringify(cal)); } catch { /* ignora */ }
}

export function calibrato() { return !!cal.focaleNorm; }
export function altezzaTelefono() { return cal.altezza ?? 1.2; }
export function setAltezzaTelefono(m) { cal.altezza = m; salva(); }
export function resetCalibrazione() { cal = { altezza: cal.altezza }; salva(); }

// Focale in pixel: dalla calibrazione o, se manca, dall'angolo di visione ipotizzato.
export function focalePx(larghezzaImg) {
  if (cal.focaleNorm) return cal.focaleNorm * larghezzaImg;
  const fov = CONFIG.fovOrizzontaleDefault * Math.PI / 180;
  return (larghezzaImg / 2) / Math.tan(fov / 2);
}

// Riga dell'orizzonte in pixel (null se non calibrata)
export function orizzontePx(altezzaImg) {
  return cal.orizzonteNorm == null ? null : cal.orizzonteNorm * altezzaImg;
}

// Spostamento laterale (metri) del centro di un oggetto rispetto al telefono.
export function lateraleMetri(ogg, distanza, larghezzaImg) {
  const [x, , w] = ogg.bbox;
  return ((x + w / 2) - larghezzaImg / 2) * distanza / focalePx(larghezzaImg);
}

/**
 * Stima la distanza (metri) di un oggetto riconosciuto.
 * Due metodi combinati:
 *  1) LARGHEZZA: un'auto larga 1,8 m appare tanto più stretta quanto è lontana.
 *  2) TERRA: più il fondo dell'oggetto è vicino all'orizzonte, più è lontano
 *     (richiede altezza del telefono e orizzonte da calibrazione).
 */
export function stima(ogg, larghezzaImg, altezzaImg) {
  const [x, y, w, h] = ogg.bbox;
  const f = focalePx(larghezzaImg);
  const larghezzaVera = CONFIG.larghezzaReale[ogg.class] ?? 1.8;

  // Metodo 1: larghezza
  const dLarg = (f * larghezzaVera) / Math.max(w, 1);

  // Metodo 2: posizione a terra (solo se l'orizzonte è calibrato)
  let dTerra = null;
  if (cal.orizzonteNorm != null && cal.altezza) {
    const fondo = y + h;
    const orizzonte = cal.orizzonteNorm * altezzaImg;
    const dy = fondo - orizzonte;
    if (dy > 2) dTerra = (f * cal.altezza) / dy;
  }

  // Un oggetto tagliato ai lati ha larghezza falsata: ci si fida di più del
  // metodo "terra". Se è tagliato in basso, il metodo "terra" è falsato.
  const tagliato = ogg.tagliatoLati ?? (x < 2 || x + w > larghezzaImg - 2);
  if (ogg.tagliatoSotto) dTerra = null;

  let d = dLarg;
  if (dTerra != null) {
    const pesoT = tagliato ? 0.9 : CONFIG.pesoMetodoTerra;
    // Se i due metodi sono molto in disaccordo (telefono inclinato, salita...)
    // si usa quello della larghezza, più robusto.
    const rapporto = dTerra / dLarg;
    if (rapporto > 0.6 && rapporto < 1.6) d = pesoT * dTerra + (1 - pesoT) * dLarg;
    else if (tagliato) d = dTerra;
  }
  return Math.min(d, CONFIG.distanzaMax);
}

/**
 * Calibrazione: con un'auto ferma davanti a distanza NOTA (misurata),
 * ricava la focale e la riga dell'orizzonte.
 */
export function calibra(ogg, distanzaVera, larghezzaImg, altezzaImg) {
  const [, y, w, h] = ogg.bbox;
  const larghezzaVera = CONFIG.larghezzaReale[ogg.class] ?? 1.8;
  const f = (w * distanzaVera) / larghezzaVera;
  const fovGradi = 2 * Math.atan((larghezzaImg / 2) / f) * 180 / Math.PI;
  // Controllo di buon senso: un telefono ha un angolo tra ~40° e ~100°.
  // Fuori da qui l'auto era probabilmente di lato, tagliata o la distanza era sbagliata.
  if (fovGradi < 40 || fovGradi > 100) return { ok: false, fovGradi };
  cal.focaleNorm = f / larghezzaImg;
  if (cal.altezza) {
    const fondo = y + h;
    cal.orizzonteNorm = (fondo - (f * cal.altezza) / distanzaVera) / altezzaImg;
  }
  salva();
  return { ok: true, fovGradi };
}
