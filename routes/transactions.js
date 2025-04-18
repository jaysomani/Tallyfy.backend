// routes/transactions.js
const express = require('express');
const router = express.Router();
const transactionsController = require('../controllers/transactionsController');

router.post("/createTempTable", transactionsController.createTempTable);
router.post('/insertParsedReceipts',  transactionsController.insertParsedReceipts);
router.post('/uploadExcel', transactionsController.uploadExcel);
router.post('/deleteTransaction', transactionsController.deleteTransaction);
router.get('/getAllTempTables', transactionsController.getAllTempTables);
router.get('/getTempTable', transactionsController.getTempTable);
router.post('/updateTempExcel', transactionsController.updateTempExcel);
router.get('/tempLedgers', transactionsController.getTempLedgers);
router.post('/alterTempTable', transactionsController.alterTempTable);
router.post('/executeSql', transactionsController.executeSql);
router.get('/tempLedgers', async (req, res) => {
   try {
     // Try to use the controller function
     await transactionsController.getTempLedgers(req, res);
   } catch (error) {
     console.error("Error in getTempLedgers:", error);
     // Return error instead of mock data
     res.status(500).json({ error: "Error fetching ledger data", details: error.message });
   }
 });
 
 // Route for deleting a temporary table
 router.post('/deleteTempTable', async (req, res) => {
   try {
     await transactionsController.deleteTempTable(req, res);
   } catch (error) {
     console.error("Error in deleteTempTable:", error);
     res.status(500).json({ error: "Error deleting temp table", details: error.message });
   }
 });
 

module.exports = router;
