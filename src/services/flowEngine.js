const ChatbotFlow = require('../models/ChatbotFlow');
const Contact = require('../models/Contact');
const Tenant = require('../models/Tenant');

/**
 * Flow Execution Engine
 *
 * Processes an inbound message through the chatbot flow system.
 * Called from webhookController when a message arrives.
 *
 * Architecture:
 *   1. Find matching active flows for the tenant (keyword, first_message, etc.)
 *   2. Walk the node graph from startNode
 *   3. Execute each node action (send message, set tag, condition branch, etc.)
 *   4. Respect business hours guard
 *   5. Handle 24h session window for interactive vs template messages
 */

// ─── Business Hours Check ────────────────────────────────────────────────────
const isWithinBusinessHours = (tenant) => {
  const bh = tenant.settings?.businessHours;
  if (!bh?.enabled) return true; // no business hours set = always open

  const now = new Date();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[now.getDay()];
  const daySchedule = bh.schedule?.[dayName];

  if (!daySchedule?.enabled) return false; // closed today

  const [openH, openM] = (daySchedule.open || '09:00').split(':').map(Number);
  const [closeH, closeM] = (daySchedule.close || '18:00').split(':').map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
};

// ─── 24h Session Window Check ────────────────────────────────────────────────
const isWithinSessionWindow = (contact) => {
  if (!contact.lastInboundAt) return false;
  const windowMs = 24 * 60 * 60 * 1000; // 24 hours
  return (Date.now() - new Date(contact.lastInboundAt).getTime()) < windowMs;
};

// ─── Find Matching Flow ──────────────────────────────────────────────────────
const findMatchingFlow = async (tenantId, messageText, contact) => {
  const flows = await ChatbotFlow.find({ tenantId, status: 'active' });
  if (!flows.length) return null;

  for (const flow of flows) {
    const trigger = flow.trigger;

    switch (trigger.type) {
      case 'keyword': {
        const lower = (messageText || '').toLowerCase();
        if (trigger.keywords?.some(kw => lower.includes(kw.toLowerCase()))) {
          return flow;
        }
        break;
      }
      case 'first_message': {
        // Check if this is the contact's first ever message
        if (!contact.messageCount || contact.messageCount <= 1) return flow;
        break;
      }
      case 'any_message': {
        return flow; // matches everything
      }
      case 'button_reply': {
        const lower = (messageText || '').toLowerCase();
        if (trigger.keywords?.some(kw => lower === kw.toLowerCase())) {
          return flow;
        }
        break;
      }
    }
  }
  return null;
};

// ─── Node Execution ──────────────────────────────────────────────────────────
const executeNode = async (node, context) => {
  const { flow, contact, tenant, messageText, sendMessage } = context;
  const result = { nextNodeId: node.nextNode || null, actions: [] };

  switch (node.type) {
    case 'send_message': {
      const text = interpolateVariables(node.message?.text || '', contact);
      const withinWindow = isWithinSessionWindow(contact);

      if (node.message?.type === 'template' || !withinWindow) {
        // Outside 24h window — must use template
        result.actions.push({
          type: 'send_template',
          templateName: node.message?.templateName || 'default',
          text,
        });
      } else {
        // Within window — can send interactive message
        if (node.message?.buttons?.length > 0) {
          result.actions.push({
            type: 'send_buttons',
            text,
            buttons: node.message.buttons,
          });
        } else {
          result.actions.push({ type: 'send_text', text });
        }
      }
      break;
    }

    case 'condition': {
      const field = node.condition?.field || 'message.text';
      const operator = node.condition?.operator || 'contains';
      const value = (node.condition?.value || '').toLowerCase();
      let testValue = '';

      if (field === 'message.text') testValue = (messageText || '').toLowerCase();
      else if (field === 'contact.tag') testValue = (contact.tags || []).join(',').toLowerCase();
      else if (field === 'contact.label') testValue = (contact.label || '').toLowerCase();

      let matched = false;
      switch (operator) {
        case 'contains': matched = testValue.includes(value); break;
        case 'equals': matched = testValue === value; break;
        case 'starts_with': matched = testValue.startsWith(value); break;
        case 'has_tag': matched = (contact.tags || []).some(t => t.toLowerCase() === value); break;
      }

      result.nextNodeId = matched ? node.condition?.trueNode : node.condition?.falseNode;
      break;
    }

    case 'set_tag': {
      if (node.tag && contact._id) {
        const tags = [...new Set([...(contact.tags || []), node.tag])];
        await Contact.findByIdAndUpdate(contact._id, { tags });
        result.actions.push({ type: 'tag_set', tag: node.tag });
      }
      break;
    }

    case 'assign_agent': {
      result.actions.push({ type: 'assign', agentId: node.assigneeId });
      break;
    }

    case 'wait': {
      result.actions.push({ type: 'wait', hours: node.waitHours || 1 });
      result.nextNodeId = null; // pause — scheduler will resume later
      result.paused = true;
      result.resumeAt = new Date(Date.now() + (node.waitHours || 1) * 3600 * 1000);
      result.resumeNodeId = node.nextNode;
      break;
    }

    case 'ai_agent': {
      // TODO: Connect real AI service (OpenAI/Gemini)
      // For now, mock the AI response
      result.actions.push({
        type: 'ai_response',
        systemPrompt: node.aiAgent?.systemPrompt,
        goal: node.aiAgent?.goal,
        maxTurns: node.aiAgent?.maxTurns || 5,
        // In production: send to AI service, get response, check if goal met
      });
      // Mock: assume goal not met, go to falseNode
      result.nextNodeId = node.aiAgent?.falseNode || null;
      break;
    }

    case 'end': {
      result.nextNodeId = null;
      result.actions.push({ type: 'end_flow' });
      break;
    }
  }

  return result;
};

