const express = require('express');
const router = express.Router();
const pool = require('../index'); // นำเข้า pool จาก index.js

/*
  GET /reports/usage
  - รับค่ากรอง: user_id, event_type, start_date, end_date
  - ดึงข้อมูลจาก usage_log และจัดรูปแบบ created_at เป็น 'YYYY-MM-DD HH24:MI:SS'
  - ส่งข้อมูลไป render หน้า usage_report.ejs
*/
router.get('/', async (req, res) => {
	if (!req.session.user) {
		return res.redirect('/login');
	}
  const client = await pool.connect();
  try {
    // รับค่ากรองจาก query string
    const { user_id, event_type, start_date, end_date } = req.query;
    let baseQuery = `
      SELECT
        ul.id,
        ul.user_id,
        COALESCE(u.username, '') AS username,
        ul.event_type,
        ul.event_description,
        ul.ip_address,
        ul.user_agent,
        TO_CHAR(ul.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
      FROM usage_log ul
      LEFT JOIN users u ON ul.user_id = u.id
      WHERE 1=1
    `;
    let params = [];
    let conditions = [];

    if (user_id) {
      conditions.push(`ul.user_id = $${params.length + 1}`);
      params.push(user_id);
    }
    if (event_type) {
      conditions.push(`ul.event_type ILIKE $${params.length + 1}`);
      params.push(event_type);
    }
    if (start_date) {
      conditions.push(`ul.created_at >= $${params.length + 1}`);
      params.push(start_date);
    }
    if (end_date) {
      conditions.push(`ul.created_at < ($${params.length + 1}::date + interval '1 day')`);
      params.push(end_date);
    }
    if (conditions.length > 0) {
      baseQuery += " AND " + conditions.join(" AND ");
    }

    baseQuery += " ORDER BY ul.id DESC";

    const result = await client.query(baseQuery, params);
    const usageLogs = result.rows;

    // ดึงรายชื่อผู้ใช้สำหรับ dropdown ในฟอร์มกรอง
    const userResult = await client.query(`
      SELECT id, username
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY username
    `);
    const users = userResult.rows;

    // ดึง distinct event types สำหรับ dropdown
    const eventTypeResult = await client.query(`
      SELECT DISTINCT event_type
      FROM usage_log
      ORDER BY event_type
    `);
    const eventTypes = eventTypeResult.rows.map(row => row.event_type);

    res.render('usage_report', {
      usageLogs,
      users,
      eventTypes,
      filters: { user_id, event_type, start_date, end_date }
    });
  } catch (error) {
    console.error('Error retrieving usage logs:', error);
    res.status(500).send('Error retrieving usage logs');
  } finally {
    client.release();
  }
});

module.exports = router;
