// controllers/ledgerController.js
const pool = require('../config/db');

exports.getUserData = async (req, res) => {
  try {
    const company = req.query.company;
    if (!company) {
      return res.status(400).json({ error: 'Company is required' });
    }
    const sql = 'SELECT * FROM ledgers WHERE company_id = $1';
    const result = await pool.query(sql, [company]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching ledger data:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getBankNames = async (req, res) => {
  try {
    const company = req.query.company;
    if (!company) {
      return res.status(400).json({ error: 'Company is required' });
    }
    const sql = `
      SELECT DISTINCT l.description AS bank_name
      FROM ledgers l
      WHERE l.company_id = $1
        AND l.extra_data->>'PARENT' = 'Bank Accounts'
    `;
    const result = await pool.query(sql, [company]);
    res.json({ bank_names: result.rows.map(row => row.bank_name) });
  } catch (err) {
    console.error('Error fetching bank names:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
