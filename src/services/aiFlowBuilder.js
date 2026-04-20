/**
 * AI Flow Builder
 *
 * Takes a natural language description and generates a chatbot flow JSON.
 * Uses OpenAI/Gemini API to generate the flow structure.
 *
 * TODO: Replace with real AI API key and endpoint
 */

const FLOW_TEMPLATES = {
  lead_qualifier: {
    name: 'Lead Qualifier',
    description: 'Qualifies incoming leads by collecting budget, location, and timeline',
    trigger: { type: 'keyword', keywords: ['interested', 'buy', 'price', 'cost'] },
    nodes: [
      { id: 'welcome', type: 'send_message', position: { x: 250, y: 50 }, message: { type: 'text', text: 'Hi {{name}}! 👋 Thanks for your interest. Let me help you find the perfect match.\n\nWhat is your approximate budget?' }, nextNode: 'budget_check' },
      { id: 'budget_check', type: 'condition', position: { x: 250, y: 200 }, condition: { field: 'message.text', operator: 'contains', value: 'lakh', trueNode: 'location_ask', falseNode: 'budget_retry' } },
      { id: 'budget_retry', type: 'send_message', position: { x: 50, y: 350 }, message: { type: 'text', text: 'Could you share your budget range? For example: "50 lakh" or "1 crore"' }, nextNode: 'budget_check' },
      { id: 'location_ask', type: 'send_message', position: { x: 450, y: 350 }, message: { type: 'text', text: 'Great! 📍 Which area or city are you looking in?' }, nextNode: 'timeline_ask' },
      { id: 'timeline_ask', type: 'send_message', position: { x: 450, y: 500 }, message: { type: 'text', text: 'When are you planning to make a decision?\n\n1️⃣ This month\n2️⃣ In 3 months\n3️⃣ Just exploring' }, nextNode: 'timeline_check' },
      { id: 'timeline_check', type: 'condition', position: { x: 450, y: 650 }, condition: { field: 'message.text', operator: 'contains', value: 'month', trueNode: 'hot_tag', falseNode: 'warm_tag' } },
      { id: 'hot_tag', type: 'set_tag', position: { x: 250, y: 800 }, tag: 'hot-lead', nextNode: 'assign' },
      { id: 'warm_tag', type: 'set_tag', position: { x: 650, y: 800 }, tag: 'warm-lead', nextNode: 'thanks' },
      { id: 'assign', type: 'assign_agent', position: { x: 250, y: 950 }, nextNode: 'thanks' },
      { id: 'thanks', type: 'send_message', position: { x: 450, y: 1100 }, message: { type: 'text', text: 'Thank you {{name}}! 🙏 Our team will reach out to you shortly with the best options. Stay tuned!' }, nextNode: 'end_flow' },
      { id: 'end_flow', type: 'end', position: { x: 450, y: 1250 } },
    ],
    startNode: 'welcome',
  },
  appointment_booking: {
    name: 'Appointment Booking',
    description: 'Books appointments by collecting date and time preferences',
    trigger: { type: 'keyword', keywords: ['appointment', 'book', 'schedule', 'visit'] },
    nodes: [
      { id: 'greet', type: 'send_message', position: { x: 250, y: 50 }, message: { type: 'text', text: 'Hi {{name}}! 📅 I can help you book an appointment.\n\nWhat date works best for you? (e.g., Monday, Tomorrow, 25th Jan)' }, nextNode: 'time_ask' },
      { id: 'time_ask', type: 'send_message', position: { x: 250, y: 200 }, message: { type: 'text', text: 'What time do you prefer?\n\n🌅 Morning (9-12)\n☀️ Afternoon (12-4)\n🌆 Evening (4-7)' }, nextNode: 'confirm' },
      { id: 'confirm', type: 'send_message', position: { x: 250, y: 350 }, message: { type: 'buttons', text: 'I\'ll schedule your visit. Should I confirm this appointment?', buttons: ['✅ Confirm', '🔄 Reschedule', '❌ Cancel'] }, nextNode: 'tag_booked' },
      { id: 'tag_booked', type: 'set_tag', position: { x: 250, y: 500 }, tag: 'appointment-booked', nextNode: 'notify_team' },
      { id: 'notify_team', type: 'assign_agent', position: { x: 250, y: 650 }, nextNode: 'done_msg' },
      { id: 'done_msg', type: 'send_message', position: { x: 250, y: 800 }, message: { type: 'text', text: 'Your appointment has been booked! ✅ Our team will send you a confirmation shortly.\n\nSee you soon, {{name}}! 😊' }, nextNode: 'end' },
      { id: 'end', type: 'end', position: { x: 250, y: 950 } },
    ],
    startNode: 'greet',
  },
  faq_handler: {
    name: 'FAQ Auto-Reply',
    description: 'Handles common questions with automatic answers',
    trigger: { type: 'any_message', keywords: [] },
    nodes: [
      { id: 'start', type: 'send_message', position: { x: 250, y: 50 }, message: { type: 'text', text: 'Hi {{name}}! 👋 How can I help you today?\n\n1️⃣ Pricing\n2️⃣ Working Hours\n3️⃣ Location\n4️⃣ Talk to Agent' }, nextNode: 'check_pricing' },
      { id: 'check_pricing', type: 'condition', position: { x: 250, y: 200 }, condition: { field: 'message.text', operator: 'contains', value: 'pric', trueNode: 'pricing_answer', falseNode: 'check_hours' } },
      { id: 'pricing_answer', type: 'send_message', position: { x: 50, y: 350 }, message: { type: 'text', text: 'Our plans start from ₹999/month! 💰\n\nVisit our website for detailed pricing or reply "agent" to speak with our team.' }, nextNode: 'end' },
      { id: 'check_hours', type: 'condition', position: { x: 450, y: 350 }, condition: { field: 'message.text', operator: 'contains', value: 'hour', trueNode: 'hours_answer', falseNode: 'check_location' } },
      { id: 'hours_answer', type: 'send_message', position: { x: 250, y: 500 }, message: { type: 'text', text: 'We\'re open Monday to Saturday, 9 AM to 6 PM! 🕐' }, nextNode: 'end' },
      { id: 'check_location', type: 'condition', position: { x: 650, y: 500 }, condition: { field: 'message.text', operator: 'contains', value: 'locat', trueNode: 'location_answer', falseNode: 'agent_handoff' } },
      { id: 'location_answer', type: 'send_message', position: { x: 450, y: 650 }, message: { type: 'text', text: '📍 We\'re located at [Your Address Here].\n\nGoogle Maps: [link]' }, nextNode: 'end' },
      { id: 'agent_handoff', type: 'assign_agent', position: { x: 650, y: 800 }, nextNode: 'handoff_msg' },
      { id: 'handoff_msg', type: 'send_message', position: { x: 650, y: 950 }, message: { type: 'text', text: 'Let me connect you with our team! 🙋 An agent will reply shortly.' }, nextNode: 'end' },
      { id: 'end', type: 'end', position: { x: 400, y: 1100 } },
    ],
    startNode: 'start',
  },
};

