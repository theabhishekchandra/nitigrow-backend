require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const Template = require('../models/Template');
const Campaign = require('../models/Campaign');
const Admin = require('../models/Admin');

const contacts_data = [
  { name: 'Rahul Sharma',    phone: '919876543210', tags: ['lead', 'property'], status: 'hot',      optedIn: true },
  { name: 'Priya Singh',     phone: '919812345678', tags: ['lead'],             status: 'warm',     optedIn: true },
  { name: 'Amit Verma',      phone: '919823456789', tags: ['customer'],         status: 'customer', optedIn: true },
  { name: 'Sunita Gupta',    phone: '919834567890', tags: ['vip', 'property'],  status: 'hot',      optedIn: true },
  { name: 'Deepak Joshi',    phone: '919845678901', tags: ['lead'],             status: 'cold',     optedIn: false },
  { name: 'Kavya Nair',      phone: '919856789012', tags: ['customer', 'vip'], status: 'customer', optedIn: true },
  { name: 'Rohit Mehta',     phone: '919867890123', tags: ['lead', 'budget'],   status: 'warm',     optedIn: true },
  { name: 'Anjali Patel',    phone: '919878901234', tags: ['property'],         status: 'hot',      optedIn: true },
  { name: 'Vikram Yadav',    phone: '919889012345', tags: ['lead'],             status: 'cold',     optedIn: false },
  { name: 'Neha Agarwal',    phone: '919890123456', tags: ['customer'],         status: 'customer', optedIn: true },
  { name: 'Suresh Kumar',    phone: '919801234567', tags: ['vip'],              status: 'hot',      optedIn: true },
  { name: 'Meena Iyer',      phone: '919802345678', tags: ['lead', 'property'], status: 'warm',     optedIn: true },
  { name: 'Arun Tiwari',     phone: '919803456789', tags: ['budget'],           status: 'cold',     optedIn: true },
  { name: 'Pooja Mishra',    phone: '919804567890', tags: ['customer'],         status: 'customer', optedIn: true },
  { name: 'Ravi Pandey',     phone: '919805678901', tags: ['lead'],             status: 'warm',     optedIn: true },
  { name: 'Divya Reddy',     phone: '919806789012', tags: ['vip', 'property'],  status: 'hot',      optedIn: true },
  { name: 'Manish Jain',     phone: '919807890123', tags: ['lead', 'budget'],   status: 'cold',     optedIn: false },
  { name: 'Sneha Bhatt',     phone: '919808901234', tags: ['customer'],         status: 'customer', optedIn: true },
  { name: 'Karan Malhotra',  phone: '919809012345', tags: ['lead'],             status: 'warm',     optedIn: true },
  { name: 'Rekha Saxena',    phone: '919800123456', tags: ['property'],         status: 'hot',      optedIn: true },
];

