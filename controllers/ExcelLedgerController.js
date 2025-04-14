// ✅ Enhanced uploadExcelLedger with duplicate file/data handling, merging, new file creation, and skipped Excel report
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

function emailToSafeString(email) {
  return email.replace(/[^a-zA-Z0-9]/g, '_');
}

function companyToSafeString(company) {
  return company.replace(/[^a-zA-Z0-9]/g, '_');
}

function rowsAreEqual(rowA, rowB) {
  const keysA = Object.keys(rowA);
  const keysB = Object.keys(rowB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => (rowA[k] || '').toString().trim() === (rowB[k] || '').toString().trim());
}

exports.uploadExcelLedger = async (req, res) => {
  try {
    const { email, company, data, uploadedFileName, action = "upload" } = req.body;
    if (!email || !company || !data || !uploadedFileName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

     // NEW: Handle check action separately
     if (action === "check") {
      const fileMatch = await pool.query(`
        SELECT * FROM user_ledger_temp_tables
        WHERE user_email = $1 AND company_id = $2 AND uploaded_file = $3
      `, [email, company, uploadedFileName]);

      if (fileMatch.rows.length > 0) {
        const existingTable = fileMatch.rows[0].temp_table;
        const existingRowsRes = await pool.query(`SELECT * FROM ${existingTable}`);
        const existingRows = existingRowsRes.rows;

        const sameData = data.length === existingRows.length && data.every(dr =>
          existingRows.some(er => rowsAreEqual(er, dr))
        );
        const uniqueNewRows = data.filter(newRow =>
          !existingRows.some(er => rowsAreEqual(er, newRow))
        );
        const duplicateRows = data.filter(newRow =>
          existingRows.some(er => rowsAreEqual(er, newRow))
        );

        return res.json({
          duplicate: true,
          identical: sameData,
          message: sameData
            ? "Same file with identical data already uploaded."
            : "Same file name, but data differs.",
          existingTable,
          uniqueNewRows,
          duplicateRows
        });
      } else {
        return res.json({ duplicate: false });
      }
    }

    const tempTableBase = `ledger_temp_${emailToSafeString(email)}_${companyToSafeString(company)}`;
    const tempTableName = `${tempTableBase}_${Date.now()}`;
    const skippedLedgers = [];

    const fileMatch = await pool.query(`
      SELECT * FROM user_ledger_temp_tables
      WHERE user_email = $1 AND company_id = $2 AND uploaded_file = $3
    `, [email, company, uploadedFileName]);

    if (fileMatch.rows.length > 0) {
      const existingTable = fileMatch.rows[0].temp_table;
      const existingRowsRes = await pool.query(`SELECT * FROM ${existingTable}`);
      const existingRows = existingRowsRes.rows;

      const sameData = data.length === existingRows.length && data.every(dr =>
        existingRows.some(er => rowsAreEqual(er, dr))
      );

      if (sameData) {
        return res.json({
          duplicate: true,
          identical: true,
          message: "Same file with identical data already uploaded.",
          existingTable
        });
      }

      const uniqueNewRows = data.filter(newRow =>
        !existingRows.some(er => rowsAreEqual(er, newRow))
      );

      const duplicateRows = data.filter(newRow =>
        existingRows.some(er => rowsAreEqual(er, newRow))
      );

      // if (action === "check") {
      //   return res.json({
      //     duplicate: true,
      //     identical: false,
      //     message: "Same file name, but data differs.",
      //     existingTable,
      //     uniqueNewRows,
      //     duplicateRows
      //   });
      // }

      if (action === "merge") {
        const insertSQL = `INSERT INTO ${existingTable} (name, parent, mailing_name) VALUES ($1, $2, $3)`;
        for (const row of uniqueNewRows) {
          await pool.query(insertSQL, [row.Name, row.Under, row["Mailing name"] || row.Name]);
        }

        return res.json({
          message: "Merged unique entries into existing file.",
          inserted: uniqueNewRows.length,
          table: existingTable
        });
      }

      if (action === "new") {
        const filteredRows = uniqueNewRows;
        const skipped = duplicateRows.map(r => ({ name: r.Name, reason: "Duplicate of existing entry" }));

        const newFileName = uploadedFileName.replace(/\.xlsx$/, '') + `(1).xlsx`;
        const newTempTable = `${tempTableBase}_${Date.now()}`;

        await pool.query(`
          CREATE TABLE ${newTempTable} (
            name TEXT,
            parent TEXT,
            mailing_name TEXT
          );
        `);
        const insertSQL = `INSERT INTO ${newTempTable} (name, parent, mailing_name) VALUES ($1, $2, $3)`;

        for (const row of filteredRows) {
          await pool.query(insertSQL, [row.Name, row.Under, row["Mailing name"] || row.Name]);
        }

        await pool.query(`
          INSERT INTO user_ledger_temp_tables (user_email, company_id, uploaded_file, temp_table)
          VALUES ($1, $2, $3, $4)
        `, [email, company, newFileName, newTempTable]);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Skipped Ledgers');
        sheet.columns = [
          { header: 'Ledger Name', key: 'name', width: 30 },
          { header: 'Reason Skipped', key: 'reason', width: 50 },
        ];
        sheet.addRows(skipped);

        // Ensure the logs directory exists
        const logsDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        const filePath = path.join(logsDir, `Skipped_Ledgers_${Date.now()}.xlsx`);
        await workbook.xlsx.writeFile(filePath);


        return res.json({
          message: "Created new file with only unique entries.",
          skipped: skipped.length,
          newFile: newFileName,
          newTable: newTempTable,
          skippedReport: filePath
        });
      }
      
    }

    // Step 1: Create a temporary ledger table
    const createTableSQL = `
      CREATE TABLE ${tempTableName} ( 
        creation_id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        parent TEXT NOT NULL,
        mailing_name TEXT,
        bill_by_bill TEXT,
        registration_type TEXT,
        type_of_ledger TEXT,
        inventory_affected TEXT,
        credit_period TEXT,
        gst_applicable TEXT,
        set_alter_gst_details TEXT,
        taxability TEXT,
        integrated_tax TEXT,
        cess_tax TEXT,
        applicable_date DATE,
        address TEXT,
        state TEXT,
        pincode TEXT,
        pan_it_no TEXT,
        gstin_uin TEXT,
        account_holder_name TEXT,
        alc_no TEXT,
        ifs_code TEXT,
        swift_code TEXT,
        bank_name TEXT,
        branch TEXT,
        type_of_duty_tax TEXT,
        percentage_of_calculation TEXT,
        hsn_sac TEXT,
        type_of_supply TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    // Additional button-specific dynamic fields (all nullable) from line 43 for button
    await pool.query(createTableSQL);

    const insertSQL = `
      INSERT INTO ${tempTableName} (
        name, parent, mailing_name, bill_by_bill, registration_type,
        type_of_ledger, inventory_affected, credit_period, gst_applicable,
        set_alter_gst_details, taxability, integrated_tax, cess_tax,
        applicable_date, address, state, pincode, pan_it_no, gstin_uin,
        account_holder_name, alc_no, ifs_code, swift_code, bank_name, branch,
        type_of_duty_tax, percentage_of_calculation, hsn_sac, type_of_supply
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25,
        $26, $27, $28, $29
      );
    `;

    // Step 2: Insert rows from Excel into temp table
    for (const row of data) {
      // Check in permanent ledger table first
      const permLedgerExists = await pool.query(
        `SELECT 1 FROM ledgers WHERE LOWER(description) = LOWER($1) AND company_id = $2`,
        [row["Name"], company]
      );
      if (permLedgerExists.rowCount > 0) {
        skippedLedgers.push({ name : row["Name"], reason: "Already exists in permanent ledger" });
        continue;
      }
      // Check in temporary ledger table next
      const tempLedgerExists = await pool.query(
        `SELECT 1 FROM ${tempTableName} WHERE LOWER(name) = LOWER($1)`,
        [row["Name"]]
      );
      if (tempLedgerExists.rowCount > 0) {
        skippedLedgers.push({ name : row["Name"], reason: "Already exists in temporary ledger" });
        continue;
      }
      await pool.query(insertSQL, [
        row["Name"],
        row["Under"],
        row["Mailing name"] || row["Name"],
        row["Bill by bill"] || null,
        row["Registration Type"] || null,
        row["Type of Ledger"] || null,
        row["Inventory Affected"] || null,
        row["Credit period"] || null,
        row["GST Applicable"] || null,
        row["Set/Alter GST Details"] || null,
        row["Taxability"] || null,
        row["Integrated Tax"] || null,
        row["Cess Tax"] || null,
        row["Applicable Date"] ? new Date(row["Applicable Date"]) : null,
        row["Address"] || null,
        row["State"] || null,
        row["Pincode"] || null,
        row["PAN/IT No"] || null,
        row["GSTIN/UIN"] || null,
        row["Account Holder Name"] || null,
        row["Alc No"] || null,
        row["IFS code"] || null,
        row["SWIFT code"] || null,
        row["Bank Name"] || null,
        row["Branch"] || null,
        row["Type of Duty Tax"] || null,
        row["Percentage of Calculation"] || null,
        row["HSN/SAC"] || null,
        row["Type of Supply"] || null
      ]);
      // Additional button-specific dynamic fields (all nullable) from line 117 for button
    }
    (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS user_ledger_temp_tables (
            id SERIAL PRIMARY KEY,
            user_email TEXT NOT NULL,
            company_id TEXT NOT NULL,
            uploaded_file TEXT,
            temp_table TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log("✅ user_ledger_temp_tables ensured");
      } catch (err) {
        console.error("❌ Failed to create user_ledger_temp_tables:", err);
      }
    })();
    
    // Step 3: Log uploaded metadata
    await pool.query(`
      INSERT INTO user_ledger_temp_tables (user_email, company_id, uploaded_file, temp_table, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    `, [email, company, uploadedFileName, tempTableName]);
    // 📤 Generate Excel report for skipped
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Skipped Ledgers');
    sheet.columns = [
      { header: 'Ledger Name', key: 'name', width: 30 },
      { header: 'Reason Skipped', key: 'reason', width: 50 },
    ];
    sheet.addRows(skippedLedgers);

    // Ensure the logs directory exists
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const filePath = path.join(logsDir, `Skipped_Ledgers_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);


    res.json({
      message: 'Ledger upload completed',
      table: tempTableName,
      skipped: skippedLedgers.length,
      reportFile: filePath, // or you can generate a downloadable URL
    });
  } catch (err) {
    console.error("Error in /api/uploadLedger:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
};

exports.downloadSkippedReport = (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send("File not found.");
  }
  res.download(filePath);
};

// ✅ GET /api/getUserExcelLedgerUploads
exports.getUserExcelLedgerUploads = async (req, res) => {
  try {
    const { email, company } = req.query;

    if (!email || !company) {
      return res.status(400).json({ error: 'Missing email or company' });
    }
    const [companyName, companyId] = company.split(':');

    const result = await pool.query(`
      SELECT id, temp_table, uploaded_file, created_at
      FROM user_ledger_temp_tables
      WHERE user_email = $1 AND company_id = $2
      ORDER BY created_at DESC
    `, [email, company]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting ledger uploads:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

// ✅ DELETE /api/deleteExcelLedgerUpload
exports.deleteExcelLedgerUpload = async (req, res) => {
  try {
    const { table } = req.body;

    if (!table) {
      return res.status(400).json({ error: 'Table name required' });
    }

    // ✅ Optional Safety Check: Ensure table name starts with your expected prefix
    if (!table.startsWith('ledger_temp_')) {
      return res.status(400).json({ error: 'Invalid table name format' });
    }

    // ✅ Step 1: Drop the dynamically created temp table
    await pool.query(`DROP TABLE IF EXISTS ${table}`);

    // ✅ Step 2: Remove corresponding record from the tracking table
    await pool.query(
      `DELETE FROM user_ledger_temp_tables WHERE temp_table = $1`,
      [table]
    );

    // ✅ Done
    res.json({ message: 'Ledger upload deleted successfully' });
  } catch (err) {
    console.error('Error deleting ledger upload:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

// ✅ POST /api/saveLedgerRows (Updated with user email and company)
exports.saveLedgerRows = async (req, res) => {
  const { email, company, tempTable, rows } = req.body;

  if (!email || !company || !tempTable || !rows || !rows.length) {
    return res.status(400).json({ error: "Missing email, company, tempTable, or rows data" });
  }

  try {
    // Optional security check: ensure tempTable belongs to this user/company
    const tableCheck = await pool.query(
      `SELECT * FROM user_ledger_temp_tables WHERE user_email=$1 AND company_id=$2 AND temp_table=$3`,
      [email, company, tempTable]
    );

    if (tableCheck.rowCount === 0) {
      return res.status(403).json({ error: "Unauthorized or invalid temp table access" });
    }

    for (const row of rows) {
      await pool.query(`
        UPDATE ${tempTable}
        SET
          name = $1,
          parent = $2,
          mailing_name = $3,
          bill_by_bill = $4,
          registration_type = $5,
          type_of_ledger = $6,
          inventory_affected = $7,
          credit_period = $8,
          gst_applicable = $9,
          set_alter_gst_details = $10,
          taxability = $11,
          integrated_tax = $12,
          cess_tax = $13,
          applicable_date = $14,
          address = $15,
          state = $16,
          pincode = $17,
          pan_it_no = $18,
          gstin_uin = $19,
          updated_at = CURRENT_TIMESTAMP
        WHERE creation_id = $20
      `, [
        row.name,
        row.parent,
        row.mailing_name || row.name,
        row.bill_by_bill,
        row.registration_type,
        row.type_of_ledger,
        row.inventory_affected,
        row.credit_period,
        row.gst_applicable,
        row.set_alter_gst_details,
        row.taxability,
        row.integrated_tax,
        row.cess_tax,
        row.applicable_date || null,
        row.address,
        row.state,
        row.pincode,
        row.pan_it_no,
        row.gstin_uin,
        row.creation_id
      ]);
    }

    res.json({ message: "Rows saved successfully" });

  } catch (err) {
    console.error("Error saving ledger rows:", err);
    res.status(500).json({ error: "Database error", details: err.message }); 
  }
}

// ✅ GET /api/getTempLedgerNames
exports.getTempLedgerNames = async (req, res) => {
  try {
    const { tempTable } = req.query;

    if (!tempTable) {
      return res.status(400).json({ error: 'Missing temporary table name' });
    }

    // Safety check: ensure the table name starts with the expected prefix
    if (!tempTable.startsWith('ledger_temp_')) {
      return res.status(400).json({ error: 'Invalid table name format' });
    }

    // Query to select all ledger names from the temporary table
    const querySQL = `SELECT name FROM ${tempTable}`;
    const result = await pool.query(querySQL);

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching temporary ledger names:", err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
};

exports.getMergedLedgerNames = async (req, res) => {
  try {
    const { email, company } = req.query;

    if (!email || !company) {
      return res.status(400).json({ error: 'Missing email or company' });
    }

    const [companyName, companyId] = company.split(':');

    // 1. Fetch permanent ledger names
    const permQuery = `SELECT description FROM ledgers WHERE company_id = $1`;
    const permResult = await pool.query(permQuery, [company]);

    const permanentLedgerNames = permResult.rows.map(row =>
      row.description?.toLowerCase().trim()
    );

    // 2. Get user's uploaded temp tables
    const tempTablesResult = await pool.query(`
      SELECT temp_table
      FROM user_ledger_temp_tables
      WHERE user_email = $1 AND company_id = $2
    `, [email, company]);

    const allTempLedgerNames = [];

    for (const { temp_table } of tempTablesResult.rows) {
      // Extra safety: only allow expected table names
      if (!temp_table.startsWith("ledger_temp_")) continue;

      const tempRes = await pool.query(`SELECT name FROM ${temp_table}`);
      const tempNames = tempRes.rows.map(row =>
        row.name?.toLowerCase().trim()
      ).filter(Boolean);

      allTempLedgerNames.push(...tempNames);
    }

    const mergedLedgers = [...new Set([...permanentLedgerNames, ...allTempLedgerNames])];

    res.json(mergedLedgers);
  } catch (err) {
    console.error("Error merging ledger names:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
};

// Add function to get Excel Ledger data
exports.getExcelLedgerData = async (req, res) => {
  try {
    const { tempTable } = req.query;
    console.log("📥 Received request for ExcelLedgersData with tempTable:", tempTable);
    
    if (!tempTable) {
      console.log("❌ Missing tempTable parameter");
      return res.status(400).json({ error: 'Temp table name required' });
    }
    
    console.log(`📊 Executing query: SELECT * FROM ${tempTable}`);
    const result = await pool.query(`SELECT * FROM ${tempTable}`);
    console.log(`✅ Query successful, fetched ${result.rows.length} rows`);
    
    if (result.rows.length > 0) {
      console.log("📋 Sample row:", result.rows[0]);
    }
    
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching ledger data:', err.message);
    console.error('❌ Full error:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
};

