const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  user: 'palm',
  host: '203.154.32.219',
  database: 'fm',
  password: 'qwer1234',
  port: 5432,
  idleTimeoutMillis: 30000
});

// Route สำหรับแสดงหน้าแผนที่
router.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('map');
});

module.exports = router;