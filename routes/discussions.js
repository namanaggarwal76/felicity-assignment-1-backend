const express = require('express');
const router = express.Router();
const Discussion = require('../models/discussion');
const Event = require('../models/event');
const Registration = require('../models/registration');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/discussions/:eventId - Get all discussions for an event
router.get('/:eventId', authMiddleware, async (req, res) => {
  try {
    const { eventId } = req.params;

    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Allow anyone logged in to VIEW discussions
    // But we'll check registration status for posting

    // Check if user is the organizer (for clubs)
    let isOrganizer = false;
    if (req.user.type === 'club') {
      isOrganizer = event.organizerId.toString() === req.user._id.toString();
    }

    // Check if user is registered
    let isRegistered = false;
    if (req.user.type === 'user') {
      const registration = await Registration.findOne({
        userId: req.user._id,
        eventId: eventId
      });
      isRegistered = !!registration;
    }

    // Fetch discussions (exclude soft-deleted messages)
    const discussions = await Discussion.find({
      eventId: eventId,
      deletedAt: null
    })
      .populate('authorId', 'firstName lastName name email')
      .populate({
        path: 'parentMessageId',
        populate: { path: 'authorId', select: 'firstName lastName name' }
      })
      .sort({ isPinned: -1, createdAt: -1 });

    res.json({ 
      discussions,
      userPermissions: {
        canPost: isRegistered || isOrganizer,
        isOrganizer: isOrganizer
      }
    });
  } catch (error) {
    console.error('Error fetching discussions:', error);
    res.status(500).json({ error: 'Failed to fetch discussions' });
  }
});

// POST /api/discussions/:eventId - Create a new discussion message
router.post('/:eventId', authMiddleware, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { message, isAnnouncement, parentMessageId } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check permissions
    let authorType = req.user.type === 'club' ? 'Club' : 'User';
    let canPostAnnouncement = false;

    if (req.user.type === 'club') {
      // Club must be the organizer
      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
      canPostAnnouncement = true;
    } else {
      // User must be registered
      const registration = await Registration.findOne({
        userId: req.user._id,
        eventId: eventId
      });
      if (!registration) {
        return res.status(403).json({ error: 'Must be registered to post' });
      }
    }

    // Only organizers can post announcements
    if (isAnnouncement && !canPostAnnouncement) {
      return res.status(403).json({ error: 'Only organizers can post announcements' });
    }

    const discussion = new Discussion({
      eventId,
      authorId: req.user._id,
      authorType,
      message: message.trim(),
      isAnnouncement: isAnnouncement || false,
      parentMessageId: parentMessageId || null
    });

    await discussion.save();
    await discussion.populate('authorId', 'firstName lastName name email');

    res.status(201).json({ discussion });
  } catch (error) {
    console.error('Error creating discussion:', error);
    res.status(500).json({ error: 'Failed to create discussion' });
  }
});

// PATCH /api/discussions/:id/pin - Pin/Unpin a message (Organizer only)
router.patch('/:id/pin', authMiddleware, async (req, res) => {
  try {
    const discussion = await Discussion.findById(req.params.id);
    if (!discussion) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const event = await Event.findById(discussion.eventId);
    if (event.organizerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only organizers can pin messages' });
    }

    discussion.isPinned = !discussion.isPinned;
    await discussion.save();

    res.json({ discussion, message: `Message ${discussion.isPinned ? 'pinned' : 'unpinned'}` });
  } catch (error) {
    console.error('Error pinning message:', error);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// DELETE /api/discussions/:id - Soft delete a message (Organizer only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const discussion = await Discussion.findById(req.params.id);
    if (!discussion) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const event = await Event.findById(discussion.eventId);
    
    // Only organizer can delete, or author can delete their own message
    const isOrganizer = event.organizerId.toString() === req.user._id.toString();
    const isAuthor = discussion.authorId.toString() === req.user._id.toString();

    if (!isOrganizer && !isAuthor) {
      return res.status(403).json({ error: 'Unauthorized to delete this message' });
    }

    discussion.deletedAt = new Date();
    await discussion.save();

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// POST /api/discussions/:id/react - Add a reaction to a message
router.post('/:id/react', authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;
    
    if (!emoji) {
      return res.status(400).json({ error: 'Emoji is required' });
    }

    const discussion = await Discussion.findById(req.params.id);
    if (!discussion) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if user already reacted with this emoji
    const existingReaction = discussion.reactions.find(
      r => r.userId.toString() === req.user._id.toString() && r.emoji === emoji
    );

    if (existingReaction) {
      // Remove reaction if already exists (toggle)
      discussion.reactions = discussion.reactions.filter(
        r => !(r.userId.toString() === req.user._id.toString() && r.emoji === emoji)
      );
    } else {
      // Add new reaction
      discussion.reactions.push({
        userId: req.user._id,
        emoji: emoji
      });
    }

    await discussion.save();
    await discussion.populate('authorId', 'firstName lastName name email');

    res.json({ discussion });
  } catch (error) {
    console.error('Error adding reaction:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

module.exports = router;
