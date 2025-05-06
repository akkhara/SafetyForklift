const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const xlsx = require('xlsx'); // เพิ่มการ import ไลบรารี xlsx
const pool = require('../index'); // ดึง pool จาก index.js

// ตั้งค่า Multer สำหรับอัปโหลดไฟล์
const upload = multer({ dest: 'uploads/' });

// ฟังก์ชันแปลง UID เป็น Hex Little-Endian
function decToLEHex(decStr) {
  let bn = BigInt(decStr);
  const bytes = [];
  while (bn > 0n) {
    bytes.push(Number(bn & 0xFFn));
    bn >>= 8n;
  }
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

// GET /admin/import
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    const companyQuery = `
      SELECT id, name, customer_code
      FROM company
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `;
    const result = await client.query(companyQuery);
    const companies = result.rows;
    res.render('admin_import', { companies });
  } catch (error) {
    console.error("Error fetching companies:", error);
    res.status(500).send("Internal server error");
  } finally {
    client.release();
  }
});

// POST /admin/import
router.post('/', upload.single('importFile'), async (req, res, next) => {
  const companyId = parseInt(req.body.company_id, 10);
  if (!companyId) {
    return res.status(400).json({ error: 'company_id is required' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const workbook = xlsx.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results = [];
    for (const row of rows) {
      const name = row.ThaiName?.trim();
      const englishName = row.EnglishName?.trim();
      const jobTitle = row.JobTitle?.trim();
      const companyCode = row.ID;
      const department = row.Section?.trim();
      const rawUid = row.ChonburiForklift;

      if (!name || !rawUid) {
        results.push({ row, status: 'skipped (missing name or UID)' });
        continue;
      }

      // 1. หา หรือ สร้าง staff
      const staffQ = await client.query(
        `SELECT id FROM public.staff
           WHERE name = $1 AND company_id = $2 AND deleted_at IS NULL
           LIMIT 1`,
        [name, companyId]
      );
      let staffId;
      if (staffQ.rowCount > 0) {
        staffId = staffQ.rows[0].id;
      } else {
        const insertStaff = await client.query(
          `INSERT INTO public.staff
             (name, english_name, job_title, company_id, department, company_code, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             RETURNING id`,
          [name, englishName, jobTitle, companyId, department, companyCode]
        );
        staffId = insertStaff.rows[0].id;
      }

      // 2. แปลง UID เป็น hex little-endian
      const uidHex = decToLEHex(rawUid);

      // 3. หา หรือ สร้าง card
      const cardQ = await client.query(
        `SELECT id FROM public.card
           WHERE uid = $1 AND deleted_at IS NULL
           LIMIT 1`,
        [uidHex]
      );
      if (cardQ.rowCount > 0) {
        // อัปเดต assigned_staff_id ให้ตรง
        await client.query(
          `UPDATE public.card
             SET assigned_staff_id = $1,
                 updated_at = now()
             WHERE id = $2`,
          [staffId, cardQ.rows[0].id]
        );
      } else {
        // สร้างใหม่ พร้อมระบุ staff
        await client.query(
          `INSERT INTO public.card
             (assigned_staff_id, issue_date, status, uid, created_at)
             VALUES ($1, now(), 'active', $2, now())`,
          [staffId, uidHex]
        );
      }

      results.push({ name, uidHex, staffId, status: 'ok' });
    }

    await client.query('COMMIT');
    res.render('admin_import', { companies: [], message: 'Import completed successfully!', messageType: 'success' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during import:', err);
    res.render('admin_import', { companies: [], message: 'Error during import process', messageType: 'error' });
  } finally {
    client.release();

    // ลบไฟล์ชั่วคราว
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

module.exports = router;