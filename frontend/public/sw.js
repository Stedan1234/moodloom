// Moodloom's service worker exists for two things only: it makes the app
// installable on a phone, and (on Android) lets it receive "Share → Moodloom"
// from other apps. It deliberately caches NOTHING: a board is live data
// behind a login, and a stale or cross-account cache would be worse than a
// loading spinner. Every request goes straight to the network.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
