const express = require('express');
const router = express.Router();

const pool = require('../index'); // นำเข้า pool จาก index.js

/* -----------------------------------------
   1) แสดงรายการ Card (GET /management/card)
   - JOIN กับ staff เพื่อดึงชื่อ staff
------------------------------------------*/
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    const query = `
      SELECT
        c.id AS card_id,
        c.uid,
        TO_CHAR(c.issue_date, 'YYYY-MM-DD') AS issue_date,
        c.status,
        s.id AS staff_id,
        s.name AS staff_name
      FROM card c
      JOIN staff s ON c.assigned_staff_id = s.id
      WHERE c.deleted_at IS NULL
      ORDER BY c.id ASC
    `;
    const result = await client.query(query);
    const cards = result.rows;

    // ดึงรายชื่อ staff (สำหรับ dropdown เลือก assigned_staff_id)
    const staffResult = await client.query(`
      SELECT id, name
      FROM staff
      WHERE deleted_at IS NULL
      ORDER BY id
    `);
    const staffs = staffResult.rows;

    // render หน้า card_list_modal.ejs
    res.render('card_list_modal', { cards, staffs });
  } catch (error) {
    console.error('Error fetching cards:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   2) เพิ่ม Card (Add) (POST /management/card/add)
------------------------------------------*/
router.post('/add', async (req, res) => {
  const {
    assigned_staff_id,
    issue_date,
    status,
    uid
  } = req.body;

  const client = await pool.connect();
  try {
    const insertQuery = `
      INSERT INTO card (
        assigned_staff_id,
        issue_date,
        status,
        uid,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
    `;
    await client.query(insertQuery, [
      assigned_staff_id,
      issue_date,
      status,
      uid
    ]);

    // บันทึกข้อมูลการใช้งานลงใน usage_log หลังจากเพิ่ม card เสร็จ
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
      req.session.user ? req.session.user.id : null,  // user_id จาก session
      'add_card',                                      // event_type
      'User added a new card',                         // event_description
      req.ip,                                          // IP Address
      req.headers['user-agent'] || ''                  // User Agent
    ]);

    res.redirect('/management/card');
  } catch (error) {
    console.error('Error adding card:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   3) แก้ไข Card (Edit) (POST /management/card/edit/:id)
------------------------------------------*/
router.post('/edit/:id', async (req, res) => {
  const cardId = req.params.id;
  const {
    assigned_staff_id,
    issue_date,
    status,
    uid
  } = req.body;

  const client = await pool.connect();
  try {
    const updateQuery = `
      UPDATE card
      SET
        assigned_staff_id = $1,
        issue_date = $2,
        status = $3,
        uid = $4,
        updated_at = NOW()
      WHERE id = $5
        AND deleted_at IS NULL
    `;
    await client.query(updateQuery, [
      assigned_staff_id,
      issue_date,
      status,
      uid,
      cardId
    ]);

    // บันทึกการใช้งาน (Usage Log) สำหรับแก้ไข card
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
      'edit_card',
      `User edited card with ID ${cardId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/card');
  } catch (error) {
    console.error('Error editing card:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   4) ลบ Card (Soft Delete) (POST /management/card/delete/:id)
------------------------------------------*/
router.post('/delete/:id', async (req, res) => {
  const cardId = req.params.id;
  const client = await pool.connect();
  try {
    const deleteQuery = `
      UPDATE card
      SET deleted_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
    `;
    await client.query(deleteQuery, [cardId]);

    // บันทึกการใช้งาน (Usage Log) สำหรับลบ card
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
      'delete_card',
      `User deleted card with ID ${cardId}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    res.redirect('/management/card');
  } catch (error) {
    console.error('Error deleting card:', error);
    res.status(500).send('Internal server error');
  } finally {
    client.release();
  }
});

module.exports = router;
