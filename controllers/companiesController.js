// controllers/companiesController.js
const pool = require('../config/db');

exports.getUserCompanies = async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const query = `
      SELECT c.company_id, c.company_name 
      FROM user_companies uc
      JOIN companies c ON uc.company_id = c.company_id
      WHERE uc.user_email = $1
    `;
    const result = await pool.query(query, [email]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching companies:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
