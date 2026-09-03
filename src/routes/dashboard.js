const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generates recurring transaction instances for a given month ONLY when the current date
 * has actually reached the recurrence day of that target month (or for past months).
 * This ensures future months and unreached days are not prematurely debited from limits or balances.
 */
function generateRecurringInstances(userId, year, month) {
  const db = getDb();
  const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
  const now = new Date();
  const currentY = now.getFullYear();
  const currentM = now.getMonth() + 1;
  const currentD = now.getDate();
  const currentMonthStr = `${currentY}-${String(currentM).padStart(2, '0')}`;

  // If the target month is in the future relative to the real current date, do not pre-generate
  if (targetMonth > currentMonthStr) {
    return;
  }

  const originals = db.prepare(`
    SELECT * FROM transactions
    WHERE user_id = ?
      AND is_recurring = 1
      AND recurrence_parent_id IS NULL
      AND (recurrence_cancelled_at IS NULL OR recurrence_cancelled_at > ?)
  `).all(userId, `${targetMonth}-01`);

  for (const orig of originals) {
    const origMonth = orig.transaction_date.substring(0, 7);
    // Don't generate for the same month the original was created or earlier
    if (origMonth >= targetMonth) continue;

    const recDay = parseInt(orig.recurrence_day || orig.transaction_date.substring(8, 10));

    // If target month is current month, only generate if current date has reached the recurrence day
    if (targetMonth === currentMonthStr && currentD < recDay) {
      continue;
    }

    const existing = db.prepare(`
      SELECT id FROM transactions
      WHERE recurrence_parent_id = ?
        AND strftime('%Y-%m', transaction_date) = ?
    `).get(orig.id, targetMonth);

    if (!existing) {
      const day = String(recDay).padStart(2, '0');
      const newDate = `${targetMonth}-${day}`;
      db.prepare(`
        INSERT INTO transactions
          (user_id, type, description, amount, category_id, payment_method,
           institution_id, transaction_date, is_paid, is_recurring,
           recurrence_day, recurrence_parent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
      `).run(
        orig.user_id, orig.type, orig.description, orig.amount,
        orig.category_id, orig.payment_method, orig.institution_id,
        newDate, recDay, orig.id
      );
    }
  }
}

