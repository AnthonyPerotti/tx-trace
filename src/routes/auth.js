const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('auth/login', { title: 'Login — TxTrace', error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.render('auth/login', { title: 'Login — TxTrace', error: 'Email ou senha inválidos.' });
    }

    req.session.userId = user.id;
    req.session.user = { id: user.id, name: user.name, email: user.email };
    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { title: 'Login — TxTrace', error: 'Erro interno do servidor.' });
  }
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('auth/register', { title: 'Criar Conta — TxTrace', error: null });
});

router.post('/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (!name || !email || !password) {
    return res.render('auth/register', { title: 'Criar Conta — TxTrace', error: 'Preencha todos os campos.' });
  }

  if (password !== confirmPassword) {
    return res.render('auth/register', { title: 'Criar Conta — TxTrace', error: 'As senhas não coincidem.' });
  }

  if (password.length < 6) {
    return res.render('auth/register', { title: 'Criar Conta — TxTrace', error: 'Senha deve ter no mínimo 6 caracteres.' });
  }

  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.render('auth/register', { title: 'Criar Conta — TxTrace', error: 'Este email já está cadastrado.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hash);

    req.session.userId = result.lastInsertRowid;
    req.session.user = { id: result.lastInsertRowid, name, email };
    res.redirect('/');
  } catch (err) {
    console.error('Register error:', err);
    res.render('auth/register', { title: 'Criar Conta — TxTrace', error: 'Erro ao criar conta. Tente novamente.' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
