const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * Safely parses a date string (YYYY-MM-DD) and returns the same string.
 * Falls back to today's date if the string is invalid or empty.
 */
function parseDateSafe(dateStr) {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.trim() === '') {
    return new Date().toISOString().split('T')[0];
  }
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) {
    return new Date().toISOString().split('T')[0];
  }
  return dateStr.trim();
}

/**
 * Adds months to a YYYY-MM-DD date string and returns a new YYYY-MM-DD string.
 */
function addMonths(dateStr, months) {
  const d = new Date(parseDateSafe(dateStr) + 'T12:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

// ─── List & Loans Dashboard ──────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const now = new Date();
  const year = parseInt(req.query.year || now.getFullYear());
  const month = parseInt(req.query.month || (now.getMonth() + 1));
  const yearStr = String(year);
  const monthStr = String(month).padStart(2, '0');

  const loans = db.prepare(`
    SELECT l.*,
      pi.name as institution_name, pi.type as institution_type, pi.color as institution_color,
      lr.id as return_id, lr.total_return_amount, lr.total_installments as return_total_installments,
      lr.first_installment_date as return_first_date
    FROM loans l
    LEFT JOIN payment_institutions pi ON l.institution_id = pi.id
    LEFT JOIN loan_returns lr ON lr.loan_id = l.id
    WHERE l.user_id = ?
    ORDER BY l.status ASC, l.created_at DESC
  `).all(userId);

  for (const loan of loans) {
    loan.installments = db.prepare(
      'SELECT * FROM loan_installments WHERE loan_id = ? ORDER BY installment_number'
    ).all(loan.id);

    loan.paid_count  = loan.installments.filter(i => i.is_paid).length;
    loan.total_paid  = loan.installments.filter(i => i.is_paid).reduce((s, i) => s + i.amount, 0);

    if (loan.return_id) {
      loan.return_installments = db.prepare(
        'SELECT * FROM loan_return_installments WHERE loan_return_id = ? ORDER BY installment_number'
      ).all(loan.return_id);
      loan.received_count  = loan.return_installments.filter(i => i.is_received).length;
      loan.total_received  = loan.return_installments.filter(i => i.is_received).reduce((s, i) => s + i.amount, 0);
    }
  }

  const institutions = db.prepare('SELECT * FROM payment_institutions WHERE user_id = ? ORDER BY name').all(userId);

  // Month-by-month loan flow metrics for the selected month
  const monthlyOutflow = db.prepare(`
    SELECT COALESCE(SUM(li.amount), 0) as total
    FROM loan_installments li
    JOIN loans l ON li.loan_id = l.id
    WHERE l.user_id = ?
      AND strftime('%Y', li.due_date) = ?
      AND strftime('%m', li.due_date) = ?
  `).get(userId, yearStr, monthStr).total;

  const monthlyInflow = db.prepare(`
    SELECT COALESCE(SUM(lri.amount), 0) as total
    FROM loan_return_installments lri
    JOIN loan_returns lr ON lri.loan_return_id = lr.id
    JOIN loans l ON lr.loan_id = l.id
    WHERE l.user_id = ?
      AND strftime('%Y', lri.due_date) = ?
      AND strftime('%m', lri.due_date) = ?
  `).get(userId, yearStr, monthStr).total;

  const monthlyNet = monthlyInflow - monthlyOutflow;

  const summary = {
    total_lent:     loans.reduce((s, l) => s + l.principal_amount, 0),
    total_received: loans.reduce((s, l) => s + (l.total_received || 0), 0),
    active_count:   loans.filter(l => l.status === 'active').length,
    settled_count:  loans.filter(l => l.status === 'settled').length,
    monthly_outflow: monthlyOutflow,
    monthly_inflow: monthlyInflow,
    monthly_net: monthlyNet
  };

  const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  res.render('loans/index', {
    title: 'Empréstimos — TxTrace',
    loans, institutions, summary, year, month, MONTH_NAMES
  });
});

