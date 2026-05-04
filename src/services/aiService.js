const Anthropic = require('@anthropic-ai/sdk');

// ─── Mock Mode ────────────────────────────────────────────────────────────────
// Set USE_MOCK=true in .env to bypass all Anthropic API calls.
// The UI works fully with realistic mock suggestions and sentiments.
// Switch to USE_MOCK=false once ANTHROPIC_API_KEY is configured.
const USE_MOCK = process.env.USE_MOCK === 'true' || !process.env.ANTHROPIC_API_KEY;

const MOCK_SUGGESTIONS = [
  ["Sure, I'd be happy to help! What specifically would you like to know?", "Let me check this for you right away.", "Thanks for reaching out! Could you share more details?"],
  ["We can definitely assist with that. When would be a convenient time?", "I'll look into this immediately and get back to you.", "That's a great question — let me get the exact answer for you."],
  ["Absolutely! Our team handles this regularly.", "I understand your concern. Let me escalate this to a specialist.", "Thank you for your patience. We'll resolve this quickly."],
  ["हां बिल्कुल, मैं आपकी मदद कर सकता हूं!", "यह जानकारी मैं अभी चेक करता हूं।", "आपका बहुत धन्यवाद। कोई भी सवाल हो तो बताएं।"],
];

// TODO: Replace with real Anthropic API key in production
// TODO: Configure ANTHROPIC_API_KEY in .env
const client = USE_MOCK ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Reply Suggestions ────────────────────────────────────────────────────────
const generateReplySuggestions = async (messages, tenant) => {
  if (USE_MOCK) {
    // Rotate mock sets for variety
    const set = MOCK_SUGGESTIONS[Math.floor(Math.random() * MOCK_SUGGESTIONS.length)];
    console.info('[AI MOCK] Returning mock reply suggestions');
    // TODO: Replace with real Anthropic call:
    // POST https://api.anthropic.com/v1/messages with claude-3-5-sonnet-20241022
    return set;
  }

  const conversationContext = messages
    .map(m => `[${m.direction === 'outbound' ? 'Agent' : 'Customer'}] ${m.content || '[Media]'}`)
    .join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200,
      system: `You are an AI assistant helping a human customer support agent at "${tenant.businessName}" reply on WhatsApp.
Read the conversation and suggest exactly 3 short, natural, professional replies the agent could send next.
Match the customer's language (Hindi, English, or Hinglish).
Return ONLY valid JSON: {"replies":["reply1","reply2","reply3"]}`,
      messages: [{ role: 'user', content: `Conversation:\n${conversationContext}` }],
    });

    const parsed = JSON.parse(response.content[0].text.trim());
    return Array.isArray(parsed.replies) ? parsed.replies.slice(0, 3) : [];
  } catch (err) {
    console.error('[AI] generateReplySuggestions failed:', err.message);
    return [];
  }
};

// ─── Sentiment Analysis ───────────────────────────────────────────────────────
const SENTIMENT_VALUES = ['positive', 'neutral', 'frustrated', 'angry'];

const MOCK_SENTIMENT_KEYWORDS = {
  angry:      ['angry', 'terrible', 'worst', 'pathetic', 'lawsuit', 'useless', 'scam', 'furious', 'hate'],
  frustrated: ['frustrated', 'not working', 'failed', 'wrong', 'issue', 'problem', 'waiting', 'delay', 'slow', 'help'],
  positive:   ['thanks', 'thank you', 'great', 'perfect', 'good', 'love', 'excellent', 'awesome', 'happy', 'satisfied'],
};

const analyzeSentiment = async (messageText) => {
  if (!messageText || messageText.trim().length < 3) return 'neutral';

  if (USE_MOCK) {
    // TODO: Replace with real Anthropic call using claude-haiku model
    const lower = messageText.toLowerCase();
    for (const [sentiment, keywords] of Object.entries(MOCK_SENTIMENT_KEYWORDS)) {
      if (keywords.some(k => lower.includes(k))) return sentiment;
    }
    return 'neutral';
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 10,
      system: 'Classify the sentiment of this WhatsApp message as exactly one of: positive, neutral, frustrated, angry. Reply with just the single word.',
      messages: [{ role: 'user', content: messageText.slice(0, 500) }],
    });
    const result = response.content[0].text.trim().toLowerCase();
    return SENTIMENT_VALUES.includes(result) ? result : 'neutral';
  } catch (err) {
    console.error('[AI] analyzeSentiment failed:', err.message);
    return 'neutral';
  }
};

