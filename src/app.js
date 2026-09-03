require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');

const authRoutes        = require('./routes/auth');
const dashboardRoutes   = require('./routes/dashboard');
const transactionRoutes = require('./routes/transactions');
const loanRoutes        = require('./routes/loans');
const settingsRoutes    = require('./routes/settings');

const app  = express();
const PORT = process.env.PORT || 3400;

// ─── View engine ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ─── Static ──────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── Body parsing ────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ─── Session ─────────────────────────────────────────────────────────────────
const DB_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, '../data');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: DB_DIR }),
  secret: process.env.SESSION_SECRET || 'tx-trace-secret-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

// ─── Locals ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.user        = req.session.user || null;
  res.locals.currentPath = req.path;
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/',             authRoutes);
app.use('/',             dashboardRoutes);
app.use('/transactions', transactionRoutes);
app.use('/loans',        loanRoutes);
app.use('/settings',     settingsRoutes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { title: '404 — TxTrace' });
});

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Erro interno: ' + err.message);
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TxTrace running → http://localhost:${PORT}`);
});
