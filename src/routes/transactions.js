const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { generateRecurringInstances } = require('./dashboard');

const router = express.Router();

// ─── List ────────────────────────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const now = new Date();

  const year  = parseInt(req.query.year  || now.getFullYear());
  const month = parseInt(req.query.month || (now.getMonth() + 1));
  const { category_id, institution_id, payment_method, type } = req.query;

  generateRecurringInstances(userId, year, month);

  const yearStr  = String(year);
  const monthStr = String(month).padStart(2, '0');

  let where = `
    WHERE t.user_id = ?
      AND strftime('%Y', t.transaction_date) = ?
      AND strftime('%m', t.transaction_date) = ?
  `;
  const params = [userId, yearStr, monthStr];

  if (category_id)    { where += ' AND t.category_id = ?';    params.push(category_id); }
  if (institution_id) { where += ' AND t.institution_id = ?'; params.push(institution_id); }
  if (payment_method) { where += ' AND t.payment_method = ?'; params.push(payment_method); }
  if (type)           { where += ' AND t.type = ?';           params.push(type); }

  const transactions = db.prepare(`
    SELECT t.*,
      COALESCE(c.name,  'Sem categoria') as category_name,
      COALESCE(c.icon,  '📦') as category_icon,
      COALESCE(c.color, '#94a3b8') as category_color,
      pi.name as institution_name,
      pi.type as institution_type
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN payment_institutions pi ON t.institution_id = pi.id
    ${where}
    ORDER BY t.transaction_date DESC, t.created_at DESC
  `).all(...params);

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expenses
    FROM transactions
    WHERE user_id = ?
      AND strftime('%Y', transaction_date) = ?
      AND strftime('%m', transaction_date) = ?
  `).get(userId, yearStr, monthStr);

  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
    ORDER BY name
  `).all(userId, userId);

  const institutions = db.prepare(`
    SELECT pi.*, parent.name AS parent_name
    FROM payment_institutions pi
    LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
    WHERE pi.user_id = ?
    ORDER BY pi.name
  `).all(userId);

  const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const txYears = db.prepare("SELECT DISTINCT CAST(strftime('%Y', transaction_date) AS INTEGER) as y FROM transactions WHERE user_id = ? ORDER BY y DESC").all(userId).map(r => r.y);
  const currentYear = new Date().getFullYear();
  const availableYears = [...new Set([currentYear, ...txYears])].sort((a, b) => b - a);

  res.render('transactions/index', {
    title: 'Transações — TxTrace',
    transactions, categories, institutions, totals, year, month,
    filters: { category_id, institution_id, payment_method, type },
    MONTH_NAMES, availableYears
  });

});

// ─── New Form ────────────────────────────────────────────────────────────────

router.get('/new', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
    ORDER BY name
  `).all(userId, userId);

  const institutions = db.prepare(`
    SELECT pi.*, parent.name AS parent_name
    FROM payment_institutions pi
    LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
    WHERE pi.user_id = ?
    ORDER BY pi.name
  `).all(userId);

  const today = new Date().toISOString().split('T')[0];

  res.render('transactions/form', {
    title: 'Nova Transação — TxTrace',
    transaction: null, categories, institutions, today, error: null
  });
});

// ─── Create ──────────────────────────────────────────────────────────────────

router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  const {
    type, description, amount, category_id, payment_method,
    institution_id, transaction_date, is_paid, is_recurring,
    is_installment, total_installments, first_installment_date
  } = req.body;

  const today = new Date().toISOString().split('T')[0];

  try {
    const amountVal = parseFloat(amount);
    if (isNaN(amountVal) || amountVal <= 0) throw new Error('Valor inválido.');

    const isPaid      = is_paid      === 'on' || is_paid      === '1' ? 1 : 0;
    const isRecurring = is_recurring === 'on' || is_recurring === '1' ? 1 : 0;
    const isInstall   = is_installment === 'on' || is_installment === '1' ? 1 : 0;

    const catId  = category_id   && category_id   !== '' ? parseInt(category_id)   : null;
    const instId = institution_id && institution_id !== '' ? parseInt(institution_id) : null;
    const txDate = transaction_date || today;

    if (isInstall && parseInt(total_installments) > 1) {
      const installments = parseInt(total_installments);
      const firstDate    = first_installment_date || txDate;
      const installAmt   = amountVal / installments;

      const group = db.prepare(`
        INSERT INTO installment_groups (user_id, description, total_amount, total_installments, first_installment_date)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, description, amountVal, installments, firstDate);

      const insertTx = db.prepare(`
        INSERT INTO transactions
          (user_id, type, description, amount, category_id, payment_method,
           institution_id, transaction_date, is_paid,
           installment_group_id, installment_number, total_installments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      db.transaction(() => {
        for (let i = 0; i < installments; i++) {
          const d = new Date(firstDate + 'T12:00:00');
          d.setMonth(d.getMonth() + i);
          const date = d.toISOString().split('T')[0];
          insertTx.run(
            userId, type,
            `${description} (${i + 1}/${installments})`,
            installAmt, catId, payment_method, instId,
            date, i === 0 ? isPaid : 0,
            group.lastInsertRowid, i + 1, installments
          );
        }
      })();

    } else {
      const recDay = isRecurring ? parseInt(txDate.split('-')[2]) : null;
      db.prepare(`
        INSERT INTO transactions
          (user_id, type, description, amount, category_id, payment_method,
           institution_id, transaction_date, is_paid, is_recurring, recurrence_day)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, type, description, amountVal, catId, payment_method, instId, txDate, isPaid, isRecurring, recDay);
    }

    res.redirect('/transactions');
  } catch (err) {
    console.error('Create transaction error:', err);
    const categories = db.prepare(`
      SELECT * FROM categories
      WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
      ORDER BY name
    `).all(userId, userId);

    const institutions = db.prepare(`
      SELECT pi.*, parent.name AS parent_name
      FROM payment_institutions pi
      LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
      WHERE pi.user_id = ?
      ORDER BY pi.name
    `).all(userId);

    res.render('transactions/form', {
      title: 'Nova Transação — TxTrace',
      transaction: req.body, categories, institutions,
      today: today, error: err.message
    });
  }
});

