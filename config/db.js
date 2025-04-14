// config/db.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

// Initialize persistent tables on startup
const initDB = async () => {
  try {
    // Create temporary_transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS temporary_transactions (
        id SERIAL PRIMARY KEY,
        upload_id TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT NOT NULL,
        bank_account TEXT NOT NULL,
        transaction_date DATE,
        transaction_type TEXT CHECK (transaction_type IN ('payment', 'receipt', 'contra withdraw', 'contra deposit')),
        description TEXT NOT NULL,
        amount NUMERIC,
        assigned_ledger TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_temp_tables table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_temp_tables (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        company TEXT NOT NULL,
        temp_table TEXT NOT NULL,
        uploaded_file TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_journal_temp_tables table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_journal_temp_tables (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        company TEXT NOT NULL,
        temp_table TEXT NOT NULL,
        uploaded_file TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized.');
  } catch (error) {
    console.error('Error initializing database tables:', error);
  }
};

initDB();

module.exports = pool;
