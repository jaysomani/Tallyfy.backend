// controllers/JournelController.js
const pool = require('../config/db');

exports.uploadJournal = async (req, res) => { 
  try {
    const { email, company, data, withItems, uploadedFileName } = req.body;
    if (!email || !company || !data) {
      return res.status(400).json({ error: 'Missing data' });
    }
    
    // Create a unique safe table name for the journal upload.
    // Added extra column "status" with default value 'pending'
    const safeTable = `journal_temp_${email.toLowerCase().replace(/[@.]/g, '_')}_${Date.now()}`;
    const columns = withItems ? `
      journal_no INTEGER, reference_no INTEGER, date DATE, cost_center TEXT, particulars TEXT,
      name_of_item TEXT, quantity NUMERIC, rate NUMERIC, dr_cr TEXT, amount NUMERIC,
      ledger_narration TEXT, narration TEXT, status TEXT DEFAULT 'pending'
    ` : `
      journal_no INTEGER, reference_no INTEGER, date DATE, cost_center TEXT, particulars TEXT,
      dr_cr TEXT, amount NUMERIC, ledger_narration TEXT, narration TEXT, status TEXT DEFAULT 'pending'
    `;
    
    // Create the temporary table with the extra "status" column.
    await pool.query(`CREATE TABLE ${safeTable} (id SERIAL PRIMARY KEY, ${columns});`);
    
    // Fetch valid ledger descriptions for the company.
    const ledgerRes = await pool.query('SELECT description FROM ledgers WHERE company_id = $1', [company]);
    const ledgerNames = ledgerRes.rows.map(r => r.description.toLowerCase().trim());
    const invalidLedgers = new Set();
    const referenceMap = {}; // Map: Reference No => { journal_no, date }
    
    // Process each row from the provided data.
    for (const [index, row] of data.entries()) {
      const requiredFields = withItems
        ? ["Reference No", "Date", "Particulars", "Name Of Item", "Quantity", "Rate", "Dr/Cr", "Amount"]
        : ["Reference No", "Date", "Particulars", "Dr/Cr", "Amount"];

      for (const field of requiredFields) {
        if (!row[field]) {
          return res.status(400).json({ error: `Missing field "${field}" in row ${index + 1}` });
        }
      }
      
      // --------------------- Date Parsing Section ---------------------
      const rawDate = row["Date"];
      let formattedDate = null;

      try {
        if (typeof rawDate === "string") {
          const trimmedDate = rawDate.trim();

          // 1) If already in ISO format
          if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
            formattedDate = trimmedDate;
          }

          // 2) If in DD-MM-YYYY or DD/MM/YYYY
          else if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(trimmedDate)) {
            const parts = trimmedDate.split(/[-/]/); // supports both - and /
            const [dd, mm, yyyy] = parts;

            if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12) {
              throw new Error(`Invalid day or month in date: "${trimmedDate}"`);
            }

            formattedDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
          }

          // 3) If in DDMMYYYY (8-digit without separator)
          else if (/^\d{8}$/.test(trimmedDate)) {
            const dd = trimmedDate.slice(0, 2);
            const mm = trimmedDate.slice(2, 4);
            const yyyy = trimmedDate.slice(4, 8);

            if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12) {
              throw new Error(`Invalid day or month in date: "${trimmedDate}"`);
            }

            formattedDate = `${yyyy}-${mm}-${dd}`;
          }

          // 4) Default to MM-DD-YY or MM/DD/YY
          else if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(trimmedDate)) {
            let [mm, dd, yyyy] = trimmedDate.split(/[\/-]/);

            if (yyyy.length === 2) {
              yyyy = '20' + yyyy; // default to 2000+ for 2-digit years
            }

            if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12) {
              throw new Error(`Invalid day or month in date: "${trimmedDate}"`);
            }

            formattedDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
          }

          else {
            throw new Error(`Unsupported or unrecognized date format: "${trimmedDate}"`);
          }
        }

        // 5) Excel serial date
        else if (typeof rawDate === "number") {
          const jsDate = new Date((rawDate - 25569) * 86400 * 1000);
          formattedDate = jsDate.toISOString().split("T")[0]; // convert to YYYY-MM-DD
        }

        else {
          throw new Error(`Invalid type for date: ${typeof rawDate}`);
        }
      } catch (e) {
        console.error("Invalid date format:", rawDate, e.message);
        return res.status(400).json({ error: `Invalid date "${rawDate}" in row ${index + 1}` });
      }


      // --------------------- End Date Parsing Section ---------------------

      const refNo = row["Reference No"];
      let journalNo = row["Journal No"];
      if (!referenceMap[refNo]) {
        referenceMap[refNo] = {
          journal_no: journalNo,
          date: formattedDate
        };
      } else {
        journalNo = referenceMap[refNo].journal_no;
      }
      
      // Validate ledger name.
      const ledgerName = row["Particulars"]?.toLowerCase().trim();
      if (!ledgerNames.includes(ledgerName)) {
        invalidLedgers.add(row["Particulars"]);
      }
      
      // Prepare values for insertion.
      // Note: Status is not supplied by Excel—it will be left as default "pending" unless later updated.
      const values = withItems ? [
        journalNo, refNo, referenceMap[refNo].date, row["Cost center"] || null, row["Particulars"],
        row["Name Of Item"], row["Quantity"], row["Rate"], row["Dr/Cr"], row["Amount"],
        row["Ledger Narration"] || null, row["Narration"] || null
      ] : [
        journalNo, refNo, referenceMap[refNo].date, row["Cost center"] || null, row["Particulars"],
        row["Dr/Cr"], row["Amount"], row["Ledger Narration"] || null, row["Narration"] || null
      ];

      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const insertColumns = withItems
        ? `(journal_no, reference_no, date, cost_center, particulars, name_of_item, quantity, rate, dr_cr, amount, ledger_narration, narration)`
        : `(journal_no, reference_no, date, cost_center, particulars, dr_cr, amount, ledger_narration, narration)`;

      await pool.query(`INSERT INTO ${safeTable} ${insertColumns} VALUES (${placeholders})`, values);
    }
    
    // Insert a record to track this journal upload.
    await pool.query(`
      INSERT INTO user_journal_temp_tables (email, company, temp_table, uploaded_file)
      VALUES ($1, $2, $3, $4)
    `, [email, company, safeTable, uploadedFileName || safeTable]);

    res.json({
      message: "Journal uploaded and stored temporarily",
      table: safeTable,
      invalidLedgers: Array.from(invalidLedgers)
    });
  } catch (err) {
    console.error('Error uploading journal:', err);
    res.status(500).json({ error: err.message || 'Database error' });
  }
};

