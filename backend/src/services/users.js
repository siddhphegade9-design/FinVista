'use strict';
/** User persistence. All SQL is parameterised. Password hashes never leave this layer except via findByEmail/findAuthById. */
const db = require('../db/pool');
const defaultCategories = require('../config/defaultCategories');
const { conflict } = require('../utils/httpError');

const { DEFAULT_CURRENCY, isSupported } = require('../config/currencies');

const toPublic = (row) => ({ id: row.id, email: row.email, fullName: row.full_name, currency: row.currency, createdAt: row.created_at });

/** Creates the user and their default categories atomically. Throws 409 if the email is taken. */
async function createUser({ email, fullName, passwordHash, currency = DEFAULT_CURRENCY }) {
  try {
    return await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO users (email, full_name, password_hash, currency) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, currency, created_at',
        [email, fullName, passwordHash, currency],
      );
      const user = rows[0];
      const names = [...defaultCategories.expense, ...defaultCategories.income];
      const kinds = [...defaultCategories.expense.map(() => 'expense'), ...defaultCategories.income.map(() => 'income')];
      await client.query(
        'INSERT INTO categories (user_id, name, kind) SELECT $1, n, k FROM unnest($2::text[], $3::text[]) AS t(n, k)',
        [user.id, names, kinds],
      );
      return toPublic(user);
    });
  } catch (err) {
    if (err.code === '23505') throw conflict('An account with this email already exists.');
    throw err;
  }
}

/** For login: includes the password hash. */
async function findByEmail(email) {
  const { rows } = await db.query('SELECT id, email, full_name, currency, created_at, password_hash FROM users WHERE lower(email) = $1', [email]);
  return rows[0] ? { ...toPublic(rows[0]), passwordHash: rows[0].password_hash } : null;
}

async function findAuthById(id) {
  const { rows } = await db.query('SELECT id, email, full_name, currency, created_at, password_hash FROM users WHERE id = $1', [id]);
  return rows[0] ? { ...toPublic(rows[0]), passwordHash: rows[0].password_hash } : null;
}

async function updateName(id, fullName) {
  const { rows } = await db.query('UPDATE users SET full_name = $2 WHERE id = $1 RETURNING id, email, full_name, currency, created_at', [id, fullName]);
  return rows[0] ? toPublic(rows[0]) : null;
}

async function updateCurrency(id, currency) {
  const { rows } = await db.query('UPDATE users SET currency = $2 WHERE id = $1 RETURNING id, email, full_name, currency, created_at', [id, currency]);
  return rows[0] ? toPublic(rows[0]) : null;
}

/** The user's currency code (INR if the user is not found). Used by services that word or scale things per currency. */
async function getCurrency(id) {
  const { rows } = await db.query('SELECT currency FROM users WHERE id = $1', [id]);
  return rows[0] && isSupported(rows[0].currency) ? rows[0].currency : DEFAULT_CURRENCY;
}

const updatePasswordHash = (id, passwordHash) => db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);

/** Deletes the user; ON DELETE CASCADE removes their categories, transactions, budgets and sessions. */
const deleteUser = (id) => db.query('DELETE FROM users WHERE id = $1', [id]);

module.exports = { createUser, findByEmail, findAuthById, updateName, updateCurrency, getCurrency, updatePasswordHash, deleteUser };
