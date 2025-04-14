// routes/companies.js
const express = require('express');
const router = express.Router();
const companiesController = require('../controllers/companiesController');
const ledgerController = require('../controllers/ledgerController');

router.get('/getUserCompanies', companiesController.getUserCompanies);

// Use the ledgerController's getBankNames method
router.get('/getBankNames', ledgerController.getBankNames);

module.exports = router;
