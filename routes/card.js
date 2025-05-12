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
        s.name AS staff_name,
        co.id AS company_id,
        co.name AS company_name
      FROM card c
      LEFT JOIN staff s ON c.assigned_staff_id = s.id
      LEFT JOIN company co ON c.company_id = co.id
      WHERE c.deleted_at IS NULL
      ORDER BY c.id ASC
    `;
    const result = await client.query(query);
    const cards = result.rows;

    // ดึงข้อมูลบริษัทสำหรับ Dropdown
    const companyQuery = `
      SELECT id, name
      FROM company
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `;
    const companyResult = await client.query(companyQuery);
    const companies = companyResult.rows;

    res.render('card_list_modal', { cards, companies });
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
  const { uid, issue_date, status, company_id } = req.body;
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO card (uid, issue_date, status, company_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
    `;
    await client.query(query, [uid, issue_date, status, company_id || null]);

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
  const { uid, issue_date, status, company_id } = req.body;
  const client = await pool.connect();
  try {
    const query = `
      UPDATE card
      SET
        uid = $1,
        issue_date = $2,
        status = $3,
        company_id = $4,
        updated_at = NOW()
      WHERE id = $5
        AND deleted_at IS NULL
    `;
    await client.query(query, [uid, issue_date, status, company_id || null, cardId]);

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
