const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../index'); // ดึง pool จาก index.js

// ตั้งค่า Multer สำหรับอัปโหลดไฟล์
const upload = multer({ dest: 'uploads/' });

// GET /admin/import
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    // ดึงข้อมูลบริษัทที่ยังไม่ถูกลบ (deleted_at IS NULL)
    const companyQuery = `
      SELECT id, name, customer_code
      FROM company
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `;
    const result = await client.query(companyQuery);
    const companies = result.rows;
    // ส่งตัวแปร companies ไปยัง view admin_import.ejs
    res.render('admin_import', { companies });
  } catch (error) {
    console.error("Error fetching companies:", error);
    res.status(500).send("Internal server error");
  } finally {
    client.release();
  }
});

// POST /admin/import
router.post('/', upload.single('importFile'), async (req, res) => {
  try {
    // 1) ตรวจสอบว่าไฟล์ถูกอัปโหลดมาหรือไม่
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    // 2) req.file.path = path ของไฟล์ที่ถูกอัปโหลดในโฟลเดอร์ 'uploads/'
    //    สามารถนำไป parse (CSV/Excel) ได้ตามต้องการ
    //    เช่น ถ้าเป็น CSV ใช้ fast-csv หรือถ้าเป็น Excel ใช้ exceljs

    // ตัวอย่าง (สมมติ parse CSV):
    // const fs = require('fs');
    // const csv = require('fast-csv');
    // fs.createReadStream(req.file.path)
    //   .pipe(csv.parse({ headers: true }))
    //   .on('data', row => {
    //     console.log(row);
    //     // TODO: บันทึก row ลงฐานข้อมูล
    //   })
    //   .on('end', rowCount => {
    //     console.log(`Parsed ${rowCount} rows`);
    //   });

    // 3) เสร็จแล้ว redirect กลับไปหน้า admin หรือจะแจ้งผลลัพธ์ก็ได้
    res.redirect('/admin');
  } catch (err) {
    console.error('Error importing data:', err);
    res.status(500).send('Error importing data');
  }
});

module.exports = router;