const conversations = [
  {
    contactIndex: 0, // Rahul Sharma
    messages: [
      { direction: 'inbound',  text: 'Hello, I saw your property listing on MagicBricks. Is the 3BHK in Sector 62 still available?' },
      { direction: 'outbound', text: 'Hi Rahul! Yes, the 3BHK in Sector 62 is available. It\'s a great property — 1450 sq ft, ready to move in. Shall I send you the full details?' },
      { direction: 'inbound',  text: 'Yes please. Also what is the asking price?' },
      { direction: 'outbound', text: 'The asking price is ₹85 lakhs. We also have a similar unit at ₹79 lakhs on the 4th floor if budget is a consideration. I\'ll send the brochure now.' },
      { direction: 'inbound',  text: 'The 79 lakh one sounds interesting. Can we schedule a site visit this weekend?' },
      { direction: 'outbound', text: 'Absolutely! Saturday 11am works great. I\'ll share the exact address and confirm with you by Friday evening. 👍' },
    ]
  },
  {
    contactIndex: 1, // Priya Singh
    messages: [
      { direction: 'inbound',  text: 'Hi, I\'m looking for a 2BHK flat in Crossing Republik. Budget around 55-60 lakhs.' },
      { direction: 'outbound', text: 'Hello Priya! We have 3 options in that range in Crossing Republik. All are ready-to-move with good connectivity to NH-58. Can I call you to discuss?' },
      { direction: 'inbound',  text: 'Yes, please call me after 6pm.' },
      { direction: 'outbound', text: 'Sure! I\'ll call you at 6:30pm today. 😊' },
    ]
  },
  {
    contactIndex: 2, // Amit Verma
    messages: [
      { direction: 'inbound',  text: 'When is my property registration scheduled?' },
      { direction: 'outbound', text: 'Hi Amit! Your registration is scheduled for 15th May at 11am at the Sub-Registrar Office, Ghaziabad. Please carry original documents.' },
      { direction: 'inbound',  text: 'Ok thanks. Do I need a DD or can I pay by cheque?' },
      { direction: 'outbound', text: 'You\'ll need a Demand Draft in favour of "Sub-Registrar Ghaziabad". Stamp duty amount is ₹2,55,000. Let me know if you need the bank details.' },
      { direction: 'inbound',  text: 'Please send the bank details.' },
      { direction: 'outbound', text: 'Sure, sending now: Bank: SBI, Branch: Kaushambi, A/C: Sub-Registrar Ghaziabad, IFSC: SBIN0001234. Please confirm once DD is ready.' },
    ]
  },
  {
    contactIndex: 3, // Sunita Gupta
    messages: [
      { direction: 'inbound',  text: 'I\'m interested in a plot in Raj Nagar Extension. What\'s available?' },
      { direction: 'outbound', text: 'Good morning Sunita! We have 100, 150 and 200 sq yd plots in Raj Nagar Ext. Prices start at ₹18,000 per sq yd. Which size are you considering?' },
      { direction: 'inbound',  text: '150 sq yd would be good. Is it freehold or leasehold?' },
      { direction: 'outbound', text: 'All our plots are freehold with clear titles. Registry done immediately. Would you like to visit the site this week?' },
    ]
  },
  {
    contactIndex: 5, // Kavya Nair
    messages: [
      { direction: 'inbound',  text: 'Hi! I purchased a flat last year through you. I need the NOC from the builder. Can you help?' },
      { direction: 'outbound', text: 'Hi Kavya! Of course, I remember your purchase in Ajnara Homes. I\'ll contact the builder today and get the NOC process started. Usually takes 5-7 working days.' },
      { direction: 'inbound',  text: 'Great thank you! Also do you know any good interior designers?' },
      { direction: 'outbound', text: 'Yes! I can refer you to 2-3 trusted interior designers we work with. Budget around how much are you planning for interiors?' },
    ]
  },
];