// ─── Campaign Writer ──────────────────────────────────────────────────────────
// TODO: Implement POST /api/ai/write-campaign using this function
const writeCampaignTemplate = async (goal, language = 'en') => {
  if (USE_MOCK) {
    // TODO: Replace with real Anthropic call when ANTHROPIC_API_KEY is configured
    return {
      header: language === 'hi' ? 'अभी देखें!' : 'Check this out!',
      body: language === 'hi'
        ? `नमस्ते {{1}},\n\n${goal} के बारे में एक खास ऑफर आपके लिए है।\n\nसीमित समय के लिए उपलब्ध!`
        : `Hi {{1}},\n\nWe have a special offer just for you regarding: ${goal}\n\nLimited time only!`,
      footer: 'Reply STOP to opt out',
      buttons: [{ type: 'QUICK_REPLY', text: 'Interested' }, { type: 'QUICK_REPLY', text: 'Not Now' }],
    };
  }

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 300,
    system: `Generate a Meta-compliant WhatsApp template message for this campaign goal. Language: ${language === 'hi' ? 'Hindi' : 'English'}. Return JSON: {header, body, footer, buttons}`,
    messages: [{ role: 'user', content: `Campaign goal: ${goal}` }],
  });

  return JSON.parse(response.content[0].text.trim());
};

/**
 * AI Lead Qualifier / Agent interaction logic.
 * Analyzes conversation history against a business goal and returns a response + goal status.
 */
const generateAiResponse = async (history, systemPrompt, goal) => {
  if (USE_MOCK) {
    console.info('[AI MOCK] Simulating agent response against goal:', goal);
    // TODO: Connect real Anthropic API here when USE_MOCK=false
    
    const lastMsg = history[history.length - 1]?.content?.toLowerCase() || '';
    let achieved = false;
    let reply = "Hello! I help you find the best property. What is your budget?";

    // Very simple simulated heuristics for the mock
    if (lastMsg.includes('price') || lastMsg.includes('budget') || lastMsg.includes('lakh') || lastMsg.includes('crore')) {
      reply = "Got it. And in which area are you looking to buy?";
    } else if (lastMsg.includes('delhi') || lastMsg.includes('mumbai') || lastMsg.includes('gurgaon')) {
      reply = "Perfect. One last thing, can I have your email address to send the brochures?";
    } else if (lastMsg.includes('@') && lastMsg.includes('.')) {
      reply = "Thank you! Our sales team will contact you shortly with the listings.";
      achieved = true;
    }

    return { reply, goalAchieved: achieved };
  }

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 400,
      system: `${systemPrompt}
Your current task/goal is: ${goal}
IMPORTANT: If you have successfully achieved the goal, end your message with the exact tag: [GOAL_ACHIEVED].
Otherwise, keep the conversation going to achieve the goal. Be concise and helpful in WhatsApp format.`,
      messages: history.map(m => ({
        role: m.direction === 'outbound' ? 'assistant' : 'user',
        content: m.content || '[Media]'
      })),
    });

    const text = response.content[0].text.trim();
    const achieved = text.includes('[GOAL_ACHIEVED]');
    const reply = text.replace('[GOAL_ACHIEVED]', '').trim();

    return { reply, goalAchieved: achieved };
  } catch (err) {
    console.error('[AI] generateAiResponse failed:', err.message);
    return { reply: "I'm sorry, I'm having trouble understanding right now. Let me connect you to a human agent.", goalAchieved: true };
  }
};

module.exports = { generateReplySuggestions, analyzeSentiment, writeCampaignTemplate, generateAiResponse, USE_MOCK };
