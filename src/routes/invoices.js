const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Given a transaction date and the card's closing day, return the invoice
 * period (year + month) the transaction belongs to.
 *
 * Rule: if transaction day >= closing_day, it belongs to next month's invoice.
 * Example: closing_day = 5, purchase on 2024-03-05 → invoice April 2024.
 *          closing_day = 5, purchase on 2024-03-04 → invoice March 2024.
 */
function getInvoicePeriod(dateStr, closingDay) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDate();
  let year  = d.getFullYear();
  let month = d.getMonth() + 1; // 1-12

  if (day >= closingDay) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }

  return { year, month };
}

// ─── GET /invoices ────────────────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  const db     = getDb();
  const userId = req.session.userId;

  // All credit card institutions for this user
  const cards = db.prepare(
    `SELECT * FROM payment_institutions
     WHERE user_id = ? AND type = 'credit_card'
     ORDER BY name`
  ).all(userId);

  // All credit transactions
  const transactions = db.prepare(
    `SELECT t.*, pi.invoice_closing_day, pi.invoice_due_day, pi.name AS institution_name
     FROM transactions t
     LEFT JOIN payment_institutions pi ON pi.id = t.institution_id
     WHERE t.user_id = ? AND t.payment_method = 'credit' AND t.type = 'expense'
     ORDER BY t.transaction_date DESC`
  ).all(userId);

  // Already paid invoice records
  const paidInvoices = db.prepare(
    'SELECT * FROM card_invoices WHERE user_id = ?'
  ).all(userId);

  const paidMap = {};
  paidInvoices.forEach(p => {
    paidMap[`${p.institution_id}-${p.year}-${p.month}`] = p;
  });

  // Group transactions per card per invoice period
  const invoicesByCard = {};

  cards.forEach(card => {
    invoicesByCard[card.id] = {
      card,
      invoices: {} // key: "YYYY-MM"
    };
  });

  transactions.forEach(tx => {
    if (!tx.institution_id || !invoicesByCard[tx.institution_id]) return;

    const closingDay = tx.invoice_closing_day || 5;
    const dueDay     = tx.invoice_due_day     || 10;
    const { year, month } = getInvoicePeriod(tx.transaction_date, closingDay);
    const key = `${year}-${String(month).padStart(2, '0')}`;

    const group = invoicesByCard[tx.institution_id].invoices;
    if (!group[key]) {
      const paidRecord = paidMap[`${tx.institution_id}-${year}-${month}`] || null;

      // Calculate due date string for display
      const dueDateObj  = new Date(year, month - 1, dueDay);
      // If due day overflows (e.g. Feb 30), JS auto-corrects to next month
      const dueDateStr  = dueDateObj.toLocaleDateString('pt-BR');

      const now         = new Date();
      const nowYear     = now.getFullYear();
      const nowMonth    = now.getMonth() + 1;
      const nowDay      = now.getDate();
      const closingDayForCard = tx.invoice_closing_day || 5;

      // A fatura é "aberta" (ainda pode receber lançamentos) somente se:
      // - É um mês futuro, OU
      // - É o mês atual E o dia de fechamento ainda não chegou
      let isOpen;
      if (year > nowYear || (year === nowYear && month > nowMonth)) {
        isOpen = true; // fatura de mês futuro, sempre aberta
      } else if (year === nowYear && month === nowMonth) {
        isOpen = nowDay < closingDayForCard; // fecha no dia do fechamento (compras no dia do fechamento vão para a próxima fatura)
      } else {
        isOpen = false; // mês passado, sempre fechada
      }

      group[key] = {
        year, month, key,
        dueDay, dueDate: dueDateStr,
        total: 0,
        txCount: 0,
        transactions: [],
        isPaid: !!paidRecord,
        paidAt: paidRecord ? paidRecord.paid_at : null,
        isOpen,
      };

    }

    group[key].total   += tx.amount;
    group[key].txCount += 1;
    group[key].transactions.push(tx);
  });

  // Convert to sorted array for each card
  const result = cards.map(card => {
    const data = invoicesByCard[card.id];
    const invoiceList = Object.values(data.invoices)
      .sort((a, b) => (b.year !== a.year ? b.year - a.year : b.month - a.month));
    return { card, invoices: invoiceList };
  }).filter(c => c.invoices.length > 0 || true); // show all cards

  const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  res.render('invoices/index', {
    title: 'Faturas — TxTrace',
    cardInvoices: result,
    MONTH_NAMES,
    success: req.query.success || null,
    error:   req.query.error   || null
  });
});

