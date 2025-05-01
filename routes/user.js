const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const pool = require('../index'); // นำเข้า pool จาก index.js

// 1) แสดงรายการ User (พร้อม JOIN กับตาราง company ถ้าต้องการ)
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    // สร้าง query พื้นฐานสำหรับดึงข้อมูลผู้ใช้
    let query = `
      SELECT
         u.id AS user_id,
         u.username,
         u.role,
         u.view_map,
         u.create_staff,
         u.company_id,
         c.name AS company_name
       FROM users u
       JOIN company c ON u.company_id = c.id
       WHERE u.deleted_at IS NULL
    `;
    let queryCompany = `
      SELECT id, name, customer_code
      FROM company
      WHERE deleted_at IS NULL
    `;

    let params = [];

    // กำหนด role options ที่ต้องการส่งให้ template
    let roleOptions = [];

    // ถ้า role ไม่ใช่ super_admin ให้แสดงเฉพาะข้อมูลของตัวเอง
    if (req.session.user.role !== 'super_admin') {
      query += ' AND u.company_id = $1';
      queryCompany += ' AND id = $1'
      params.push(req.session.user.company_id);
    } else {
      roleOptions.push('super_admin');
    }
    roleOptions.push('customer_admin');

    query += ' ORDER BY u.id ASC';
    queryCompany += ' ORDER BY id ASC';

    const result = await client.query(query, params);
    const users = result.rows;

    // ดึงรายการ company ทั้งหมด (สำหรับ dropdown เลือก company)
    
    const companyResult = await client.query(queryCompany, params);
    const companies = companyResult.rows;

    // render หน้า user_list.ejs
    res.render('user_list_modal', { users, companies, roleOptions });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

// 2) เพิ่มผู้ใช้ (Add)
router.post('/add', async (req, res) => {
  const { username, password, role, company_id, view_map, create_staff } = req.body;
  const client = await pool.connect();
  try {
    // ตรวจสอบว่า company_id มีอยู่ในตาราง company หรือไม่ เพื่อดึง customer_code
    const companyQuery = `
      SELECT customer_code
      FROM company
      WHERE id = $1
        AND deleted_at IS NULL
    `;
    const companyResult = await client.query(companyQuery, [company_id]);
    if (companyResult.rows.length === 0) {
      return res.status(400).json({
        Status: "Error",
        message: "Invalid customer code or company not found"
      });
    }
    const customer_code = companyResult.rows[0].customer_code;
    const hashedPassword = crypto.scryptSync(password, customer_code, 64).toString('hex');

    // เปลี่ยน INSERT ให้ RETURNING id เพื่อให้ได้ userId ใหม่
    const insertQuery = `
      INSERT INTO users (
        username, 
        password, 
        role, 
        company_id, 
        view_map, 
        create_staff,
        created_at, 
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id
    `;
    const result = await client.query(insertQuery, [
      username,
      hashedPassword,
      role,
      company_id,
      view_map === 'on',
      create_staff === 'on'
    ]);
    const newUserId = result.rows[0].id;

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการเพิ่ม user
    const usageLogQuery = `
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
    await client.query(usageLogQuery, [
      req.session.user ? req.session.user.id : null,
      'add_user',
      `User added a new user with ID ${newUserId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/user');
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).send('Username already exists');
    }
    console.error('Error adding user:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

// 3) แก้ไขผู้ใช้ (Edit)
router.post('/edit/:id', async (req, res) => {
  const userId = req.params.id;
  const { username, password, role, company_id, view_map, create_staff } = req.body;

  const client = await pool.connect();
  try {
    const updateQuery = `
      UPDATE users
      SET
        username = $1,
        password = $2,
        role = $3,
        company_id = $4,
        view_map = $5,
        create_staff = $6,
        updated_at = NOW()
      WHERE id = $7
        AND deleted_at IS NULL
    `;
    await client.query(updateQuery, [
      username,
      password,  // ในระบบจริงควรทำการ Hash ก่อนอัปเดต
      role,
      company_id,
      view_map === 'on',
      create_staff === 'on',
      userId
    ]);

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการแก้ไข user
    const usageLogQuery = `
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
    await client.query(usageLogQuery, [
      req.session.user ? req.session.user.id : null,
      'edit_user',
      `User edited user with ID ${userId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/user');
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

router.post('/delete/:id', async (req, res) => {
  const userId = req.params.id;
  const client = await pool.connect();
  try {
    const deleteQuery = `
      UPDATE users
      SET deleted_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
    `;
    await client.query(deleteQuery, [userId]);

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการลบ user
    const usageLogQuery = `
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
    await client.query(usageLogQuery, [
      req.session.user ? req.session.user.id : null,
      'delete_user',
      `User deleted user with ID ${userId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/user');
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

module.exports = router;
