// ============================================================
//  PARAMETRI REGOLABILI
//  Tutti i numeri "magici" dell'app sono qui. Cambia questi
//  valori per tarare il comportamento senza toccare il resto.
// ============================================================

export const CONFIG = {
  // --- Fotocamera ---
  risoluzione: { width: 1280, height: 720 },

  // Angolo di visione orizzontale ipotizzato (gradi), usato SOLO
  // finché non fai la calibrazione. Dopo la calibrazione è ignorato.
  fovOrizzontaleDefault: 68,

  // --- Riconoscimento oggetti ---
  sogliaConfidenza: 0.45,     // 0..1: sotto questa soglia l'oggetto è ignorato
  sogliaVeicoli: 0.30,        // soglia più bassa per i veicoli (aiuta con le auto scure)

  // Zona dell'immagine analizzata (frazioni 0..1). Tagliare cielo e cruscotto
  // fa vedere al modello le auto più grandi, quindi le riconosce meglio da lontano.
  zonaAnalisi: { x: 0.08, y: 0.28, w: 0.84, h: 0.57 },

  // Motore di calcolo: 'auto' prova WebGPU (più veloce), poi WebGL, poi CPU.
  motorePreferito: 'auto',

  // Larghezza reale media (metri) per tipo di oggetto: serve a stimare la distanza
  larghezzaReale: {
    car: 1.8,
    truck: 2.5,
    bus: 2.55,
    motorcycle: 0.8,
    bicycle: 0.6,
    person: 0.5,
  },
  veicoli: ['car', 'truck', 'bus', 'motorcycle'],
  ostacoli: ['person', 'bicycle', 'dog', 'cat', 'horse', 'cow'],

  // Corsia "nostra", in METRI rispetto al centro del telefono.
  // Un veicolo è "davanti" se il suo centro è entro ±semiCorsiaMetri.
  // (Una corsia italiana è larga 3,5–3,75 m: l'auto accanto è a ~3,5 m.)
  semiCorsiaMetri: 1.6,
  spostamentoTelefono: 0,     // metri: + se il telefono è a destra del centro auto

  // --- Stima distanza ---
  // Peso del metodo "posizione a terra" rispetto a "larghezza" (0..1).
  // Usato solo se la calibrazione ha fissato l'orizzonte.
  pesoMetodoTerra: 0.4,
  distanzaMax: 120,           // oltre questo (m) la stima non è affidabile

  // --- Filtri e velocità relativa ---
  smorzamentoDistanza: 0.3,   // 0..1: più basso = più liscio ma più lento
  finestraVelRelativa: 1.5,   // secondi di storia per calcolare la velocità relativa
  tempoPerdita: 1000,         // ms senza vedere un oggetto prima di dimenticarlo

  // Auto in senso opposto: si avvicinano a circa il doppio della nostra velocità.
  // È "contromano" se si avvicina più veloce di: nostra velocità × fattore + margine,
  // per più fotogrammi di fila. Valori prudenti: meglio un avviso in più che
  // ignorare un'auto ferma davanti.
  fattoreContrario: 1.4,
  margineContrario: 4,        // m/s
  confermeContrario: 3,       // fotogrammi di fila
  distanzaSicurezzaContromano: 20, // m: sotto questa distanza non si ignora nessuna auto in corsia

  // --- Cruise control adattivo (simulato) ---
  distanzaMinimaFermo: 5,     // metri di distanza da tenere anche a velocità 0
  intervalliTempo: [1.0, 1.5, 2.0, 2.5], // secondi di distanza selezionabili
  guadagnoDistanza: 0.25,     // quanto "corregge" la velocità per l'errore di distanza
  tolleranzaKmh: 3,           // differenza sotto cui il consiglio è "mantieni"
  sogliaFrenaKmh: 15,         // se devi scendere di più di così: "frena" invece di "rallenta"

  // --- Avvisi ---
  ttcAttenzione: 3.0,         // secondi all'impatto: avviso giallo
  ttcPericolo: 1.6,           // secondi all'impatto: avviso rosso + suono
  distanzaTempoMinima: 0.8,   // secondi: sotto questo "troppo vicino"
};
