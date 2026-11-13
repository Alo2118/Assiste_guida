// ============================================================
//  VEICOLO DAVANTI + CRUISE CONTROL ADATTIVO (simulato)
// ============================================================

import { CONFIG } from './config.js';

// ---------- 1. Scelta del veicolo davanti ----------
// Tra i veicoli riconosciuti, prende il più vicino che si sovrappone
// alla fascia centrale (la nostra corsia).
export function sceglieVeicoloDavanti(oggetti, larghezzaImg) {
  const centro = larghezzaImg / 2;
  const semi = CONFIG.semiLarghezzaCorsia * larghezzaImg;
  let migliore = null;
  for (const o of oggetti) {
    if (!CONFIG.veicoli.includes(o.class)) continue;
    const [x, , w] = o.bbox;
    const sovrapposto = x < centro + semi && x + w > centro - semi;
    if (sovrapposto && (!migliore || o.distanza < migliore.distanza)) migliore = o;
  }
  return migliore;
}

// ---------- 2. Inseguimento: distanza filtrata e velocità relativa ----------
export class Inseguitore {
  constructor() { this.reset(); }

  reset() {
    this.distanza = null;   // metri, filtrata
    this.storia = [];       // [{t, d}]
    this.velRel = 0;        // m/s: positivo = si allontana, negativo = ci avviciniamo
    this.ultimaVista = 0;
  }

  aggiorna(distanzaGrezza, t) {
    // Se il veicolo è "saltato" (es. ne è entrato un altro), riparti da zero.
    if (this.distanza != null && Math.abs(distanzaGrezza - this.distanza) > Math.max(8, this.distanza * 0.4)) {
      this.reset();
    }
    const a = CONFIG.smorzamentoDistanza;
    this.distanza = this.distanza == null ? distanzaGrezza : a * distanzaGrezza + (1 - a) * this.distanza;
    this.ultimaVista = t;

    this.storia.push({ t, d: this.distanza });
    const limite = t - CONFIG.finestraVelRelativa * 1000;
    while (this.storia.length && this.storia[0].t < limite) this.storia.shift();
    this.velRel = pendenza(this.storia);
  }

  // Dopo 0,7 s senza vederlo, il veicolo è considerato perso.
  perso(t) { return t - this.ultimaVista > 700; }
}

// Retta di regressione: velocità di variazione della distanza (m/s).
function pendenza(punti) {
  if (punti.length < 4) return 0;
  const n = punti.length, t0 = punti[0].t;
  let st = 0, sd = 0, stt = 0, std = 0;
  for (const p of punti) {
    const t = (p.t - t0) / 1000;
    st += t; sd += p.d; stt += t * t; std += t * p.d;
  }
  const den = n * stt - st * st;
  return den > 1e-6 ? (n * std - st * sd) / den : 0;
}

// ---------- 3. Logica ACC ----------
/**
 * @param vEgo        nostra velocità (m/s)
 * @param vImpostata  velocità impostata (m/s)
 * @param intervallo  distanza di sicurezza desiderata (secondi)
 * @param lead        {distanza, velRel} oppure null
 * @returns consiglio di guida + stato avvisi
 */
export function calcolaACC(vEgo, vImpostata, intervallo, lead) {
  const r = {
    vObiettivo: vImpostata,
    azione: 'MANTIENI',
    livello: 'ok',         // ok | attenzione | pericolo
    ttc: null,             // secondi all'impatto
    tempoDistanza: null,   // secondi di distanza attuali
    messaggio: '',
  };

  if (lead) {
    const vLead = Math.max(0, vEgo + lead.velRel);
    const dDesiderata = CONFIG.distanzaMinimaFermo + intervallo * vEgo;
    // Velocità che riporta gradualmente alla distanza desiderata
    const vSeguire = vLead + CONFIG.guadagnoDistanza * (lead.distanza - dDesiderata);
    r.vObiettivo = Math.max(0, Math.min(vImpostata, vSeguire));

    if (vEgo > 1) r.tempoDistanza = lead.distanza / vEgo;
    const avvicinamento = -lead.velRel;
    if (avvicinamento > 0.5) r.ttc = lead.distanza / avvicinamento;

    if (r.ttc != null && r.ttc < CONFIG.ttcPericolo) {
      r.livello = 'pericolo'; r.messaggio = 'FRENA!';
    } else if ((r.ttc != null && r.ttc < CONFIG.ttcAttenzione) ||
               (r.tempoDistanza != null && r.tempoDistanza < CONFIG.distanzaTempoMinima)) {
      r.livello = 'attenzione'; r.messaggio = 'Troppo vicino';
    }
  }

  const diffKmh = (r.vObiettivo - vEgo) * 3.6;
  if (r.livello === 'pericolo') r.azione = 'FRENA';
  else if (diffKmh > CONFIG.tolleranzaKmh) r.azione = 'ACCELERA';
  else if (diffKmh < -CONFIG.sogliaFrenaKmh) r.azione = 'FRENA';
  else if (diffKmh < -CONFIG.tolleranzaKmh) r.azione = 'RALLENTA';
  return r;
}