// Helper function: Convert JS Date object to "YYYY-MM-DD"
function formatDateToISO(jsDate) {
  const yyyy = jsDate.getFullYear();
  const mm = String(jsDate.getMonth() + 1).padStart(2, '0');
  const dd = String(jsDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

exports.getJournalData = async (req, res) => {
  try {
    const { tempTable } = req.query;
    if (!tempTable) {
      return res.status(400).json({ error: 'Temp table name required' });
    }

    const query = `
      SELECT
        id,
        journal_no,
        reference_no,
        to_char(date, 'YYYY-MM-DD') AS date,
        cost_center,
        particulars,
        dr_cr,
        amount,
        ledger_narration,
        narration,
        status
      FROM ${tempTable}
      ORDER BY id ASC
    `;
    const result = await pool.query(query);
    console.log("✅ Fetched data from DB:", result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching journal data:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
};

exports.updateJournalRow = async (req, res) => {
  console.log("✅ /api/updateJournalRow hit!");

  try {
    const { tempTable, updatedRow } = req.body;
    const rowId = req.body.creation_id;
    const email = req.query.email || req.body.email;
    const company = req.query.company || req.body.company;

    console.log("🧾 Received Payload:", {
      tempTable,
      rowId,
      email,
      company,
      updatedRow
    });

    if (!tempTable || !rowId || !updatedRow || !email || !company) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        details: { tempTable, rowId, email, company } 
      });
    }

    // When saving, ensure that updatedRow includes status "saved".
    // (Frontend should include updatedRow.status = "saved", but if not, we force it here.)
    if (!updatedRow.status) {
      updatedRow.status = "saved";
    }

    const currentRowQuery = `SELECT * FROM ${tempTable} WHERE id = $1`;
    const currentRow = await pool.query(currentRowQuery, [rowId]);

    if (currentRow.rowCount === 0) {
      return res.status(404).json({ error: 'Row not found' });
    }

    const previousValues = currentRow.rows[0];
    const keys = Object.keys(updatedRow);
    const setClause = keys.map((key, i) => `"${key}" = $${i + 1}`).join(', ');
    const values = keys.map(k => updatedRow[k]);
    values.push(rowId);

    const updateQuery = `
      UPDATE ${tempTable}
      SET ${setClause}
      WHERE id = $${values.length}
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Row not found during update' });
    }

    console.log("✅ Row updated successfully in DB");

    const updatedFields = {};
    const previousFieldValues = {};
    keys.forEach(key => {
      if (updatedRow[key] !== previousValues[key]) {
        updatedFields[key] = updatedRow[key];
        previousFieldValues[key] = previousValues[key];
      }
    });

    if (Object.keys(updatedFields).length > 0) {
      const logQuery = `
        INSERT INTO journal_updates_log 
        (temp_table, row_id, user_email, company_id, updated_fields, previous_values, reference_no, journal_no)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      await pool.query(logQuery, [
        tempTable,
        rowId,
        email,
        company,
        JSON.stringify(updatedFields),
        JSON.stringify(previousFieldValues),
        updatedRow.reference_no || previousValues.reference_no,
        updatedRow.journal_no || previousValues.journal_no
      ]);

      console.log("📝 Logged update to journal_updates_log");
    } else {
      console.log("ℹ️ No changes detected — nothing logged.");
    }

    res.json({ 
      message: 'Row updated successfully',
      updatedFields: updatedFields
    });

  } catch (err) {
    console.error('❌ Error in /api/updateJournalRow:', err);
    res.status(500).json({ error: 'Update failed', details: err.message });
  }
};

