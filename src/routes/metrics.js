const express = require('express');
const { register } = require('../lib/metrics');

const router = express.Router();

/**
 * GET /metrics — Prometheus scrape target.
 * Intentionally unauthenticated; expose only on internal network / behind LB ACL.
 */
router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(`# metrics error: ${err.message}`);
  }
});

module.exports = router;
