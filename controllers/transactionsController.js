// controllers/transactionsController.js
const pool = require('../config/db');
const { convertDate } = require('../utils/helpers');
const { v4: uuidv4 } = require('uuid');

exports.uploadExcel = async (req, res) => {
  try {
    const { email, company, bankAccount, data, fileName } = req.body;
    if (!email || !company || !bankAccount || !data) {
      return res.status(400).json({ error: 'Missing email, company, bankAccount, or data' });
    }
    // Generate a unique upload ID for this upload
    const uploadId = uuidv4();

    // Insert each row from the uploaded data
    for (const row of data) {
      const convertedDateStr = convertDate(row.transaction_date);
      const jsDate = convertedDateStr ? new Date(convertedDateStr) : null;
      await pool.query(
        `INSERT INTO temporary_transactions
          (upload_id, email, company, bank_account, transaction_date, transaction_type, description, amount, assigned_ledger)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
         [
           uploadId,
           email,
           company,
           bankAccount,
           jsDate,
           row.transaction_type || null,
           row.description,
           row.amount,
           row.assignedLedger || ''
         ]
      );
    }

    // Insert a record into user_temp_tables for tracking
    await pool.query(
      `INSERT INTO user_temp_tables (email, company, temp_table, uploaded_file)
       VALUES ($1, $2, $3, $4)`,
       [email, company, uploadId, fileName]
    );

    // (Optional) Get the count of inserted rows
    const rowsInserted = await pool.query(
      `SELECT COUNT(*) FROM temporary_transactions WHERE upload_id = $1`,
      [uploadId]
    );
    console.log(`Now have ${rowsInserted.rows[0].count} total rows for upload ${uploadId}`);

    res.json({
      message: 'Excel/PDF data stored/updated with a unique upload id',
      table: uploadId,
    });
  } catch (err) {
    console.error('Error in uploadExcel:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteTransaction = async (req, res) => {
  try {
    const { tempTable, transactionId } = req.body;
    if (!tempTable || !transactionId) {
      return res.status(400).json({ error: 'Missing tempTable or transactionId' });
    }
    await pool.query(
      `DELETE FROM temporary_transactions WHERE upload_id = $1 AND id = $2`,
      [tempTable, transactionId]
    );
    res.json({ message: 'Transaction deleted successfully' });
  } catch (err) {
    console.error('Error in deleteTransaction:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getAllTempTables = async (req, res) => {
  try {
    const { email, company } = req.query;
    if (!email || !company) {
      return res.status(400).json({ error: 'Missing email or company' });
    }
    const result = await pool.query(
      `SELECT id, email, company, temp_table, uploaded_file, created_at
       FROM user_temp_tables
       WHERE email = $1 AND company = $2
       ORDER BY created_at DESC`,
      [email, company]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching temp table info:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getTempTable = async (req, res) => {
  try {
    const { email, company } = req.query;
    if (!email || !company) {
      return res.status(400).json({ error: 'Missing email or company' });
    }
    const result = await pool.query(
      `SELECT temp_table, uploaded_file
       FROM user_temp_tables
       WHERE email = $1 AND company = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [email, company]
    );
    if (result.rows.length === 0) {
      return res.json({});
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching temp table info:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.updateTempExcel = async (req, res) => {
  try {
    const { tempTable, data } = req.body;
    if (!tempTable || !data) {
      return res.status(400).json({ error: 'Missing tempTable or data' });
    }
    // Remove all existing rows for this upload id
    await pool.query(`DELETE FROM temporary_transactions WHERE upload_id = $1`, [tempTable]);

    // Insert updated rows
    for (const row of data) {
      const convertedDateStr = convertDate(row.transaction_date);
      const jsDate = convertedDateStr ? new Date(convertedDateStr) : null;
      await pool.query(
        `INSERT INTO temporary_transactions
         (upload_id, transaction_date, transaction_type, description, amount, assigned_ledger)
         VALUES ($1, $2, $3, $4, $5, $6)`,
         [
           tempTable,
           jsDate,
           row.transaction_type || '',
           row.description || '',
           row.amount || 0,
           row.assignedLedger || ''
         ]
      );
    }
    console.log(`updateTempExcel: replaced rows for upload ${tempTable}`);
    res.json({ message: 'Updated rows for the upload', table: tempTable });
  } catch (err) {
    console.error('Error in updateTempExcel:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getTempLedgers = async (req, res) => {
  try {
    const { tempTable } = req.query;
    if (!tempTable) {
      return res.status(400).json({ error: 'tempTable is required' });
    }
    const result = await pool.query(
      `SELECT * FROM temporary_transactions WHERE upload_id = $1`,
      [tempTable]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error in getTempLedgers:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
