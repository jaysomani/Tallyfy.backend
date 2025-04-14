// controllers/tallyController.js
const pool = require('../config/db');
const { formatCompanyName } = require('../utils/helpers');
const axios = require('axios');

exports.getTallyTransactions = async (req, res) => {
  try {
    const { tempTable } = req.query;
    if (!tempTable) {
      return res.status(400).json({ error: 'tempTable is required' });
    }
    const sql = `SELECT COUNT(*) FROM temporary_transactions WHERE upload_id = $1 AND status = 'sent'`;
    const result = await pool.query(sql, [tempTable]);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error('Error fetching tally transactions:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.sendToTally = async (req, res) => {
  try {
    const { company, tempTable, selectedTransactions } = req.body;
    if (!company || !tempTable) {
      return res.status(400).json({ error: 'Missing company or tempTable' });
    }
    const formattedCompany = formatCompanyName(company);
    let result;
    if (selectedTransactions && selectedTransactions.length > 0) {
      result = await pool.query(
        `SELECT * FROM temporary_transactions
         WHERE upload_id = $1
           AND assigned_ledger IS NOT NULL
           AND assigned_ledger != ''
           AND id = ANY($2)
         ORDER BY transaction_date`,
        [tempTable, selectedTransactions]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM temporary_transactions
         WHERE upload_id = $1
           AND assigned_ledger IS NOT NULL
           AND assigned_ledger != ''
         ORDER BY transaction_date`,
        [tempTable]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No transactions found with assigned ledgers' });
    }

    const transformedData = result.rows.map(row => ({
      id: row.id,
      transaction_date: row.transaction_date ? row.transaction_date.toISOString().split('T')[0] : null,
      transaction_type: row.transaction_type ? row.transaction_type.toLowerCase() : '',
      description: row.description ? row.description.trim() : '',
      amount: Math.abs(parseFloat(row.amount || 0)),
      bank_account: row.bank_account ? row.bank_account.trim() : '',
      assigned_ledger: row.assigned_ledger ? row.assigned_ledger.trim() : ''
    }));

    const invalidTransactions = transformedData.filter(
      trans => !trans.transaction_date || !trans.bank_account || !trans.assigned_ledger || !trans.amount
    );

    if (invalidTransactions.length > 0) {
      return res.status(400).json({
        error: 'Some transactions have invalid data',
        invalidTransactions
      });
    }

    console.log('Sending to tally_connector:', {
      company: formattedCompany,
      transactionCount: transformedData.length,
      sampleTransaction: transformedData[0]
    });

    try {
      const response = await axios.post('http://localhost:5000/api/tallyConnector', {
        company: formattedCompany,
        data: transformedData
      });

      if (selectedTransactions && selectedTransactions.length > 0) {
        await pool.query(
          `UPDATE temporary_transactions SET status = 'sent' WHERE upload_id = $1 AND id = ANY($2)`,
          [tempTable, selectedTransactions]
        );
      } else {
        await pool.query(
          `UPDATE temporary_transactions
           SET status = 'sent'
           WHERE upload_id = $1
             AND assigned_ledger IS NOT NULL
             AND assigned_ledger != ''`,
          [tempTable]
        );
      }

      return res.json({
        message: 'Data sent to Tally successfully',
        transactionsSent: transformedData.length,
        tallyResponse: response.data
      });
    } catch (axiosError) {
      console.error('Tally connector error:', axiosError.response?.data || axiosError.message);
      return res.status(500).json({
        error: 'Failed to send data to Tally connector',
        details: axiosError.response?.data || axiosError.message
      });
    }
  } catch (err) {
    console.error('Error in sendToTally:', err);
    res.status(500).json({
      error: 'Server error',
      details: err.message
    });
  }
};

exports.tallyConnector = async (req, res) => {
  try {
    const { company, data } = req.body;
    if (!company || !data) {
      return res.status(400).json({ error: 'Missing data' });
    }
    console.log('Processing data for Tally:', { company, data });
    res.json({ message: 'Tally Connector received the data successfully' });
  } catch (err) {
    console.error('Error processing Tally data:', err);
    res.status(500).json({ error: 'Tally processing error' });
  }
};

exports.checkTallyConnector = async (req, res) => {
  try {
    // Call the Tally Connector's health endpoint.
    const response = await axios.get('http://127.0.0.1:5000/health');
    res.json({
      message: "Tally Connector is running",
      data: response.data
    });
  } catch (error) {
    console.error("Tally Connector health check failed:", error.message);
    res.status(500).json({
      message: "Tally Connector is offline or unreachable",
      error: error.message
    });
  }
};

exports.sendLedgersFromTempTables = async (req, res) => {
  try {
    const { email, company } = req.body;
    if (!email || !company) {
      return res.status(400).json({ error: 'Missing email or company' });
    }

    // Get all temporary tables for this user and company
    const tempTablesResult = await pool.query(`
      SELECT temp_table
      FROM user_ledger_temp_tables
      WHERE user_email = $1 AND company_id = $2
    `, [email, company]);

    const allLedgerData = [];

    // Collect all ledger data from temporary tables
    for (const { temp_table } of tempTablesResult.rows) {
      if (!temp_table.startsWith("ledger_temp_")) continue;

      const tempRes = await pool.query(`SELECT * FROM ${temp_table}`);
      allLedgerData.push(...tempRes.rows);
    }

    if (allLedgerData.length === 0) {
      return res.json({ message: 'No ledger data found in temporary tables' });
    }

    // Send all ledger data to Tally
    const tallyResponse = await axios.post('http://127.0.0.1:5000/api/tallyConnector', {
      company,
      ledgerData: allLedgerData,
    });

    // Process each temporary table separately
    for (const { temp_table } of tempTablesResult.rows) {
      if (!temp_table.startsWith("ledger_temp_")) continue;
      
      const tempRes = await pool.query(`SELECT * FROM ${temp_table}`);
      const tableData = tempRes.rows;
      
      if (tableData.length > 0) {
        // Use the helper function to insert into permanent table and delete from temp table
        await insertAndDeleteLedgerData(tableData, temp_table, company);
      }
    }

    res.json({
      message: 'Ledger data sent to Tally, inserted into permanent table, and temporary data deleted successfully.',
      tallyResponse: tallyResponse.data,
    });
  } catch (err) {
    console.error('❌ Error sending ledger data from temporary tables to Tally:', err.message);
    res.status(500).json({ error: 'Failed to send ledger data to Tally', details: err.message });
  }
};

exports.sendJournalToTally = async (req, res) => { 
  try {
    const { company, tempTable, selectedRows } = req.body;
    console.log('Request body:', { company, tempTable, selectedRowsCount: selectedRows?.length });

    // Validate company and at least one source of data (either tempTable or selectedRows)
    if (!company || (!selectedRows && !tempTable)) {
      return res.status(400).json({ error: 'Missing company or data source (tempTable/selectedRows)' });
    }

    let journalData = [];
    if (selectedRows && Array.isArray(selectedRows) && selectedRows.length > 0) {
      // Use the selected rows sent from the frontend
      journalData = selectedRows;
      console.log(`Using ${journalData.length} selected rows from frontend`);
    } else {
      // Fallback: if selectedRows is not provided, use the tempTable to query all data
      const result = await pool.query(`SELECT * FROM ${tempTable}`);
      journalData = result.rows;
      console.log(`Fetched ${journalData.length} rows from temp table: ${tempTable}`);
    }

    if (journalData.length === 0) {
      return res.status(404).json({ error: 'No journal data found' });
    }

    // Log the first entry to help debug data structure
    console.log('Sample journal entry:', JSON.stringify(journalData[0], null, 2));

    // Initialize tracking arrays
    const successfulEntries = [];
    const failedEntries = [];

    // Process rows one by one
    for (const journalRow of journalData) {
      // Get row identifier (id or index in array if id is missing)
      const Id = journalRow.id || journalRow._id || id || 'unknown';
      console.log(`Processing journal entry ID: ${Id}`);
      
      try {
        // Make sure the journalRow has all required fields before sending to Tally
        if (!validateJournalEntry(journalRow)) {
          throw new Error('Invalid journal entry: missing required fields');
        }

        // Send single journal entry to TallyConnector
        console.log(`Sending journal entry to TallyConnector: ${Id}`);
        const tallyResponse = await axios.post('http://127.0.0.1:5000/api/tallyConnector', {
          company,
          journalData: [journalRow], // Send as array with single entry
        });
        
        console.log(`TallyConnector response for ${Id}:`, tallyResponse.data);
        
        // If successful, add to successful entries
        successfulEntries.push({
          journalEntry: journalRow,
          tallyResponse: tallyResponse.data
        });
        
        // If we're using a tempTable, mark this row as processed
        if (tempTable && Id !== 'unknown') {
          try {
            // Check if the table has a status column before updating
            const tableColumns = await pool.query(`
              SELECT column_name 
              FROM information_schema.columns 
              WHERE table_name = $1
            `, [tempTable.replace(/['"]/g, '')]);
            
            const hasStatusColumn = tableColumns.rows.some(col => 
              col.column_name.toLowerCase() === 'status'
            );
            
            if (hasStatusColumn) {
              await pool.query(
                `UPDATE ${tempTable} SET status = 'sent_to_tally' WHERE id = $1`,
                [Id]
              );
              console.log(`Updated status for journal ID ${Id} in ${tempTable}`);
            } else {
              console.log(`Table ${tempTable} does not have a status column, skipping status update`);
            }
          } catch (updateError) {
            console.error(`Error updating status for journal ID ${Id}:`, updateError);
          }
        }
        
      } catch (entryError) {
        console.error(`Failed to send journal entry ID: ${Id}:`, entryError.message);
        console.error(`Error details:`, entryError.response?.data || 'No additional error details');
        
        // Add to failed entries with error details
        failedEntries.push({
          journalEntry: journalRow,
          error: entryError.message,
          details: entryError.response?.data || {}
        });
      }
    }

    // Return detailed results
    res.json({
      message: 'Journal processing completed',
      summary: {
        total: journalData.length,
        successful: successfulEntries.length,
        failed: failedEntries.length
      },
      successfulEntries: successfulEntries.map(entry => ({
        id: entry.journalEntry.id || entry.journalEntry._id,
        details: entry.journalEntry
      })),
      failedEntries: failedEntries.map(entry => ({
        id: entry.journalEntry.id || entry.journalEntry._id,
        error: entry.error,
        details: entry.journalEntry
      }))
    });
    
  } catch (err) {
    console.error('❌ Error processing journal data:', err.message);
    res.status(500).json({ error: 'Failed to process journal data', details: err.message });
  }
};

// Helper function to validate journal entries
function validateJournalEntry(entry) {
  // Check for required fields - implement based on your requirements
  // For example: if entry needs to have date, amount, narration, etc.
  if (!entry) return false;
  
  // Add your validation logic here based on what Tally expects
  // For example:
  const hasRequiredFields = 
    entry.date !== undefined && 
    entry.narration !== undefined;
    
  return true; // Replace with actual validation
}

exports.sendLedgerToTally = async (req, res) => {
  try {
    const { company, tempTable } = req.body;
    if (!company || !tempTable) {
      return res.status(400).json({ error: 'Missing company or tempTable' });
    }

    // 1. Query the ledger rows from the temporary table.
    const result = await pool.query(`SELECT * FROM ${tempTable}`);
    const ledgerData = result.rows;

    if (ledgerData.length === 0) {
      return res.status(404).json({ error: 'No ledger data found in temporary table' });
    }

    // 2. Send data to the local TallyConnector API.
    const tallyResponse = await axios.post('http://127.0.0.1:5000/api/tallyConnector', {
      company,
      ledgerData,
    });

    // 3. If TallyConnector returned a success response, finalize the data.
    if (tallyResponse.data && tallyResponse.data.message) {
      await insertAndDeleteLedgerData(ledgerData, tempTable, company);
      return res.json({
        message: 'Ledger data sent to Tally successfully and finalized',
        tallyResponse: tallyResponse.data,
      });
    } else {
      return res.status(500).json({ error: 'TallyConnector did not return a success response' });
    }
  } catch (err) {
    console.error('❌ Error sending ledger data to Tally:', err.message);
    res.status(500).json({ error: 'Failed to send ledger data to Tally', details: err.message });
  }
};

// Helper function to insert ledger rows into permanent table "ledgers" then delete them from the temporary table.
async function insertAndDeleteLedgerData(ledgerData, tempTableName, company) {
  if (!ledgerData || ledgerData.length === 0) return;

  try {
    // For each ledger row, insert into permanent table "ledgers"
    for (const row of ledgerData) {
      if (!row.name) {
        console.warn('Skipping row with missing name:', row);
        continue;
      }

      // Destructure the fields that we want to store as extra_data
      const { creation_id, name, created_at, updated_at, ...extraFields } = row;
      const extraDataJSON = JSON.stringify(extraFields);

      try {
        await pool.query(
          `INSERT INTO ledgers (company_id, description, closing_balance, extra_data)
           VALUES ($1, $2, $3, $4)`,
          [company, name, 0, extraDataJSON]
        );
      } catch (insertError) {
        console.error('Error inserting ledger:', insertError);
        throw insertError;
      }
    }

    // Delete the inserted rows from the temporary table
    for (const row of ledgerData) {
      if (!row.name) continue;
      
      try {
        await pool.query(
          `DELETE FROM ${tempTableName}
           WHERE name = $1`,
          [row.name]
        );
      } catch (deleteError) {
        console.error('Error deleting from temp table:', deleteError);
        throw deleteError;
      }
    }
  } catch (err) {
    console.error('Error in insertAndDeleteLedgerData:', err);
    throw err;
  }
}

// New Endpoint: sendAllLedgersToTally
// If tempTable is provided in the request body, use it to query ledger data.
// Otherwise, search the user_ledger_temp_tables table for all temp tables for the given user (by email) and company,
// then aggregate ledger data from each table and send it to the TallyConnector.
// exports.sendAllLedgersToTally = async (req, res) => {
//   try {
//     // Expect company and email to be provided.
//     // tempTable is optional.
//     const { company, email, tempTable } = req.body;
//     if (!company || !email) {
//       return res.status(400).json({ error: 'Missing company or email' });
//     }

//     const formattedCompany = formatCompanyName ? formatCompanyName(company) : company;
//     let ledgerData = [];

//     if (tempTable) {
//       // If tempTable is provided, query that table for ledger data.
//       const result = await pool.query(`SELECT * FROM ${tempTable}`);
//       ledgerData = result.rows;
//       if (ledgerData.length === 0) {
//         return res.status(404).json({ error: 'No ledger data found in temporary table' });
//       }
//     } else {
//       // When tempTable is not provided, search for all ledger temporary tables for this user.
//       const tablesResult = await pool.query(
//         `SELECT temp_table FROM user_ledger_temp_tables WHERE email = $1 AND company = $2`,
//         [email, company]
//       );
//       const tables = tablesResult.rows;
//       if (tables.length === 0) {
//         return res.status(404).json({ error: 'No ledger temp tables found for this user and company' });
//       }
//       // Aggregate ledger data from each temporary table.
//       for (const row of tables) {
//         const currentTable = row.temp_table;
//         const result = await pool.query(`SELECT * FROM ${currentTable}`);
//         const tempData = result.rows;
//         if (tempData.length > 0) {
//           ledgerData = ledgerData.concat(tempData);
//         }
//       }
//       if (ledgerData.length === 0) {
//         return res.status(404).json({ error: 'No ledger data found in any ledger temp tables' });
//       }
//     }

//     // Send the aggregated ledger data to the TallyConnector.
//     const tallyResponse = await axios.post('http://127.0.0.1:5000/api/tallyConnector', {
//       company: formattedCompany,
//       ledgerData: ledgerData,
//     });

//     res.json({
//       message: 'Ledger data sent to Tally successfully',
//       tallyResponse: tallyResponse.data,
//     });
//   } catch (err) {
//     console.error('❌ Error sending ledger data to Tally:', err.message);
//     res.status(500).json({ error: 'Failed to send ledger data to Tally', details: err.message });
//   }
// };
exports.sendAllLedgersToTally = async (req, res) => {
  try {
    console.log('Starting sendAllLedgersToTally with request body:', req.body);
    const { company, email, tempTable } = req.body;
    
    if (!company || !email) {
      console.log('Missing required parameters:', { company, email });
      return res.status(400).json({ error: 'Missing company or email' });
    }

    console.log('Processing request for:', { company, email, tempTable });
    const formattedCompany = formatCompanyName ? formatCompanyName(company) : company;
    let ledgerData = [];

    if (tempTable) {
      console.log('Using provided tempTable:', tempTable);
      const result = await pool.query(`SELECT * FROM ${tempTable}`);
      ledgerData = result.rows;
      console.log(`Found ${ledgerData.length} rows in tempTable`);
      
      if (ledgerData.length === 0) {
        console.log('No data found in tempTable');
        return res.status(404).json({ error: 'No ledger data found in temporary table' });
      }
    } else {
      console.log('Fetching all temp tables for user');
      const tablesResult = await pool.query(
        `SELECT temp_table FROM user_ledger_temp_tables WHERE user_email = $1 AND company_id = $2`,
        [email, company]
      );
      const tables = tablesResult.rows;
      console.log(`Found ${tables.length} temp tables`);
      
      if (tables.length === 0) {
        console.log('No temp tables found for user');
        return res.status(404).json({ error: 'No ledger temp tables found for this user and company' });
      }
      
      for (const row of tables) {
        const currentTable = row.temp_table;
        if (!currentTable.startsWith("ledger_temp_")) {
          console.log('Skipping non-ledger table:', currentTable);
          continue;
        }
        console.log('Processing table:', currentTable);
        const result = await pool.query(`SELECT * FROM ${currentTable}`);
        const tempData = result.rows;
        console.log(`Found ${tempData.length} rows in ${currentTable}`);
        
        if (tempData.length > 0) {
          ledgerData = ledgerData.concat(tempData);
        }
      }
      
      if (ledgerData.length === 0) {
        console.log('No ledger data found in any temp tables');
        return res.status(404).json({ error: 'No ledger data found in any ledger temp tables' });
      }
    }

    console.log(`Total ledger data to send: ${ledgerData.length} rows`);
    console.log('Sending data to TallyConnector...');
    
    const tallyResponse = await axios.post('http://127.0.0.1:5000/api/tallyConnector', {
      company,
      ledgerData,
    });

    console.log('TallyConnector response:', tallyResponse.data);

    if (tallyResponse.data && tallyResponse.data.message) {
      console.log('Processing successful Tally response');
      if (tempTable) {
        console.log('Inserting and deleting data from single tempTable');
        await insertAndDeleteLedgerData(ledgerData, tempTable, company);
      } else {
        console.log('Processing multiple temp tables');
        const tablesResult = await pool.query(
          `SELECT temp_table FROM user_ledger_temp_tables WHERE user_email = $1 AND company_id = $2`,
          [email, company]
        );
        for (const row of tablesResult.rows) {
          const currentTable = row.temp_table;
          if (!currentTable.startsWith("ledger_temp_")) {
            console.log('Skipping non-ledger table:', currentTable);
            continue;
          }
          console.log('Processing table:', currentTable);
          const tempRes = await pool.query(`SELECT * FROM ${currentTable}`);
          const tempData = tempRes.rows;
          if (tempData.length > 0) {
            console.log(`Inserting and deleting ${tempData.length} rows from ${currentTable}`);
            await insertAndDeleteLedgerData(tempData, currentTable, company);
          }
        }
      }

      console.log('Operation completed successfully');
      return res.json({
        message: 'Ledger data sent to Tally successfully',
        tallyResponse: tallyResponse.data,
      });
    } else {
      console.log('TallyConnector did not return success response');
      return res.status(500).json({ error: 'TallyConnector did not return a success response' });
    }
  } catch (err) {
    console.error('❌ Error in sendAllLedgersToTally:', err);
    if (err.response?.status === 404) {
      console.log('TallyConnector is offline or not responding');
      return res.status(404).json({ 
        error: 'TallyConnector is offline or not responding. Please check if TallyConnector is running.',
        details: err.message 
      });
    }
    console.error('Server error:', err.message);
    res.status(500).json({ 
      error: 'Failed to send ledger data to Tally', 
      details: err.message 
    });
  }
};

// Helper function to insert ledger rows into permanent table "ledgers" then delete them from the temporary table.
async function insertAndDeleteLedgerData(ledgerData, tempTableName, company) {
  if (!ledgerData || ledgerData.length === 0) return;

  try {
    // For each ledger row, insert into permanent table "ledgers"
    for (const row of ledgerData) {
      if (!row.name) {
        console.warn('Skipping row with missing name:', row);
        continue;
      }

      // Destructure the fields that we want to store as extra_data
      const { creation_id, name, created_at, updated_at, ...extraFields } = row;
      const extraDataJSON = JSON.stringify(extraFields);

      try {
        await pool.query(
          `INSERT INTO ledgers (company_id, description, closing_balance, extra_data)
           VALUES ($1, $2, $3, $4)`,
          [company, name, 0, extraDataJSON]
        );
      } catch (insertError) {
        console.error('Error inserting ledger:', insertError);
        throw insertError;
      }
    }

    // Delete the inserted rows from the temporary table
    for (const row of ledgerData) {
      if (!row.name) continue;
      
      try {
        await pool.query(
          `DELETE FROM ${tempTableName}
           WHERE name = $1`,
          [row.name]
        );
      } catch (deleteError) {
        console.error('Error deleting from temp table:', deleteError);
        throw deleteError;
      }
    }
  } catch (err) {
    console.error('Error in insertAndDeleteLedgerData:', err);
    throw err;
  }
}