// ─── Edit Form ───────────────────────────────────────────────────────────────

router.get('/:id/edit', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!tx) return res.redirect('/transactions');

  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
    ORDER BY name
  `).all(userId, userId);

  const institutions = db.prepare(`
    SELECT pi.*, parent.name AS parent_name
    FROM payment_institutions pi
    LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
    WHERE pi.user_id = ?
    ORDER BY pi.name
  `).all(userId);

  res.render('transactions/form', {
    title: 'Editar Transação — TxTrace',
    transaction: tx, categories, institutions,
    today: new Date().toISOString().split('T')[0], error: null
  });
});

// ─── Update ──────────────────────────────────────────────────────────────────

router.post('/:id/update', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { type, description, amount, category_id, payment_method, institution_id, transaction_date, is_paid } = req.body;

  db.prepare(`
    UPDATE transactions SET
      type = ?, description = ?, amount = ?, category_id = ?,
      payment_method = ?, institution_id = ?, transaction_date = ?, is_paid = ?
    WHERE id = ? AND user_id = ?
  `).run(
    type, description, parseFloat(amount),
    category_id || null, payment_method, institution_id || null,
    transaction_date, is_paid === 'on' || is_paid === '1' ? 1 : 0,
    req.params.id, userId
  );

  res.redirect('/transactions');
});

// ─── Delete ──────────────────────────────────────────────────────────────────

router.post('/:id/delete', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  res.redirect('/transactions');
});

// ─── Toggle Paid ─────────────────────────────────────────────────────────────

router.post('/:id/toggle-paid', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const tx = db.prepare('SELECT is_paid FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (tx) {
    db.prepare('UPDATE transactions SET is_paid = ? WHERE id = ? AND user_id = ?').run(tx.is_paid ? 0 : 1, req.params.id, userId);
  }

  const ref = req.headers.referer || '/transactions';
  res.redirect(ref);
});

// ─── Cancel Recurrence ───────────────────────────────────────────────────────

router.post('/:id/cancel-recurrence', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const now = new Date().toISOString().split('T')[0];

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!tx) return res.redirect('/transactions');

  // Cancel on the original (parent or this one itself)
  const originalId = tx.recurrence_parent_id || tx.id;

  db.transaction(() => {
    // 1. Mark parent as cancelled
    db.prepare('UPDATE transactions SET recurrence_cancelled_at = ? WHERE id = ? AND user_id = ?').run(now, originalId, userId);

    // 2. Also mark current instance as cancelled if it's a child
    if (tx.recurrence_parent_id) {
      db.prepare('UPDATE transactions SET recurrence_cancelled_at = ? WHERE id = ? AND user_id = ?').run(now, tx.id, userId);
    }

    // 3. Remove any future unpaid instances already generated for months after today
    db.prepare(`
      DELETE FROM transactions
      WHERE recurrence_parent_id = ?
        AND user_id = ?
        AND transaction_date > ?
        AND is_paid = 0
    `).run(originalId, userId, now);
  })();

  const ref = req.headers.referer || '/transactions';
  res.redirect(ref);
});

module.exports = router;
