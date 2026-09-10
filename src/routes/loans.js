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
  const direction = req.query.direction || 'all'; // 'all', 'given', 'received'
  const yearStr = String(year);
  const monthStr = String(month).padStart(2, '0');

  const allLoans = db.prepare(`
    SELECT l.*,
      pi.name as institution_name, pi.type as institution_type, pi.color as institution_color,
      parent.name as parent_institution_name,
      lr.id as return_id, lr.total_return_amount, lr.total_installments as return_total_installments,
      lr.first_installment_date as return_first_date, lr.notes as return_notes,
      lir.id as interest_return_id, lir.total_amount as interest_total_amount,
      lir.total_installments as interest_total_installments, lir.first_installment_date as interest_first_date,
      lir.notes as interest_notes
    FROM loans l
    LEFT JOIN payment_institutions pi ON l.institution_id = pi.id
    LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
    LEFT JOIN loan_returns lr ON lr.loan_id = l.id
    LEFT JOIN loan_interest_returns lir ON lir.loan_id = l.id
    WHERE l.user_id = ?
    ORDER BY l.status ASC, l.created_at DESC
  `).all(userId);

  for (const loan of allLoans) {
    loan.installments = db.prepare(
      'SELECT * FROM loan_installments WHERE loan_id = ? ORDER BY installment_number'
    ).all(loan.id);

    loan.paid_count = loan.installments.filter(i => i.is_paid).length;
    loan.total_paid = loan.installments.filter(i => i.is_paid).reduce((s, i) => s + i.amount, 0);

    if (loan.return_id) {
      loan.return_installments = db.prepare(
        'SELECT * FROM loan_return_installments WHERE loan_return_id = ? ORDER BY installment_number'
      ).all(loan.return_id);
      loan.received_count = loan.return_installments.filter(i => i.is_received).length;
      loan.total_received = loan.return_installments.filter(i => i.is_received).reduce((s, i) => s + i.amount, 0);
    }

    if (loan.interest_return_id) {
      loan.interest_return_installments = db.prepare(
        'SELECT * FROM loan_interest_return_installments WHERE loan_interest_return_id = ? ORDER BY installment_number'
      ).all(loan.interest_return_id);
      loan.interest_received_count = loan.interest_return_installments.filter(i => i.is_received).length;
      loan.interest_total_received = loan.interest_return_installments.filter(i => i.is_received).reduce((s, i) => s + i.amount, 0);
    }
  }

  // Filter loans for display based on direction
  const loans = direction === 'all'
    ? allLoans
    : allLoans.filter(l => (l.loan_direction || 'given') === direction);

  const institutions = db.prepare(`
    SELECT pi.*, parent.name AS parent_name
    FROM payment_institutions pi
    LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
    WHERE pi.user_id = ?
    ORDER BY pi.name
  `).all(userId);

  // Month-by-month loan flow metrics for the selected month
  const monthlyOutflow = db.prepare(`
    SELECT COALESCE(SUM(li.amount), 0) as total
    FROM loan_installments li
    JOIN loans l ON li.loan_id = l.id
    WHERE l.user_id = ?
      AND strftime('%Y', li.due_date) = ?
      AND strftime('%m', li.due_date) = ?
  `).get(userId, yearStr, monthStr).total;

  const monthlyReturnInflow = db.prepare(`
    SELECT COALESCE(SUM(lri.amount), 0) as total
    FROM loan_return_installments lri
    JOIN loan_returns lr ON lri.loan_return_id = lr.id
    JOIN loans l ON lr.loan_id = l.id
    WHERE l.user_id = ?
      AND strftime('%Y', lri.due_date) = ?
      AND strftime('%m', lri.due_date) = ?
  `).get(userId, yearStr, monthStr).total;

  const monthlyInterestInflow = db.prepare(`
    SELECT COALESCE(SUM(liri.amount), 0) as total
    FROM loan_interest_return_installments liri
    JOIN loan_interest_returns lir ON liri.loan_interest_return_id = lir.id
    JOIN loans l ON lir.loan_id = l.id
    WHERE l.user_id = ?
      AND strftime('%Y', liri.due_date) = ?
      AND strftime('%m', liri.due_date) = ?
  `).get(userId, yearStr, monthStr).total;

  const monthlyBorrowedInflow = db.prepare(`
    SELECT COALESCE(SUM(l.principal_amount), 0) as total
    FROM loans l
    WHERE l.user_id = ?
      AND l.loan_direction = 'received'
      AND strftime('%Y', l.loan_date) = ?
      AND strftime('%m', l.loan_date) = ?
  `).get(userId, yearStr, monthStr).total;

  const monthlyInflow = monthlyReturnInflow + monthlyInterestInflow + monthlyBorrowedInflow;
  const monthlyNet = monthlyInflow - monthlyOutflow;

  const givenLoans = allLoans.filter(l => (l.loan_direction || 'given') === 'given');
  const receivedLoans = allLoans.filter(l => l.loan_direction === 'received');

  // Total amount expected to be returned (principal returns + parallel interest returns)
  const totalReceivable = givenLoans.reduce((s, l) => s + (l.total_return_amount || 0) + (l.interest_total_amount || 0), 0);
  // Total already received so far
  const totalReceived = givenLoans.reduce((s, l) => s + (l.total_received || 0) + (l.interest_total_received || 0), 0);
  // Total pending to be received
  const totalPendingToReceive = Math.max(0, totalReceivable - totalReceived);

  const summary = {
    total_lent:               givenLoans.reduce((s, l) => s + l.principal_amount, 0),
    total_received:           totalReceived,
    total_receivable:         totalReceivable,
    total_pending_to_receive: totalPendingToReceive,
    total_borrowed:           receivedLoans.reduce((s, l) => s + l.principal_amount, 0),
    total_repaid:             receivedLoans.reduce((s, l) => s + (l.total_paid || 0), 0),
    active_count:             allLoans.filter(l => l.status === 'active').length,
    settled_count:            allLoans.filter(l => l.status === 'settled').length,
    monthly_outflow:          monthlyOutflow,
    monthly_inflow:           monthlyInflow,
    monthly_net:              monthlyNet
  };

  // Years with actual loan data (loans and their installments/returns)
  const loanYears     = db.prepare("SELECT DISTINCT CAST(strftime('%Y', loan_date) AS INTEGER) as y FROM loans WHERE user_id = ? AND loan_date IS NOT NULL AND length(loan_date) >= 4 ORDER BY y DESC").all(userId).map(r => r.y);
  const loanInstYears = db.prepare("SELECT DISTINCT CAST(strftime('%Y', li.due_date) AS INTEGER) as y FROM loan_installments li JOIN loans l ON li.loan_id = l.id WHERE l.user_id = ? AND li.due_date IS NOT NULL ORDER BY y DESC").all(userId).map(r => r.y);
  const loanRetYears  = db.prepare("SELECT DISTINCT CAST(strftime('%Y', lri.due_date) AS INTEGER) as y FROM loan_return_installments lri JOIN loan_returns lr ON lri.loan_return_id = lr.id JOIN loans l ON lr.loan_id = l.id WHERE l.user_id = ? AND lri.due_date IS NOT NULL ORDER BY y DESC").all(userId).map(r => r.y);
  const currentYear = new Date().getFullYear();
  const availableYears = [...new Set([currentYear, ...loanYears, ...loanInstYears, ...loanRetYears])]
    .filter(y => Number.isInteger(y) && y >= 2000 && y <= 2100)
    .sort((a, b) => b - a);

  const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  res.render('loans/index', {
    title: 'Empréstimos — TxTrace',
    loans, institutions, summary, year, month, direction, MONTH_NAMES, availableYears, currentYear
  });

});