// ─── New Form ────────────────────────────────────────────────────────────────

router.get('/new', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const institutions = db.prepare('SELECT * FROM payment_institutions WHERE user_id = ? ORDER BY name').all(userId);
  const today = new Date().toISOString().split('T')[0];

  res.render('loans/form', {
    title: 'Novo Empréstimo — TxTrace',
    loan: null, institutions, today, error: null
  });
});

// ─── Edit Form ───────────────────────────────────────────────────────────────

router.get('/:id/edit', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;

  const loan = db.prepare(`
    SELECT l.*,
      lr.id as return_id, lr.total_return_amount, lr.total_installments as return_total_installments,
      lr.first_installment_date as return_first_installment_date, lr.notes as return_notes
    FROM loans l
    LEFT JOIN loan_returns lr ON lr.loan_id = l.id
    WHERE l.id = ? AND l.user_id = ?
  `).get(req.params.id, userId);

  if (!loan) return res.redirect('/loans');

  const institutions = db.prepare('SELECT * FROM payment_institutions WHERE user_id = ? ORDER BY name').all(userId);
  const today = new Date().toISOString().split('T')[0];

  res.render('loans/form', {
    title: 'Editar Empréstimo — TxTrace',
    loan, institutions, today, error: null
  });
});

// ─── Create ──────────────────────────────────────────────────────────────────

