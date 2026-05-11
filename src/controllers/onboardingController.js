const Tenant = require('../models/Tenant');
const { encrypt, decrypt } = require('../services/encryption');
const {
  exchangeCodeForToken,
  getWabaDetails,
  verifyPhoneNumber,
  validateToken,
} = require('../utils/metaGraph');

// Surface friendly error from a Meta axios failure
const metaError = (err, fallback) => {
  const meta = err?.response?.data?.error?.message;
  return meta ? `WhatsApp: ${meta}` : (err.message || fallback);
};

// ─── POST /api/onboarding/exchange-code ──────────────────────────────────────
// Meta embedded signup flow — frontend hands us the auth code from FB.login().
const exchangeCode = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Authorization code is required' });

    const { accessToken } = await exchangeCodeForToken(code);
    const details = await getWabaDetails(accessToken);

    await Tenant.findByIdAndUpdate(req.tenantId, {
      wabaId:             details.wabaId,
      phoneNumberId:      details.phoneNumberId,
      displayPhoneNumber: details.displayPhoneNumber,
      accessToken:        encrypt(accessToken),
    });

    res.json({
      wabaId:             details.wabaId,
      phoneNumberId:      details.phoneNumberId,
      displayPhoneNumber: details.displayPhoneNumber,
    });
  } catch (err) {
    res.status(400).json({ error: metaError(err, 'Could not complete WhatsApp signup') });
  }
};

// ─── POST /api/onboarding/link-existing-waba ─────────────────────────────────
// Client already has a WABA + system user token from another BSP — paste it in.
const linkExistingWaba = async (req, res) => {
  try {
    const { accessToken, wabaId, phoneNumberId } = req.body;
    if (!accessToken || !wabaId || !phoneNumberId) {
      return res.status(400).json({ error: 'accessToken, wabaId and phoneNumberId are required' });
    }

    // Cheap sanity check before we encrypt + persist anything
    await validateToken(accessToken).catch(() => {
      throw new Error('Invalid access token — Meta rejected the credentials');
    });

    const profile = await verifyPhoneNumber(accessToken, phoneNumberId).catch(() => {
      throw new Error('Could not read phone number — check the phoneNumberId or token scopes');
    });

    await Tenant.findByIdAndUpdate(req.tenantId, {
      wabaId,
      phoneNumberId,
      displayPhoneNumber: profile.displayPhoneNumber,
      qualityRating:      profile.qualityRating,
      messagingTier:      profile.messagingTier,
      accessToken:        encrypt(accessToken),
    });

    res.json({
      message:            'WhatsApp linked successfully',
      wabaId,
      phoneNumberId,
      displayPhoneNumber: profile.displayPhoneNumber,
      qualityRating:      profile.qualityRating,
      messagingTier:      profile.messagingTier,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not link WhatsApp account' });
  }
};

// ─── POST /api/onboarding/verify-connection ──────────────────────────────────
// Called post-link to refresh display name, quality + tier on the tenant.
const verifyConnection = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant?.accessToken || !tenant.phoneNumberId) {
      return res.status(400).json({ error: 'WhatsApp not connected yet' });
    }

    const token = decrypt(tenant.accessToken);
    const profile = await verifyPhoneNumber(token, tenant.phoneNumberId);

    tenant.displayPhoneNumber = profile.displayPhoneNumber;
    tenant.qualityRating      = profile.qualityRating;
    tenant.messagingTier      = profile.messagingTier;
    await tenant.save();

    res.json({
      connected:          true,
      displayPhoneNumber: profile.displayPhoneNumber,
      verifiedName:       profile.verifiedName,
      qualityRating:      profile.qualityRating,
      messagingTier:      profile.messagingTier,
    });
  } catch (err) {
    res.status(400).json({ error: metaError(err, 'Verification failed') });
  }
};

// ─── POST /api/onboarding/disconnect ─────────────────────────────────────────
const disconnect = async (req, res) => {
  try {
    await Tenant.findByIdAndUpdate(req.tenantId, {
      $unset: {
        wabaId:             '',
        phoneNumberId:      '',
        accessToken:        '',
        displayPhoneNumber: '',
      },
    });
    res.json({ message: 'WhatsApp disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { exchangeCode, linkExistingWaba, verifyConnection, disconnect };
