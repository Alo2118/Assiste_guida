# Assistente Guida (prototipo)

Web app per Android che usa la fotocamera del telefono per:
- riconoscere veicoli, pedoni e ostacoli;
- stimare la distanza dal veicolo davanti;
- calcolare velocità relativa e tempo all'impatto, con avvisi;
- simulare un cruise control adattivo (velocità consigliata).

Funziona offline dopo il primo caricamento. **Non è un sistema di sicurezza.**

## File
| File | Cosa fa |
|---|---|
| `config.js` | **Tutti i parametri regolabili** (soglie, distanze, avvisi) |
| `app.js` | Programma principale: fotocamera → riconoscimento → schermo |
| `distance.js` | Stima della distanza (da sostituire per la versione a due camere) |
| `acc.js` | Inseguimento oggetti, filtro contromano, veicolo davanti, logica ACC |
| `dispositivo.js` | GPS, schermo acceso, suoni |
| `sw.js` | Funzionamento offline (aumentare `VERSIONE` a ogni modifica) |
| `vendor/` | Librerie TensorFlow.js e modello COCO-SSD (copia locale) |

## Uso
1. Apri il sito su Chrome Android → menu ⋮ → "Installa app".
2. Telefono in orizzontale sul supporto. Impostazioni ⚙ → altezza del telefono da terra.
3. **Calibra**: auto ferma davanti, vista da dietro, a distanza misurata (8–15 m).
4. Per provare da fermo: ⚙ → "Velocità manuale".
