const express = require('express');
const router = express.Router();
const pool = require('../index'); // นำเข้า pool จาก index.js

/* -----------------------------------------
   1) แสดงรายการ Shift Time (GET /management/shift_time)
      - JOIN shift_time_site -> site เพื่อดึงรายชื่อ Sites ที่เกี่ยวข้อง
------------------------------------------*/
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    // Query เอา Shift Time ทั้งหมด (ที่ไม่ถูกลบ) พร้อม Sites
    // ใช้ array_agg เก็บ Site name หรือ ID
    const query = `
      SELECT
        st.id AS shift_time_id,
        st.name AS shift_time_name,
        st.start_time,
        st.end_time,
        st.deleted_at,
        array_agg(si.id) FILTER (WHERE si.id IS NOT NULL) AS site_ids,
        array_agg(si.name) FILTER (WHERE si.id IS NOT NULL) AS site_names
      FROM shift_time st
      LEFT JOIN shift_time_site sts ON st.id = sts.shift_time_id
      LEFT JOIN site si ON sts.site_id = si.id
      WHERE st.deleted_at IS NULL
      GROUP BY st.id
      ORDER BY st.id ASC
    `;
    const result = await client.query(query);
    const shiftTimes = result.rows;

    // ดึงรายชื่อ Site (สำหรับ dropdown หลายตัว)
    const siteResult = await client.query(`
      SELECT id, name
      FROM site
      WHERE deleted_at IS NULL
      ORDER BY name
    `);
    const sites = siteResult.rows;

    // render หน้า shift_time_list_modal.ejs
    res.render('shift_time_list_modal', { shiftTimes, sites });
  } catch (error) {
    console.error('Error fetching shift_time:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   2) เพิ่ม Shift Time (Add) (POST /management/shift_time/add)
   - Insert shift_time
   - Insert shift_time_site ตาม sites ที่เลือก
------------------------------------------*/
router.post('/add', async (req, res) => {
  const { name, start_time, end_time, site_ids } = req.body;
  // site_ids อาจเป็น string หรือ array ถ้าส่งเป็น multiple select
  // ถ้าใช้ multiple select => site_ids จะเป็น Array

  const client = await pool.connect();
  try {
    // 1) Insert shift_time
    const insertQuery = `
      INSERT INTO shift_time (
        name,
        start_time,
        end_time,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id
    `;
    const insertResult = await client.query(insertQuery, [name, start_time, end_time]);
    const newShiftTimeId = insertResult.rows[0].id;

    // 2) Insert shift_time_site (ถ้าเลือก Site)
    if (site_ids) {
      // ถ้าเป็น string ให้ทำเป็น Array
      let siteArray = Array.isArray(site_ids) ? site_ids : [site_ids];

      for (const siteId of siteArray) {
        if (siteId) {
          await client.query(
            `INSERT INTO shift_time_site (shift_time_id, site_id) VALUES ($1, $2)`,
            [newShiftTimeId, siteId]
          );
        }
      }
    }

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการเพิ่ม shift_time
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
      'add_shift_time',
      `User added shift time with ID ${newShiftTimeId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/shift_time');
  } catch (error) {
    console.error('Error adding shift_time:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   3) แก้ไข Shift Time (Edit) (POST /management/shift_time/edit/:id)
   - Update shift_time
   - ลบข้อมูลใน shift_time_site เดิม แล้ว insert ใหม่ตาม sites ที่เลือก
------------------------------------------*/
router.post('/edit/:id', async (req, res) => {
  const shiftTimeId = req.params.id;
  const { name, start_time, end_time, site_ids } = req.body;

  const client = await pool.connect();
  try {
    // 1) Update shift_time
    const updateQuery = `
      UPDATE shift_time
      SET
        name = $1,
        start_time = $2,
        end_time = $3,
        updated_at = NOW()
      WHERE id = $4
        AND deleted_at IS NULL
    `;
    await client.query(updateQuery, [name, start_time, end_time, shiftTimeId]);

    // 2) ลบข้อมูล shift_time_site เดิม
    await client.query(
      `DELETE FROM shift_time_site WHERE shift_time_id = $1`,
      [shiftTimeId]
    );

    // 3) Insert ใหม่ตาม sites ที่เลือก
    if (site_ids) {
      let siteArray = Array.isArray(site_ids) ? site_ids : [site_ids];
      for (const siteId of siteArray) {
        if (siteId) {
          await client.query(
            `INSERT INTO shift_time_site (shift_time_id, site_id) VALUES ($1, $2)`,
            [shiftTimeId, siteId]
          );
        }
      }
    }

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการแก้ไข shift_time
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
      'edit_shift_time',
      `User edited shift time with ID ${shiftTimeId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/shift_time');
  } catch (error) {
    console.error('Error editing shift_time:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   4) ลบ Shift Time (Soft Delete) (POST /management/shift_time/delete/:id)
------------------------------------------*/
router.post('/delete/:id', async (req, res) => {
  const shiftTimeId = req.params.id;

  const client = await pool.connect();
  try {
    const deleteQuery = `
      UPDATE shift_time
      SET deleted_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
    `;
    await client.query(deleteQuery, [shiftTimeId]);

    // หากต้องการลบ shift_time_site ด้วย (optional):
    // await client.query(`DELETE FROM shift_time_site WHERE shift_time_id = $1`, [shiftTimeId]);

    // บันทึกข้อมูลการใช้งาน (Usage Log) สำหรับการลบ shift_time
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
      'delete_shift_time',
      `User deleted shift time with ID ${shiftTimeId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/shift_time');
  } catch (error) {
    console.error('Error deleting shift_time:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

module.exports = router;
