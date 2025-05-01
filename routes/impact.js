const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');

const pool = require('../index'); // นำเข้า pool จาก index.js

/* 
  GET /reports/impact
  - รับค่ากรอง forklift_id, staff_id, severity, start_date, end_date
  - JOIN impact_log + forklift + staff
  - แสดงผลใน EJS
*/
router.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const client = await pool.connect();
  try {
    // รับค่ากรองจาก query string
    let { fleet_id, staff_id, severity, start_date, end_date } = req.query;

    // หากไม่มีการระบุวันที่ ให้กำหนดเป็นวันแรกและวันสุดท้ายของเดือนปัจจุบัน
    const currentDate = new Date();
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 2);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    if (!start_date) {
      start_date = firstDay.toISOString().split('T')[0];
    }
    if (!end_date) {
      end_date = lastDay.toISOString().split('T')[0];
    }

    let baseQuery = `
      SELECT
        ul.id AS impact_id,
        f.vehicle_name AS fleet_name,
        s.name AS staff_name,
        ul.severity,
        ul.g_force,
        ul."location" AS location,
        TO_CHAR(ul.occurred_at, 'YYYY-MM-DD HH24:MI:SS') AS occurred_at
      FROM impact_log ul
      JOIN fleet f ON ul.fleet_id = f.id
      JOIN staff s ON ul.staff_id = s.id
      WHERE ul.deleted_at IS NULL
    `;
    let params = [];
    let conditions = [];

    if (fleet_id) {
      conditions.push(`f.id = $${params.length + 1}`);
      params.push(fleet_id);
    }
    if (staff_id) {
      conditions.push(`s.id = $${params.length + 1}`);
      params.push(staff_id);
    }
    if (severity) {
      conditions.push(`ul.severity ILIKE $${params.length + 1}`);
      params.push(`%${severity}%`);
    }
    // กรองด้วย start_date และ end_date
    if (start_date) {
      conditions.push(`ul.occurred_at >= $${params.length + 1}`);
      params.push(start_date);
    }
    if (end_date) {
      conditions.push(`ul.occurred_at < ($${params.length + 1}::date + interval '1 day')`);
      params.push(end_date);
    }

    if (conditions.length > 0) {
      baseQuery += " AND " + conditions.join(" AND ");
    }
    baseQuery += " ORDER BY ul.id DESC";

    // รัน query
    const result = await client.query(baseQuery, params);
    const impacts = result.rows;

    // ดึงรายการ fleet สำหรับ dropdown
    const fleetResult = await client.query(`
      SELECT id, vehicle_name
      FROM fleet
      WHERE deleted_at IS NULL
      ORDER BY vehicle_name
    `);
    const staffResult = await client.query(`
      SELECT id, name
      FROM staff
      WHERE deleted_at IS NULL
      ORDER BY name
    `);
    const severityOptions = ['Low', 'Medium', 'High'];

    res.render('impact_report', {
      impacts,
      fleets: fleetResult.rows,
      staffs: staffResult.rows,
      severityOptions,
      filters: { fleet_id, staff_id, severity, start_date, end_date }
    });
  } catch (err) {
    console.error('Error retrieving impact report:', err);
    res.status(500).send('Error retrieving impact report');
  } finally {
    client.release();
  }
});

/* --------------------------------------------
  Export Impact Report as CSV (GET /reports/impact/export/csv)
-------------------------------------------- */
router.get('/export/csv', async (req, res) => {
  const client = await pool.connect();
  try {
    // รับค่าจาก query string เหมือนใน route GET /
    let { fleet_id, staff_id, severity, start_date, end_date } = req.query;

    // กำหนดค่า default ของวันที่ (วันแรก-วันสุดท้ายของเดือนปัจจุบัน) หากไม่มีการส่งมา
    if (!start_date || !end_date) {
      const currentDate = new Date();
      const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 2);
      const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
      if (!start_date) {
        start_date = firstDay.toISOString().split('T')[0];
      }
      if (!end_date) {
        end_date = lastDay.toISOString().split('T')[0];
      }
    }

    let baseQuery = `
      SELECT
        il.id AS impact_id,
        f.vehicle_name AS fleet_name,
        s.name AS staff_name,
        il.severity,
        il.g_force,
        il."location" AS location,
        TO_CHAR(il.occurred_at, 'YYYY-MM-DD HH24:MI:SS') AS occurred_at
      FROM impact_log il
      JOIN fleet f ON il.fleet_id = f.id
      JOIN staff s ON il.staff_id = s.id
      WHERE il.deleted_at IS NULL
    `;
    let params = [];
    let conditions = [];

    if (fleet_id) {
      conditions.push(`f.id = $${params.length + 1}`);
      params.push(fleet_id);
    }
    if (staff_id) {
      conditions.push(`s.id = $${params.length + 1}`);
      params.push(staff_id);
    }
    if (severity) {
      conditions.push(`il.severity ILIKE $${params.length + 1}`);
      params.push(`%${severity}%`);
    }
    if (start_date) {
      conditions.push(`il.occurred_at >= $${params.length + 1}`);
      params.push(start_date);
    }
    if (end_date) {
      conditions.push(`il.occurred_at < ($${params.length + 1}::date + interval '1 day')`);
      params.push(end_date);
    }
    if (conditions.length > 0) {
      baseQuery += " AND " + conditions.join(" AND ");
    }
    baseQuery += " ORDER BY il.id DESC";

    const result = await client.query(baseQuery, params);
    const impacts = result.rows;

    // ตั้ง Header ให้ browser ดาวน์โหลดเป็น CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="impact_report.csv"');

    // สร้าง CSV header
    let csvContent = 'Impact ID,Fleet Name,Staff Name,Severity,G-Force,Location,Occurred At\n';
    // Loop สร้างข้อมูล CSV
    impacts.forEach(impact => {
      csvContent += [
        impact.impact_id,
        `"${impact.fleet_name}"`,
        `"${impact.staff_name}"`,
        impact.severity,
        impact.g_force,
        `"${impact.location || ''}"`,
        impact.occurred_at
      ].join(',') + '\n';
    });
    res.send(csvContent);
  } catch (err) {
    console.error('Error exporting CSV:', err);
    res.status(500).send('Error exporting CSV');
  } finally {
    client.release();
  }
});

