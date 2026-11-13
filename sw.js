// Service worker: salva l'app sul telefono per usarla senza internet.
// Quando cambi un file, aumenta VERSIONE così i telefoni scaricano la nuova.
const VERSIONE = 'v1';
const FILE = [
  './', 'index.html', 'style.css', 'manifest.json',
  'app.js', 'config.js', 'distance.js', 'acc.js', 'dispositivo.js',
  'vendor/tf.min.js', 'vendor/coco-ssd.min.js', 'vendor/model/model.json',
  'vendor/model/group1-shard1of5', 'vendor/model/group1-shard2of5', 'vendor/model/group1-shard3of5',
  'vendor/model/group1-shard4of5', 'vendor/model/group1-shard5of5',
  'icone/icona-192.png', 'icone/icona-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((chiavi) => Promise.all(chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Prima cerca nella memoria del telefono, poi in rete.
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
