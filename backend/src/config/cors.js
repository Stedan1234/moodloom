// CORS was previously wide open (`cors()` with no options), which is fine for
// a solo local-dev loop but wrong the moment this is reachable from the
// public internet — any website could otherwise script requests against a
// signed-in user's bearer token if it ever leaked into a readable place.
//
// Two kinds of caller hit this API:
//  1. The web app, from a normal http(s) origin — allowlisted explicitly via
//     ALLOWED_ORIGINS (comma-separated) so it's a deploy-time config choice,
//     not a code change.
//  2. The browser extension, from a `chrome-extension://<id>` origin. The
//     id is stable once published but different for every unpacked/dev load,
//     so we allow the chrome-extension: scheme generically rather than
//     hardcoding one id — this is safe because the extension has no cookies
//     or ambient credentials for this API to hand out; it only ever sends a
//     bearer token it already holds, the same as any explicit fetch caller.
//
// Requests with no Origin header (curl, server-to-server, same-origin) are
// allowed through, matching how the `cors` package already treats them.
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export function corsOptions() {
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.startsWith('chrome-extension://')) return callback(null, true);
      if (configuredOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  };
}
