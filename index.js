// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend server is running' });
});

// Import routes
const companiesRoutes = require('./routes/companies');
const ledgerRoutes = require('./routes/ledger');
const transactionsRoutes = require('./routes/transactions');
const tallyRoutes = require('./routes/tally');
const ExcelLedgerRoutes = require('./routes/ExcelLedger');
const JournelRoutes = require('./routes/Journel');

// Mount routes under the /api path
app.use('/api', companiesRoutes);
app.use('/api', ledgerRoutes);
app.use('/api', transactionsRoutes);
app.use('/api', tallyRoutes);
app.use('/api',  ExcelLedgerRoutes);
app.use('/api',  JournelRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
