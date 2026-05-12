/* eslint-disable no-console */
/**
 * Demo seed — wipes all tenant-side data (preserves Admin docs) and inserts
 * a realistic Indian SMB tenant set so the admin + app feel "live" without
 * any external API keys configured.
 *
 * Idempotent: re-running deletes all tenants/users/contacts/messages/...
 * and reinserts a fresh set. Admin users (pankaj@ardym.in) are kept.
 *
 * Run:  node src/scripts/seed-demo.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const crypto   = require('crypto');

const Tenant       = require('../models/Tenant');
const User         = require('../models/User');
const Contact      = require('../models/Contact');
const Message      = require('../models/Message');
const Template     = require('../models/Template');
const Campaign     = require('../models/Campaign');
const Lead         = require('../models/Lead');
const Notification = require('../models/Notification');
const Admin        = require('../models/Admin');
const AdminAudit   = require('../models/AdminAudit');

// ─── Utilities ──────────────────────────────────────────────────────────────
const r = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[r(arr.length)];
const pickN = (arr, n) => { const c = [...arr]; const out = []; while (out.length < n && c.length) out.push(c.splice(r(c.length), 1)[0]); return out; };
const days = (n) => n * 24 * 60 * 60 * 1000;
const hours = (n) => n * 60 * 60 * 1000;
const minutes = (n) => n * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const hex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const num = (min, max) => min + r(max - min + 1);
const monthStr = () => new Date().toISOString().slice(0, 7);
const phoneIN = () => '91' + (70 + r(30)) + String(r(99999999)).padStart(8, '0');
const indianPhonePretty = () => `+91 ${num(70, 99)}${num(0, 9)} ${String(r(100000)).padStart(5, '0')}`;

// ─── Indian name pools ─────────────────────────────────────────────────────
const FIRST_M = ['Aarav','Aditya','Akshay','Amit','Anil','Arjun','Ashok','Avinash','Bhavesh','Chetan','Deepak','Dilip','Gaurav','Harsh','Karan','Karthik','Krishna','Manish','Mohan','Naveen','Nikhil','Pankaj','Pradeep','Prakash','Rahul','Rajesh','Ramesh','Ravi','Rohan','Sachin','Sandeep','Sanjay','Saurabh','Shivam','Sumit','Suresh','Tanmay','Tushar','Varun','Vinay','Vivek','Yash'];
const FIRST_F = ['Aishwarya','Aditi','Ananya','Anjali','Anita','Bhavna','Deepika','Divya','Gauri','Isha','Kavya','Kriti','Latha','Madhuri','Manisha','Maya','Meena','Meera','Mira','Nandini','Neha','Nikita','Pooja','Priya','Priyanka','Radhika','Rashmi','Ritu','Sangeeta','Shalini','Shilpa','Shreya','Sneha','Sonia','Sunita','Swati','Tanvi','Vandana','Vidya'];
const LAST = ['Sharma','Singh','Patel','Mehta','Joshi','Verma','Reddy','Iyer','Pillai','Nair','Menon','Kumar','Kapoor','Malhotra','Gupta','Bansal','Agarwal','Tiwari','Pandey','Yadav','Trivedi','Saxena','Tripathi','Goel','Jain','Shah','Desai','Khanna','Chopra','Aggarwal'];
const randomName = () => `${pick([...FIRST_M, ...FIRST_F])} ${pick(LAST)}`;

// ─── Tenant catalogue (25 realistic Indian SMBs) ────────────────────────────
const TENANTS = [
  // ── Active, healthy ──
  { name: 'Riya Fashions',        slug: 'riyafashions',     city: 'Mumbai',     industry: 'Boutique · Fashion',     plan: 'growth',     quality: 'GREEN',  tier: 'TIER_10K',     status: 'active',  daysOld: 188 },
  { name: 'Krishna Electronics',  slug: 'krishnaelec',      city: 'Jaipur',     industry: 'Electronics Retail',     plan: 'pro',        quality: 'GREEN',  tier: 'TIER_100K',    status: 'active',  daysOld: 245 },
  { name: 'Aditya Sweets',        slug: 'adityasweets',     city: 'Delhi',      industry: 'Sweets · Food',          plan: 'starter',    quality: 'GREEN',  tier: 'TIER_1K',      status: 'active',  daysOld: 92  },
  { name: 'TechBridge Solutions', slug: 'techbridge',       city: 'Bangalore',  industry: 'IT Services',            plan: 'pro',        quality: 'GREEN',  tier: 'TIER_100K',    status: 'active',  daysOld: 312, vip: true },
  { name: 'HealthPlus Clinic',    slug: 'healthplus',       city: 'Chennai',    industry: 'Healthcare',             plan: 'growth',     quality: 'GREEN',  tier: 'TIER_10K',     status: 'active',  daysOld: 156 },
  { name: 'AjmerSilks',           slug: 'ajmersilks',       city: 'Ajmer',      industry: 'Textiles',               plan: 'starter',    quality: 'GREEN',  tier: 'TIER_1K',      status: 'active',  daysOld: 78  },
  { name: 'Spice Route Café',     slug: 'spiceroute',       city: 'Goa',        industry: 'Restaurant',             plan: 'starter',    quality: 'GREEN',  tier: 'TIER_1K',      status: 'active',  daysOld: 132 },
  { name: 'Kalakriti Handlooms',  slug: 'kalakriti',        city: 'Lucknow',    industry: 'Handicrafts',            plan: 'growth',     quality: 'GREEN',  tier: 'TIER_10K',     status: 'active',  daysOld: 201 },
  { name: 'Pune Wedding Planners',slug: 'punewp',           city: 'Pune',       industry: 'Events',                 plan: 'starter',    quality: 'GREEN',  tier: 'TIER_1K',      status: 'active',  daysOld: 64  },
  { name: 'Ramesh Tyres',         slug: 'rameshtyres',      city: 'Hyderabad',  industry: 'Auto · Tyres',           plan: 'growth',     quality: 'GREEN',  tier: 'TIER_10K',     status: 'active',  daysOld: 178 },
  { name: 'Patel Real Estate',    slug: 'patelrealty',      city: 'Ahmedabad',  industry: 'Real Estate',            plan: 'pro',        quality: 'GREEN',  tier: 'TIER_100K',    status: 'active',  daysOld: 287, vip: true },
  { name: 'Mountain View Resort', slug: 'mountainview',     city: 'Manali',     industry: 'Hospitality',            plan: 'growth',     quality: 'GREEN',  tier: 'TIER_10K',     status: 'active',  daysOld: 145 },
  { name: 'The Chai Stand',       slug: 'chaistand',        city: 'Bengaluru',  industry: 'F&B · Café',             plan: 'starter',    quality: 'GREEN',  tier: 'TIER_1K',      status: 'active',  daysOld: 41  },
  { name: 'Bharat Tutorials',     slug: 'bharattutorials',  city: 'Jaipur',     industry: 'Education · Coaching',   plan: 'growth',     quality: 'GREEN',  tier: 'TIER_10K',     status: 'active',  daysOld: 167 },

  // ── YELLOW quality (warning) ──
  { name: 'Sundari Boutique',     slug: 'sundari',          city: 'Ahmedabad',  industry: 'Boutique · Fashion',     plan: 'growth',     quality: 'YELLOW', tier: 'TIER_10K',     status: 'active',  daysOld: 102, yellowDays: 2 },
  { name: 'DesiDeals Wholesale',  slug: 'desideals',        city: 'Surat',      industry: 'Wholesale · Apparel',    plan: 'growth',     quality: 'YELLOW', tier: 'TIER_10K',     status: 'active',  daysOld: 89,  yellowDays: 4 },

  // ── RED quality (urgent) ──
  { name: 'EduFirst Academy',     slug: 'edufirst',         city: 'Pune',       industry: 'Education · Coaching',   plan: 'pro',        quality: 'RED',    tier: 'TIER_100K',    status: 'active',  daysOld: 230, redDays: 3 },
  { name: 'CloudStore India',     slug: 'cloudstore',       city: 'Bangalore',  industry: 'eCommerce',              plan: 'growth',     quality: 'RED',    tier: 'TIER_10K',     status: 'active',  daysOld: 119, redDays: 1 },

  // ── Trial (no WABA yet) ──
  { name: 'Mira Photography',     slug: 'miraphoto',        city: 'Mumbai',     industry: 'Photography',            plan: 'trial',      quality: null,     tier: null,           status: 'active',  daysOld: 9,  trialExpiresInDays: 5 },
  { name: 'Vedic Yoga Studio',    slug: 'vedicyoga',        city: 'Rishikesh',  industry: 'Wellness',               plan: 'trial',      quality: null,     tier: null,           status: 'active',  daysOld: 12, trialExpiresInDays: 2 },
  { name: 'Saraswati Books',      slug: 'saraswatibooks',   city: 'Varanasi',   industry: 'Retail · Books',         plan: 'trial',      quality: null,     tier: null,           status: 'active',  daysOld: 4,  trialExpiresInDays: 10 },
  { name: 'Reliable Plumbers',    slug: 'reliableplumbers', city: 'Mumbai',     industry: 'Services',               plan: 'trial',      quality: null,     tier: null,           status: 'active',  daysOld: 11, trialExpiresInDays: 3 },

  // ── Money trouble ──
  { name: 'NoorCarpets',          slug: 'noorcarpets',      city: 'Srinagar',   industry: 'Handicrafts',            plan: 'starter',    quality: 'GREEN',  tier: 'TIER_1K',      status: 'past_due', daysOld: 156 },
  { name: 'Modern Optical',       slug: 'modernoptical',    city: 'Kolkata',    industry: 'Retail · Optical',       plan: 'starter',    quality: 'GREEN',  tier: 'TIER_1K',      status: 'past_due', daysOld: 142 },

  // ── Suspended ──
  { name: 'Sundar Salon',         slug: 'sundarsalon',      city: 'Indore',     industry: 'Beauty · Salon',         plan: 'starter',    quality: null,     tier: null,           status: 'suspended', daysOld: 89 },
];

// ─── Message scripts (used to seed conversations) ───────────────────────────
const SCRIPTS = [
  // Property / real estate
  [
    { d: 'inbound',  t: 'Hi, is the property still available?' },
    { d: 'outbound', t: 'Hi {{name}}! Yes, it is. Would you like to schedule a site visit this weekend?' },
    { d: 'inbound',  t: 'Saturday 11am works' },
    { d: 'outbound', t: 'Perfect — I\'ll share the location pin and confirm with you Friday evening. 👍' },
  ],
  // Order tracking / commerce
  [
    { d: 'inbound',  t: 'Where is my order?' },
    { d: 'outbound', t: 'Hi {{name}}! Your order #SH-7821 was shipped yesterday via Delhivery. ETA: tomorrow by 6 PM.' },
    { d: 'inbound',  t: 'Can I get the tracking link?' },
    { d: 'outbound', t: 'Sure — https://delhivery.in/track/DH7821-IN. Reply here if you face any issue.' },
  ],
  // Boutique inquiry (Hinglish)
  [
    { d: 'inbound',  t: 'Aapke yahaan lehenga rental hai kya?' },
    { d: 'outbound', t: 'Haan {{name}} ji, lehenga rental ₹3,500 se shuru hota hai. Aapke event ki date kya hai?' },
    { d: 'inbound',  t: '15 December' },
    { d: 'outbound', t: 'Got it — main 15 Dec ke liye 5 options chunke bhejti hoon abhi. 📸' },
  ],
  // Restaurant / café
  [
    { d: 'inbound',  t: 'Is the rooftop open for dinner today?' },
    { d: 'outbound', t: 'Yes! Rooftop is open 7 PM onwards. Would you like to book a table?' },
    { d: 'inbound',  t: 'Table for 4 at 8:30' },
    { d: 'outbound', t: 'Confirmed — table for 4 at 8:30 PM tonight. See you soon! 🌙' },
  ],
  // Healthcare appointment
  [
    { d: 'inbound',  t: 'Need to book an appointment with Dr. Sharma.' },
    { d: 'outbound', t: 'Sure {{name}}! Dr. Sharma is available tomorrow 11 AM, 3 PM, or Thursday 10 AM. Which suits you?' },
    { d: 'inbound',  t: 'Tomorrow 3pm' },
    { d: 'outbound', t: 'Booked: Tomorrow 3 PM at HealthPlus Clinic. Please arrive 10 min early. Token #42.' },
  ],
  // Coaching / education
  [
    { d: 'inbound',  t: 'I want to join the JEE batch starting July.' },
    { d: 'outbound', t: 'Welcome {{name}}! July batch fee is ₹52,000. We have a demo class this Sat 10 AM. Want me to enroll you for the demo?' },
    { d: 'inbound',  t: 'Yes please' },
    { d: 'outbound', t: 'Done. You\'ll get a Google Meet link Saturday morning. Good luck! 📚' },
  ],
  // Wedding / events
  [
    { d: 'inbound',  t: 'Looking for a wedding planner for Feb 2026 in Pune.' },
    { d: 'outbound', t: 'Hi {{name}}! Congrats 🎉 We have 3 packages starting ₹4.5L. Can we schedule a call this week?' },
    { d: 'inbound',  t: 'Thursday evening?' },
    { d: 'outbound', t: 'Perfect — Thursday 6 PM. I\'ll call you on this number.' },
  ],
  // Auto / tyres
  [
    { d: 'inbound',  t: 'Need 4 new tyres for Swift Dzire.' },
    { d: 'outbound', t: 'Yes sir — Apollo Apterra HT for Swift Dzire is ₹4,200 each. Fitment + balancing included. Free pickup-drop within 5km.' },
    { d: 'inbound',  t: 'Can you come tomorrow?' },
    { d: 'outbound', t: 'Tomorrow 11 AM works. Sharing the technician\'s number. ✅' },
  ],
];

const TEMPLATE_LIBRARY = [
  { name: 'welcome_new_lead', category: 'MARKETING', status: 'APPROVED',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Welcome to {{businessName}} 🙏' },
      { type: 'BODY', text: 'Hi {{1}},\n\nThank you for reaching out. Our team will get back to you shortly. Feel free to reply to this message anytime.' },
      { type: 'FOOTER', text: 'Made with ❤ in India' },
    ] },
  { name: 'order_confirmed', category: 'UTILITY', status: 'APPROVED',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Order Confirmed ✅' },
      { type: 'BODY', text: 'Hi {{1}},\n\nYour order *#{{2}}* for *₹{{3}}* is confirmed. ETA: {{4}}.\n\nReply for any help.' },
    ] },
  { name: 'appointment_reminder', category: 'UTILITY', status: 'APPROVED',
    components: [
      { type: 'BODY', text: 'Reminder, {{1}}: your appointment is on *{{2}}* at *{{3}}*. Please arrive 10 minutes early.\n\nReply RESCHEDULE to change.' },
    ] },
  { name: 'festive_offer_diwali', category: 'MARKETING', status: 'APPROVED',
    components: [
      { type: 'HEADER', format: 'TEXT', text: '🪔 Diwali Specials' },
      { type: 'BODY', text: 'Dear {{1}},\n\nThis Diwali, enjoy up to *30% off* on everything in store. Offer valid till 31st Oct.\n\nReply *INTERESTED* and we\'ll send the catalog.' },
      { type: 'FOOTER', text: 'T&C apply' },
    ] },
  { name: 'payment_reminder', category: 'UTILITY', status: 'APPROVED',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, this is a gentle reminder that *₹{{2}}* is due on *{{3}}*. Tap below to pay now.' },
    ] },
  { name: 'feedback_request', category: 'MARKETING', status: 'PENDING',
    components: [
      { type: 'BODY', text: 'Hi {{1}},\n\nHope you loved your recent experience at {{businessName}}! Mind leaving us a quick review? It really helps us grow. 🙏' },
    ] },
];

const CAMPAIGN_TITLES = [
  'Diwali 2025 Offer Blast', 'New Arrival — Festive Collection', 'Summer Mega Sale',
  'Welcome New Customers — Q1', 'Cart Abandoners Recovery', 'Birthday Wishes Batch',
  'Re-engagement — Inactive 60d', 'Service Reminder — Monsoon Special',
];

const SUPPORT_TICKETS_PER_TENANT = [0, 0, 1, 1, 2, 3]; // most have none, some have a few

// ─── Seeders ────────────────────────────────────────────────────────────────
async function seedTenants() {
  console.log('\n── Inserting tenants ──');
  const out = [];
  for (const spec of TENANTS) {
    const createdAt = ago(days(spec.daysOld));
    // The Tenant model's top-level status enum is ['active','suspended','cancelled'].
    // Money-trouble tenants stay top-level 'active' — past_due belongs on subscription.status.
    const topStatus = spec.status === 'past_due' ? 'active' : spec.status;
    const t = await Tenant.create({
      businessName: spec.name,
      email: `owner@${spec.slug}.com`,
      phone: indianPhonePretty(),
      industry: spec.industry,
      plan: spec.plan === 'trial' ? 'trial' : spec.plan,
      status: topStatus,
      ...(spec.quality ? {
        wabaId: hex(16),
        phoneNumberId: hex(15),
        displayPhoneNumber: indianPhonePretty(),
        qualityRating: spec.quality,
        messagingTier: spec.tier,
        dailyLimit: { TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: -1 }[spec.tier] || 250,
        dailyMsgCount: num(50, 800),
        dailyCountResetAt: ago(hours(num(1, 23))),
      } : {}),
      usage: {
        month: monthStr(),
        messagesSent:  spec.plan === 'trial' ? num(20, 500) : num(800, 20000),
        aiOperations:  spec.plan === 'trial' ? num(5, 50)  : num(40, 800),
        contactsCount: spec.plan === 'trial' ? num(10, 100) : num(120, 1800),
      },
      subscription: spec.plan === 'trial' ? {
        status: 'trial',
        trialEndsAt: new Date(Date.now() + days(spec.trialExpiresInDays)),
      } : spec.status === 'past_due' ? {
        status: 'past_due',
        currentPeriodStart: ago(days(45)),
        currentPeriodEnd:   ago(days(15)),
      } : spec.status === 'suspended' ? {
        status: 'cancelled',
        currentPeriodStart: ago(days(60)),
        currentPeriodEnd:   ago(days(30)),
      } : {
        status: 'active',
        currentPeriodStart: ago(days(num(1, 28))),
        currentPeriodEnd:   new Date(Date.now() + days(num(2, 28))),
        razorpaySubscriptionId: 'sub_' + hex(14),
      },
      createdAt,
    });
    out.push({ t, spec });
  }
  console.log(`  ${out.length} tenants ✓`);
  return out;
}

async function seedUsersFor(tenant, spec) {
  const owner = await User.create({
    tenantId: tenant._id,
    name: randomName(),
    email: `owner@${spec.slug}.com`,
    password: 'Demo@1234',
    role: 'owner',
  });
  const agents = [];
  const agentCount = spec.plan === 'pro' ? 3 : spec.plan === 'growth' ? 2 : 1;
  for (let i = 0; i < agentCount; i++) {
    agents.push(await User.create({
      tenantId: tenant._id,
      name: randomName(),
      email: `agent${i + 1}@${spec.slug}.com`,
      password: 'Demo@1234',
      role: pick(['sales_agent', 'support_agent', 'campaign_manager']),
    }));
  }
  return [owner, ...agents];
}

async function seedContactsFor(tenant, spec, count) {
  const used = new Set();
  const docs = [];
  for (let i = 0; i < count; i++) {
    let p; do { p = phoneIN(); } while (used.has(p));
    used.add(p);
    const status = pick(['hot', 'hot', 'warm', 'warm', 'warm', 'cold', 'customer', 'customer']);
    docs.push({
      tenantId: tenant._id,
      name: randomName(),
      phone: p,
      tags: pickN(['lead', 'vip', 'returning', 'cart-abandoner', 'newsletter', 'campaign-respondent'], num(0, 3)),
      status,
      optedIn: Math.random() > 0.05,
      optInSource: pick(['whatsapp_initiated', 'website_form', 'manual']),
      optInDate: ago(days(num(1, 240))),
      channel: 'whatsapp',
      lastContactedAt: ago(hours(num(1, 24 * 30))),
      windowExpiresAt: Math.random() > 0.4 ? ago(-hours(num(1, 23))) : null,
      windowType: 'customer_initiated',
      createdAt: ago(days(num(1, Math.min(spec.daysOld, 180)))),
    });
  }
  return Contact.insertMany(docs);
}

async function seedMessagesFor(tenant, contacts, users) {
  const owner = users[0];
  const total = num(30, Math.min(200, contacts.length * 3));
  const conversationCount = Math.min(num(8, 25), contacts.length);
  const conversationContacts = pickN(contacts, conversationCount);

  const docs = [];
  for (const contact of conversationContacts) {
    const script = pick(SCRIPTS);
    let t = Date.now() - days(num(1, 14)) - hours(num(0, 23));
    for (const m of script) {
      t += minutes(num(2, 25));
      docs.push({
        tenantId: tenant._id,
        contactId: contact._id,
        direction: m.d,
        type: 'text',
        content: { text: m.t.replace('{{name}}', (contact.name || '').split(' ')[0] || 'there') },
        waMessageId: 'wa_msg_' + hex(20),
        status: m.d === 'outbound' ? pick(['delivered', 'read', 'read']) : 'delivered',
        sentBy: m.d === 'outbound' ? owner._id : undefined,
        sentiment: m.d === 'inbound' ? pick(['neutral', 'neutral', 'positive', 'positive', 'frustrated']) : undefined,
        createdAt: new Date(t),
      });
    }
  }
  // Sprinkle a few standalone broadcast outbounds within the last day
  for (let i = 0; i < num(5, 30); i++) {
    const c = pick(contacts);
    docs.push({
      tenantId: tenant._id,
      contactId: c._id,
      direction: 'outbound',
      type: 'template',
      templateName: pick(['welcome_new_lead', 'festive_offer_diwali', 'appointment_reminder']),
      content: { text: '[Template message]' },
      waMessageId: 'wa_msg_' + hex(20),
      status: pick(['sent', 'delivered', 'delivered', 'read']),
      sentBy: owner._id,
      createdAt: ago(hours(num(1, 24))),
    });
  }
  if (docs.length) await Message.insertMany(docs);
  return docs.length;
}

async function seedTemplatesFor(tenant, spec) {
  const count = spec.plan === 'pro' ? 6 : spec.plan === 'growth' ? 5 : 3;
  const picks = pickN(TEMPLATE_LIBRARY, count);
  const docs = picks.map(t => ({
    tenantId: tenant._id,
    name: t.name,
    category: t.category,
    language: 'en',
    status: t.status,
    metaTemplateId: t.status === 'APPROVED' ? 'meta_tpl_' + hex(10) : undefined,
    components: t.components,
  }));
  return Template.insertMany(docs);
}

async function seedCampaignsFor(tenant, spec, owner, templates) {
  if (spec.plan === 'trial' || spec.status === 'suspended') return [];
  const approved = templates.filter(t => t.status === 'APPROVED');
  if (!approved.length) return [];
  const count = spec.plan === 'pro' ? 5 : spec.plan === 'growth' ? 3 : 1;
  const docs = [];
  for (let i = 0; i < count; i++) {
    const tpl = pick(approved);
    const status = pick(['completed', 'completed', 'completed', 'running', 'scheduled', 'draft']);
    const total = num(80, 1200);
    const sent = status === 'draft' || status === 'scheduled' ? 0 : Math.floor(total * num(85, 100) / 100);
    const delivered = Math.floor(sent * num(90, 99) / 100);
    const read = Math.floor(delivered * num(45, 85) / 100);
    const replied = Math.floor(read * num(8, 25) / 100);
    const failed = total - sent;
    docs.push({
      tenantId: tenant._id,
      name: pick(CAMPAIGN_TITLES),
      templateId: tpl._id,
      templateName: tpl.name,
      language: 'en',
      audience: { type: pick(['all', 'tag', 'segment']), tags: pickN(['lead', 'vip', 'newsletter'], num(0, 2)) },
      status,
      scheduledAt:  status === 'scheduled' ? new Date(Date.now() + days(num(1, 7))) : undefined,
      startedAt:    status === 'completed' || status === 'running' ? ago(days(num(1, 30))) : undefined,
      completedAt:  status === 'completed' ? ago(days(num(0, 28)) + hours(num(1, 23))) : undefined,
      stats: { total, sent, delivered, read, replied, failed },
      createdBy: owner._id,
      createdAt: ago(days(num(1, 60))),
    });
  }
  return Campaign.insertMany(docs);
}

async function seedLeadsFor(tenant, spec, contacts, users) {
  if (spec.plan === 'trial' || spec.status === 'suspended') return [];
  if (!contacts.length || !users.length) return [];
  const owner = users[0];
  const sales = users.filter(u => u.role === 'sales_agent');
  const stagePool = ['new', 'new', 'warm', 'warm', 'hot', 'won', 'lost'];
  const count = num(6, 14);
  const sample = pickN(contacts, Math.min(count, contacts.length));
  const docs = sample.map((c) => ({
    tenantId: tenant._id,
    contactId: c._id,
    name: c.name,
    phone: c.phone,
    channel: 'whatsapp',
    stage: pick(stagePool),
    value: num(5000, 250000),
    source: pick(['inbox', 'website', 'import', 'api']),
    assignedTo: (sales.length ? pick(sales) : owner)._id,
    tags: c.tags || [],
    createdAt: ago(days(num(0, 45))),
  }));
  return Lead.insertMany(docs);
}

// ─── Admin notifications + audit ────────────────────────────────────────────
async function seedAdminSignals(tenants, admin) {
  // Audit entries — recent admin actions
  const samples = [];
  const tnByName = (n) => tenants.find(({ spec }) => spec.name === n)?.t;
  const pushAudit = (action, tenant, when, extra = {}) => samples.push({
    adminId: admin._id, action,
    targetType: 'tenant',
    targetId: tenant?._id,
    ...extra,
    ip: '49.207.' + num(0, 255) + '.' + num(0, 255),
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36',
    createdAt: when,
  });
  pushAudit('admin.password.change',     null,                                       ago(days(11)));
  pushAudit('admin.profile.update',      null,                                       ago(days(9)));
  pushAudit('tenant.suspend',            tnByName('Sundar Salon'),                   ago(days(7)),  { before: { status: 'active' }, after: { status: 'suspended' } });
  pushAudit('tenant.impersonate',        tnByName('CloudStore India'),               ago(hours(2)));
  pushAudit('tenant.limits.update',      tnByName('TechBridge Solutions'),           ago(days(2)),  { after: { messages: 5000, ai: 1000 } });
  pushAudit('tenant.impersonate',        tnByName('EduFirst Academy'),               ago(hours(8)));
  pushAudit('admin.session.revoke',      null,                                       ago(days(3)));
  pushAudit('tenant.suspend',            tnByName('Sundar Salon'),                   ago(days(7)));
  pushAudit('tenant.impersonate',        tnByName('Riya Fashions'),                  ago(days(1)));
  pushAudit('tenant.limits.update',      tnByName('Patel Real Estate'),              ago(days(4)),  { after: { messages: 10000, ai: 2000 } });
  pushAudit('admin.2fa.enable',          null,                                       ago(days(14)));
  pushAudit('tenant.impersonate',        tnByName('NoorCarpets'),                    ago(days(5)));
  if (samples.length) await AdminAudit.insertMany(samples);
  console.log(`  ${samples.length} audit entries ✓`);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to Atlas');

  // Wipe tenant-side data (preserve Admin docs)
  console.log('\n── Wiping existing tenant-side data ──');
  const wipe = await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Contact.deleteMany({}),
    Message.deleteMany({}),
    Template.deleteMany({}),
    Campaign.deleteMany({}),
    Lead.deleteMany({}),
    Notification.deleteMany({}),
    AdminAudit.deleteMany({}),
  ]);
  console.log(`  ${wipe.reduce((s, x) => s + x.deletedCount, 0)} docs removed`);

  // Ensure admin user exists (will already exist for pankaj@ardym.in but be safe)
  let admin = await Admin.findOne({ email: 'pankaj@ardym.in' });
  if (!admin) {
    admin = await Admin.create({ name: 'Pankaj Jain', email: 'pankaj@ardym.in', password: 'NitiGrow@2026', role: 'superadmin' });
    console.log('  Admin pankaj@ardym.in created');
  } else {
    console.log(`  Admin preserved: ${admin.email}`);
  }

  // Tenants
  const tenants = await seedTenants();

  // Per-tenant seeding
  let totalContacts = 0, totalMessages = 0, totalCampaigns = 0, totalLeads = 0, totalTemplates = 0, totalUsers = 0;
  for (const { t, spec } of tenants) {
    const users = await seedUsersFor(t, spec);
    totalUsers += users.length;

    const contactCount = spec.plan === 'trial' ? num(5, 30)
                        : spec.plan === 'starter' ? num(40, 150)
                        : spec.plan === 'growth' ? num(120, 600)
                        : num(300, 1500);
    const contacts = await seedContactsFor(t, spec, contactCount);
    totalContacts += contacts.length;

    totalMessages += await seedMessagesFor(t, contacts, users);

    const templates = await seedTemplatesFor(t, spec);
    totalTemplates += templates.length;

    const campaigns = await seedCampaignsFor(t, spec, users[0], templates);
    totalCampaigns += campaigns.length;

    const leads = await seedLeadsFor(t, spec, contacts, users);
    totalLeads += leads.length;
  }

  console.log('\n── Tenant-side totals ──');
  console.log(`  Users:     ${totalUsers}`);
  console.log(`  Contacts:  ${totalContacts}`);
  console.log(`  Messages:  ${totalMessages}`);
  console.log(`  Templates: ${totalTemplates}`);
  console.log(`  Campaigns: ${totalCampaigns}`);
  console.log(`  Leads:     ${totalLeads}`);

  // Admin signals
  console.log('\n── Admin signals ──');
  await seedAdminSignals(tenants, admin);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 Demo seed complete.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Admin   (admin:5174) → pankaj@ardym.in / NitiGrow@2026');
  console.log('App     (app:5173)   → any tenant: owner@<slug>.com / Demo@1234');
  console.log('  e.g.  owner@riyafashions.com  /  Demo@1234');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
}

main().catch(err => { console.error('❌ Seed failed:', err); process.exit(1); });
