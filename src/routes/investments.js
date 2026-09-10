const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeCurrentAmount(inv) {
  if (inv.type === 'variable_income' && inv.quantity != null && inv.current_price != null) {
    return inv.quantity * inv.current_price;
  }
  return inv.current_amount != null ? inv.current_amount : inv.invested_amount;
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  const filterType   = req.query.type   || 'all';   // 'all' | 'fixed_income' | 'variable_income'
  const filterStatus = req.query.status || 'active'; // 'active' | 'redeemed' | 'all'

  let where = 'WHERE i.user_id = ?';
  const params = [userId];

  if (filterType !== 'all') {
    where += ' AND i.type = ?';
    params.push(filterType);
  }
  if (filterStatus !== 'all') {
    where += ' AND i.status = ?';
    params.push(filterStatus);
  }

  const investments = db.prepare(`
    SELECT i.*,
      c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM investments i
    LEFT JOIN categories c ON i.category_id = c.id
    ${where}
    ORDER BY i.status ASC, i.start_date DESC
  `).all(...params);

  // Compute derived values
  for (const inv of investments) {
    inv.computed_current = computeCurrentAmount(inv);
    inv.gain             = inv.computed_current - inv.invested_amount;
    inv.gain_pct         = inv.invested_amount > 0
      ? (inv.gain / inv.invested_amount) * 100
      : 0;
  }

  // Summary (always over active investments, ignoring filters for totals)
  const allActive = db.prepare(`
    SELECT * FROM investments WHERE user_id = ? AND status = 'active'
  `).all(userId);

  for (const inv of allActive) {
    inv.computed_current = computeCurrentAmount(inv);
  }

  const totalInvested = allActive.reduce((s, i) => s + i.invested_amount, 0);
  const totalCurrent  = allActive.reduce((s, i) => s + i.computed_current, 0);
  const totalGain     = totalCurrent - totalInvested;
  const totalGainPct  = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;
  const fixedCount    = allActive.filter(i => i.type === 'fixed_income').length;
  const varCount      = allActive.filter(i => i.type === 'variable_income').length;

  const summary = { totalInvested, totalCurrent, totalGain, totalGainPct, fixedCount, varCount };

  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
    ORDER BY name
  `).all(userId, userId);

  res.render('investments/index', {
    title: 'Investimentos — TxTrace',
    investments, summary, categories,
    filterType, filterStatus
  });
});

// ─── New Form ─────────────────────────────────────────────────────────────────

router.get('/new', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const today = new Date().toISOString().split('T')[0];
  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
    ORDER BY name
  `).all(userId, userId);

  res.render('investments/form', {
    title: 'Novo Investimento — TxTrace',
    investment: null, categories, today, error: null
  });
});

// ─── Edit Form ────────────────────────────────────────────────────────────────

