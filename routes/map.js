const express = require('express');
const router = express.Router();

const pool = require('../index'); // นำเข้า pool จาก index.js

// Route สำหรับแสดงหน้าแผนที่
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const user = req.session.user; // ดึงข้อมูลผู้ใช้จาก session
  const client = await pool.connect();

  try {
    let companiesQuery = 'SELECT id, name FROM company WHERE deleted_at IS NULL';
    const params = [];

    // หากผู้ใช้ไม่ใช่ super_admin ให้กรองเฉพาะบริษัทของตัวเอง
    if (user.role !== 'super_admin') {
      companiesQuery += ' AND id = $1';
      params.push(user.company_id);
    }

    const companiesResult = await client.query(companiesQuery, params);

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
      ORDER BY vehicle_name ASC
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

router.get('/api/fleet-history/:fleetId', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        latitude, 
        longitude, 
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as timestamp
      FROM fleet_location_history 
      WHERE fleet_id = $1 
      AND created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY created_at ASC
    `, [req.params.fleetId]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching fleet history:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;