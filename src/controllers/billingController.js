const Tenant = require('../models/Tenant');
const billing = require('../services/billingService');

// GET /api/billing/status — current plan, usage, subscription details
const getStatus = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('-accessToken');
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const plan = tenant.plan || 'trial';
    const limits = billing.PLAN_LIMITS[plan] || {};
    const usage = tenant.usage || {};
    const currentMonth = new Date().toISOString().slice(0, 7);

    // If month rolled, usage is effectively 0
    const usageData = usage.month === currentMonth ? usage : { messagesSent: 0, aiOperations: 0, contactsCount: 0 };

    res.json({
      plan,
      status: tenant.status,
      subscription: tenant.subscription,
      usage: {
        messages:  { used: usageData.messagesSent  || 0, limit: limits.messages  || 0 },
        ai:        { used: usageData.aiOperations   || 0, limit: limits.ai        || 0 },
        contacts:  { used: usageData.contactsCount  || 0, limit: limits.contacts  || 0 },
        users:     { limit: limits.users || 1 },
      },
      prices: billing.PLAN_PRICES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/billing/subscribe — create Razorpay subscription
const subscribe = async (req, res) => {
  try {
    const { plan } = req.body;
    const validPlans = ['starter', 'growth', 'pro'];
    if (!validPlans.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });

    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Check not already active on same plan
    if (tenant.plan === plan && tenant.subscription?.status === 'active') {
      return res.status(400).json({ error: 'Already subscribed to this plan' });
    }

    const subscription = await billing.createSubscription(tenant, plan);

    // Store pending subscription ID (will be confirmed on webhook)
    await Tenant.findByIdAndUpdate(req.tenantId, {
      'subscription.razorpaySubscriptionId': subscription.id,
      'subscription.status': 'trial', // stays trial until payment confirmed
    });

    res.json({
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url, // Razorpay hosted payment page
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('[Billing] subscribe error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/billing/cancel — cancel at period end
const cancel = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const subId = tenant.subscription?.razorpaySubscriptionId;
    if (!subId) return res.status(400).json({ error: 'No active subscription found' });

    await billing.cancelSubscription(subId);
    await Tenant.findByIdAndUpdate(req.tenantId, {
      'subscription.cancelAtPeriodEnd': true,
    });

    res.json({ message: 'Subscription will be cancelled at the end of the current billing period.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/billing/invoices — invoice history from Razorpay
const getInvoices = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.tenantId).select('subscription');
    const subId = tenant?.subscription?.razorpaySubscriptionId;
    if (!subId) return res.json({ invoices: [] });

    const invoices = await billing.getInvoices(subId);
    res.json({ invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/billing/webhook/razorpay — receives Razorpay events
const razorpayWebhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody;

  if (!billing.verifyWebhookSignature(rawBody, signature)) {
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  // Acknowledge immediately
  res.sendStatus(200);

  const event = req.body.event;
  const payload = req.body.payload;

  try {
    switch (event) {
      case 'subscription.activated':
        await billing.handleSubscriptionActivated(payload); break;
      case 'subscription.charged':
        await billing.handleSubscriptionCharged(payload); break;
      case 'payment.failed':
        await billing.handlePaymentFailed(payload); break;
      case 'subscription.halted':
        await billing.handleSubscriptionHalted(payload); break;
      case 'subscription.cancelled':
        await billing.handleSubscriptionCancelled(payload); break;
      default:
        console.log(`[Billing Webhook] Unhandled event: ${event}`);
    }
  } catch (err) {
    console.error(`[Billing Webhook] Error handling ${event}:`, err.message);
  }
};

module.exports = { getStatus, subscribe, cancel, getInvoices, razorpayWebhook };