router.get('/:id/edit', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const investment = db.prepare(
    'SELECT * FROM investments WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!investment) return res.redirect('/investments');

  const today = new Date().toISOString().split('T')[0];
  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
    ORDER BY name
  `).all(userId, userId);

  res.render('investments/form', {
    title: 'Editar Investimento — TxTrace',
    investment, categories, today, error: null
  });
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const today = new Date().toISOString().split('T')[0];

  try {
    const {
      type, name, broker, category_id, invested_amount, current_amount,
      start_date, notes,
      // fixed income
      rate_type, rate_value, maturity_date, is_liquid,
      // variable income
      asset_class, ticker, quantity, avg_price, current_price
    } = req.body;

    const amount = parseFloat(invested_amount);
    if (isNaN(amount) || amount <= 0) throw new Error('Valor investido inválido.');
    if (!name || !name.trim()) throw new Error('Nome do investimento obrigatório.');

    const now = new Date().toISOString().split('T')[0];
    const hasCurrentPrice = type === 'variable_income' && current_price && !isNaN(parseFloat(current_price));

    db.prepare(`
      INSERT INTO investments (
        user_id, type, name, broker, category_id, invested_amount, current_amount,
        start_date, notes,
        rate_type, rate_value, maturity_date, is_liquid,
        asset_class, ticker, quantity, avg_price, current_price, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      type,
      name.trim(),
      broker?.trim() || null,
      category_id ? parseInt(category_id) : null,
      amount,
      type === 'fixed_income' && current_amount ? parseFloat(current_amount) || null : null,
      start_date || today,
      notes?.trim() || null,
      // fixed
      type === 'fixed_income' ? (rate_type || null) : null,
      type === 'fixed_income' && rate_value ? parseFloat(rate_value) || null : null,
      type === 'fixed_income' ? (maturity_date || null) : null,
      type === 'fixed_income' ? (is_liquid === 'on' || is_liquid === '1' ? 1 : 0) : 0,
      // variable
      type === 'variable_income' ? (asset_class || null) : null,
      type === 'variable_income' ? (ticker?.trim().toUpperCase() || null) : null,
      type === 'variable_income' && quantity ? parseFloat(quantity) || null : null,
      type === 'variable_income' && avg_price ? parseFloat(avg_price) || null : null,
      hasCurrentPrice ? parseFloat(current_price) : null,
      hasCurrentPrice ? now : null
    );

    res.redirect('/investments');
  } catch (err) {
    console.error('Create investment error:', err);
    const categories = db.prepare(`
      SELECT * FROM categories
      WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
      ORDER BY name
    `).all(userId, userId);
    res.render('investments/form', {
      title: 'Novo Investimento — TxTrace',
      investment: req.body, categories, today, error: err.message
    });
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.post('/:id/update', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const invId = req.params.id;
  const today = new Date().toISOString().split('T')[0];

  try {
    const existing = db.prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(invId, userId);
    if (!existing) return res.redirect('/investments');

    const {
      type, name, broker, category_id, invested_amount, current_amount,
      start_date, notes,
      rate_type, rate_value, maturity_date, is_liquid,
      asset_class, ticker, quantity, avg_price, current_price
    } = req.body;

    const amount = parseFloat(invested_amount);
    if (isNaN(amount) || amount <= 0) throw new Error('Valor investido inválido.');

    const hasCurrentPrice = type === 'variable_income' && current_price && !isNaN(parseFloat(current_price));
    const priceChanged = hasCurrentPrice && parseFloat(current_price) !== existing.current_price;
    const newLastUpdated = hasCurrentPrice
      ? (priceChanged ? today : (existing.last_updated_at || today))
      : null;

    db.prepare(`
      UPDATE investments SET
        type = ?, name = ?, broker = ?, category_id = ?,
        invested_amount = ?, current_amount = ?, start_date = ?, notes = ?,
        rate_type = ?, rate_value = ?, maturity_date = ?, is_liquid = ?,
        asset_class = ?, ticker = ?, quantity = ?, avg_price = ?,
        current_price = ?, last_updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      type,
      name.trim(),
      broker?.trim() || null,
      category_id ? parseInt(category_id) : null,
      amount,
      type === 'fixed_income' && current_amount ? parseFloat(current_amount) || null : null,
      start_date || today,
      notes?.trim() || null,
      type === 'fixed_income' ? (rate_type || null) : null,
      type === 'fixed_income' && rate_value ? parseFloat(rate_value) || null : null,
      type === 'fixed_income' ? (maturity_date || null) : null,
      type === 'fixed_income' ? (is_liquid === 'on' || is_liquid === '1' ? 1 : 0) : 0,
      type === 'variable_income' ? (asset_class || null) : null,
      type === 'variable_income' ? (ticker?.trim().toUpperCase() || null) : null,
      type === 'variable_income' && quantity ? parseFloat(quantity) || null : null,
      type === 'variable_income' && avg_price ? parseFloat(avg_price) || null : null,
      hasCurrentPrice ? parseFloat(current_price) : null,
      newLastUpdated,
      invId, userId
    );

    res.redirect('/investments');
  } catch (err) {
    console.error('Update investment error:', err);
    const categories = db.prepare(`
      SELECT * FROM categories
      WHERE (user_id = ? OR (user_id IS NULL AND id NOT IN (SELECT category_id FROM user_hidden_categories WHERE user_id = ?)))
      ORDER BY name
    `).all(userId, userId);
    res.render('investments/form', {
      title: 'Editar Investimento — TxTrace',
      investment: { ...req.body, id: invId }, categories, today, error: err.message
    });
  }
});

// ─── Quick price update ───────────────────────────────────────────────────────

router.post('/:id/update-price', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { current_price, current_amount } = req.body;
  const today = new Date().toISOString().split('T')[0];

  const inv = db.prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!inv) return res.redirect('/investments');

  if (inv.type === 'variable_income' && current_price) {
    db.prepare(`
      UPDATE investments SET current_price = ?, last_updated_at = ? WHERE id = ? AND user_id = ?
    `).run(parseFloat(current_price), today, req.params.id, userId);
  } else if (inv.type === 'fixed_income' && current_amount) {
    db.prepare(`
      UPDATE investments SET current_amount = ?, last_updated_at = ? WHERE id = ? AND user_id = ?
    `).run(parseFloat(current_amount), today, req.params.id, userId);
  }

  res.redirect('/investments');
});

// ─── Redeem ───────────────────────────────────────────────────────────────────

router.post('/:id/redeem', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  db.prepare("UPDATE investments SET status = 'redeemed' WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  res.redirect('/investments');
});

// ─── Reopen ───────────────────────────────────────────────────────────────────

router.post('/:id/reopen', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  db.prepare("UPDATE investments SET status = 'active' WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  res.redirect('/investments');
});

// ─── Delete ───────────────────────────────────────────────────────────────────

router.post('/:id/delete', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  db.prepare('DELETE FROM investments WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  res.redirect('/investments');
});

module.exports = router;
