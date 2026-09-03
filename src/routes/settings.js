const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  const categories = db.prepare(
    'SELECT * FROM categories WHERE user_id IS NULL OR user_id = ? ORDER BY is_default DESC, name'
  ).all(userId);

  const institutions = db.prepare(
    'SELECT * FROM payment_institutions WHERE user_id = ? ORDER BY type, name'
  ).all(userId);

  const currentUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);

  res.render('settings', {
    title: 'Configurações — TxTrace',
    categories, institutions, currentUser,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// ─── Categories ──────────────────────────────────────────────────────────────

router.post('/categories', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { name, icon, color } = req.body;

  if (!name || !name.trim()) return res.redirect('/settings?error=Nome+é+obrigatório');

  try {
    db.prepare(
      'INSERT INTO categories (user_id, name, icon, color) VALUES (?, ?, ?, ?)'
    ).run(userId, name.trim(), icon || '📦', color || '#6366f1');
    res.redirect('/settings?success=Categoria+criada+com+sucesso');
  } catch (err) {
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

router.post('/categories/:id/update', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { name, icon, color } = req.body;

  if (!name || !name.trim()) return res.redirect('/settings?error=Nome+é+obrigatório');

  try {
    db.prepare(
      'UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ? AND user_id = ?'
    ).run(name.trim(), icon || '📦', color || '#6366f1', req.params.id, userId);
    res.redirect('/settings?success=Categoria+atualizada+com+sucesso');
  } catch (err) {
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

router.post('/categories/:id/delete', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  try {
    db.transaction(() => {
      // Unlink category from transactions first so foreign key won't fail
      db.prepare('UPDATE transactions SET category_id = NULL WHERE category_id = ? AND user_id = ?').run(req.params.id, userId);
      // Delete user category (cannot delete default ones where user_id is NULL)
      db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, userId);
    })();
    res.redirect('/settings?success=Categoria+removida+com+sucesso');
  } catch (err) {
    console.error('Error deleting category:', err);
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

// ─── Institutions ─────────────────────────────────────────────────────────────

router.post('/institutions', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { name, type, color, credit_limit } = req.body;

  if (!name || !name.trim()) return res.redirect('/settings?error=Nome+é+obrigatório');

  try {
    const limit = type === 'credit_card' && credit_limit ? parseFloat(credit_limit) : null;
    db.prepare(
      'INSERT INTO payment_institutions (user_id, name, type, color, credit_limit) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, name.trim(), type || 'bank', color || '#6366f1', limit);
    res.redirect('/settings?success=Instituição+criada+com+sucesso');
  } catch (err) {
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

router.post('/institutions/:id/update', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { name, type, color, credit_limit } = req.body;

  if (!name || !name.trim()) return res.redirect('/settings?error=Nome+é+obrigatório');

  try {
    const limit = type === 'credit_card' && credit_limit ? parseFloat(credit_limit) : null;
    db.prepare(
      'UPDATE payment_institutions SET name = ?, type = ?, color = ?, credit_limit = ? WHERE id = ? AND user_id = ?'
    ).run(name.trim(), type, color, limit, req.params.id, userId);
    res.redirect('/settings?success=Instituição+atualizada+com+sucesso');
  } catch (err) {
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

router.post('/institutions/:id/delete', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  try {
    db.transaction(() => {
      // Unlink institution from transactions and loans before deleting
      db.prepare('UPDATE transactions SET institution_id = NULL WHERE institution_id = ? AND user_id = ?').run(req.params.id, userId);
      db.prepare('UPDATE loans SET institution_id = NULL WHERE institution_id = ? AND user_id = ?').run(req.params.id, userId);
      db.prepare('DELETE FROM payment_institutions WHERE id = ? AND user_id = ?').run(req.params.id, userId);
    })();
    res.redirect('/settings?success=Instituição+removida+com+sucesso');
  } catch (err) {
    console.error('Error deleting institution:', err);
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

// ─── Profile Update ──────────────────────────────────────────────────────────

router.post('/profile/update', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { name, email } = req.body;

  if (!name || !name.trim() || !email || !email.trim()) {
    return res.redirect('/settings?error=Nome+e+email+são+obrigatórios');
  }

  try {
    // Check if email belongs to another user
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim(), userId);
    if (existing) {
      return res.redirect('/settings?error=Email+já+utilizado+por+outro+usuário');
    }

    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name.trim(), email.trim(), userId);

    // Update active session
    req.session.user.name = name.trim();
    req.session.user.email = email.trim();

    res.redirect('/settings?success=Perfil+atualizado+com+sucesso');
  } catch (err) {
    console.error('Error updating profile:', err);
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

router.post('/profile/password', requireAuth, async (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.redirect('/settings?error=Preencha+todos+os+campos+de+senha');
  }

  if (new_password !== confirm_password) {
    return res.redirect('/settings?error=A+nova+senha+e+confirmação+não+coincidem');
  }

  if (new_password.length < 6) {
    return res.redirect('/settings?error=A+nova+senha+deve+ter+no+mínimo+6+caracteres');
  }

  try {
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.redirect('/settings?error=Senha+atual+incorreta');
    }

    const newHash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);

    res.redirect('/settings?success=Senha+alterada+com+sucesso');
  } catch (err) {
    console.error('Error updating password:', err);
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
