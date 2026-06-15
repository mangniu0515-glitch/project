const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

router.get('/', (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const users = req.db.prepare("SELECT id, username, role, created_at, updated_at FROM users WHERE role = 'admin'").all();
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function requireAdminAccountTarget(req, res, user) {
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return false;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Only administrator accounts can be managed here' });
    return false;
  }
  return true;
}

router.post('/', [
  body('username').notEmpty().trim().isLength({ min: 3, max: 20 }),
  body('password').notEmpty().isLength({ min: 6 }),
  body('role').optional().isIn(['admin'])
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { username, password } = req.body;

    const existingUser = req.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const stmt = req.db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
    const result = stmt.run(username, hashedPassword, 'admin');

    const user = req.db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      message: 'User created successfully',
      user
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', [
  body('username').optional().trim().isLength({ min: 3, max: 20 }),
  body('password').optional().isLength({ min: 6 }),
  body('role').optional().isIn(['admin'])
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const userId = parseInt(req.params.id);
    const { username, password, role } = req.body;

    const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!requireAdminAccountTarget(req, res, user)) return;

    if (username && username !== user.username) {
      const existingUser = req.db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
      if (existingUser) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    const updates = {};
    if (username) updates.username = username;
    if (password) updates.password = bcrypt.hashSync(password, 10);
    if (role && req.user.role === 'admin') updates.role = 'admin';

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = [...Object.values(updates), userId];
      req.db.prepare(`UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
    }

    const updatedUser = req.db.prepare('SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?').get(userId);

    res.json({
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/password', [
  body('password').notEmpty().isLength({ min: 6 })
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const userId = parseInt(req.params.id);
    const { password } = req.body;

    const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!requireAdminAccountTarget(req, res, user)) return;

    const hashedPassword = bcrypt.hashSync(password, 10);
    req.db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashedPassword, userId);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const userId = parseInt(req.params.id);

    const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!requireAdminAccountTarget(req, res, user)) return;

    if (user.username === 'admin') {
      return res.status(400).json({ error: 'The built-in admin account cannot be deleted' });
    }

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const adminCount = req.db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last administrator account' });
    }

    req.db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
