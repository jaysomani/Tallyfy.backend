// routes/Journel.js
const express = require('express');
const router = express.Router();
const JournelController = require('../controllers/JournelController');


router.post('/uploadJournal', JournelController.uploadJournal);
router.post('/updateJournalRow', JournelController.updateJournalRow);
router.get('/getJournalData', JournelController.getJournalData);
router.get('/getUserJournelUploads', JournelController.getUserJournelUploads);
router.delete('/deleteJournelUpload', JournelController.deleteJournelUpload);
router.get('/getJournalUpdateHistory', JournelController.getJournalUpdateHistory);
router.post('/deleteJournalRow', JournelController.deleteJournalRow);

module.exports = router;