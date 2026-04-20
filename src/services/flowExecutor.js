const ChatbotFlow = require('../models/ChatbotFlow');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const { sendText, sendButtons, sendTemplate, saveAndEmit } = require('./whatsapp');
const { generateAiResponse } = require('./aiService');

/**
 * Attempt to match an active flow for an incoming message.
 * Called by webhookController.processIncomingMessage AFTER saving the message.
 *
 * @param {string} tenantId
 * @param {Object} contact  — Mongoose Contact document
 * @param {string} messageText — plain text of the incoming message
 * @returns {boolean} — true if a flow was triggered
 */
const tryExecuteFlow = async (tenantId, contact, messageText) => {
  try {
    // 1. Check if contact is already in a persistent flow (e.g. AI conversation)
    if (contact.activeFlowId && contact.activeNodeId) {
      const flow = await ChatbotFlow.findOne({ _id: contact.activeFlowId, tenantId, status: 'active' });
      if (flow) {
        console.info(`[FlowExecutor] Resuming flow ${flow.name} for ${contact.phone} at node ${contact.activeNodeId}`);
        await executeFlow(tenantId, contact, flow, messageText, contact.activeNodeId);
        return true;
      } else {
        // Flow was deleted or deactivated, clear state
        await Contact.updateOne({ _id: contact._id }, { $unset: { activeFlowId: 1, activeNodeId: 1 } });
      }
    }

    // 2. Otherwise, check for trigger matching
    const flows = await ChatbotFlow.find({ tenantId, status: 'active' });
    if (!flows.length) return false;

    const text = (messageText || '').trim().toLowerCase();
    const contactTags = contact.tags || [];

    // Find the first flow whose trigger matches this message
    let matchedFlow = null;

    for (const flow of flows) {
      const trigger = flow.trigger;

      if (trigger.type === 'first_message' && contact.messageCount <= 1) {
        matchedFlow = flow; break;
      }
      if (trigger.type === 'any_message') {
        matchedFlow = flow; break;
      }
      if (trigger.type === 'keyword' && trigger.keywords?.length) {
        const matched = trigger.keywords.some(kw => text.includes(kw.toLowerCase()));
        if (matched) { matchedFlow = flow; break; }
      }
      if (trigger.type === 'button_reply') {
        // Button replies handled by matching text against known button titles
        const matched = trigger.keywords?.some(kw => text === kw.toLowerCase());
        if (matched) { matchedFlow = flow; break; }
      }
    }

    if (!matchedFlow) return false;

    // Execute the flow starting from startNode
    await executeFlow(tenantId, contact, matchedFlow, messageText);

    // Increment stats
    await ChatbotFlow.updateOne({ _id: matchedFlow._id }, { $inc: { 'stats.triggered': 1 } });
    return true;
  } catch (err) {
    console.error('[FlowExecutor] Error:', err.message);
    return false;
  }
};

/**
 * Walk through the flow nodes, executing each one.
 * Stops when it reaches an 'end' node or can't find the next node.
 */
const executeFlow = async (tenantId, contact, flow, inboundText, startNodeId = null) => {
  const nodeMap = {};
  for (const node of flow.nodes) nodeMap[node.id] = node;

  let currentNodeId = startNodeId || flow.startNode;
  const maxSteps = 20; // prevent infinite loops
  let steps = 0;

  while (currentNodeId && steps < maxSteps) {
    const node = nodeMap[currentNodeId];
    if (!node) break;
    steps++;

    switch (node.type) {
      case 'send_message':
        await executeSendMessage(tenantId, contact, node);
        currentNodeId = node.nextNode;
        break;

      case 'condition':
        currentNodeId = evaluateCondition(node.condition, contact, inboundText)
          ? node.condition.trueNode
          : node.condition.falseNode;
        break;

      case 'set_tag':
        if (node.tag) {
          const tags = [...new Set([...contact.tags || [], node.tag])];
          await Contact.updateOne({ _id: contact._id }, { tags });
          contact.tags = tags; // update in-memory for subsequent conditions
        }
        currentNodeId = node.nextNode;
        break;

      case 'assign_agent':
        if (node.assigneeId) {
          await Contact.updateOne({ _id: contact._id }, { assignedTo: node.assigneeId });
        }
        currentNodeId = node.nextNode;
        break;

      case 'ai_agent':
        currentNodeId = await executeAiAgentNode(tenantId, contact, flow, node);
        break;

      case 'wait':
        // For simplicity, wait nodes are NON-blocking in current implementation.
        // TODO: Implement deferred execution using BullMQ delayed jobs
        // await scheduleFlowResume(tenantId, contact._id, flow._id, node.nextNode, node.waitHours)
        currentNodeId = null; // pause here — will resume via scheduled job
        break;

      case 'end':
        await ChatbotFlow.updateOne({ _id: flow._id }, { $inc: { 'stats.completed': 1 } });
        await Contact.updateOne({ _id: contact._id }, { $unset: { activeFlowId: 1, activeNodeId: 1 } });
        currentNodeId = null;
        break;

      default:
        currentNodeId = node.nextNode;
    }
  }
};

