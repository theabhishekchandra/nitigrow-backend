const QuickReply = require('../models/QuickReply');

const list = async (req, res) => {
  try {
    const { category } = req.query;
    const query = { tenantId: req.tenantId };
    if (category) query.category = category;
    const replies = await QuickReply.find(query).sort({ category: 1, shortcut: 1 });
    res.json(replies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const create = async (req, res) => {
  try {
    const { shortcut, title, content, category } = req.body;
    if (!shortcut || !title || !content) {
      return res.status(400).json({ error: 'shortcut, title, and content are required' });
    }
    // Ensure shortcut starts with /
    const cleanShortcut = shortcut.startsWith('/') ? shortcut : `/${shortcut}`;

    const reply = await QuickReply.create({
      tenantId: req.tenantId,
      shortcut: cleanShortcut,
      title,
      content,
      category: category || 'general',
      createdBy: req.user._id,
    });
    res.status(201).json(reply);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: `Shortcut "${req.body.shortcut}" already exists` });
    }
    res.status(500).json({ error: err.message });
  }
};

const update = async (req, res) => {
  try {
    const { title, content, category } = req.body;
    const reply = await QuickReply.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { title, content, category },
      { new: true }
    );
    if (!reply) return res.status(404).json({ error: 'Quick reply not found' });
    res.json(reply);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const remove = async (req, res) => {
  try {
    const reply = await QuickReply.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!reply) return res.status(404).json({ error: 'Quick reply not found' });
    res.json({ message: 'Quick reply deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Search quick replies by shortcut prefix (for inline typeahead in Inbox)
const search = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const replies = await QuickReply.find({
      tenantId: req.tenantId,
      $or: [
        { shortcut: { $regex: q, $options: 'i' } },
        { title: { $regex: q, $options: 'i' } },
      ],
    }).limit(5);
    res.json(replies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { list, create, update, remove, search };