exports.getJournalUpdateHistory = async (req, res) => {
  try {
    const { email, company, tempTable } = req.query;
    
    if (!email || !company) {
      return res.status(400).json({ error: 'Missing email or company' });
    }

    let query = `
      SELECT * FROM journal_updates_log 
      WHERE user_email = $1 AND company_id = $2
    `;
    const params = [email, company];

    if (tempTable) {
      query += ` AND temp_table = $3`;
      params.push(tempTable);
    }

    query += ` ORDER BY updated_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting update history:', err);
    res.status(500).json({ error: 'Failed to fetch update history' });
  }
};

exports.getUserJournelUploads = async (req, res) => {
  try {
    const { email, company } = req.query;
    if (!email || !company) {
      return res.status(400).json({ error: 'Missing email or company' });
    }
    const result = await pool.query(`
      SELECT id, temp_table, uploaded_file, created_at
      FROM user_journal_temp_tables
      WHERE email = $1 AND company = $2
      ORDER BY created_at DESC
    `, [email, company]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting uploads:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteJournelUpload = async (req, res) => {
  try {
    const { table } = req.body;
    if (!table) {
      return res.status(400).json({ error: 'Table name required' });
    }
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.query(`DELETE FROM user_journal_temp_tables WHERE temp_table = $1`, [table]);
    res.json({ message: 'Upload deleted successfully' });
  } catch (err) {
    console.error('Error deleting upload:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteJournalRow = async (req, res) => {
  try {
    const { tempTable, rowId } = req.body;
    
    if (!tempTable || !rowId) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        details: { tempTable, rowId } 
      });
    }

    console.log(`🗑️ Attempting to delete row ID ${rowId} from table ${tempTable}`);

    // First check if the row exists
    const checkQuery = `SELECT id FROM ${tempTable} WHERE id = $1`;
    const checkResult = await pool.query(checkQuery, [rowId]);
    
    if (checkResult.rowCount === 0) {
      return res.status(404).json({ error: 'Row not found' });
    }

    // Delete the row
    const deleteQuery = `DELETE FROM ${tempTable} WHERE id = $1`;
    await pool.query(deleteQuery, [rowId]);

    // Record the deletion in history table for audit purposes
    // Only add this if the history table exists - comment out if causing errors
    /* 
    await pool.query(`
      INSERT INTO journal_update_history 
      (temp_table, row_id, action, timestamp) 
      VALUES ($1, $2, 'delete', CURRENT_TIMESTAMP)
    `, [tempTable, rowId]);
    */

    console.log(`✅ Successfully deleted row ID ${rowId} from table ${tempTable}`);
    
    res.json({ 
      success: true, 
      message: `Row ${rowId} deleted successfully` 
    });
  } catch (err) {
    console.error('❌ Error deleting journal row:', err);
    res.status(500).json({ 
      error: 'Database error', 
      details: err.message 
    });
  }
};
