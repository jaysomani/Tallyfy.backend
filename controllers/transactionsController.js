// controllers/transactionsController.js
const pool = require('../config/db');
const { convertDate } = require('../utils/helpers');
const { v4: uuidv4 } = require('uuid');

/**
 * Creates a new, empty temp table and returns its name
 */
exports.createTempTable = async (req, res) => {
  try {
    const { email, company, fileName, bankAccount } = req.body;
    if (!email || !company) {
      return res.status(400).json({ error: "email and company required" });
    }
    if (!bankAccount) {
      return res.status(400).json({ error: "bankAccount required" });
    }

    // Build a safe, unique table name
    const uploadId  = uuidv4().replace(/-/g, "_");
    const tableName = `temp_txn_${uploadId}`;

    // CREATE TABLE with all parsed‑PDF fields
    const createSql = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id                SERIAL    PRIMARY KEY,
        upload_id         TEXT      NOT NULL,
        email             TEXT      NOT NULL,
        company           TEXT      NOT NULL,
        bank_account      TEXT      NOT NULL DEFAULT '${bankAccount}',
        transaction_date  DATE,
        description       TEXT,
        ledger            TEXT,
        withdrawal        NUMERIC,
        deposit           NUMERIC,
        balance           TEXT,
        balance_num       NUMERIC,
        prev_balance      NUMERIC,
        expected_balance  NUMERIC,
        page              INTEGER,
        entirechunk       TEXT,
        transaction_type  TEXT,
        amount            NUMERIC,
        balance_match     BOOLEAN,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(createSql);

    // Record in lookup table
    await pool.query(
      `INSERT INTO user_temp_tables
         (email, company, temp_table, uploaded_file)
       VALUES ($1, $2, $3, $4)`,
      [email, company, tableName, fileName || null]
    );

    // Return the new table name
    res.json({ status: "success", table: tableName });
  } catch (err) {
    console.error("Error creating temp table:", err);
    res.status(500).json({ error: "Could not create temp table" });
  }
};



// Add this to your transactionsController.js file
exports.executeSql = async (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql) {
      return res.status(400).json({ error: "Missing SQL statement" });
    }
    
    // Very simple validation to prevent obvious SQL injection
    if (sql.toLowerCase().includes('drop') || sql.toLowerCase().includes('delete from')) {
      return res.status(403).json({ error: "Potentially harmful SQL not allowed" });
    }
    
    // Execute the SQL
    await pool.query(sql);
    
    res.json({ status: 'success', message: 'SQL executed successfully' });
  } catch (err) {
    console.error('Error executing SQL:', err);
    res.status(500).json({ error: 'Database error' });
  }
};