// ─── Variable Interpolation ──────────────────────────────────────────────────
const interpolateVariables = (text, contact) => {
  if (!text) return text;
  return text
    .replace(/\{\{name\}\}/gi, contact.name || 'there')
    .replace(/\{\{phone\}\}/gi, contact.phone || '')
    .replace(/\{\{email\}\}/gi, contact.email || '')
    .replace(/\{\{1\}\}/g, contact.name || 'there')
    .replace(/\{\{2\}\}/g, contact.phone || '');
};

// ─── Main Executor ───────────────────────────────────────────────────────────
/**
 * processInboundMessage
 *
 * @param {string}   tenantId    - tenant ObjectId
 * @param {string}   messageText - the inbound message text
 * @param {object}   contact     - Contact document
 * @param {function} sendMessage - callback to send outbound message (text, buttons, template)
 * @returns {{ matched: boolean, flowName: string, actions: array }}
 */
const processInboundMessage = async (tenantId, messageText, contact, sendMessage) => {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return { matched: false, reason: 'tenant_not_found' };

  // Business hours guard — if outside hours, send auto-reply instead
  if (!isWithinBusinessHours(tenant)) {
    const oohReply = tenant.settings?.autoReplies?.outOfHours;
    if (oohReply?.enabled && oohReply?.message) {
      const text = interpolateVariables(oohReply.message, contact);
      if (sendMessage) await sendMessage({ type: 'text', text });
      return { matched: true, flowName: 'auto_reply_out_of_hours', actions: [{ type: 'send_text', text }] };
    }
    return { matched: false, reason: 'outside_business_hours' };
  }

  // Find matching flow
  const flow = await findMatchingFlow(tenantId, messageText, contact);
  if (!flow) return { matched: false, reason: 'no_matching_flow' };

  // Increment trigger count
  await ChatbotFlow.findByIdAndUpdate(flow._id, { $inc: { 'stats.triggered': 1 } });

  // Walk the node graph
  const allActions = [];
  let currentNodeId = flow.startNode;
  let steps = 0;
  const MAX_STEPS = 20; // safety limit

  const context = { flow, contact, tenant, messageText, sendMessage };

  while (currentNodeId && steps < MAX_STEPS) {
    const node = flow.nodes.find(n => n.id === currentNodeId);
    if (!node) break;

    const result = await executeNode(node, context);
    allActions.push(...result.actions);

    // Execute send actions
    if (sendMessage) {
      for (const action of result.actions) {
        if (action.type === 'send_text') {
          await sendMessage({ type: 'text', text: action.text });
        } else if (action.type === 'send_buttons') {
          await sendMessage({ type: 'buttons', text: action.text, buttons: action.buttons });
        } else if (action.type === 'send_template') {
          await sendMessage({ type: 'template', templateName: action.templateName });
        }
      }
    }

    // Check for pause (wait node)
    if (result.paused) {
      // TODO: Schedule resume via BullMQ delayed job
      break;
    }

    currentNodeId = result.nextNodeId;
    steps++;
  }

  // Update completion stats
  if (!currentNodeId) {
    await ChatbotFlow.findByIdAndUpdate(flow._id, { $inc: { 'stats.completed': 1 } });
  }

  return {
    matched: true,
    flowId: flow._id,
    flowName: flow.name,
    actions: allActions,
    stepsExecuted: steps,
  };
};

module.exports = {
  processInboundMessage,
  findMatchingFlow,
  isWithinBusinessHours,
  isWithinSessionWindow,
};
