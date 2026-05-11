const axios = require('axios');

// Mock mode lets dev run the embedded signup flow without real Meta credentials.
const USE_MOCK = process.env.USE_MOCK === 'true';

const BASE_URL = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v19.0';

const randomId = (prefix) =>
  `${prefix}_${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const mockToken = () =>
  `MOCK_SU_TOKEN_${Math.random().toString(36).slice(2, 12).toUpperCase()}`;

// ─── Exchange code → long-lived system user token ────────────────────────────
const exchangeCodeForToken = async (code) => {
  if (USE_MOCK) {
    return {
      accessToken: mockToken(),
      tokenType: 'bearer',
      expiresIn: 0, // system user tokens are non-expiring
    };
  }

  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    throw new Error('Meta credentials not configured on server');
  }

  const { data } = await axios.get(`${BASE_URL}/oauth/access_token`, {
    params: {
      client_id:     process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      code,
    },
    timeout: 10000,
  });

  if (!data?.access_token) throw new Error('Meta did not return an access token');

  return {
    accessToken: data.access_token,
    tokenType:   data.token_type,
    expiresIn:   data.expires_in,
  };
};

// ─── Find first WABA + phone number for a given access token ────────────────
const getWabaDetails = async (accessToken) => {
  if (USE_MOCK) {
    return {
      wabaId:              randomId('mock_waba'),
      businessId:          randomId('mock_biz'),
      phoneNumberId:       randomId('mock_phone'),
      displayPhoneNumber:  '+91 98765 43210',
    };
  }

  const client = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });

  // Walk: businesses → owned WABAs → phone numbers
  const businesses = await client.get('/me/businesses');
  const businessId = businesses.data?.data?.[0]?.id;
  if (!businessId) throw new Error('No business found for this token');

  const wabas = await client.get(`/${businessId}/owned_whatsapp_business_accounts`);
  const wabaId = wabas.data?.data?.[0]?.id;
  if (!wabaId) throw new Error('No WhatsApp Business Account found');

  const phones = await client.get(`/${wabaId}/phone_numbers`);
  const phone = phones.data?.data?.[0];
  if (!phone) throw new Error('No phone number registered on this WABA');

  return {
    wabaId,
    businessId,
    phoneNumberId:      phone.id,
    displayPhoneNumber: phone.display_phone_number,
  };
};

// ─── Fetch live phone-number profile, quality + tier ─────────────────────────
const verifyPhoneNumber = async (accessToken, phoneNumberId) => {
  if (USE_MOCK) {
    return {
      displayPhoneNumber: '+91 98765 43210',
      verifiedName:       'NitiGrow Demo',
      qualityRating:      'GREEN',
      messagingTier:      'TIER_1K',
    };
  }

  const { data } = await axios.get(`${BASE_URL}/${phoneNumberId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params:  { fields: 'display_phone_number,verified_name,quality_rating,messaging_limit_tier' },
    timeout: 10000,
  });

  return {
    displayPhoneNumber: data.display_phone_number,
    verifiedName:       data.verified_name,
    qualityRating:      (data.quality_rating || 'UNKNOWN').toUpperCase(),
    messagingTier:      data.messaging_limit_tier || 'TIER_1K',
  };
};

// ─── Lightweight token validation — used by link-existing path ──────────────
const validateToken = async (accessToken) => {
  if (USE_MOCK) return { id: 'mock_user_id', name: 'Mock User' };

  const { data } = await axios.get(`${BASE_URL}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });
  return data;
};

module.exports = {
  exchangeCodeForToken,
  getWabaDetails,
  verifyPhoneNumber,
  validateToken,
  USE_MOCK,
};
