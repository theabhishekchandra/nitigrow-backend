const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';
const isProd = process.env.NODE_ENV === 'production';

// Pretty in dev only — dynamically require so pino-pretty is not a prod-required dep.
let transport;
if (!isProd) {
  try {
    require.resolve('pino-pretty');
    transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    };
  } catch {
    // pino-pretty not installed — fall back to JSON
    transport = undefined;
  }
}

const logger = pino({
  level,
  base: { service: 'nitigrow-api', env: process.env.NODE_ENV || 'development' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(transport ? { transport } : {}),
});

module.exports = logger;