/**
 * Execute a send_message node — routes to correct WhatsApp sender
 */
const executeSendMessage = async (tenantId, contact, node) => {
  const msg = node.message;
  if (!msg) return;

  let waResponse;

  try {
    switch (msg.type) {
      case 'text':
        waResponse = await sendText(tenantId, contact.phone, msg.text);
        await saveAndEmit(tenantId, contact._id, 'text', { text: msg.text }, waResponse?.messages?.[0]?.id);
        break;

      case 'buttons':
        waResponse = await sendButtons(tenantId, contact.phone, msg.text, msg.buttons || []);
        await saveAndEmit(tenantId, contact._id, 'buttons', { text: msg.text, buttons: msg.buttons }, waResponse?.messages?.[0]?.id);
        break;

      case 'template':
        waResponse = await sendTemplate(tenantId, contact.phone, msg.templateName);
        await saveAndEmit(tenantId, contact._id, 'template', { templateName: msg.templateName }, waResponse?.messages?.[0]?.id);
        break;
    }
  } catch (err) {
    console.error(`[FlowExecutor] sendMessage error (node: ${node.id}):`, err.message);
  }
};

/**
 * Execute an AI Agent node.
 * Uses conversation history to generate a contextual response.
 * Branches to trueNode if goal is achieved, or falseNode if maxTurns reached.
 */
const executeAiAgentNode = async (tenantId, contact, flow, node) => {
  const aiCfg = node.aiAgent;
  if (!aiCfg) return node.nextNode;

  try {
    // 1. Fetch recent conversation history for context
    const history = await Message.find({ contactId: contact._id })
      .sort({ createdAt: -1 })
      .limit(10);
    history.reverse();

    // 2. Enforce turn limit (check how many AI responses in current session)
    // For simplicity, we count consecutive AI messages within the last 10
    const aiTurns = history.filter(m => m.direction === 'outbound' && m.status === 'sent' && !m.sentBy).length;

    if (aiTurns >= (aiCfg.maxTurns || 5)) {
      console.warn(`[FlowExecutor] AI Node ${node.id} reached maxTurns (${aiCfg.maxTurns}). Branching to falseNode.`);
      return aiCfg.falseNode;
    }

    // 3. Generate response via Claude (or Mock)
    const { reply, goalAchieved } = await generateAiResponse(
      history,
      aiCfg.systemPrompt,
      aiCfg.goal
    );

    // 4. Send the reply to WhatsApp
    const waResponse = await sendText(tenantId, contact.phone, reply);
    await saveAndEmit(tenantId, contact._id, 'text', { text: reply }, waResponse?.messages?.[0]?.id);

    // 5. Branch based on goal status
    if (goalAchieved) {
      console.info(`[FlowExecutor] AI Node ${node.id} achieved goal. Branching to trueNode.`);
      return aiCfg.trueNode;
    }

    // Otherwise, pause here and wait for next inbound message to continue the flow at this SAME node
    await Contact.updateOne(
      { _id: contact._id },
      { activeFlowId: flow._id, activeNodeId: node.id }
    );
    return null; 
  } catch (err) {
    console.error(`[FlowExecutor] ai_agent error (node: ${node.id}):`, err.message);
    return aiCfg.falseNode;
  }
};

/**
 * Evaluate a condition node — returns true/false
 */
const evaluateCondition = (condition, contact, inboundText) => {
  if (!condition) return false;
  const { field, operator, value } = condition;

  let fieldValue = '';
  if (field === 'message.text') fieldValue = (inboundText || '').toLowerCase();
  else if (field === 'contact.tag') fieldValue = (contact.tags || []).join(',').toLowerCase();
  else if (field === 'contact.label') fieldValue = (contact.label || '').toLowerCase();
  else if (field === 'contact.name') fieldValue = (contact.name || '').toLowerCase();

  const cmpValue = (value || '').toLowerCase();

  switch (operator) {
    case 'contains':    return fieldValue.includes(cmpValue);
    case 'equals':      return fieldValue === cmpValue;
    case 'starts_with': return fieldValue.startsWith(cmpValue);
    case 'has_tag':     return (contact.tags || []).includes(value);
    default:            return false;
  }
};

module.exports = { tryExecuteFlow };
