const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
    ORDER BY is_default DESC, name
  `).all(userId, userId);

  const hiddenCount = db.prepare('SELECT COUNT(*) as count FROM user_hidden_categories WHERE user_id = ?').get(userId)?.count || 0;

  const institutions = db.prepare(`
    SELECT pi.*, parent.name AS parent_name
    FROM payment_institutions pi
    LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
    WHERE pi.user_id = ?
    ORDER BY pi.type, pi.name
  `).all(userId);

  const currentUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);

  res.render('settings', {
    title: 'Configurações — TxTrace',
    categories, institutions, currentUser, hiddenCount,
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

router.post('/categories/:id/hide', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  try {
    db.prepare('INSERT OR IGNORE INTO user_hidden_categories (user_id, category_id) VALUES (?, ?)').run(userId, req.params.id);
    res.redirect('/settings?success=Categoria+padrão+ocultada');
  } catch (err) {
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

router.post('/categories/restore-defaults', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  try {
    db.prepare('DELETE FROM user_hidden_categories WHERE user_id = ?').run(userId);
    res.redirect('/settings?success=Categorias+padrão+restauradas');
  } catch (err) {
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

// ─── Institutions ─────────────────────────────────────────────────────────────

router.post('/institutions', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const {
    name, type, color, credit_limit, invoice_closing_day, invoice_due_day, parent_institution_id,
    has_card, card_name, card_credit_limit, card_closing_day, card_due_day, card_color
  } = req.body;

  if (!name || !name.trim()) return res.redirect('/settings?error=Nome+é+obrigatório');

  try {
    db.transaction(() => {
      const limit = type === 'credit_card' && credit_limit ? parseFloat(credit_limit) : null;
      const closingDay = type === 'credit_card' ? (parseInt(invoice_closing_day) || 5) : null;
      const dueDay     = type === 'credit_card' ? (parseInt(invoice_due_day)     || 10) : null;
      const parentId   = type === 'credit_card' && parent_institution_id ? parseInt(parent_institution_id) : null;

      const result = db.prepare(
        'INSERT INTO payment_institutions (user_id, name, type, color, credit_limit, invoice_closing_day, invoice_due_day, parent_institution_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(userId, name.trim(), type || 'bank', color || '#6366f1', limit, closingDay, dueDay, parentId);

      const newInstId = result.lastInsertRowid;

      // If creating a bank account and user opted to also attach a credit card
      if (type !== 'credit_card' && has_card === '1') {
        const cName = card_name && card_name.trim() ? card_name.trim() : `${name.trim()} (Cartão)`;
        const cLimit = card_credit_limit ? parseFloat(card_credit_limit) : null;
        const cClosing = parseInt(card_closing_day) || 5;
        const cDue = parseInt(card_due_day) || 10;
        const cColor = card_color || color || '#818cf8';

        db.prepare(
          'INSERT INTO payment_institutions (user_id, name, type, color, credit_limit, invoice_closing_day, invoice_due_day, parent_institution_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(userId, cName, 'credit_card', cColor, cLimit, cClosing, cDue, newInstId);
      }
    })();

    res.redirect('/settings?success=Instituição+salva+com+sucesso');
  } catch (err) {
    res.redirect('/settings?error=' + encodeURIComponent(err.message));
  }
});

router.post('/institutions/:id/update', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { name, type, color, credit_limit, invoice_closing_day, invoice_due_day, parent_institution_id } = req.body;

  if (!name || !name.trim()) return res.redirect('/settings?error=Nome+é+obrigatório');

  try {
    const limit      = type === 'credit_card' && credit_limit ? parseFloat(credit_limit) : null;
    const closingDay = type === 'credit_card' ? (parseInt(invoice_closing_day) || 5)  : null;
    const dueDay     = type === 'credit_card' ? (parseInt(invoice_due_day)     || 10) : null;
    const parentId   = type === 'credit_card' && parent_institution_id ? parseInt(parent_institution_id) : null;

    db.prepare(
      'UPDATE payment_institutions SET name = ?, type = ?, color = ?, credit_limit = ?, invoice_closing_day = ?, invoice_due_day = ?, parent_institution_id = ? WHERE id = ? AND user_id = ?'
    ).run(name.trim(), type, color, limit, closingDay, dueDay, parentId, req.params.id, userId);
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
      // If deleting a parent bank, cards linked to it have their parent_institution_id set to NULL automatically via FOREIGN KEY ON DELETE SET NULL
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
