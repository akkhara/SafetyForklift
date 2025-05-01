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
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    const companiesResult = await client.query('SELECT id, name FROM company WHERE deleted_at IS NULL');
    res.render('map', { companies: companiesResult.rows });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).send('Internal Server Error');
  } finally {
    client.release();
  }
});

// API สำหรับดึงข้อมูล Fleet ตามบริษัท
router.get('/api/fleets', async (req, res) => {
  const { companyId } = req.query;
  const client = await pool.connect();

  try {
    const fleetsResult = await client.query(
      'SELECT id, vehicle_name FROM fleet WHERE company_id = $1 AND deleted_at IS NULL',
      [companyId]
    );
    res.json(fleetsResult.rows);
  } catch (error) {
    console.error('Error fetching fleets:', error);
    res.status(500).send('Internal Server Error');
  } finally {
    client.release();
  }
});

module.exports = router;