/**
 * generateFlowFromDescription
 * In production this calls OpenAI/Gemini. For now, matches against templates.
 */
const generateFlowFromDescription = async (description) => {
  // TODO: Replace with real AI API call
  // const response = await openai.chat.completions.create({
  //   model: 'gpt-4',
  //   messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: description }],
  // });
  // return JSON.parse(response.choices[0].message.content);

  const lower = (description || '').toLowerCase();

  // Smart template matching based on description keywords
  if (lower.includes('lead') || lower.includes('qualify') || lower.includes('budget') || lower.includes('sales')) {
    return { ...FLOW_TEMPLATES.lead_qualifier, name: 'AI Generated: Lead Qualifier' };
  }
  if (lower.includes('appointment') || lower.includes('book') || lower.includes('schedule') || lower.includes('visit')) {
    return { ...FLOW_TEMPLATES.appointment_booking, name: 'AI Generated: Appointment Booking' };
  }
  if (lower.includes('faq') || lower.includes('question') || lower.includes('support') || lower.includes('help')) {
    return { ...FLOW_TEMPLATES.faq_handler, name: 'AI Generated: FAQ Handler' };
  }

  // Default: lead qualifier with custom name
  return {
    ...FLOW_TEMPLATES.lead_qualifier,
    name: `AI Generated: ${description.slice(0, 40)}`,
    description: description,
  };
};

module.exports = { generateFlowFromDescription, FLOW_TEMPLATES };
