const Razorpay = require('razorpay');
const Tenant = require('../models/Tenant');

const PLAN_LIMITS = Tenant.PLAN_LIMITS;

// ─── Mock Mode ────────────────────────────────────────────────────────────────
// Set USE_MOCK=true in .env to bypass all Razorpay API calls.
// The UI works fully with simulated subscription data and invoices.
// Switch to USE_MOCK=false once RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are configured.
const USE_MOCK = process.env.USE_MOCK === 'true';

// Razorpay plan IDs — set these in .env after creating plans on Razorpay Dashboard
// TODO: Create plans at https://dashboard.razorpay.com/app/subscriptions/plans
const RAZORPAY_PLAN_IDS = {
  starter:    process.env.RAZORPAY_PLAN_STARTER    || 'plan_starter_CONFIGURE_IN_ENV',
  growth:     process.env.RAZORPAY_PLAN_GROWTH     || 'plan_growth_CONFIGURE_IN_ENV',
  pro:        process.env.RAZORPAY_PLAN_PRO        || 'plan_pro_CONFIGURE_IN_ENV',
  enterprise: process.env.RAZORPAY_PLAN_ENTERPRISE || 'plan_enterprise_CONFIGURE_IN_ENV',
};

const PLAN_PRICES = { starter: 999, growth: 2499, pro: 4999, enterprise: 0 };

// TODO: Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env
let rzp = null;
const getRzp = () => {
  if (!rzp) {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) throw new Error('Razorpay keys not configured in .env');
    rzp = new Razorpay({ key_id, key_secret });
  }
  return rzp;
};

// ─── Mock Data Factories ──────────────────────────────────────────────────────
const mockSubscription = (tenantId, plan) => ({
  id: `sub_MOCK_${Date.now()}`,
  plan_id: RAZORPAY_PLAN_IDS[plan],
  status: 'created',
  // TODO: Replace with real Razorpay short_url from API
  short_url: `https://rzp.io/l/MOCK_${plan}_${tenantId}`,
  notes: { tenantId: tenantId.toString() },
});

const mockInvoices = () => [
  { id: 'inv_MOCK_001', receipt: 'INV-001', amount: 99900, status: 'paid', date: Math.floor((Date.now() - 30 * 86400000) / 1000) },
  { id: 'inv_MOCK_002', receipt: 'INV-002', amount: 99900, status: 'paid', date: Math.floor((Date.now() - 60 * 86400000) / 1000) },
];

// ─── Service Methods ──────────────────────────────────────────────────────────
const createSubscription = async (tenant, plan) => {
  if (USE_MOCK) {
    console.info(`[Billing MOCK] Simulated subscription created: tenant=${tenant._id} plan=${plan}`);
    // TODO: Replace with real Razorpay API call: rzp.subscriptions.create({...})
    return mockSubscription(tenant._id, plan);
  }

  const rzpPlanId = RAZORPAY_PLAN_IDS[plan];
  if (rzpPlanId.includes('CONFIGURE_IN_ENV')) {
    throw new Error(`No Razorpay plan ID configured for plan: ${plan}. Set RAZORPAY_PLAN_${plan.toUpperCase()} in .env`);
  }

  return getRzp().subscriptions.create({
    plan_id: rzpPlanId,
    total_count: 120,
    quantity: 1,
    notify_info: { notify_phone: tenant.phone || '', notify_email: tenant.email },
    notes: { tenantId: tenant._id.toString(), businessName: tenant.businessName },
  });
};

const cancelSubscription = async (razorpaySubscriptionId) => {
  if (USE_MOCK) {
    console.info(`[Billing MOCK] Simulated subscription cancel: ${razorpaySubscriptionId}`);
    // TODO: Replace with real Razorpay API call: rzp.subscriptions.cancel(id, true)
    return { id: razorpaySubscriptionId, status: 'cancelled' };
  }
  return getRzp().subscriptions.cancel(razorpaySubscriptionId, true);
};

