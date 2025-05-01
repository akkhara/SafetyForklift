const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const crypto = require('crypto'); // ใช้ generate code หรือจะใช้วิธีอื่น

const pool = require('../index'); // นำเข้า pool จาก index.js

// ฟังก์ชันสำหรับ Generate customer_code ขนาด 10 ตัวอักษร
// ตัวอย่าง: random hex 5 ไบต์ => 10 ตัวอักษร
function generateCustomerCode() {
  //return crypto.randomBytes(5).toString('hex').toUpperCase(); 
  // ได้ string เช่น "A1B2C3D4E5"
  return uuidv4().replace(/-/g, '').toUpperCase().slice(0, 10); // ตัดให้เหลือ 10 ตัว
}

/* -----------------------------------------
   1) แสดงรายการ Company (GET /management/company)
------------------------------------------*/
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        id AS company_id,
        name,
        address,
        contact_person,
        contact_phone,
        contact_email,
        customer_code
      FROM company
      WHERE deleted_at IS NULL
      ORDER BY id ASC
    `;
    const result = await client.query(query);
    const companies = result.rows;

    // render หน้า company_list_modal.ejs
    res.render('company_list_modal', { companies });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   2) เพิ่ม Company (Add)
   POST /management/company/add
------------------------------------------*/
router.post('/add', async (req, res) => {
  const {
    name,
    address,
    contact_person,
    contact_phone,
    contact_email
    // ไม่รับ customer_code จาก client เพราะจะ generate อัตโนมัติ
  } = req.body;

  // Generate customer_code อัตโนมัติ
  const customer_code = generateCustomerCode();

  const client = await pool.connect();
  try {
    const insertQuery = `
      INSERT INTO company (
        name,
        address,
        contact_person,
        contact_phone,
        contact_email,
        customer_code,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING id
    `;
    const result = await client.query(insertQuery, [
      name,
      address,
      contact_person,
      contact_phone,
      contact_email,
      customer_code
    ]);
    
    const companyId = result.rows[0].id;

    // บันทึกการใช้งาน (Usage Log) สำหรับการเพิ่ม company
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
      'add_company',
      `User added company with ID ${companyId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/company');
  } catch (error) {
    console.error('Error adding company:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   3) แก้ไข Company (Edit)
   POST /management/company/edit/:id
------------------------------------------*/
router.post('/edit/:id', async (req, res) => {
  const companyId = req.params.id;
  const {
    name,
    address,
    contact_person,
    contact_phone,
    contact_email
    // ไม่รับ customer_code เพราะไม่ให้แก้
  } = req.body;

  const client = await pool.connect();
  try {
    // ไม่อัปเดต customer_code (ตัดออกจากคำสั่ง UPDATE)
    const updateQuery = `
      UPDATE company
      SET
        name = $1,
        address = $2,
        contact_person = $3,
        contact_phone = $4,
        contact_email = $5,
        updated_at = NOW()
      WHERE id = $6
        AND deleted_at IS NULL
    `;
    await client.query(updateQuery, [
      name,
      address,
      contact_person,
      contact_phone,
      contact_email,
      companyId
    ]);

    // บันทึกการใช้งาน (Usage Log) สำหรับการแก้ไข company
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
      'edit_company',
      `User edited company with ID ${companyId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/company');
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   4) ลบ Company (Soft Delete)
   POST /management/company/delete/:id
------------------------------------------*/
router.post('/delete/:id', async (req, res) => {
  const companyId = req.params.id;

  const client = await pool.connect();
  try {
    const deleteQuery = `
      UPDATE company
      SET deleted_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
    `;
    await client.query(deleteQuery, [companyId]);

    // บันทึกการใช้งาน (Usage Log) สำหรับการลบ company
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
      'delete_company',
      `User deleted company with ID ${companyId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/company');
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

module.exports = router;
