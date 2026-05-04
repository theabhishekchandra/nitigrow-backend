const mongoose = require('mongoose');

// ─── Node Types ───────────────────────────────────────────────────────────────
// send_message  — send a text/buttons/list/template message to the contact
// condition     — branch based on keyword/tag/attribute
// set_tag       — add tag to contact
// assign_agent  — assign conversation to a team member
// wait          — pause flow for N hours before next node
// end           — terminate flow (optional handoff to human agent)

const nodeSchema = new mongoose.Schema({
  id:       { type: String, required: true },          // unique within flow, e.g. "node_1"
  type:     { type: String, enum: ['send_message', 'condition', 'set_tag', 'assign_agent', 'wait', 'end', 'ai_agent'], required: true },
  position: { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },

  // send_message payload
  message: {
    type:       { type: String, enum: ['text', 'buttons', 'list', 'template'] },
    text:       { type: String },
    buttons:    [{ type: String }],               // for button messages
    templateName: { type: String },               // for template messages
  },

  // condition payload
  condition: {
    field:    { type: String },                   // 'message.text', 'contact.tag', 'contact.label'
    operator: { type: String, enum: ['contains', 'equals', 'starts_with', 'has_tag'] },
    value:    { type: String },
    trueNode: { type: String },                   // node id to go to if true
    falseNode:{ type: String },                   // node id to go to if false
  },

  // set_tag payload
  tag:      { type: String },

  // assign_agent payload
  assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // wait payload
  waitHours: { type: Number, default: 1 },

  // ai_agent payload
  aiAgent: {
    systemPrompt: { type: String },               // Identity/instructions for the bot
    goal:         { type: String },               // Specific objective (e.g. "collect property preferences")
    maxTurns:     { type: Number, default: 5 },   // Safety limit to prevent credit drain
    trueNode:     { type: String },               // Node to go to if goal is achieved (Hand-off)
    falseNode:    { type: String },               // Node to go to if max turns reached without goal
  },

  // next node (for linear nodes)
  nextNode: { type: String },                     // node id, null = end
}, { _id: false });

const chatbotFlowSchema = new mongoose.Schema({
  tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name:       { type: String, required: true },
  description:{ type: String },
  status:     { type: String, enum: ['active', 'inactive', 'draft'], default: 'draft' },

  // Trigger — when to start this flow
  trigger: {
    type:     { type: String, enum: ['keyword', 'first_message', 'any_message', 'button_reply'], default: 'keyword' },
    keywords: [{ type: String }],                 // trigger if inbound message contains any of these keywords
  },

  startNode: { type: String },                    // id of the first node to execute
  nodes:     [nodeSchema],

  // Execution stats
  stats: {
    triggered:   { type: Number, default: 0 },
    completed:   { type: Number, default: 0 },
    handedOff:   { type: Number, default: 0 },
  },
}, { timestamps: true });

chatbotFlowSchema.index({ tenantId: 1, status: 1 });
chatbotFlowSchema.index({ tenantId: 1, 'trigger.keywords': 1 });

module.exports = mongoose.model('ChatbotFlow', chatbotFlowSchema);
