const { doubleCsrf } = require('csrf-csrf');

// ── CSRF protection for cookie-authenticated user routes ───────────────────
// We use the double-submit cookie pattern: the server sets a hashed token in a
// cookie (`niti-csrf`), the frontend reads a matching value from
// `GET /api/auth/csrf` and echoes it back in `X-CSRF-Token` on state-changing
// requests. Bearer-token endpoints don't need this — they're not vulnerable
// to CSRF — so we only mount this on /api/auth/refresh and /api/auth/logout.
//
// IMPORTANT: we DO NOT mount this globally. The rest of the API uses
// Authorization: Bearer <jwt>, which the browser will not send cross-origin
// without an explicit fetch from attacker JS, so CSRF is not a vector there.

const isProd = process.env.NODE_ENV === 'production';

const COOKIE_NAME = 'niti-csrf';
const HEADER_NAME = 'X-CSRF-Token';

const getSecret = () =>
  process.env.CSRF_SECRET ||
  process.env.JWT_SECRET ||
  // Stable enough for dev; production should have CSRF_SECRET set explicitly.
  'nitigrow-dev-csrf-secret-change-me';

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret,
  // Session identifier — we don't have a server session, so anchor the token
  // to the refresh-token cookie when present (rotates on refresh) or fall back
  // to a stable per-request placeholder.
  getSessionIdentifier: (req) => req.cookies?.refreshToken || req.ip || 'anon',
  cookieName: COOKIE_NAME,
  cookieOptions: {
    httpOnly: false, // double-submit pattern — frontend JS must be able to read it.
    sameSite: isProd ? 'strict' : 'lax',
    secure: isProd,
    path: '/',
  },
  // Only enforce on state-changing verbs; GET/HEAD/OPTIONS pass through.
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getCsrfTokenFromRequest: (req) => req.headers[HEADER_NAME.toLowerCase()] || req.body?._csrf,
});

// The protect middleware. Apply to specific routes — never globally.
const csrfMiddleware = doubleCsrfProtection;

// GET /api/auth/csrf handler — returns a fresh token AND sets the matching cookie.
const getCsrfToken = (req, res) => {
  const csrfToken = generateCsrfToken(req, res);
  res.json({ csrfToken });
};

module.exports = {
  csrfMiddleware,
  getCsrfToken,
  CSRF_COOKIE_NAME: COOKIE_NAME,
  CSRF_HEADER_NAME: HEADER_NAME,
};
