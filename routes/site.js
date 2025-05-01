const express = require('express');
const router = express.Router();
const pool = require('../index'); // นำเข้า pool จาก index.js

/* -----------------------------------------
   1) แสดงรายการ Site (GET /management/site)
   - JOIN กับ company เพื่อดึงชื่อบริษัท
------------------------------------------*/
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        s.id AS site_id,
        s.name AS site_name,
        s.contact_person,
        s.contact_phone,
        s.contact_email,
        s.latitude,
        s.longitude,
        c.id AS company_id,
        c.name AS company_name
      FROM site s
      JOIN company c ON s.company_id = c.id
      WHERE s.deleted_at IS NULL
      ORDER BY s.id ASC
    `;
    const result = await client.query(query);
    const sites = result.rows;

    // ดึงรายชื่อ company (สำหรับ dropdown เลือก company)
    const companyResult = await client.query(`
      SELECT id, name
      FROM company
      WHERE deleted_at IS NULL
      ORDER BY name
    `);
    const companies = companyResult.rows;

    // render หน้า site_list_modal.ejs
    res.render('site_list_modal', { sites, companies });
  } catch (error) {
    console.error('Error fetching sites:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   2) เพิ่ม Site (Add) (POST /management/site/add)
------------------------------------------*/
router.post('/add', async (req, res) => {
  const {
    name,
    company_id,
    contact_person,
    contact_phone,
    contact_email,
    latitude,
    longitude
  } = req.body;

  const client = await pool.connect();
  try {
    const insertQuery = `
      INSERT INTO site (
        name,
        company_id,
        contact_person,
        contact_phone,
        contact_email,
        latitude,
        longitude,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id
    `;
    const result = await client.query(insertQuery, [
      name,
      company_id,
      contact_person,
      contact_phone,
      contact_email,
      latitude,
      longitude
    ]);
    const newSiteId = result.rows[0].id;

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการเพิ่ม site
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
      'add_site',
      `User added site with ID ${newSiteId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/site');
  } catch (error) {
    console.error('Error adding site:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   3) แก้ไข Site (Edit) (POST /management/site/edit/:id)
------------------------------------------*/
router.post('/edit/:id', async (req, res) => {
  const siteId = req.params.id;
  const {
    name,
    company_id,
    contact_person,
    contact_phone,
    contact_email
  } = req.body;

  const client = await pool.connect();
  try {
    const updateQuery = `
      UPDATE site
      SET
        name = $1,
        company_id = $2,
        contact_person = $3,
        contact_phone = $4,
        contact_email = $5,
        updated_at = NOW()
      WHERE id = $6
        AND deleted_at IS NULL
    `;
    await client.query(updateQuery, [
      name,
      company_id,
      contact_person,
      contact_phone,
      contact_email,
      siteId
    ]);

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการแก้ไข site
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
      'edit_site',
      `User edited site with ID ${siteId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/site');
  } catch (error) {
    console.error('Error editing site:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   4) ลบ Site (Soft Delete) (POST /management/site/delete/:id)
------------------------------------------*/
router.post('/delete/:id', async (req, res) => {
  const siteId = req.params.id;
  const client = await pool.connect();
  try {
    const deleteQuery = `
      UPDATE site
      SET deleted_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
    `;
    await client.query(deleteQuery, [siteId]);

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการลบ site
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
      'delete_site',
      `User deleted site with ID ${siteId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/site');
  } catch (error) {
    console.error('Error deleting site:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

module.exports = router;
