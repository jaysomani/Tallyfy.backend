// routes/ExcelLedger.js
const express = require('express');
const router = express.Router();
const ExcelLedgerController = require('../controllers/ExcelLedgerController');

router.post('/uploadExcelLedger',  ExcelLedgerController.uploadExcelLedger);
router.get('/downloadSkippedReport', ExcelLedgerController.downloadSkippedReport);
router.get('/getUserExcelLedgerUploads', ExcelLedgerController.getUserExcelLedgerUploads);
router.delete('/deleteExcelLedgerUpload',  ExcelLedgerController.deleteExcelLedgerUpload);
router.post('/saveLedgerRows',  ExcelLedgerController.saveLedgerRows);
router.get('/getTempLedgerNames',  ExcelLedgerController. getTempLedgerNames);
router.get('/getMergedLedgerNames',  ExcelLedgerController.getMergedLedgerNames);
router.get('/excelLedgersData', ExcelLedgerController.getExcelLedgerData);

module.exports = router;