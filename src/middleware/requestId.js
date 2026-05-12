const crypto = require('crypto');

/**
 * Reads or assigns an X-Request-Id for every request.
 * Mirrors the value on the response so clients can correlate logs.
 */
const requestId = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 200
      ? incoming
      : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};

module.exports = requestId;
