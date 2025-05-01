const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const pool = require('../index'); // นำเข้า pool จาก index.js

// ตั้งค่าที่เก็บไฟล์ชั่วคราว
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    // เช็คไฟล์นามสกุล .jpg หรือ .jpeg
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') {
      cb(null, true);
    } else {
      cb(new Error('Only .jpg/.jpeg files are allowed'), false);
    }
  }
});

/* -----------------------------------------
   1) แสดงรายการ Staff (GET /management/staff)
------------------------------------------*/
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    // สร้าง query สำหรับดึงข้อมูล staff โดยมีเงื่อนไขตาม role
    let query = `
      SELECT
        s.id AS staff_id,
        s.name AS staff_name,
        s.job_title,
        s.phone_no,
        s.email,
        s.department,
        s.address,
        s.company_code,
        c.name AS company_name,
        c.id AS company_id,
        si.name AS site_name,
        si.id AS site_id,
        st.name AS shift_time_name,
        st.id AS shift_time_id
      FROM staff s
      JOIN company c ON s.company_id = c.id
      LEFT JOIN site si ON s.site_id = si.id
      LEFT JOIN shift_time st ON s.shift_time_id = st.id
      WHERE s.deleted_at IS NULL
    `;
    let params = [];
    // ถ้า role ไม่ใช่ super_admin ให้กรองเฉพาะบริษัทของผู้ใช้
    if (req.session.user.role !== 'super_admin') {
      query += " AND s.company_id = $1";
      params.push(req.session.user.company_id);
    }
    query += " ORDER BY s.id ASC";
    const result = await client.query(query, params);
    const staffs = result.rows;
    
    // ดึงข้อมูลสำหรับ dropdown ของ company
    let companyQuery;
    let companyParams = [];
    if (req.session.user.role !== 'super_admin') {
      companyQuery = `
        SELECT id, name, customer_code
        FROM company
        WHERE id = $1 AND deleted_at IS NULL
        ORDER BY name ASC
      `;
      companyParams.push(req.session.user.company_id);
    } else {
      companyQuery = `
        SELECT id, name, customer_code
        FROM company
        WHERE deleted_at IS NULL
        ORDER BY name ASC
      `;
    }
    const companyResult = await client.query(companyQuery, companyParams);
    const companies = companyResult.rows;

    // ดึงข้อมูลสำหรับ dropdown ของ site
    let siteQuery;
    let siteParams = [];
    if (req.session.user.role !== 'super_admin') {
      siteQuery = `
        SELECT id, name
        FROM site
        WHERE company_id = $1 AND deleted_at IS NULL
        ORDER BY name ASC
      `;
      siteParams.push(req.session.user.company_id);
    } else {
      siteQuery = `
        SELECT id, name
        FROM site
        WHERE deleted_at IS NULL
        ORDER BY name ASC
      `;
    }
    const siteResult = await client.query(siteQuery, siteParams);
    const sites = siteResult.rows;

    // ดึงข้อมูลสำหรับ dropdown ของ shift_time:
    // ถ้าผู้ใช้ไม่ใช่ super_admin ให้แสดงเฉพาะ shift_time ที่เชื่อมโยงกับไซต์ที่มี company_id เท่ากับของผู้ใช้
    let shiftTimeQuery;
    let shiftTimeParams = [];
    if (req.session.user.role !== 'super_admin') {
      shiftTimeQuery = `
        SELECT DISTINCT st.id, st.name
        FROM shift_time st
        JOIN shift_time_site sts ON st.id = sts.shift_time_id
        JOIN site s ON sts.site_id = s.id
        WHERE s.company_id = $1
          AND st.deleted_at IS NULL
        ORDER BY st.id
      `;
      shiftTimeParams.push(req.session.user.company_id);
    } else {
      shiftTimeQuery = `
        SELECT id, name
        FROM shift_time
        WHERE deleted_at IS NULL
        ORDER BY id
      `;
    }
    const shiftTimeResult = await client.query(shiftTimeQuery, shiftTimeParams);
    const shiftTimes = shiftTimeResult.rows;

    res.render('staff_list_modal', { staffs, companies, sites, shiftTimes });
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   2) เพิ่ม Staff (Add) (POST /management/staff/add)
------------------------------------------*/
router.post('/add', upload.single('image'), async (req, res) => {
  const {
    name,
    job_title,
    company_id,
    address,
    phone_no,
    email,
    site_id,
    shift_time_id,
    department,
    company_code    // รับค่าจากฟอร์ม
  } = req.body;

  const client = await pool.connect();
  try {
    // เตรียม buffer สำหรับเก็บรูป (bytea)
    let imageBuffer = null;
    if (req.file) {
      imageBuffer = fs.readFileSync(req.file.path);
    }

    const insertQuery = `
      INSERT INTO staff (
        name,
        job_title,
        company_id,
        address,
        phone_no,
        email,
        site_id,
        shift_time_id,
        department,
        image,
        company_code,    -- เพิ่มคอลัมน์นี้
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id
    `;
    const result = await client.query(insertQuery, [
      name,
      job_title,
      company_id,
      address,
      phone_no,
      email,
      site_id || null,
      shift_time_id || null,
      department,
      imageBuffer,
      company_code   // ส่งค่าที่ได้รับจากฟอร์ม
    ]);

    let newStaffId = result.rows[0].id;

    // ลบไฟล์ tmp ถ้ามี
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการเพิ่ม Staff
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
      'add_staff',
      `User added staff with ID ${newStaffId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/staff');
  } catch (error) {
    console.error('Error adding staff:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   3) แก้ไข Staff (Edit) (POST /management/staff/edit/:id)
------------------------------------------*/
router.post('/edit/:id', upload.single('image'), async (req, res) => {
  const staffId = req.params.id;
  const {
    name,
    job_title,
    company_id,
    address,
    phone_no,
    email,
    site_id,
    shift_time_id,
    department,
    company_code
  } = req.body;

  const client = await pool.connect();
  try {
    let updateQuery;
    let queryParams;
    
    if (req.file) {
      // ถ้ามีการอัปโหลดรูปใหม่ ให้อ่านไฟล์และอัปเดตคอลัมน์ image ด้วย
      const imageBuffer = fs.readFileSync(req.file.path);
      updateQuery = `
        UPDATE staff
        SET
          name = $1,
          job_title = $2,
          company_id = $3,
          address = $4,
          phone_no = $5,
          email = $6,
          site_id = $7,
          shift_time_id = $8,
          department = $9,
          company_code = $10,
          image = $11,
          updated_at = NOW()
        WHERE id = $12
          AND deleted_at IS NULL
      `;
      queryParams = [
        name,
        job_title,
        company_id,
        address,
        phone_no,
        email,
        site_id || null,
        shift_time_id || null,
        department,
        company_code,
        imageBuffer,
        staffId
      ];
    } else {
      // ถ้าไม่มีการอัปโหลดรูปใหม่ ไม่อัปเดตคอลัมน์ image
      updateQuery = `
        UPDATE staff
        SET
          name = $1,
          job_title = $2,
          company_id = $3,
          address = $4,
          phone_no = $5,
          email = $6,
          site_id = $7,
          shift_time_id = $8,
          department = $9,
          company_code = $10,
          updated_at = NOW()
        WHERE id = $11
          AND deleted_at IS NULL
      `;
      queryParams = [
        name,
        job_title,
        company_id,
        address,
        phone_no,
        email,
        site_id || null,
        shift_time_id || null,
        department,
        company_code,
        staffId
      ];
    }
    
    await client.query(updateQuery, queryParams);

    // ลบไฟล์ temp ถ้ามี
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการแก้ไข Staff
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
      'edit_staff',
      `User edited staff with ID ${staffId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/staff');
  } catch (error) {
    console.error('Error editing staff:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   4) ลบ Staff (Soft Delete) (POST /management/staff/delete/:id)
------------------------------------------*/
router.post('/delete/:id', async (req, res) => {
  const staffId = req.params.id;
  const client = await pool.connect();
  try {
    const deleteQuery = `
      UPDATE staff
      SET deleted_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
    `;
    await client.query(deleteQuery, [staffId]);

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการลบ Staff
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
      'delete_staff',
      `User deleted staff with ID ${staffId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/staff');
  } catch (error) {
    console.error('Error deleting staff:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

module.exports = router;
