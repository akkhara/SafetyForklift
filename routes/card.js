const express = require('express');
const router = express.Router();

const pool = require('../index'); // นำเข้า pool จาก index.js

/* -----------------------------------------
   1) แสดงรายการ Card (GET /management/card)
   - JOIN กับ staff เพื่อดึงชื่อ staff
------------------------------------------*/
router.get('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const cardQuery = `
      SELECT
        c.id AS card_id,
        c.uid,
        TO_CHAR(c.issue_date, 'YYYY-MM-DD') AS issue_date,
        c.status,
        s.id AS staff_id,
        s.name AS staff_name,
        co.id AS company_id,
        co.name AS company_name,
        ARRAY_REMOVE(ARRAY_AGG(cf.fleet_id), NULL) AS fleet_ids
      FROM card c
      LEFT JOIN staff s ON c.assigned_staff_id = s.id
      LEFT JOIN company co ON c.company_id = co.id
      LEFT JOIN card_fleet cf ON c.id = cf.card_id
      WHERE c.deleted_at IS NULL
      GROUP BY c.id, s.id, co.id
      ORDER BY c.id ASC
    `;
    const cardResult = await client.query(cardQuery);
    const cards = cardResult.rows;

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

// เพิ่ม Card
router.post('/add', async (req, res) => {
  let { uid, issue_date, status, company_id, assigned_staff_id } = req.body;
  uid = uid ? uid.trim() : ''; // <-- เพิ่มบรรทัดนี้
  let fleet_ids = req.body.fleet_ids;
  if (!fleet_ids) fleet_ids = [];
  if (!Array.isArray(fleet_ids)) fleet_ids = [fleet_ids];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertCardQuery = `
      INSERT INTO card (uid, issue_date, status, company_id, assigned_staff_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id
    `;
    const cardResult = await client.query(insertCardQuery, [
      uid, issue_date, status, company_id || null, assigned_staff_id || null
    ]);
    const cardId = cardResult.rows[0].id;

    // เพิ่ม fleet ที่เลือก
    if (fleet_ids.length > 0 && fleet_ids[0] !== '') {
      const insertFleetQuery = `
        INSERT INTO card_fleet (card_id, fleet_id)
        SELECT $1, UNNEST($2::int[])
      `;
      await client.query(insertFleetQuery, [cardId, fleet_ids.map(Number)]);
    }

    // บันทึกการใช้งาน (Usage Log) สำหรับเพิ่ม card
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
      'add_card',
      `User added card with UID ${uid}`,
      req.ip,
      req.headers['user-agent'] || ''
    ]);

    await client.query('COMMIT');
    res.redirect('/management/card');
  } catch (error) {
    await client.query('ROLLBACK');
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
  let { uid, issue_date, status, company_id, assigned_staff_id } = req.body;
  uid = uid ? uid.trim() : ''; // <-- เพิ่มบรรทัดนี้
  const cardId = req.params.id;
  let fleet_ids = req.body.fleet_ids;
  if (!fleet_ids) fleet_ids = [];
  if (!Array.isArray(fleet_ids)) fleet_ids = [fleet_ids];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateCardQuery = `
      UPDATE card
      SET uid = $1,
          issue_date = $2,
          status = $3,
          company_id = $4,
          assigned_staff_id = $5,
          updated_at = NOW()
      WHERE id = $6 AND deleted_at IS NULL
    `;
    await client.query(updateCardQuery, [
      uid, issue_date, status, company_id || null, assigned_staff_id || null, cardId
    ]);

    // ลบ fleet เดิมทั้งหมด
    await client.query('DELETE FROM card_fleet WHERE card_id = $1', [cardId]);

    // เพิ่ม fleet ใหม่
    if (fleet_ids.length > 0 && fleet_ids[0] !== '') {
      const insertFleetQuery = `
        INSERT INTO card_fleet (card_id, fleet_id)
        SELECT $1, UNNEST($2::int[])
      `;
      await client.query(insertFleetQuery, [cardId, fleet_ids.map(Number)]);
    }

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

    await client.query('COMMIT');
    res.redirect('/management/card');
  } catch (error) {
    await client.query('ROLLBACK');
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

/* -----------------------------------------
   5) ดึง Card ตามบริษัท (GET /management/card/by-company/:companyId)
------------------------------------------*/
router.get('/by-company/:companyId', async (req, res) => {
  const companyId = req.params.companyId;
  const client = await pool.connect();
  try {
    const query = `
      SELECT c.id, c.uid, s.name AS staff_name
      FROM card c
      LEFT JOIN staff s ON c.assigned_staff_id = s.id
      WHERE c.company_id = $1
        AND c.deleted_at IS NULL
      ORDER BY s.name ASC, c.uid ASC
    `;
    const result = await client.query(query, [companyId]);
    res.json({ cards: result.rows });
  } catch (error) {
    console.error('Error fetching cards by company:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/* -----------------------------------------
   6) ดึง Fleet IDs ที่เชื่อมโยงกับ Card นี้ (GET /management/card/fleets/:cardId)
------------------------------------------*/
router.get('/fleets/:cardId', async (req, res) => {
  const cardId = req.params.cardId;
  const client = await pool.connect();
  try {
    const query = `
      SELECT fleet_id
      FROM card_fleet
      WHERE card_id = $1
    `;
    const result = await client.query(query, [cardId]);
    const fleetIds = result.rows.map(row => row.fleet_id);
    res.json({ fleetIds });
  } catch (error) {
    console.error('Error fetching fleets for card:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;