// ─── Dashboard Route ─────────────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const now = new Date();
  const year = parseInt(req.query.year || now.getFullYear());
  const month = parseInt(req.query.month || (now.getMonth() + 1));
  const institutionId = req.query.institution_id || null;
  const viewMode = req.query.view_mode || 'transactions'; // 'transactions', 'all' (consolidado), 'loans'

  generateRecurringInstances(userId, year, month);

  const monthStr = String(month).padStart(2, '0');
  const yearStr = String(year);

  // 1. Transactions summary for month
  const txSummaryParams = [userId, yearStr, monthStr];
  let txSummaryWhere = `
    WHERE user_id = ?
      AND strftime('%Y', transaction_date) = ?
      AND strftime('%m', transaction_date) = ?
  `;
  if (institutionId) {
    txSummaryWhere += ' AND institution_id = ?';
    txSummaryParams.push(institutionId);
  }

  const txSummary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expenses
    FROM transactions ${txSummaryWhere}
  `).get(...txSummaryParams);

  // 2. Loans monthly flow (returns received = income; loan principal installments paid = expense)
  const loanInflowParams = [userId, yearStr, monthStr];
  let loanInflowWhere = `
    WHERE l.user_id = ?
      AND strftime('%Y', lri.due_date) = ?
      AND strftime('%m', lri.due_date) = ?
  `;
  if (institutionId) {
    loanInflowWhere += ' AND l.institution_id = ?';
    loanInflowParams.push(institutionId);
  }

  const loanInflow = db.prepare(`
    SELECT COALESCE(SUM(lri.amount), 0) as total
    FROM loan_return_installments lri
    JOIN loan_returns lr ON lri.loan_return_id = lr.id
    JOIN loans l ON lr.loan_id = l.id
    ${loanInflowWhere}
  `).get(...loanInflowParams).total;

  const loanOutflowParams = [userId, yearStr, monthStr];
  let loanOutflowWhere = `
    WHERE l.user_id = ?
      AND strftime('%Y', li.due_date) = ?
      AND strftime('%m', li.due_date) = ?
  `;
  if (institutionId) {
    loanOutflowWhere += ' AND l.institution_id = ?';
    loanOutflowParams.push(institutionId);
  }

  const loanOutflow = db.prepare(`
    SELECT COALESCE(SUM(li.amount), 0) as total
    FROM loan_installments li
    JOIN loans l ON li.loan_id = l.id
    ${loanOutflowWhere}
  `).get(...loanOutflowParams).total;

  // Compute final summary according to selected viewMode
  let summary = { income: 0, expenses: 0, balance: 0 };
  if (viewMode === 'all') {
    summary.income = txSummary.income + loanInflow;
    summary.expenses = txSummary.expenses + loanOutflow;
  } else if (viewMode === 'loans') {
    summary.income = loanInflow;
    summary.expenses = loanOutflow;
  } else {
    // Default: 'transactions'
    summary.income = txSummary.income;
    summary.expenses = txSummary.expenses;
  }
  summary.balance = summary.income - summary.expenses;

  // Breakdown sub-values for display in view
  summary.txIncome = txSummary.income;
  summary.txExpenses = txSummary.expenses;
  summary.loanInflow = loanInflow;
  summary.loanOutflow = loanOutflow;

  // 3. Expenses by category this month (only relevant for transactions)
  const byCategory = db.prepare(`
    SELECT
      COALESCE(c.name, 'Sem categoria') as name,
      COALESCE(c.icon, '📦') as icon,
      COALESCE(c.color, '#94a3b8') as color,
      COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = ?
      AND t.type = 'expense'
      AND strftime('%Y', t.transaction_date) = ?
      AND strftime('%m', t.transaction_date) = ?
    GROUP BY t.category_id
    ORDER BY total DESC
    LIMIT 8
  `).all(userId, yearStr, monthStr);

  // If viewMode includes loans, add an "Empréstimos Concedidos" category slice if there was outflow
  if ((viewMode === 'all' || viewMode === 'loans') && loanOutflow > 0) {
    byCategory.unshift({
      name: 'Empréstimos (Saídas)',
      icon: '🤝',
      color: '#ef4444',
      total: loanOutflow
    });
  }

  // 4. Last 6 months data for chart
  const chartData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');

    // Tx row
    const txRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expenses
      FROM transactions
      WHERE user_id = ?
        AND strftime('%Y', transaction_date) = ?
        AND strftime('%m', transaction_date) = ?
        ${institutionId ? 'AND institution_id = ?' : ''}
    `).get(...(institutionId ? [userId, String(y), m, institutionId] : [userId, String(y), m]));

    // Loan monthly values
    const lIn = db.prepare(`
      SELECT COALESCE(SUM(lri.amount), 0) as total
      FROM loan_return_installments lri
      JOIN loan_returns lr ON lri.loan_return_id = lr.id
      JOIN loans l ON lr.loan_id = l.id
      WHERE l.user_id = ?
        AND strftime('%Y', lri.due_date) = ?
        AND strftime('%m', lri.due_date) = ?
        ${institutionId ? 'AND l.institution_id = ?' : ''}
    `).get(...(institutionId ? [userId, String(y), m, institutionId] : [userId, String(y), m])).total;

    const lOut = db.prepare(`
      SELECT COALESCE(SUM(li.amount), 0) as total
      FROM loan_installments li
      JOIN loans l ON li.loan_id = l.id
      WHERE l.user_id = ?
        AND strftime('%Y', li.due_date) = ?
        AND strftime('%m', li.due_date) = ?
        ${institutionId ? 'AND l.institution_id = ?' : ''}
    `).get(...(institutionId ? [userId, String(y), m, institutionId] : [userId, String(y), m])).total;

    let chartInc = 0;
    let chartExp = 0;

    if (viewMode === 'all') {
      chartInc = (txRow?.income || 0) + lIn;
      chartExp = (txRow?.expenses || 0) + lOut;
    } else if (viewMode === 'loans') {
      chartInc = lIn;
      chartExp = lOut;
    } else {
      chartInc = txRow?.income || 0;
      chartExp = txRow?.expenses || 0;
    }

    chartData.push({
      label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      income: chartInc,
      expenses: chartExp
    });
  }

  // 5. Credit card summaries with limit tracking
  const cardSummaries = db.prepare(`
    SELECT
      pi.id, pi.name, pi.color, pi.credit_limit, pi.type,
      COALESCE(
        (SELECT SUM(t.amount)
         FROM transactions t
         WHERE t.institution_id = pi.id
           AND t.user_id = pi.user_id
           AND t.payment_method = 'credit'
           AND t.type = 'expense'
           AND t.is_paid = 0),
        0
      ) as used_limit
    FROM payment_institutions pi
    WHERE pi.user_id = ? AND pi.type = 'credit_card'
    ORDER BY pi.name
  `).all(userId);

  // 6. Recent transactions (last 10)
  const recentTransactions = db.prepare(`
    SELECT t.*,
      COALESCE(c.name, 'Sem categoria') as category_name,
      COALESCE(c.icon, '📦') as category_icon,
      COALESCE(c.color, '#94a3b8') as category_color,
      pi.name as institution_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN payment_institutions pi ON t.institution_id = pi.id
    WHERE t.user_id = ?
    ORDER BY t.transaction_date DESC, t.created_at DESC
    LIMIT 10
  `).all(userId);

  const institutions = db.prepare('SELECT * FROM payment_institutions WHERE user_id = ? ORDER BY name').all(userId);

  const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  res.render('dashboard', {
    title: 'Dashboard — TxTrace',
    summary, byCategory, chartData, cardSummaries,
    recentTransactions, institutions, year, month,
    institutionId, viewMode, MONTH_NAMES
  });
});

