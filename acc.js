// ============================================================
//  VEICOLO DAVANTI + CRUISE CONTROL ADATTIVO (simulato)
// ============================================================

import { CONFIG } from './config.js';

// ---------- 1. Inseguimento di tutti gli oggetti ----------
// Ogni oggetto riconosciuto viene "agganciato" a quello del fotogramma
// precedente che gli si sovrappone di più. Così di ogni auto conosciamo
// la storia: distanza filtrata, velocità relativa, se viene contromano.

export class Tracciatore {
  constructor() { this.tracce = []; this.prossimoId = 1; }

  /**
   * @param oggetti  riconosciuti in questo fotogramma (con .distanza e .laterale)
   * @param t        tempo in ms
   * @param vEgo     nostra velocità in m/s (null se sconosciuta)
   * @returns elenco delle tracce attive
   */
  aggiorna(oggetti, t, vEgo) {
    const libere = new Set(this.tracce);
    // Accoppiamento: ogni oggetto va alla traccia la cui posizione PREVISTA
    // (in metri: distanza e spostamento laterale) è più vicina.
    // Funziona anche a pochi fps, quando i riquadri si spostano molto.
    const coppie = [];
    for (const o of oggetti) {
      for (const tr of this.tracce) {
        if (gruppo(o.class) !== gruppo(tr.classe)) continue;
        const c = tr.costo(o, t);
        if (c < 1) coppie.push({ o, tr, c });
      }
    }
    coppie.sort((a, b) => a.c - b.c);
    const usati = new Set();
    for (const { o, tr } of coppie) {
      if (usati.has(o) || !libere.has(tr)) continue;
      usati.add(o); libere.delete(tr);
      tr.aggiorna(o, t, vEgo);
    }
    // Oggetti nuovi
    for (const o of oggetti) {
      if (usati.has(o)) continue;
      const tr = new Traccia(this.prossimoId++, o.class);
      tr.aggiorna(o, t, vEgo);
      this.tracce.push(tr);
    }
    // Dimentica quelli non visti da troppo
    this.tracce = this.tracce.filter((tr) => t - tr.ultimaVista < CONFIG.tempoPerdita);
    return this.tracce;
  }

  reset() { this.tracce = []; }
}

class Traccia {
  constructor(id, classe) {
    this.id = id;
    this.classe = classe;
    this.distanza = null;   // metri, filtrata (per lo schermo)
    this.laterale = 0;      // metri a destra (+) o sinistra (−) del telefono
    this.storia = [];       // [{t, d}] distanze GREZZE: la regressione le liscia già
    this.velRel = 0;        // m/s: positivo = si allontana, negativo = si avvicina
    this.contromano = false;
    this.ultimaVista = 0;
    this.ultimaGrezza = null;
    this.bbox = null;
  }

  // Distanza prevista adesso, in base alla velocità relativa
  prevista(t) {
    return this.ultimaGrezza + this.velRel * (t - this.ultimaVista) / 1000;
  }

  // Quanto un oggetto è "lontano" da questa traccia (sotto 1 = compatibile)
  costo(o, t) {
    const dp = Math.max(1, this.prevista(t));
    const errD = Math.abs(o.distanza - dp) / Math.max(4, 0.35 * dp);
    const errL = Math.abs(o.laterale - this.laterale) / (1.2 + 0.02 * dp);
    return Math.max(errD, errL);
  }

  aggiorna(o, t, vEgo) {
    this.bbox = o.bbox;
    this.classe = o.class;
    o.traccia = this;
    const a = CONFIG.smorzamentoDistanza;
    this.distanza = this.distanza == null ? o.distanza : a * o.distanza + (1 - a) * this.distanza;
    this.laterale = this.storia.length ? this.laterale * 0.5 + o.laterale * 0.5 : o.laterale;
    this.ultimaGrezza = o.distanza;
    this.ultimaVista = t;

    this.storia.push({ t, d: o.distanza });
    const limite = t - CONFIG.finestraVelRelativa * 1000;
    while (this.storia.length > 2 && this.storia[0].t < limite) this.storia.shift();
    this.velRel = pendenza(this.storia);
    // Se si avvicina velocemente la distanza filtrata resta indietro:
    // la correggiamo verso quella grezza.
    if (Math.abs(this.velRel) > 8) this.distanza = 0.7 * o.distanza + 0.3 * this.distanza;

    // Filtro fisico: un'auto nel nostro senso non può avvicinarsi più veloce
    // di quanto andiamo noi. Se lo fa, viene verso di noi (contromano).
    // Una volta riconosciuta come tale, resta tale.
    // Serve la conferma su più fotogrammi di fila: un errore di stima non deve
    // far ignorare un'auto ferma davanti a noi.
    // Un'auto contromano si avvicina a circa il DOPPIO della nostra velocità,
    // quindi la soglia può essere larga: nostra velocità × fattore + margine.
    if (!this.contromano && vEgo != null && vEgo > 5 && this.storia.length >= 4 &&
        -this.velRel > vEgo * CONFIG.fattoreContrario + CONFIG.margineContrario) {
      this.indiziContromano = (this.indiziContromano || 0) + 1;
      if (this.indiziContromano >= CONFIG.confermeContrario) this.contromano = true;
    } else {
      this.indiziContromano = 0;
    }
  }
}

const gruppo = (c) => (CONFIG.veicoli.includes(c) ? 'veicolo' : c);

// Retta di regressione: velocità di variazione della distanza (m/s).
function pendenza(punti) {
  if (punti.length < 3) return 0;
  const n = punti.length, t0 = punti[0].t;
  let st = 0, sd = 0, stt = 0, std = 0;
  for (const p of punti) {
    const t = (p.t - t0) / 1000;
    st += t; sd += p.d; stt += t * t; std += t * p.d;
  }
  const den = n * stt - st * st;
  return den > 1e-6 ? (n * std - st * sd) / den : 0;
}

// ---------- 2. Scelta del veicolo davanti ----------
export function inCorsia(traccia, allarga = 1) {
  return Math.abs(traccia.laterale + CONFIG.spostamentoTelefono) < CONFIG.semiCorsiaMetri * allarga;
}

// Il più vicino tra i veicoli nella nostra corsia, esclusi quelli contromano lontani.
export function sceglieVeicoloDavanti(tracce) {
  let migliore = null;
  for (const tr of tracce) {
    if (!CONFIG.veicoli.includes(tr.classe) || !inCorsia(tr)) continue;
    // Le auto contromano si ignorano solo da lontano: se sono nella nostra
    // corsia e vicine sono un pericolo vero (o la stima era sbagliata).
    if (tr.contromano && tr.distanza > CONFIG.distanzaSicurezzaContromano) continue;
    if (tr.storia.length < 2) continue;   // appena comparso: aspettiamo una conferma
    if (!migliore || tr.distanza < migliore.distanza) migliore = tr;
  }
  return migliore;
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