router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const today = new Date().toISOString().split('T')[0];

  const {
    borrower_name, principal_amount, loan_date, payment_source,
    institution_id, total_installments, first_installment_date, notes,
    total_return_amount, return_total_installments, return_first_installment_date, return_notes
  } = req.body;

  try {
    const amount = parseFloat(principal_amount);
    if (isNaN(amount) || amount <= 0) throw new Error('Valor inválido.');

    const installments  = Math.max(1, parseInt(total_installments) || 1);
    const firstDate     = parseDateSafe(first_installment_date || loan_date || today);
    const installAmt    = amount / installments;

    const loanResult = db.prepare(`
      INSERT INTO loans (user_id, borrower_name, principal_amount, loan_date, payment_source, institution_id, total_installments, first_installment_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, borrower_name.trim(), amount, loan_date || today,
      payment_source, institution_id || null,
      installments, firstDate, notes || null
    );

    const loanId = loanResult.lastInsertRowid;

    db.transaction(() => {
      // Loan installments
      const insertInst = db.prepare(`
        INSERT INTO loan_installments (loan_id, installment_number, due_date, amount)
        VALUES (?, ?, ?, ?)
      `);
      for (let i = 0; i < installments; i++) {
        insertInst.run(loanId, i + 1, addMonths(firstDate, i), installAmt);
      }

      // Return configuration
      const retAmount = parseFloat(total_return_amount || 0);
      if (retAmount > 0) {
        const retInstallments = Math.max(1, parseInt(return_total_installments) || 1);
        const retFirstDate    = parseDateSafe(return_first_installment_date || firstDate);
        const retInstallAmt   = retAmount / retInstallments;

        const retResult = db.prepare(`
          INSERT INTO loan_returns (loan_id, total_return_amount, total_installments, first_installment_date, notes)
          VALUES (?, ?, ?, ?, ?)
        `).run(loanId, retAmount, retInstallments, retFirstDate, return_notes || null);

        const retId = retResult.lastInsertRowid;
        const insertRetInst = db.prepare(`
          INSERT INTO loan_return_installments (loan_return_id, installment_number, due_date, amount)
          VALUES (?, ?, ?, ?)
        `);
        for (let i = 0; i < retInstallments; i++) {
          insertRetInst.run(retId, i + 1, addMonths(retFirstDate, i), retInstallAmt);
        }
      }
    })();

    res.redirect('/loans');
  } catch (err) {
    console.error('Create loan error:', err);
    const institutions = db.prepare('SELECT * FROM payment_institutions WHERE user_id = ? ORDER BY name').all(userId);
    res.render('loans/form', {
      title: 'Novo Empréstimo — TxTrace',
      loan: req.body, institutions, today: today, error: err.message
    });
  }
});

// ─── Update ──────────────────────────────────────────────────────────────────

router.post('/:id/update', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const loanId = req.params.id;
  const today = new Date().toISOString().split('T')[0];

  const {
    borrower_name, principal_amount, loan_date, payment_source,
    institution_id, total_installments, first_installment_date, notes,
    total_return_amount, return_total_installments, return_first_installment_date, return_notes
  } = req.body;

  try {
    const existingLoan = db.prepare('SELECT * FROM loans WHERE id = ? AND user_id = ?').get(loanId, userId);
    if (!existingLoan) return res.redirect('/loans');

    const amount = parseFloat(principal_amount);
    if (isNaN(amount) || amount <= 0) throw new Error('Valor inválido.');

    const installments = Math.max(1, parseInt(total_installments) || 1);
    const firstDate = parseDateSafe(first_installment_date || loan_date || today);
    const installAmt = amount / installments;

    // Read previous paid state of installments to preserve them
    const prevInstallments = db.prepare('SELECT installment_number, is_paid, paid_date FROM loan_installments WHERE loan_id = ?').all(loanId);
    const paidMap = new Map();
    prevInstallments.forEach(pi => paidMap.set(pi.installment_number, { is_paid: pi.is_paid, paid_date: pi.paid_date }));

    // Read previous return installments
    const existingReturn = db.prepare('SELECT id FROM loan_returns WHERE loan_id = ?').get(loanId);
    const receivedMap = new Map();
    if (existingReturn) {
      const prevReturnInsts = db.prepare('SELECT installment_number, is_received, received_date FROM loan_return_installments WHERE loan_return_id = ?').all(existingReturn.id);
      prevReturnInsts.forEach(pri => receivedMap.set(pri.installment_number, { is_received: pri.is_received, received_date: pri.received_date }));
    }

    db.transaction(() => {
      // 1. Update loan master
      db.prepare(`
        UPDATE loans SET
          borrower_name = ?, principal_amount = ?, loan_date = ?, payment_source = ?,
          institution_id = ?, total_installments = ?, first_installment_date = ?, notes = ?
        WHERE id = ? AND user_id = ?
      `).run(
        borrower_name.trim(), amount, loan_date || today,
        payment_source, institution_id || null,
        installments, firstDate, notes || null,
        loanId, userId
      );

      // 2. Re-create loan installments preserving paid marks
      db.prepare('DELETE FROM loan_installments WHERE loan_id = ?').run(loanId);
      const insertInst = db.prepare(`
        INSERT INTO loan_installments (loan_id, installment_number, due_date, amount, is_paid, paid_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (let i = 0; i < installments; i++) {
        const prev = paidMap.get(i + 1);
        insertInst.run(
          loanId, i + 1, addMonths(firstDate, i), installAmt,
          prev ? prev.is_paid : 0, prev ? prev.paid_date : null
        );
      }

      // 3. Update or recreate return structure
      const retAmount = parseFloat(total_return_amount || 0);
      if (retAmount > 0) {
        const retInstallments = Math.max(1, parseInt(return_total_installments) || 1);
        const retFirstDate = parseDateSafe(return_first_installment_date || firstDate);
        const retInstallAmt = retAmount / retInstallments;

        if (existingReturn) {
          db.prepare(`
            UPDATE loan_returns SET
              total_return_amount = ?, total_installments = ?, first_installment_date = ?, notes = ?
            WHERE id = ?
          `).run(retAmount, retInstallments, retFirstDate, return_notes || null, existingReturn.id);
          var retId = existingReturn.id;
          db.prepare('DELETE FROM loan_return_installments WHERE loan_return_id = ?').run(retId);
        } else {
          const retResult = db.prepare(`
            INSERT INTO loan_returns (loan_id, total_return_amount, total_installments, first_installment_date, notes)
            VALUES (?, ?, ?, ?, ?)
          `).run(loanId, retAmount, retInstallments, retFirstDate, return_notes || null);
          var retId = retResult.lastInsertRowid;
        }

        const insertRetInst = db.prepare(`
          INSERT INTO loan_return_installments (loan_return_id, installment_number, due_date, amount, is_received, received_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (let i = 0; i < retInstallments; i++) {
          const prevRec = receivedMap.get(i + 1);
          insertRetInst.run(
            retId, i + 1, addMonths(retFirstDate, i), retInstallAmt,
            prevRec ? prevRec.is_received : 0, prevRec ? prevRec.received_date : null
          );
        }
      } else if (existingReturn) {
        // If return amount cleared, delete return
        db.prepare('DELETE FROM loan_returns WHERE id = ?').run(existingReturn.id);
      }
    })();

    res.redirect('/loans');
  } catch (err) {
    console.error('Update loan error:', err);
    const institutions = db.prepare('SELECT * FROM payment_institutions WHERE user_id = ? ORDER BY name').all(userId);
    res.render('loans/form', {
      title: 'Editar Empréstimo — TxTrace',
      loan: { ...req.body, id: loanId },
      institutions, today: today, error: err.message
    });
  }
});

// ─── Mark Loan Installment Paid/Unpaid ───────────────────────────────────────

router.post('/:loanId/installments/:instId/toggle', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { paid_date } = req.body;

  const loan = db.prepare('SELECT id FROM loans WHERE id = ? AND user_id = ?').get(req.params.loanId, userId);
  if (!loan) return res.redirect('/loans');

  const inst = db.prepare('SELECT * FROM loan_installments WHERE id = ? AND loan_id = ?').get(req.params.instId, req.params.loanId);
  if (!inst) return res.redirect('/loans');

  const newPaid = inst.is_paid ? 0 : 1;
  db.prepare('UPDATE loan_installments SET is_paid = ?, paid_date = ? WHERE id = ?').run(
    newPaid,
    newPaid ? (paid_date || new Date().toISOString().split('T')[0]) : null,
    req.params.instId
  );

  res.redirect('/loans');
});

// ─── Mark Return Installment Received ────────────────────────────────────────

router.post('/:loanId/return/installments/:instId/toggle', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { received_date } = req.body;

  const loan = db.prepare('SELECT id FROM loans WHERE id = ? AND user_id = ?').get(req.params.loanId, userId);
  if (!loan) return res.redirect('/loans');

  const loanReturn = db.prepare('SELECT id FROM loan_returns WHERE loan_id = ?').get(req.params.loanId);
  if (!loanReturn) return res.redirect('/loans');

  const inst = db.prepare(
    'SELECT * FROM loan_return_installments WHERE id = ? AND loan_return_id = ?'
  ).get(req.params.instId, loanReturn.id);
  if (!inst) return res.redirect('/loans');

  const newReceived = inst.is_received ? 0 : 1;
  db.prepare('UPDATE loan_return_installments SET is_received = ?, received_date = ? WHERE id = ?').run(
    newReceived,
    newReceived ? (received_date || new Date().toISOString().split('T')[0]) : null,
    req.params.instId
  );

  res.redirect('/loans');
});

// ─── Settle Loan ─────────────────────────────────────────────────────────────

router.post('/:loanId/settle', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  db.prepare("UPDATE loans SET status = 'settled' WHERE id = ? AND user_id = ?").run(req.params.loanId, userId);
  res.redirect('/loans');
});

// ─── Reopen Loan ─────────────────────────────────────────────────────────────

router.post('/:loanId/reopen', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  db.prepare("UPDATE loans SET status = 'active' WHERE id = ? AND user_id = ?").run(req.params.loanId, userId);
  res.redirect('/loans');
});

// ─── Delete ──────────────────────────────────────────────────────────────────

router.post('/:loanId/delete', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  db.prepare('DELETE FROM loans WHERE id = ? AND user_id = ?').run(req.params.loanId, userId);
  res.redirect('/loans');
});

module.exports = router;
