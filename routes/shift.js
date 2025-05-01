const express = require('express');
const router = express.Router();
const pool = require('../index'); // นำเข้า pool จาก index.js

/* --------------------------------------------
 2.1. ฟังก์ชันช่วยสร้าง Query สำหรับ Shift Log
		 ตามเงื่อนไขที่ผู้ใช้กรอก
-------------------------------------------- */
function buildShiftQuery(filters) {
	/*
		filters = {
			company_id: (string|undefined),
			card_uid: (string|undefined),
			staff_name: (string|undefined),
			fleet_name: (string|undefined), // <-- เพิ่มตัวนี้
			start_date: (string|undefined),
			end_date: (string|undefined)
		}
	*/

	let baseQuery = `
        SELECT
          sl.id AS shift_log_id,
          st.name AS staff_name,
          c2.name AS company_name,
          card.uid AS card_uid,
          f.vehicle_name AS fleet_name,
          TO_CHAR(sl.check_in, 'YYYY-MM-DD HH24:MI:SS') AS check_in,
          TO_CHAR(sl.check_out, 'YYYY-MM-DD HH24:MI:SS') AS check_out
        FROM shift_log sl
        JOIN staff st ON sl.staff_id = st.id
        JOIN company c2 ON st.company_id = c2.id
        JOIN card ON sl.card_id = card.id
        JOIN fleet f ON sl.fleet_id = f.id
      `;

	let conditions = [];
	let params = [];

	// Filter: company_id
	if (filters.company_id) {
		conditions.push(`c2.id = $${params.length + 1}`);
		params.push(filters.company_id);
	}

	// Filter: card_uid
	if (filters.card_uid) {
		conditions.push(`card.uid ILIKE $${params.length + 1}`);
		params.push(`%${filters.card_uid}%`);
	}

	// Filter: staff_name
	if (filters.staff_name) {
		conditions.push(`st.name ILIKE $${params.length + 1}`);
		params.push(`%${filters.staff_name}%`);
	}

	// Filter: fleet_name (ใหม่)
	if (filters.fleet_name) {
		conditions.push(`f.vehicle_name ILIKE $${params.length + 1}`);
		params.push(`%${filters.fleet_name}%`);
	}

	// Filter: start_date
	if (filters.start_date) {
		conditions.push(`sl.check_in >= $${params.length + 1}`);
		params.push(filters.start_date);
	}

	// Filter: end_date
	if (filters.end_date) {
		conditions.push(`sl.check_in < ($${params.length + 1}::date + interval '1 day')`);
		params.push(filters.end_date);
	}

	if (conditions.length > 0) {
		baseQuery += ` WHERE ` + conditions.join(' AND ');
	}

	// เรียงตาม ID
	baseQuery += ` ORDER BY sl.id DESC`;

	return { queryString: baseQuery, params };
}

/* --------------------------------------------
 2.2. Route แสดงหน้า /shifts (GET)
			พร้อมกรองข้อมูลตาม query string
-------------------------------------------- */
router.get('/', async (req, res) => {
	if (!req.session.user) {
		return res.redirect('/login');
	}
	const client = await pool.connect();
	try {
		// ดึงค่ากรองจาก query string
		let { company_id, card_uid, staff_name, fleet_name, start_date, end_date } = req.query;

		// หากไม่มีการส่ง start_date หรือ end_date ให้กำหนดเป็นวันแรกและวันสุดท้ายของเดือนปัจจุบัน
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

		// สร้าง object filters
		let filters = { company_id, card_uid, staff_name, fleet_name, start_date, end_date };

		// หากผู้ใช้ไม่ใช่ super_admin ให้บังคับให้ filters.company_id เป็นของผู้ใช้เท่านั้น
		if (req.session.user.role !== 'super_admin') {
			filters.company_id = req.session.user.company_id;
		}

		// สร้าง query โดยใช้ฟังก์ชัน buildShiftQuery (ฟังก์ชันนี้จะสร้าง SQL และ params ตาม filters ที่ส่งมา)
		const { queryString, params } = buildShiftQuery(filters);

		// รัน query สำหรับ shift report
		const result = await client.query(queryString, params);
		const shifts = result.rows;

		// ดึงรายชื่อบริษัทสำหรับ dropdown
		let companyQuery;
		let companyParams = [];
		if (req.session.user.role !== 'super_admin') {
			companyQuery = `
		  SELECT id, name
		  FROM company
		  WHERE id = $1 AND deleted_at IS NULL
		  ORDER BY name ASC
		`;
			companyParams.push(req.session.user.company_id);
		} else {
			companyQuery = `
		  SELECT id, name
		  FROM company
		  WHERE deleted_at IS NULL
		  ORDER BY name ASC
		`;
		}
		const companyResult = await client.query(companyQuery, companyParams);
		const companies = companyResult.rows;

		res.render('shifts', {
			shifts,
			companies,
			filters
		});
	} catch (err) {
		console.error(err);
		res.status(500).send('Error retrieving shift log data');
	} finally {
		client.release();
	}
});