// ─── API endpoint for dynamic chart reloading ────────────────────────────────

router.get('/api/chart', requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.session.userId;
  const { period = '6months', year, month, institution_id, view_mode = 'transactions' } = req.query;

  const now = new Date();
  const y = parseInt(year || now.getFullYear());
  const m = parseInt(month || (now.getMonth() + 1));

  const periodsMap = { '2months': 2, '3months': 3, '6months': 6, '12months': 12 };
  const count = periodsMap[period] || 6;

  const dataPoints = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const dy = d.getFullYear();
    const dm = String(d.getMonth() + 1).padStart(2, '0');

    // Tx row
    const txRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expenses
      FROM transactions
      WHERE user_id = ?
        AND strftime('%Y', transaction_date) = ?
        AND strftime('%m', transaction_date) = ?
        ${institution_id ? 'AND institution_id = ?' : ''}
    `).get(...(institution_id ? [userId, String(dy), dm, institution_id] : [userId, String(dy), dm]));

    // Loans
    const lIn = db.prepare(`
      SELECT COALESCE(SUM(lri.amount), 0) as total
      FROM loan_return_installments lri
      JOIN loan_returns lr ON lri.loan_return_id = lr.id
      JOIN loans l ON lr.loan_id = l.id
      WHERE l.user_id = ?
        AND strftime('%Y', lri.due_date) = ?
        AND strftime('%m', lri.due_date) = ?
        ${institution_id ? 'AND l.institution_id = ?' : ''}
    `).get(...(institution_id ? [userId, String(dy), dm, institution_id] : [userId, String(dy), dm])).total;

    const lOut = db.prepare(`
      SELECT COALESCE(SUM(li.amount), 0) as total
      FROM loan_installments li
      JOIN loans l ON li.loan_id = l.id
      WHERE l.user_id = ?
        AND strftime('%Y', li.due_date) = ?
        AND strftime('%m', li.due_date) = ?
        ${institution_id ? 'AND l.institution_id = ?' : ''}
    `).get(...(institution_id ? [userId, String(dy), dm, institution_id] : [userId, String(dy), dm])).total;

    let chartInc = 0;
    let chartExp = 0;

    if (view_mode === 'all') {
      chartInc = (txRow?.income || 0) + lIn;
      chartExp = (txRow?.expenses || 0) + lOut;
    } else if (view_mode === 'loans') {
      chartInc = lIn;
      chartExp = lOut;
    } else {
      chartInc = txRow?.income || 0;
      chartExp = txRow?.expenses || 0;
    }

    dataPoints.push({
      label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      income: chartInc,
      expenses: chartExp,
      balance: chartInc - chartExp
    });
  }

  res.json(dataPoints);
});

module.exports = router;
module.exports.generateRecurringInstances = generateRecurringInstances;
