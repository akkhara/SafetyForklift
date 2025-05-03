const express = require('express');
const router = express.Router();

const pool = require('../index'); // นำเข้า pool จาก index.js

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

// API สำหรับดึงข้อมูล Fleet ตามบริษัท พร้อมตำแหน่งล่าสุด
router.get('/api/fleets', async (req, res) => {
  const { companyId } = req.query;

  if (!companyId) {
    return res.status(400).json({
      Status: "Error",
      message: "Missing required parameter: companyId"
    });
  }

  const client = await pool.connect();

  try {
    const fleetsResult = await client.query(
      `
      SELECT 
        id, 
        vehicle_name, 
        latitude, 
        longitude 
      FROM fleet 
      WHERE company_id = $1 
        AND deleted_at IS NULL
      `,
      [companyId]
    );

    res.json(fleetsResult.rows);
  } catch (error) {
    console.error('Error fetching fleets:', error);
    res.status(500).json({
      Status: "Error",
      message: "Internal Server Error"
    });
  } finally {
    client.release();
  }
});

module.exports = router;