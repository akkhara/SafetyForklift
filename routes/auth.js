const express = require('express');
const router = express.Router();
const crypto = require('crypto'); // สมมติใช้ scryptSync ในการ hash password
const pool = require('../index'); // นำเข้า pool จาก index.js

/* 
  GET /login
  แสดงหน้า login
*/
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

/* 
  POST /login
  ตรวจสอบข้อมูล login โดยใช้ customer_code จาก company เป็น salt
*/
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // ตรวจสอบข้อมูลพื้นฐาน
  if (!username || !password) {
    return res.render('login', { error: 'Please enter both username and password' });
  }

  const client = await pool.connect();
  try {
    // ค้นหาผู้ใช้ที่ username ตรงกัน พร้อมดึง customer_code จาก company
    const query = `
        SELECT u.id, u.username, u.password, u.company_id, c.customer_code, u.role, u.view_map, u.create_staff
        FROM users u
        JOIN company c ON u.company_id = c.id
        WHERE u.username = $1 AND u.deleted_at IS NULL
        LIMIT 1
      `;
    const result = await client.query(query, [username]);

    if (result.rows.length === 0) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    // ใช้ customer_code จาก company เป็น salt (ปรับเปลี่ยนตามที่ต้องการ)
    const salt = user.customer_code.toUpperCase();
    const hashedPassword = crypto.scryptSync(password, salt, 64).toString('hex');

    if (hashedPassword !== user.password) {
      return res.render('login', { error: 'Invalid username or password' });
    }

    // สร้าง session พร้อมเก็บ role ด้วย
    req.session.user = {
      id: user.id,
      username: user.username,
      company_id: user.company_id,
      role: user.role,             // เก็บ user role ใน session
      customer_code: user.customer_code,
      view_map: user.view_map,
      create_staff: user.create_staff
    };

    // บันทึกข้อมูลการใช้งานใน usage_log (event: login)
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || '';
    const logQuery = `
      INSERT INTO usage_log (
        user_id,
        event_type,
        event_description,
        ip_address,
        user_agent,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
    `;
    await client.query(logQuery, [
      user.id,
      'login',
      'User logged in',
      ipAddress,
      userAgent
    ]);

    res.redirect('/');
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).render('login', { error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/* 
  GET /logout
  ทำการ logout โดยทำลาย session แล้ว redirect ไปหน้า login
*/
router.get('/logout', async (req, res) => {
  // หาก session ไม่มีผู้ใช้ ให้ redirect ทันที
  if (!req.session.user) {
    return res.redirect('/login');
  }
  
  const client = await pool.connect();
  try {
    const userId = req.session.user.id;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'] || '';
    
    // บันทึกการใช้งาน (event: logout)
    const logQuery = `
      INSERT INTO usage_log (
        user_id,
        event_type,
        event_description,
        ip_address,
        user_agent,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
    `;
    await client.query(logQuery, [
      userId,
      'logout',
      'User logged out',
      ipAddress,
      userAgent
    ]);
    
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
      }
      res.redirect('/login');
    });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

module.exports = router;