exports.insertParsedReceipts = async (req, res) => {
  try {
    const { temp_table: tableName, receipts, email, company, upload_id } = req.body;

    // Validate inputs
    if (!tableName || !Array.isArray(receipts)) {
      return res.status(400).json({ error: "Missing temp_table or receipts array" });
    }
    // Sanitize table name
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      return res.status(400).json({ error: "Invalid table name" });
    }

    // Use tableName as uploadId if not provided
    const actualUploadId = upload_id || tableName;
    const userEmail = email || '';
    const userCompany = company || '';

    // Columns must match the schema created by createTempTable
    const cols = [
      'upload_id', 'email', 'company', // Add the required fields
      'transaction_date','description','withdrawal','deposit',
      'balance','balance_num','prev_balance','expected_balance',
      'page','entirechunk','transaction_type','amount','balance_match'
    ];
    const rowCount = receipts.length;
    const colCount = cols.length;

    // Build placeholders: ($1,…,$16), ($17,…,$32), …
    const valuesSql = receipts.map((_, i) => {
      const offset = i * colCount;
      const placeholders = cols.map((_, j) => `$${offset + j + 1}`);
      return `(${placeholders.join(', ')})`;
    }).join(',\n');

    // Flatten values in the correct column order
    const flatValues = receipts.flatMap(r => [
      actualUploadId, // Required upload_id
      userEmail,      // Required email
      userCompany,    // Required company
      r.date ? new Date(r.date.split('/').reverse().join('-')) : null,
      r.description || null,
      parseFloat(r.withdrawal) || 0,
      parseFloat(r.deposit) || 0,
      r.balance      || null,
      parseFloat(r.balance_num)       || 0,
      parseFloat(r.prev_balance)      || 0,
      parseFloat(r.expected_balance)  || 0,
      r.page         || null,
      r.entirechunk  || null,
      r.type         || null,
      parseFloat(r.amount)    || 0,
      Boolean(r.balance_match)
    ]);

    const sql = `
      INSERT INTO ${tableName} (${cols.join(', ')})
      VALUES
        ${valuesSql};
    `;

    // Execute bulk insert
    await pool.query(sql, flatValues);

    res.json({ status: 'success', inserted: rowCount });
  } catch (err) {
    console.error('Error in insertParsedReceipts:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

// Add this function to your transactionsController.js
exports.alterTempTable = async (req, res) => {
  try {
    const { temp_table, columns } = req.body;
    if (!temp_table || !columns || !Array.isArray(columns)) {
      return res.status(400).json({ error: 'Missing temp_table or columns' });
    }
    
    // Process each column update
    for (const col of columns) {
      try {
        // Check if column exists
        const checkResult = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = $1 AND column_name = $2
        `, [temp_table, col.name]);
        
        if (checkResult.rows.length === 0) {
          // Add column if it doesn't exist
          await pool.query(`ALTER TABLE ${temp_table} ADD COLUMN ${col.name} ${col.type}`);
        }
        
        // Set default value for all null values
        if (col.default !== undefined) {
          await pool.query(`
            UPDATE ${temp_table} 
            SET ${col.name} = $1 
            WHERE ${col.name} IS NULL
          `, [col.default]);
        }
      } catch (err) {
        console.warn(`Error altering column ${col.name}:`, err);
      }
    }
    
    res.json({ status: 'success', message: 'Table altered successfully' });
  } catch (err) {
    console.error('Error in alterTempTable:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

/**
 * Inserts Excel data into the shared temporary_transactions table
 */
exports.uploadExcel = async (req, res) => {
  try {
    const { email, company, bankAccount, data, fileName } = req.body;
    if (!email || !company || !bankAccount || !data) {
      return res.status(400).json({ error: 'Missing email, company, bankAccount, or data' });
    }
    const uploadId = uuidv4();

    for (const row of data) {
      const convertedDateStr = convertDate(row.transaction_date);
      const jsDate = convertedDateStr ? new Date(convertedDateStr) : null;
      await pool.query(
        `INSERT INTO temporary_transactions
          (upload_id, email, company, bank_account,
           transaction_date, transaction_type, description, amount, assigned_ledger)
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

    await pool.query(
      `INSERT INTO user_temp_tables (email, company, temp_table, uploaded_file)
       VALUES ($1, $2, $3, $4)`,
      [email, company, uploadId, fileName]
    );

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

/**
 * Deletes a single transaction row
 */
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

/**
 * Lists all temp tables for a user/company
 */
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
    const { email, company, temp_table } = req.query;

    // 1) All three params are mandatory
    if (!email || !company || !temp_table) {
      return res
        .status(400)
        .json({ error: 'Missing one or more required parameters: email, company, temp_table' });
    }

    // 2) Validate temp_table name
    if (!/^[A-Za-z0-9_]+$/.test(temp_table)) {
      return res
        .status(400)
        .json({ error: 'Invalid temp_table name' });
    }

    // 3) Verify ownership
    const meta = await pool.query(
      `SELECT 1
         FROM user_temp_tables
        WHERE email      = $1
          AND company    = $2
          AND temp_table = $3
        LIMIT 1`,
      [email, company, temp_table]
    );
    if (meta.rowCount === 0) {
      return res
        .status(404)
        .json({ error: 'Temp table not found for this user/company' });
    }

    // 4) Fetch only the requested columns
    const data = await pool.query(
      `SELECT id,
              transaction_date,
              description,
              ledger,
              transaction_type,
              amount
         FROM "${temp_table}"`
    );

    // 5) Return the rows
    return res.json({ rows: data.rows });
  } catch (err) {
    console.error('Error fetching temp table data:', err);
    return res
      .status(500)
      .json({ error: 'Database error' });
  }
};

/**
 * Replaces all rows in a temp table (for edits)
 */
exports.updateTempExcel = async (req, res) => {
  try {
    const { tempTable, data } = req.body;
    if (!tempTable || !data) {
      return res.status(400).json({ error: 'Missing tempTable or data' });
    }
    await pool.query(`DELETE FROM temporary_transactions WHERE upload_id = $1`, [tempTable]);

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
    res.json({ message: 'Updated rows for the upload', table: tempTable });
  } catch (err) {
    console.error('Error in updateTempExcel:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

/**
 * Fetches all rows from a temp table
 */
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


 exports.deleteTempTable = async (req, res) => {
   try {
     const { id, email, company } = req.body;
     
     if (!id || !email || !company) {
       return res.status(400).json({ error: 'Missing id, email, or company' });
     }
     
     // Get the temp_table value
     const tableResult = await pool.query(
       `SELECT temp_table FROM user_temp_tables WHERE id = $1 AND email = $2 AND company = $3`,
       [id, email, company]
     );
     
     if (tableResult.rows.length === 0) {
       return res.status(404).json({ error: 'Temporary table not found' });
     }
     
     const tempTable = tableResult.rows[0].temp_table;
     
     // Delete all related transactions first
     await pool.query(
       `DELETE FROM temporary_transactions WHERE upload_id = $1`,
       [tempTable]
     );
     
     // Then delete the entry from user_temp_tables
     await pool.query(
       `DELETE FROM user_temp_tables WHERE id = $1 AND email = $2 AND company = $3`,
       [id, email, company]
     );
     
     res.json({ message: 'Temporary table and related transactions deleted successfully' });
   } catch (err) {
     console.error('Error in deleteTempTable:', err);
     res.status(500).json({ error: 'Database error' });
   }
 };