// ─── POST /invoices/:institutionId/:year/:month/pay ───────────────────────────

router.post('/:institutionId/:year/:month/pay', requireAuth, (req, res) => {
  const db     = getDb();
  const userId = req.session.userId;
  const { institutionId, year, month } = req.params;

  // Verify card belongs to user
  const card = db.prepare(
    `SELECT * FROM payment_institutions WHERE id = ? AND user_id = ? AND type = 'credit_card'`
  ).get(institutionId, userId);

  if (!card) return res.redirect('/invoices?error=Cartão+não+encontrado');

  // Recalculate total for this invoice period
  const closingDay = card.invoice_closing_day || 5;
  const transactions = db.prepare(
    `SELECT id, amount, transaction_date FROM transactions
     WHERE user_id = ? AND institution_id = ? AND payment_method = 'credit' AND type = 'expense'`
  ).all(userId, institutionId);

  let total = 0;
  const txIdsInPeriod = [];
  transactions.forEach(tx => {
    const period = getInvoicePeriod(tx.transaction_date, closingDay);
    if (period.year === parseInt(year) && period.month === parseInt(month)) {
      total += tx.amount;
      txIdsInPeriod.push(tx.id);
    }
  });

  try {
    db.transaction(() => {
      // Register / update the invoice as paid
      db.prepare(
        `INSERT INTO card_invoices (user_id, institution_id, year, month, total_amount, paid_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(institution_id, year, month)
         DO UPDATE SET paid_at = datetime('now', 'localtime'), total_amount = excluded.total_amount`
      ).run(userId, institutionId, parseInt(year), parseInt(month), total);

      // Mark all pending transactions in this invoice period as paid
      if (txIdsInPeriod.length > 0) {
        const placeholders = txIdsInPeriod.map(() => '?').join(',');
        db.prepare(
          `UPDATE transactions SET is_paid = 1
           WHERE id IN (${placeholders}) AND user_id = ? AND is_paid = 0`
        ).run(...txIdsInPeriod, userId);
      }
    })();

    res.redirect('/invoices?success=Fatura+marcada+como+paga+e+transa%C3%A7%C3%B5es+atualizadas+com+sucesso');
  } catch (err) {
    console.error('Error marking invoice as paid:', err);
    res.redirect('/invoices?error=' + encodeURIComponent(err.message));
  }
});

// ─── POST /invoices/:institutionId/:year/:month/unpay ────────────────────────

router.post('/:institutionId/:year/:month/unpay', requireAuth, (req, res) => {
  const db     = getDb();
  const userId = req.session.userId;
  const { institutionId, year, month } = req.params;

  // Verify card belongs to user
  const card = db.prepare(
    `SELECT * FROM payment_institutions WHERE id = ? AND user_id = ? AND type = 'credit_card'`
  ).get(institutionId, userId);

  if (!card) return res.redirect('/invoices?error=Cartão+não+encontrado');

  try {
    db.transaction(() => {
      // Delete the paid invoice record entirely so it's treated as unpaid
      db.prepare(
        `DELETE FROM card_invoices
         WHERE user_id = ? AND institution_id = ? AND year = ? AND month = ?`
      ).run(userId, institutionId, parseInt(year), parseInt(month));

      // Revert is_paid on transactions that belong to this invoice period
      const closingDay = card.invoice_closing_day || 5;
      const allTx = db.prepare(
        `SELECT id, transaction_date FROM transactions
         WHERE user_id = ? AND institution_id = ? AND payment_method = 'credit' AND type = 'expense' AND is_paid = 1`
      ).all(userId, institutionId);

      const txToRevert = allTx.filter(tx => {
        const period = getInvoicePeriod(tx.transaction_date, closingDay);
        return period.year === parseInt(year) && period.month === parseInt(month);
      }).map(tx => tx.id);

      if (txToRevert.length > 0) {
        const placeholders = txToRevert.map(() => '?').join(',');
        db.prepare(
          `UPDATE transactions SET is_paid = 0 WHERE id IN (${placeholders}) AND user_id = ?`
        ).run(...txToRevert, userId);
      }
    })();

    res.redirect('/invoices?success=Fatura+reaberta+com+sucesso');
  } catch (err) {
    console.error('Error reopening invoice:', err);
    res.redirect('/invoices?error=' + encodeURIComponent(err.message));
  }
});


module.exports = router;
module.exports.getInvoicePeriod = getInvoicePeriod;