/* --------------------------------------------
  Export Impact Report as Excel (GET /reports/impact/export/excel)
-------------------------------------------- */
router.get('/export/excel', async (req, res) => {
  const client = await pool.connect();
  try {
    // รับค่าจาก query string เช่นเดียวกับใน CSV Export
    let { fleet_id, staff_id, severity, start_date, end_date } = req.query;
    if (!start_date || !end_date) {
      const currentDate = new Date();
      const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 2);
      const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
      if (!start_date) {
        start_date = firstDay.toISOString().split('T')[0];
      }
      if (!end_date) {
        end_date = lastDay.toISOString().split('T')[0];
      }
    }

    let baseQuery = `
      SELECT
        il.id AS impact_id,
        f.vehicle_name AS fleet_name,
        s.name AS staff_name,
        il.severity,
        il.g_force,
        il."location" AS location,
        TO_CHAR(il.occurred_at, 'YYYY-MM-DD HH24:MI:SS') AS occurred_at
      FROM impact_log il
      JOIN fleet f ON il.fleet_id = f.id
      JOIN staff s ON il.staff_id = s.id
      WHERE il.deleted_at IS NULL
    `;
    let params = [];
    let conditions = [];

    if (fleet_id) {
      conditions.push(`f.id = $${params.length + 1}`);
      params.push(fleet_id);
    }
    if (staff_id) {
      conditions.push(`s.id = $${params.length + 1}`);
      params.push(staff_id);
    }
    if (severity) {
      conditions.push(`il.severity ILIKE $${params.length + 1}`);
      params.push(`%${severity}%`);
    }
    if (start_date) {
      conditions.push(`il.occurred_at >= $${params.length + 1}`);
      params.push(start_date);
    }
    if (end_date) {
      conditions.push(`il.occurred_at < ($${params.length + 1}::date + interval '1 day')`);
      params.push(end_date);
    }
    if (conditions.length > 0) {
      baseQuery += " AND " + conditions.join(" AND ");
    }
    baseQuery += " ORDER BY il.id DESC";

    const result = await client.query(baseQuery, params);
    const impacts = result.rows;

    // สร้างไฟล์ Excel ด้วย ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Impact Report');

    // กำหนด header columns
    worksheet.columns = [
      { header: 'Impact ID', key: 'impact_id', width: 10 },
      { header: 'Fleet Name', key: 'fleet_name', width: 20 },
      { header: 'Staff Name', key: 'staff_name', width: 20 },
      { header: 'Severity', key: 'severity', width: 10 },
      { header: 'G-Force', key: 'g_force', width: 10 },
      { header: 'Location', key: 'location', width: 30 },
      { header: 'Occurred At', key: 'occurred_at', width: 20 }
    ];

    // เพิ่มข้อมูลใน worksheet
    impacts.forEach(impact => {
      worksheet.addRow({
        impact_id: impact.impact_id,
        fleet_name: impact.fleet_name,
        staff_name: impact.staff_name,
        severity: impact.severity,
        g_force: impact.g_force,
        location: impact.location,
        occurred_at: impact.occurred_at
      });
    });

    // ตั้ง Header ให้ Browser ดาวน์โหลดไฟล์ Excel
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="impact_report.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting Excel:', err);
    res.status(500).send('Error exporting Excel');
  } finally {
    client.release();
  }
});

module.exports = router;
