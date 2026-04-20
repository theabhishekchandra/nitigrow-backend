const express = require('express');
const router = express.Router();
const controller = require('../controllers/quickWinsController');

// The tenant auth middleware location has to be checked, assuming they are accessible via existing routes pattern
// For now, these are standard bindings
router.get('/go/:shortCode', controller.handleRedirect);
router.post('/qr/generate', controller.generateQRCode);
router.post('/links/shorten', controller.shortenLink);
router.post('/contacts/verify-bulk', controller.verifyNumbersBulk);
router.post('/reviews/request', controller.triggerReviewRequest);

module.exports = router;
