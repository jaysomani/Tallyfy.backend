// routes/ledger.js
const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledgerController');

router.get('/getUserData', ledgerController.getUserData);
router.get('/getBankNames', ledgerController.getBankNames);

module.exports = router;
