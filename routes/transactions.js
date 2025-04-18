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
module.exports = router;
