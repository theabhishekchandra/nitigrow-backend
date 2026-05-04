const Notification = require('../models/Notification');

/**
 * GET /api/notifications
 * Paginated list of notifications for the authenticated user (newest first).
 * Query params: page (default 1), limit (default 20)
 */
const listNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = { userId: req.user._id, tenantId: req.tenantId };

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments(query),
    ]);

    res.json({
      notifications,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error('[NotificationCtrl] listNotifications error:', err.message);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

/**
 * GET /api/notifications/unread-count
 * Returns the number of unread notifications for the authenticated user.
 */
const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      userId: req.user._id,
      tenantId: req.tenantId,
      readAt: null,
    });
    res.json({ count });
  } catch (err) {
    console.error('[NotificationCtrl] getUnreadCount error:', err.message);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
};

/**
 * PUT /api/notifications/:id/read
 * Mark a single notification as read.
 */
const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, tenantId: req.tenantId },
      { readAt: new Date() },
      { new: true }
    );
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json(notification);
  } catch (err) {
    console.error('[NotificationCtrl] markAsRead error:', err.message);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

/**
 * PUT /api/notifications/read-all
 * Mark ALL unread notifications as read for the authenticated user.
 */
const markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, tenantId: req.tenantId, readAt: null },
      { readAt: new Date() }
    );
    res.json({ marked: result.modifiedCount });
  } catch (err) {
    console.error('[NotificationCtrl] markAllAsRead error:', err.message);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
};

/**
 * DELETE /api/notifications/:id
 * Delete a single notification.
 */
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
      tenantId: req.tenantId,
    });
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    console.error('[NotificationCtrl] deleteNotification error:', err.message);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

module.exports = {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