// ─── New Form ────────────────────────────────────────────────────────────────

router.get('/new', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const institutions = db.prepare(`
    SELECT pi.*, parent.name AS parent_name
    FROM payment_institutions pi
    LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
    WHERE pi.user_id = ?
    ORDER BY pi.name
  `).all(userId);
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
      lr.first_installment_date as return_first_installment_date, lr.notes as return_notes,
      lir.id as interest_return_id, lir.total_amount as interest_total_amount,
      lir.total_installments as interest_total_installments, lir.first_installment_date as interest_first_date,
      lir.notes as interest_notes
    FROM loans l
    LEFT JOIN loan_returns lr ON lr.loan_id = l.id
    LEFT JOIN loan_interest_returns lir ON lir.loan_id = l.id
    WHERE l.id = ? AND l.user_id = ?
  `).get(req.params.id, userId);

  if (!loan) return res.redirect('/loans');

  const institutions = db.prepare(`
    SELECT pi.*, parent.name AS parent_name
    FROM payment_institutions pi
    LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
    WHERE pi.user_id = ?
    ORDER BY pi.name
  `).all(userId);
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
    loan_direction = 'given',
    borrower_name, creditor_name, principal_amount, loan_date, payment_source,
    institution_id, total_installments, first_installment_date, notes,
    interest_rate, interest_rate_type, total_with_interest,
    total_return_amount, return_total_installments, return_first_installment_date, return_notes,
    has_interest_return, interest_return_amount, interest_return_installments, interest_first_installment_date, interest_return_notes
  } = req.body;

  try {
    const amount = parseFloat(principal_amount);
    if (isNaN(amount) || amount <= 0) throw new Error('Valor inválido.');

    const isReceived = loan_direction === 'received';
    const installments = Math.max(1, parseInt(total_installments) || 1);
    const firstDate = parseDateSafe(first_installment_date || loan_date || today);

    db.transaction(() => {
      if (isReceived) {
        const cName = (creditor_name || '').trim();
        if (!cName) throw new Error('Nome da instituição/credor é obrigatório.');
        const bName = `Empréstimo ${cName}`;
        const rate = interest_rate ? parseFloat(interest_rate) : null;
        const rateType = interest_rate_type || 'monthly';
        const totalPayable = total_with_interest ? parseFloat(total_with_interest) : amount;
        const installAmt = totalPayable / installments;

        const loanResult = db.prepare(`
          INSERT INTO loans
            (user_id, borrower_name, creditor_name, loan_direction, principal_amount,
             total_with_interest, interest_rate, interest_rate_type, loan_date,
             payment_source, institution_id, total_installments, first_installment_date, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId, bName, cName, 'received', amount,
          totalPayable, rate, rateType, loan_date || today,
          'bank_account', institution_id ? parseInt(institution_id) : null,
          installments, firstDate, notes || null
        );

        const loanId = loanResult.lastInsertRowid;

        const insertInst = db.prepare(`
          INSERT INTO loan_installments (loan_id, installment_number, due_date, amount)
          VALUES (?, ?, ?, ?)
        `);
        for (let i = 0; i < installments; i++) {
          insertInst.run(loanId, i + 1, addMonths(firstDate, i), installAmt);
        }

      } else {
        // Given loan
        const bName = (borrower_name || '').trim();
        if (!bName) throw new Error('Nome de quem recebeu o empréstimo é obrigatório.');
        const installAmt = amount / installments;

        const loanResult = db.prepare(`
          INSERT INTO loans
            (user_id, borrower_name, loan_direction, principal_amount, loan_date,
             payment_source, institution_id, total_installments, first_installment_date, notes)
          VALUES (?, ?, 'given', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId, bName, amount, loan_date || today,
          payment_source || 'bank_account', institution_id ? parseInt(institution_id) : null,
          installments, firstDate, notes || null
        );

        const loanId = loanResult.lastInsertRowid;

        const insertInst = db.prepare(`
          INSERT INTO loan_installments (loan_id, installment_number, due_date, amount)
          VALUES (?, ?, ?, ?)
        `);
        for (let i = 0; i < installments; i++) {
          insertInst.run(loanId, i + 1, addMonths(firstDate, i), installAmt);
        }

        // Return configuration (Principal)
        const retAmount = parseFloat(total_return_amount || 0);
        if (retAmount > 0) {
          const retInstallments = Math.max(1, parseInt(return_total_installments) || 1);
          const retFirstDate = parseDateSafe(return_first_installment_date || firstDate);
          const retInstallAmt = retAmount / retInstallments;

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

        // Parallel interest return (Double return)
        if (has_interest_return === '1' || has_interest_return === 'on') {
          const intAmount = parseFloat(interest_return_amount || 0);
          if (intAmount > 0) {
            const intInstallments = Math.max(1, parseInt(interest_return_installments) || 1);
            const intFirstDate = parseDateSafe(interest_first_installment_date || firstDate);
            const intInstallAmt = intAmount / intInstallments;

            const intResult = db.prepare(`
              INSERT INTO loan_interest_returns (loan_id, total_amount, total_installments, first_installment_date, notes)
              VALUES (?, ?, ?, ?, ?)
            `).run(loanId, intAmount, intInstallments, intFirstDate, interest_return_notes || null);

            const intId = intResult.lastInsertRowid;
            const insertIntInst = db.prepare(`
              INSERT INTO loan_interest_return_installments (loan_interest_return_id, installment_number, due_date, amount)
              VALUES (?, ?, ?, ?)
            `);
            for (let i = 0; i < intInstallments; i++) {
              insertIntInst.run(intId, i + 1, addMonths(intFirstDate, i), intInstallAmt);
            }
          }
        }
      }
    })();

    res.redirect('/loans');
  } catch (err) {
    console.error('Create loan error:', err);
    const institutions = db.prepare(`
      SELECT pi.*, parent.name AS parent_name
      FROM payment_institutions pi
      LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
      WHERE pi.user_id = ?
      ORDER BY pi.name
    `).all(userId);
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
    loan_direction = 'given',
    borrower_name, creditor_name, principal_amount, loan_date, payment_source,
    institution_id, total_installments, first_installment_date, notes,
    interest_rate, interest_rate_type, total_with_interest,
    total_return_amount, return_total_installments, return_first_installment_date, return_notes,
    has_interest_return, interest_return_amount, interest_return_installments, interest_first_installment_date, interest_return_notes
  } = req.body;

  try {
    const existingLoan = db.prepare('SELECT * FROM loans WHERE id = ? AND user_id = ?').get(loanId, userId);
    if (!existingLoan) return res.redirect('/loans');

    const amount = parseFloat(principal_amount);
    if (isNaN(amount) || amount <= 0) throw new Error('Valor inválido.');

    const isReceived = loan_direction === 'received';
    const installments = Math.max(1, parseInt(total_installments) || 1);
    const firstDate = parseDateSafe(first_installment_date || loan_date || today);

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

    // Read previous interest return installments
    const existingInterestReturn = db.prepare('SELECT id FROM loan_interest_returns WHERE loan_id = ?').get(loanId);
    const interestReceivedMap = new Map();
    if (existingInterestReturn) {
      const prevIntInsts = db.prepare('SELECT installment_number, is_received, received_date FROM loan_interest_return_installments WHERE loan_interest_return_id = ?').all(existingInterestReturn.id);
      prevIntInsts.forEach(pii => interestReceivedMap.set(pii.installment_number, { is_received: pii.is_received, received_date: pii.received_date }));
    }

    db.transaction(() => {
      if (isReceived) {
        const cName = (creditor_name || '').trim();
        if (!cName) throw new Error('Nome da instituição/credor é obrigatório.');
        const bName = `Empréstimo ${cName}`;
        const rate = interest_rate ? parseFloat(interest_rate) : null;
        const rateType = interest_rate_type || 'monthly';
        const totalPayable = total_with_interest ? parseFloat(total_with_interest) : amount;
        const installAmt = totalPayable / installments;

        db.prepare(`
          UPDATE loans SET
            borrower_name = ?, creditor_name = ?, loan_direction = 'received',
            principal_amount = ?, total_with_interest = ?, interest_rate = ?, interest_rate_type = ?,
            loan_date = ?, payment_source = 'bank_account', institution_id = ?,
            total_installments = ?, first_installment_date = ?, notes = ?
          WHERE id = ? AND user_id = ?
        `).run(
          bName, cName, amount, totalPayable, rate, rateType,
          loan_date || today, institution_id ? parseInt(institution_id) : null,
          installments, firstDate, notes || null,
          loanId, userId
        );

        // Recreate installments preserving paid marks
        db.prepare('DELETE FROM loan_installments WHERE loan_id = ?').run(loanId);
        const insertInst = db.prepare(`
          INSERT INTO loan_installments (loan_id, installment_number, due_date, amount, is_paid, paid_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (let i = 0; i < installments; i++) {
          const prev = paidMap.get(i + 1);
          insertInst.run(loanId, i + 1, addMonths(firstDate, i), installAmt, prev ? prev.is_paid : 0, prev ? prev.paid_date : null);
        }

        // Clean up returns if any existed from previously being a given loan
        if (existingReturn) db.prepare('DELETE FROM loan_returns WHERE id = ?').run(existingReturn.id);
        if (existingInterestReturn) db.prepare('DELETE FROM loan_interest_returns WHERE id = ?').run(existingInterestReturn.id);

      } else {
        // Given loan update
        const bName = (borrower_name || '').trim();
        if (!bName) throw new Error('Nome de quem recebeu o empréstimo é obrigatório.');
        const installAmt = amount / installments;

        db.prepare(`
          UPDATE loans SET
            borrower_name = ?, creditor_name = NULL, loan_direction = 'given',
            principal_amount = ?, total_with_interest = NULL, interest_rate = NULL, interest_rate_type = NULL,
            loan_date = ?, payment_source = ?, institution_id = ?,
            total_installments = ?, first_installment_date = ?, notes = ?
          WHERE id = ? AND user_id = ?
        `).run(
          bName, amount, loan_date || today,
          payment_source || 'bank_account', institution_id ? parseInt(institution_id) : null,
          installments, firstDate, notes || null,
          loanId, userId
        );

        // Recreate installments preserving paid marks
        db.prepare('DELETE FROM loan_installments WHERE loan_id = ?').run(loanId);
        const insertInst = db.prepare(`
          INSERT INTO loan_installments (loan_id, installment_number, due_date, amount, is_paid, paid_date)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (let i = 0; i < installments; i++) {
          const prev = paidMap.get(i + 1);
          insertInst.run(loanId, i + 1, addMonths(firstDate, i), installAmt, prev ? prev.is_paid : 0, prev ? prev.paid_date : null);
        }

        // Return configuration (Principal)
        const retAmount = parseFloat(total_return_amount || 0);
        if (retAmount > 0) {
          const retInstallments = Math.max(1, parseInt(return_total_installments) || 1);
          const retFirstDate = parseDateSafe(return_first_installment_date || firstDate);
          const retInstallAmt = retAmount / retInstallments;

          let retId;
          if (existingReturn) {
            db.prepare(`
              UPDATE loan_returns SET
                total_return_amount = ?, total_installments = ?, first_installment_date = ?, notes = ?
              WHERE id = ?
            `).run(retAmount, retInstallments, retFirstDate, return_notes || null, existingReturn.id);
            retId = existingReturn.id;
            db.prepare('DELETE FROM loan_return_installments WHERE loan_return_id = ?').run(retId);
          } else {
            const retResult = db.prepare(`
              INSERT INTO loan_returns (loan_id, total_return_amount, total_installments, first_installment_date, notes)
              VALUES (?, ?, ?, ?, ?)
            `).run(loanId, retAmount, retInstallments, retFirstDate, return_notes || null);
            retId = retResult.lastInsertRowid;
          }

          const insertRetInst = db.prepare(`
            INSERT INTO loan_return_installments (loan_return_id, installment_number, due_date, amount, is_received, received_date)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (let i = 0; i < retInstallments; i++) {
            const prevRec = receivedMap.get(i + 1);
            insertRetInst.run(retId, i + 1, addMonths(retFirstDate, i), retInstallAmt, prevRec ? prevRec.is_received : 0, prevRec ? prevRec.received_date : null);
          }
        } else if (existingReturn) {
          db.prepare('DELETE FROM loan_returns WHERE id = ?').run(existingReturn.id);
        }

        // Parallel interest return (Double return)
        const intAmount = parseFloat(interest_return_amount || 0);
        if ((has_interest_return === '1' || has_interest_return === 'on') && intAmount > 0) {
          const intInstallments = Math.max(1, parseInt(interest_return_installments) || 1);
          const intFirstDate = parseDateSafe(interest_first_installment_date || firstDate);
          const intInstallAmt = intAmount / intInstallments;

          let intId;
          if (existingInterestReturn) {
            db.prepare(`
              UPDATE loan_interest_returns SET
                total_amount = ?, total_installments = ?, first_installment_date = ?, notes = ?
              WHERE id = ?
            `).run(intAmount, intInstallments, intFirstDate, interest_return_notes || null, existingInterestReturn.id);
            intId = existingInterestReturn.id;
            db.prepare('DELETE FROM loan_interest_return_installments WHERE loan_interest_return_id = ?').run(intId);
          } else {
            const intResult = db.prepare(`
              INSERT INTO loan_interest_returns (loan_id, total_amount, total_installments, first_installment_date, notes)
              VALUES (?, ?, ?, ?, ?)
            `).run(loanId, intAmount, intInstallments, intFirstDate, interest_return_notes || null);
            intId = intResult.lastInsertRowid;
          }

          const insertIntInst = db.prepare(`
            INSERT INTO loan_interest_return_installments (loan_interest_return_id, installment_number, due_date, amount, is_received, received_date)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          for (let i = 0; i < intInstallments; i++) {
            const prevRec = interestReceivedMap.get(i + 1);
            insertIntInst.run(intId, i + 1, addMonths(intFirstDate, i), intInstallAmt, prevRec ? prevRec.is_received : 0, prevRec ? prevRec.received_date : null);
          }
        } else if (existingInterestReturn) {
          db.prepare('DELETE FROM loan_interest_returns WHERE id = ?').run(existingInterestReturn.id);
        }
      }
    })();

    res.redirect('/loans');
  } catch (err) {
    console.error('Update loan error:', err);
    const institutions = db.prepare(`
      SELECT pi.*, parent.name AS parent_name
      FROM payment_institutions pi
      LEFT JOIN payment_institutions parent ON pi.parent_institution_id = parent.id
      WHERE pi.user_id = ?
      ORDER BY pi.name
    `).all(userId);
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

// ─── Mark Interest Return Installment Received ───────────────────────────────

router.post('/:loanId/interest-return/installments/:instId/toggle', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { received_date } = req.body;

  const loan = db.prepare('SELECT id FROM loans WHERE id = ? AND user_id = ?').get(req.params.loanId, userId);
  if (!loan) return res.redirect('/loans');

  const interestReturn = db.prepare('SELECT id FROM loan_interest_returns WHERE loan_id = ?').get(req.params.loanId);
  if (!interestReturn) return res.redirect('/loans');

  const inst = db.prepare(
    'SELECT * FROM loan_interest_return_installments WHERE id = ? AND loan_interest_return_id = ?'
  ).get(req.params.instId, interestReturn.id);
  if (!inst) return res.redirect('/loans');

  const newReceived = inst.is_received ? 0 : 1;
  db.prepare('UPDATE loan_interest_return_installments SET is_received = ?, received_date = ? WHERE id = ?').run(
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