/* --------------------------------------------
 2.3. Route Export CSV (GET)
			Export ตามเงื่อนไขเดียวกัน (Filter)
-------------------------------------------- */
router.get('/export/csv', async (req, res) => {
	const client = await pool.connect();
	try {
		// รับค่า filters เหมือน /shifts
		const { company_id, card_uid, staff_name, start_date, end_date } = req.query;
		const filters = { company_id, card_uid, staff_name, start_date, end_date };

		// สร้าง query ด้วยฟังก์ชันเดียวกัน
		const { queryString, params } = buildShiftQuery(filters);
		const result = await client.query(queryString, params);

		// ตั้ง Header ให้ browser ดาวน์โหลดเป็น CSV
		res.setHeader('Content-Type', 'text/csv');
		res.setHeader('Content-Disposition', 'attachment; filename="shifts.csv"');

		// สร้าง Header ของ CSV
		let csvContent = 'Shift ID,Staff Name,Company,Card UID,Fleet Name,Check In,Check Out\n';

		// Loop ใส่ข้อมูล
		result.rows.forEach(shift => {
			// ใส่ "" เพื่อกัน comma ที่อาจมีในข้อความ
			csvContent += [
				shift.shift_log_id,
				`"${shift.staff_name}"`,
				`"${shift.company_name}"`,
				`"${shift.card_uid}"`,
				`"${shift.fleet_name}"`,
				shift.check_in,
				shift.check_out
			].join(',') + '\n';
		});

		// ส่ง CSV กลับ
		res.send(csvContent);
	} catch (err) {
		console.error(err);
		res.status(500).send('Error exporting CSV');
	} finally {
		client.release();
	}
});

/* --------------------------------------------
 2.4. Route Export Excel (GET)
			Export ตามเงื่อนไขเดียวกัน (Filter)
-------------------------------------------- */
router.get('/export/excel', async (req, res) => {
	const client = await pool.connect();
	try {
		// รับค่า filters
		const { company_id, card_uid, staff_name, start_date, end_date } = req.query;
		const filters = { company_id, card_uid, staff_name, start_date, end_date };

		// สร้าง query ด้วยฟังก์ชันเดียวกัน
		const { queryString, params } = buildShiftQuery(filters);
		const result = await client.query(queryString, params);

		// สร้างไฟล์ Excel ด้วย exceljs
		const workbook = new ExcelJS.Workbook();
		const worksheet = workbook.addWorksheet('Shifts');

		// กำหนดคอลัมน์ (Header)
		worksheet.columns = [
			{ header: 'Shift ID', key: 'shift_log_id', width: 10 },
			{ header: 'Staff Name', key: 'staff_name', width: 20 },
			{ header: 'Company', key: 'company_name', width: 20 },
			{ header: 'Card UID', key: 'card_uid', width: 20 },
			{ header: 'Fleet Name', key: 'fleet_name', width: 20 },
			{ header: 'Check In', key: 'check_in', width: 20 },
			{ header: 'Check Out', key: 'check_out', width: 20 }
		];

		// ใส่ข้อมูลใน Worksheet
		result.rows.forEach(shift => {
			worksheet.addRow({
				shift_log_id: shift.shift_log_id,
				staff_name: shift.staff_name,
				company_name: shift.company_name,
				card_uid: shift.card_uid,
				fleet_name: shift.fleet_name,
				check_in: shift.check_in,
				check_out: shift.check_out
			});
		});

		// ตั้ง Header ให้ Browser ดาวน์โหลดไฟล์ Excel
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="shifts.xlsx"');

		// เขียนไฟล์ลงใน stream
		await workbook.xlsx.write(res);
		res.end();
	} catch (err) {
		console.error(err);
		res.status(500).send('Error exporting Excel');
	} finally {
		client.release();
	}
});

module.exports = router;
