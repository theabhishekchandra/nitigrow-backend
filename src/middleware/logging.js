const pinoHttp = require('pino-http');
const logger = require('../lib/logger');

const SKIP_PREFIXES = ['/health', '/metrics'];

const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id, // requestId middleware must run first
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) =>
      SKIP_PREFIXES.some(
        (p) => req.url === p || req.url.startsWith(p + '/') || req.url.startsWith(p + '?'),
      ),
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.totpSecret',
      'req.body.code',
      'res.headers["set-cookie"]',
    ],
    remove: false,
    censor: '***REDACTED***',
  },
});

module.exports = httpLogger;