const templates_data = [
  {
    name: 'welcome_new_lead',
    category: 'MARKETING',
    language: 'en',
    status: 'APPROVED',
    metaTemplateId: 'meta_tpl_001',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Welcome to Old Is Gold Properties! 🏠' },
      { type: 'BODY', text: 'Hi {{1}},\n\nThank you for your interest in our properties! We specialize in residential and commercial properties in NCR.\n\nOur team will connect with you shortly to understand your requirements better.\n\nFeel free to reply to this message anytime!' },
      { type: 'FOOTER', text: 'Old Is Gold Properties — Trusted Since 2018' },
    ],
  },
  {
    name: 'site_visit_reminder',
    category: 'UTILITY',
    language: 'en',
    status: 'APPROVED',
    metaTemplateId: 'meta_tpl_002',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Site Visit Reminder 📅' },
      { type: 'BODY', text: 'Dear {{1}},\n\nThis is a reminder for your site visit scheduled on *{{2}}* at *{{3}}*.\n\nLocation: {{4}}\n\nPlease reply YES to confirm or call us to reschedule.\n\nLooking forward to meeting you!' },
      { type: 'FOOTER', text: 'Old Is Gold Properties' },
    ],
  },
  {
    name: 'diwali_offer',
    category: 'MARKETING',
    language: 'en',
    status: 'APPROVED',
    metaTemplateId: 'meta_tpl_003',
    components: [
      { type: 'HEADER', format: 'TEXT', text: '🪔 Diwali Special Offer!' },
      { type: 'BODY', text: 'Dear {{1}},\n\nThis Diwali, make your dream of owning a home come true! 🏡\n\n✨ *Special Diwali Discounts* up to ₹5 Lakhs\n✨ Zero stamp duty on select properties\n✨ Free modular kitchen worth ₹1.5L\n\nOffer valid till 31st October. Limited units available!\n\nReply *INTERESTED* to know more.' },
      { type: 'FOOTER', text: 'T&C Apply. Old Is Gold Properties' },
    ],
  },
  {
    name: 'payment_due_reminder',
    category: 'UTILITY',
    language: 'en',
    status: 'APPROVED',
    metaTemplateId: 'meta_tpl_004',
    components: [
      { type: 'BODY', text: 'Dear {{1}},\n\nThis is a friendly reminder that your installment of *₹{{2}}* for {{3}} is due on *{{4}}*.\n\nPlease ensure timely payment to avoid any late charges.\n\nFor payment or any queries, reply to this message or call us.' },
      { type: 'FOOTER', text: 'Old Is Gold Properties' },
    ],
  },
  {
    name: 'new_property_launch',
    category: 'MARKETING',
    language: 'en',
    status: 'PENDING',
    components: [
      { type: 'HEADER', format: 'TEXT', text: '🚀 New Launch — Ajnara City, Sector 77' },
      { type: 'BODY', text: 'Hi {{1}},\n\nWe are excited to announce the launch of *Ajnara City Phase 3* in Sector 77, Noida.\n\n🏠 2BHK starting ₹62L\n🏠 3BHK starting ₹89L\n📍 Noida-Greater Noida Expressway\n🚇 2 min from metro station\n\nPre-launch prices available for the first 50 bookings only.\n\nReply *CALLBACK* and our team will reach you within 1 hour.' },
      { type: 'FOOTER', text: 'RERA Approved. Old Is Gold Properties' },
    ],
  },
];

