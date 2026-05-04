const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = require('../controllers/notificationController');

// All notification routes require authentication
router.use(protect);

// List (paginated, newest first)
router.get('/', listNotifications);

// Unread badge count
router.get('/unread-count', getUnreadCount);

// Mark all as read (must be before /:id to avoid route collision)
router.put('/read-all', markAllAsRead);

// Mark single as read
router.put('/:id/read', markAsRead);

// Delete single
router.delete('/:id', deleteNotification);

module.exports = router;