const getInvoices = async (razorpaySubscriptionId) => {
  if (USE_MOCK) {
    console.info('[Billing MOCK] Returning mock invoices');
    // TODO: Replace with real Razorpay API call: rzp.subscriptions.fetchAllInvoices(id)
    return mockInvoices();
  }
  try {
    const payments = await getRzp().subscriptions.fetchAllInvoices(razorpaySubscriptionId);
    return payments.items || [];
  } catch { return []; }
};

const verifyWebhookSignature = (rawBody, signature) => {
  if (USE_MOCK) return true; // Skip verification in mock mode
  try {
    const crypto = require('crypto');
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return true; // skip in dev if not configured
    // TODO: Set RAZORPAY_WEBHOOK_SECRET in .env once Razorpay webhook is configured
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return expected === signature;
  } catch { return false; }
};

// ─── Webhook Event Handlers ───────────────────────────────────────────────────
const handleSubscriptionActivated = async (payload) => {
  const subscriptionId = payload.subscription?.entity?.id;
  const notes = payload.subscription?.entity?.notes || {};
  const tenantId = notes.tenantId;
  if (!tenantId || !subscriptionId) return;

  const planId = payload.subscription?.entity?.plan_id;
  const plan = Object.keys(RAZORPAY_PLAN_IDS).find(p => RAZORPAY_PLAN_IDS[p] === planId) || 'starter';

  const now = new Date();
  await Tenant.findByIdAndUpdate(tenantId, {
    plan, status: 'active',
    'subscription.status': 'active',
    'subscription.razorpaySubscriptionId': subscriptionId,
    'subscription.currentPeriodStart': now,
    'subscription.currentPeriodEnd': new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  });
  console.info(`[Billing] Subscription activated: tenant=${tenantId} plan=${plan}`);
};

const handleSubscriptionCharged = async (payload) => {
  const subscriptionId = payload.subscription?.entity?.id;
  const tenantId = payload.subscription?.entity?.notes?.tenantId;
  if (!tenantId) return;

  const now = new Date();
  await Tenant.findOneAndUpdate(
    { 'subscription.razorpaySubscriptionId': subscriptionId },
    {
      'subscription.status': 'active',
      'subscription.currentPeriodStart': now,
      'subscription.currentPeriodEnd': new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      'usage.month': now.toISOString().slice(0, 7),
      'usage.messagesSent': 0, 'usage.aiOperations': 0, 'usage.contactsCount': 0,
    }
  );
  console.info(`[Billing] Subscription charged + usage reset: ${subscriptionId}`);
};

const handlePaymentFailed = async (payload) => {
  const subscriptionId = payload.subscription?.entity?.id;
  if (!subscriptionId) return;
  await Tenant.findOneAndUpdate({ 'subscription.razorpaySubscriptionId': subscriptionId }, { 'subscription.status': 'past_due' });
  console.warn(`[Billing] Payment failed: ${subscriptionId} → past_due`);
};

const handleSubscriptionHalted = async (payload) => {
  const subscriptionId = payload.subscription?.entity?.id;
  if (!subscriptionId) return;
  await Tenant.findOneAndUpdate({ 'subscription.razorpaySubscriptionId': subscriptionId }, { 'subscription.status': 'expired', status: 'suspended' });
  console.error(`[Billing] Subscription halted → account suspended: ${subscriptionId}`);
};

const handleSubscriptionCancelled = async (payload) => {
  const subscriptionId = payload.subscription?.entity?.id;
  if (!subscriptionId) return;
  await Tenant.findOneAndUpdate({ 'subscription.razorpaySubscriptionId': subscriptionId }, { 'subscription.status': 'cancelled', 'subscription.cancelAtPeriodEnd': true });
  console.info(`[Billing] Subscription cancelled: ${subscriptionId}`);
};

module.exports = {
  createSubscription, cancelSubscription, getInvoices, verifyWebhookSignature,
  handleSubscriptionActivated, handleSubscriptionCharged, handlePaymentFailed,
  handleSubscriptionHalted, handleSubscriptionCancelled,
  PLAN_PRICES, PLAN_LIMITS, USE_MOCK,
};