const campaigns_data = [
  {
    name: 'Diwali 2024 Offer Blast',
    templateName: 'diwali_offer',
    language: 'en',
    audience: { type: 'all' },
    status: 'completed',
    startedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
    stats: { total: 18, sent: 17, delivered: 15, read: 11, replied: 4, failed: 1 },
  },
  {
    name: 'Site Visit Reminder — Dec Batch',
    templateName: 'site_visit_reminder',
    language: 'en',
    audience: { type: 'tag', tags: ['lead', 'property'] },
    status: 'completed',
    startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 15 * 60 * 1000),
    stats: { total: 8, sent: 8, delivered: 7, read: 6, replied: 3, failed: 0 },
  },
  {
    name: 'Welcome New Leads — Jan 2025',
    templateName: 'welcome_new_lead',
    language: 'en',
    audience: { type: 'tag', tags: ['lead'] },
    status: 'draft',
    stats: { total: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 },
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB Atlas');

  // Wipe existing seed data
  await Promise.all([
    Tenant.deleteMany({ email: 'demo@oldisgold.in' }),
    Admin.deleteMany({ email: 'pankaj@ardym.in' }),
  ]);

  // Create tenant
  const tenant = await Tenant.create({
    businessName: 'Old Is Gold Properties',
    email: 'demo@oldisgold.in',
    phone: '918755221974',
    plan: 'growth',
    status: 'active',
    subscription: {
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    },
  });
  console.log('✅ Tenant created:', tenant.businessName);

  // Create users — let pre-save hook handle hashing
  const owner = await User.create({
    tenantId: tenant._id, name: 'Pankaj Jain',
    email: 'pankaj@oldisgold.in', password: 'Demo@1234', role: 'owner',
  });

  await User.create({ tenantId: tenant._id, name: 'Ritu Sharma',  email: 'ritu@oldisgold.in',  password: 'Agent@1234', role: 'sales_agent' });
  await User.create({ tenantId: tenant._id, name: 'Ajay Kumar',   email: 'ajay@oldisgold.in',  password: 'Agent@1234', role: 'support_agent' });
  await User.create({ tenantId: tenant._id, name: 'Sonia Verma',  email: 'sonia@oldisgold.in', password: 'Agent@1234', role: 'campaign_manager' });
  console.log('✅ 4 team members created');

  // Create contacts
  const createdContacts = await Contact.insertMany(
    contacts_data.map(c => ({
      ...c,
      tenantId: tenant._id,
      lastContactedAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000),
    }))
  );
  console.log(`✅ ${createdContacts.length} contacts created`);

  // Create templates
  const createdTemplates = await Template.insertMany(
    templates_data.map(t => ({ ...t, tenantId: tenant._id }))
  );
  console.log(`✅ ${createdTemplates.length} templates created`);

  // Create messages (conversations)
  for (const conv of conversations) {
    const contact = createdContacts[conv.contactIndex];
    let baseTime = Date.now() - Math.floor(Math.random() * 7 + 1) * 24 * 60 * 60 * 1000;
    for (const m of conv.messages) {
      baseTime += Math.floor(Math.random() * 20 + 2) * 60 * 1000; // 2-22 min apart
      await Message.create({
        tenantId: tenant._id,
        contactId: contact._id,
        direction: m.direction,
        type: 'text',
        content: { text: m.text },
        waMessageId: 'wa_msg_' + Math.random().toString(36).slice(2),
        status: m.direction === 'outbound' ? 'delivered' : 'read',
        createdAt: new Date(baseTime),
      });
    }
  }
  console.log(`✅ ${conversations.length} conversations created`);

  // Create campaigns
  const approvedTemplate = createdTemplates.find(t => t.name === 'diwali_offer');
  const approvedTemplate2 = createdTemplates.find(t => t.name === 'site_visit_reminder');
  const draftTemplate = createdTemplates.find(t => t.name === 'welcome_new_lead');

  await Campaign.insertMany([
    {
      tenantId: tenant._id,
      name: campaigns_data[0].name,
      templateId: approvedTemplate._id,
      templateName: campaigns_data[0].templateName,
      language: 'en',
      audience: campaigns_data[0].audience,
      status: campaigns_data[0].status,
      startedAt: campaigns_data[0].startedAt,
      completedAt: campaigns_data[0].completedAt,
      stats: campaigns_data[0].stats,
      createdBy: owner._id,
    },
    {
      tenantId: tenant._id,
      name: campaigns_data[1].name,
      templateId: approvedTemplate2._id,
      templateName: campaigns_data[1].templateName,
      language: 'en',
      audience: campaigns_data[1].audience,
      status: campaigns_data[1].status,
      startedAt: campaigns_data[1].startedAt,
      completedAt: campaigns_data[1].completedAt,
      stats: campaigns_data[1].stats,
      createdBy: owner._id,
    },
    {
      tenantId: tenant._id,
      name: campaigns_data[2].name,
      templateId: draftTemplate._id,
      templateName: campaigns_data[2].templateName,
      language: 'en',
      audience: campaigns_data[2].audience,
      status: campaigns_data[2].status,
      stats: campaigns_data[2].stats,
      createdBy: owner._id,
    },
  ]);
  console.log(`✅ ${campaigns_data.length} campaigns created`);

  // Create superadmin — let pre-save hook handle hashing
  await Admin.create({ name: 'Pankaj Jain', email: 'pankaj@ardym.in', password: 'Admin@1234', role: 'superadmin' });
  console.log('✅ Superadmin created');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 Seed complete! Login credentials:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📱 App (localhost:5173)');
  console.log('   Email   : pankaj@oldisgold.in');
  console.log('   Password: Demo@1234');
  console.log('');
  console.log('🔧 Admin Panel (localhost:5174)');
  console.log('   Email   : pankaj@ardym.in');
  console.log('   Password: Admin@1234');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
}

seed().catch(err => { console.error('❌ Seed failed:', err.message); process.exit(1); });
