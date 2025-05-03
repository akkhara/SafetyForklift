require('dotenv').config();
const { Pool } = require('pg');
const express = require('express');
const cors = require("cors");
const app = express();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');

// สร้าง HTTP Server
const server = http.createServer(app);

// สร้าง Socket.IO Server
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  idleTimeoutMillis: 30000
});

module.exports = pool;

app.use(express.static(path.join(__dirname, 'public')));

// ตั้งค่า EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ตั้งค่า express-session
const sessionMiddleware = session({
  store: new pgSession({ pool: new Pool(/*…*/)}),
  secret: 'S@fetyForklift',
  resave: false,
  saveUninitialized: false
});

app.use(sessionMiddleware);

// ให้ Socket.IO ใช้ session
io.use((socket, next) => {
  let req = socket.request;
  let res = req.res;
  sessionMiddleware(req, res, next);
});

// Import routes login, logout, และ routes อื่น ๆ ที่ต้อง login
const authRoutes = require('./routes/auth');
app.use('/', authRoutes);

const userRoutes = require('./routes/user');
app.use('/management/user', userRoutes);

const companyRoutes = require('./routes/company');
app.use('/management/company', companyRoutes);

const staffRoutes = require('./routes/staff');
app.use('/management/staff', staffRoutes);

const fleetRoutes = require('./routes/fleet');
app.use('/management/fleet', fleetRoutes);

const shiftTimeRoutes = require('./routes/shift_time');
app.use('/management/shift_time', shiftTimeRoutes);

const siteRoutes = require('./routes/site');
app.use('/management/site', siteRoutes);

const cardRoutes = require('./routes/card');
app.use('/management/card', cardRoutes);

const shiftsRoutes = require('./routes/shift');
app.use('/reports/shifts', shiftsRoutes);

const impactRoutes = require('./routes/impact');
app.use('/reports/impact', impactRoutes);

const usageRoutes = require('./routes/usage');
app.use('/reports/usage', usageRoutes);

const mapRoutes = require('./routes/map');
app.use('/map', mapRoutes);

app.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('admin_home', { user: req.session.user });
});

// ตัวอย่าง route อื่น ๆ ที่ต้องมีการตรวจสอบสิทธิ์
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}
app.get('/protected', isAuthenticated, (req, res) => {
  res.send('This is a protected route.');
});

// ตั้งค่า static (ถ้ามีไฟล์ CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

// ตั้งค่า Multer สำหรับอัปโหลดไฟล์
const upload = multer({ dest: 'uploads/' }); // โฟลเดอร์เก็บไฟล์ชั่วคราว

// app.post('/login', async (req, res) => {
//   let data = req.body;
//   /*
//   {
//   "username": "admin",
//   "password": "1234",
//   "token":"5555"
//   }
//    */
//   //console.log(data);
//   const client = await pool.connect();
//   try {

//   } finally {
//     client.release();
//   }
//   if (data.username == "admin" && data.password == "1234" && data.token == "5555")
//     res.status(200).send({ "Status": "OK" });
//   else
//     res.status(401).send({ "Status": "Fail" });
// })

app.post('/createaccount', async (req, res) => {
  const data = req.body;
  const client = await pool.connect();

  try {
    // 1) ตรวจสอบว่ามี email, password, customerCode ครบหรือไม่
    if (!data.email || !data.password || !data.customerCode) {
      return res.status(400).json({
        Status: "Error",
        message: "Missing required fields (email, password, customerCode)"
      });
    }

    // 2) ตรวจสอบว่า customerCode นี้มีในตาราง company หรือไม่
    const companyQuery = `
            SELECT id
            FROM company
            WHERE UPPER(customer_code) = UPPER($1)
                AND deleted_at IS NULL
        `;
    const companyResult = await client.query(companyQuery, [data.customerCode]);
    if (companyResult.rows.length === 0) {
      return res.status(400).json({
        Status: "Error",
        message: "Invalid customer code or company not found"
      });
    }
    const companyId = companyResult.rows[0].id;

    // 3) ตรวจสอบว่า email (username) นี้ มีในตาราง users (ภายใต้ company เดียวกัน) หรือไม่
    const emailCheckQuery = `
            SELECT username
            FROM users
            WHERE username = $1
                AND company_id = $2
                AND deleted_at IS NULL
        `;
    const emailCheckResult = await client.query(emailCheckQuery, [data.email, companyId]);
    if (emailCheckResult.rows.length > 0) {
      return res.status(400).json({
        Status: "Error",
        message: "Email already exists for this company"
      });
    }

    // 4) Hash the password
    //    ใช้ customerCode (ตัวพิมพ์ใหญ่) เป็น salt เพื่อเพิ่มความปลอดภัย
    const salt = data.customerCode.toUpperCase();
    const hashedPassword = crypto.scryptSync(data.password, salt, 64).toString('hex');

    // 5) Insert ลงตาราง users
    //    - ใน schema ใหม่ใช้ฟิลด์ password (ไม่ใช่ password_hash)
    //    - company_id ต้องมาจากตาราง company
    const insertQuery = `
            INSERT INTO users (
                username, 
                password, 
                company_id, 
                created_at, 
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `;
    const now = new Date();
    const insertResult = await client.query(insertQuery, [
      data.email,        // username
      hashedPassword,    // password
      companyId,         // company_id
      now,               // created_at
      now                // updated_at
    ]);

    // 6) ส่งกลับ response
    res.status(201).json({
      Status: "OK",
      message: "Account created successfully",
      userId: insertResult.rows[0].id
    });

  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({
      Status: "Error",
      message: "Internal server error"
    });
  } finally {
    client.release();
  }
});

app.post('/deleteaccount', async (req, res) => {
  const data = req.body;
  /*
    data json format
    {
      "email": "admin@mail.com",
      "customerCode": "0987654321"
    }
  */

  const client = await pool.connect();

  try {
    // 1) ตรวจสอบว่า email และ customerCode ถูกส่งมาหรือไม่
    if (!data.email || !data.customerCode) {
      return res.status(400).json({
        Status: "Error",
        message: "Missing required fields (email, customerCode)"
      });
    }

    // 2) หา company_id จากตาราง company โดยใช้ customer_code
    const companyQuery = `
            SELECT id 
            FROM company
            WHERE UPPER(customer_code) = UPPER($1)
                AND deleted_at IS NULL
        `;
    const companyResult = await client.query(companyQuery, [data.customerCode]);
    if (companyResult.rows.length === 0) {
      return res.status(404).json({
        Status: "Error",
        message: "Company not found or invalid customer code"
      });
    }
    const companyId = companyResult.rows[0].id;

    // 3) ตรวจสอบว่ามี user (users) ที่ username = email + company_id ตรงกัน และยังไม่ถูกลบหรือไม่
    const checkQuery = `
            SELECT id 
            FROM users
            WHERE username = $1
                AND company_id = $2
                AND deleted_at IS NULL
        `;
    const checkResult = await client.query(checkQuery, [data.email, companyId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        Status: "Error",
        message: "Account not found or already deleted"
      });
    }

    // 4) ทำ Soft Delete โดยตั้ง deleted_at = ตอนนี้ และอาจตั้ง status อื่น ๆ ตามต้องการ
    const deleteQuery = `
            UPDATE users
            SET deleted_at = $1,
                updated_at = $1
            WHERE username = $2
                AND company_id = $3
                AND deleted_at IS NULL
        `;
    await client.query(deleteQuery, [new Date(), data.email, companyId]);

    // 5) ส่งผลลัพธ์กลับ
    res.status(200).json({
      Status: "OK",
      message: "Account deleted successfully"
    });

  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({
      Status: "Error",
      message: "Internal server error"
    });
  } finally {
    client.release();
  }
});

app.post('/updateaccount', async (req, res) => {
  const data = req.body;
  /*
    data json format
    {
      "username": "user123",          // Required for identifying the account
      "customerCode": "0987654321",   // Required for identifying the account
      "newPassword": "new_password"   // Required for updating the password
    }
  */

  const client = await pool.connect();
  try {
    // 1) ตรวจสอบว่ามี username, customerCode, newPassword ครบหรือไม่
    if (!data.username || !data.customerCode || !data.newPassword) {
      return res.status(400).json({
        Status: "Error",
        message: "Missing required fields (username, customerCode, newPassword)"
      });
    }

    // 2) หา company_id จากตาราง company โดยใช้ customer_code
    const companyQuery = `
            SELECT id 
            FROM company
            WHERE UPPER(customer_code) = UPPER($1)
                AND deleted_at IS NULL
        `;
    const companyResult = await client.query(companyQuery, [data.customerCode]);
    if (companyResult.rows.length === 0) {
      return res.status(404).json({
        Status: "Error",
        message: "Company not found or invalid customer code"
      });
    }
    const companyId = companyResult.rows[0].id;

    // 3) ตรวจสอบว่ามี user (users) ที่ username = data.username + company_id ตรงกัน และยังไม่ถูกลบหรือไม่
    const checkQuery = `
            SELECT id 
            FROM users
            WHERE username = $1
                AND company_id = $2
                AND deleted_at IS NULL
        `;
    const checkResult = await client.query(checkQuery, [data.username, companyId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        Status: "Error",
        message: "Account not found or already deleted"
      });
    }

    // 4) Hash the new password
    //    ใช้ customerCode (ตัวพิมพ์ใหญ่) เป็น salt เพื่อเพิ่มความปลอดภัย
    //    (แนะนำให้ใช้ bcrypt หรือ argon2 ใน production)
    const salt = data.customerCode.toUpperCase();
    const hashedPassword = crypto
      .scryptSync(data.newPassword, salt, 64)
      .toString('hex');

    // 5) Update password ลงตาราง users
    //    - ฟิลด์ password คือที่เก็บรหัสผ่าน (ตาม schema ล่าสุด)
    //    - อัปเดต updated_at ด้วย
    const updateQuery = `
            UPDATE users
            SET password = $1,
                updated_at = NOW()
            WHERE username = $2
                AND company_id = $3
                AND deleted_at IS NULL
        `;
    await client.query(updateQuery, [hashedPassword, data.username, companyId]);

    // 6) ส่งผลลัพธ์กลับ
    res.status(200).json({
      Status: "OK",
      message: "Password updated successfully"
    });

  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({
      Status: "Error",
      message: "Internal server error"
    });
  } finally {
    client.release();
  }
});

function generateUID() {
  return uuidv4().replace(/-/g, '').toUpperCase().slice(0, 10); // ตัดให้เหลือ 10 ตัว
}

app.post('/createcompany', async (req, res) => {
  let data = req.body;

  const client = await pool.connect();

  try {
    // Check if the company already exists and is not deleted
    const result = await client.query(
      'SELECT * FROM company WHERE name = $1 AND deleted_at IS NULL',
      [data.name]
    );

    if (result.rows.length > 0) {
      return res.status(400).json({ Status: "Error", message: "Company already exists" });
    }

    // Insert a new company
    const insertResult = await client.query(
      'INSERT INTO company (name, address, contact_person, contact_phone, contact_email, customer_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [
        data.name,
        data.address,
        data.contactPerson,
        data.contactPhone,
        data.contactEmail,
        generateUID()
      ]
    );

    res.status(201).json({ Status: "OK", message: "Company created successfully", companyId: insertResult.rows[0].id });
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ Status: "Error", message: "Internal server error" });
  } finally {
    client.release();
  }
});

app.post('/deletecompany', async (req, res) => {
  let data = req.body;

  /*
  data json format:
  {
      "name": "company_name"
  }
  */

  const client = await pool.connect();

  try {
    // Check if the company exists and is not already deleted
    const result = await client.query(
      'SELECT id FROM company WHERE name = $1 AND deleted_at IS NULL',
      [data.name]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ Status: "Error", message: "Company not found or already deleted" });
    }

    // Soft delete the company
    await client.query(
      'UPDATE company SET deleted_at = $1 WHERE name = $2 AND deleted_at IS NULL',
      [new Date(), data.name]
    );

    res.status(200).json({ Status: "OK", message: "Company deleted successfully" });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).json({ Status: "Error", message: "Internal server error" });
  } finally {
    client.release();
  }
});

app.post('/updatecompany', async (req, res) => {
  let data = req.body;

  /*
  data json format:
  {
      "name": "company_name", // Required for identifying the company
      "address": "new_address", // Optional
      "contactPerson": "new_contact_person", // Optional
      "contactPhone": "new_contact_phone", // Optional
      "contactEmail": "new_contact_email" // Optional
  }
  */

  const client = await pool.connect();

  try {
    // Check if the company exists and is not deleted
    const result = await client.query(
      'SELECT id FROM company WHERE name = $1 AND deleted_at IS NULL',
      [data.name]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ Status: "Error", message: "Company not found or already deleted" });
    }

    // Build dynamic update query
    let updates = [];
    let updateValues = [];
    let index = 1;

    if (data.address) {
      updates.push(`address = $${index}`);
      updateValues.push(data.address);
      index++;
    }

    if (data.contactPerson) {
      updates.push(`contact_person = $${index}`);
      updateValues.push(data.contactPerson);
      index++;
    }

    if (data.contactPhone) {
      updates.push(`contact_phone = $${index}`);
      updateValues.push(data.contactPhone);
      index++;
    }

    if (data.contactEmail) {
      updates.push(`contact_email = $${index}`);
      updateValues.push(data.contactEmail);
      index++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ Status: "Error", message: "No fields to update" });
    }

    // Add WHERE clause values
    updateValues.push(data.name);

    // Execute update query
    const updateQuery = `
            UPDATE company 
            SET ${updates.join(', ')}, updated_at = $${index + 1}
            WHERE name = $${index} AND deleted_at IS NULL
        `;
    await client.query(updateQuery, [...updateValues, new Date()]);

    res.status(200).json({ Status: "OK", message: "Company updated successfully" });
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).json({ Status: "Error", message: "Internal server error" });
  } finally {
    client.release();
  }
});

app.post('/checkin', async (req, res) => {
  let data = req.body;

  /*
  data json format:
  {
      "cardID":"046678C2616080",
      "deviceID":"123456"
  }
  */

  const client = await pool.connect();

  try {
    // Check if the company exists and is not deleted
    const result = await client.query(`
            select s.id staff_id, c.id card_id, f.id fleet_id, s."name", s.job_title, s.department, s.company_code, c2."name" company_name, c.uid
            from card c
            left join staff s on c.assigned_staff_id = s.id
            left join fleet f on s.company_id = f.company_id
            left join company c2 on s.company_id = c2.id
            where c.uid = $1 and f.device_id = $2
            and c.deleted_at is null and s.deleted_at is null and c2.deleted_at  is null`,
      [data.cardID, data.deviceID]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ Status: "Error", message: `Card ID[${data.cardID}] and device ID[${data.deviceID}] not match.` });
    }

    res.status(200).json({
      Status: "OK",
      message: "Checked in successfully",
      name: result.rows[0].name,
      jobTitle: result.rows[0].job_title,
      department: result.rows[0].department,
      companyCode: result.rows[0].company_code,
      companyName: result.rows[0].company_name,
      staffId: result.rows[0].staff_id,
      cardID: result.rows[0].uid
    });
  } catch (error) {
    console.error('Error shift in:', error);
    res.status(500).json({ Status: "Error", message: "Internal server error" });
  } finally {
    client.release();
  }
});

app.post('/shiftin', async (req, res) => {
  let data = req.body;

  /*
  data json format:
  {
      "cardID":"046678C2616080",
      "deviceID":"123456",
      "shiftIn":"2025-02-23 01:00"
  }
  */

  const client = await pool.connect();

  try {
    // Check if the company exists and is not deleted
    const result = await client.query(`
            select s.id staff_id, c.id card_id, f.id fleet_id, s."name", s.job_title, s.department, s.company_code, c2."name" company_name, c.uid
            from card c
            left join staff s on c.assigned_staff_id = s.id
            left join fleet f on s.company_id = f.company_id
            left join company c2 on s.company_id = c2.id
            where c.uid = $1 and f.device_id = $2
            and c.deleted_at is null and s.deleted_at is null and c2.deleted_at  is null`,
      [data.cardID, data.deviceID]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ Status: "Error", message: "cardID and deviceID not match." });
    }

    // Execute update query
    // Insert a new company
    const insertResult = await client.query(
      'INSERT INTO shift_log (staff_id, card_id, fleet_id, check_in) VALUES ($1, $2, $3, $4) RETURNING id',
      [
        result.rows[0].staff_id,
        result.rows[0].card_id,
        result.rows[0].fleet_id,
        data.shiftIn
      ]
    );

    res.status(201).json({
      Status: "OK",
      message: "Shift in successfully",
      shiftId: insertResult.rows[0].id,
      name: result.rows[0].name,
      jobTitle: result.rows[0].job_title,
      department: result.rows[0].department,
      companyCode: result.rows[0].company_code,
      companyName: result.rows[0].company_name,
      staffId: result.rows[0].staff_id,
      cardID: result.rows[0].uid
    });
  } catch (error) {
    console.error('Error shift in:', error);
    res.status(500).json({ Status: "Error", message: "Internal server error" });
  } finally {
    client.release();
  }
});

app.post('/shiftout', async (req, res) => {
  let data = req.body;

  /*
  data json format:
  {
      "shiftId": 3,
      "shiftOut":"2025-02-23 01:00"
  }
  */

  const client = await pool.connect();

  try {
    // Check if the company exists and is not deleted
    const result = await client.query(`
            select *
            from shift_log
            where id = $1 and check_out is null`,
      [data.shiftId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ Status: "Error", message: "Shift not found." });
    }

    // Execute update query
    const updateQuery = `
            UPDATE shift_log 
            SET check_out = $1, updated_at = $2
            WHERE id = $3 AND deleted_at IS NULL
        `;
    await client.query(updateQuery, [data.shiftOut, new Date(), data.shiftId]);

    res.status(200).json({ Status: "OK", message: "Shift out successfully" });
  } catch (error) {
    console.error('Error shift in:', error);
    res.status(500).json({ Status: "Error", message: "Internal server error" });
  } finally {
    client.release();
  }
});

app.get("/getimage/:staffId", async (req, res) => {
  const staff_id = req.params.staffId;
  const client = await pool.connect();

  try {
    const result = await client.query(`
            SELECT image
            FROM staff
            WHERE id = $1 AND deleted_at IS NULL`,
      [staff_id]
    );

    if (result.rows.length === 0 || !result.rows[0].image) {
      return res.status(404).json({ Status: "Error", message: "Image not found." });
    }

    const imageBuffer = result.rows[0].image;

    res.writeHead(200, {
      "Content-Type": "image/jpeg", // Change this if needed
      "Content-Length": imageBuffer.length
    });
    res.end(imageBuffer);

  } catch (error) {
    console.error("Error fetching image:", error);
    res.status(500).json({ Status: "Error", message: "Internal server error." });
  } finally {
    client.release(); // Ensure connection is released
  }
});

app.post('/getDeviceInfo', async (req, res) => {
  let data = req.body;

  /*
  data json format:
  {
      "deviceID":"123456"
  }
  */

  const client = await pool.connect();

  try {
    // Check if the company exists and is not deleted
    const result = await client.query(`
            select f.id, f.vehicle_name, f.vehicle_type, f.vehicle_status, f.make, f.model, f.year, c.name company_name
            from fleet f
            left join company c on f.company_id = c.id
            where f.device_id = $1
            and f.deleted_at is null and c.deleted_at is null`,
      [data.deviceID]
    );

    if (result.rows.length === 0) {
      // Insert a new record into the fleet table with default name 'New Device'
      const insertResult = await client.query(`
                INSERT INTO fleet (device_id, vehicle_name, is_registered, vehicle_status)
                VALUES ($1, $2, false, 'inactive')
                RETURNING id`,
        [data.deviceID, 'New Device']
      );

      return res.status(200).json({
        Status: "OK",
        message: "Device not found. New device added to the database.",
        fleetID: insertResult.rows[0].id,
        vehicleName: 'New Device',
        is_registered: false,
        vehicleStatus: "inactive"
      });
    }

    res.status(200).json({
      Status: "OK",
      message: "Get device info successfully",
      vehicleName: result.rows[0].vehicle_name,
      vehicleType: result.rows[0].vehicle_type,
      vehicleStatus: result.rows[0].vehicle_status,
      make: result.rows[0].make,
      model: result.rows[0].model,
      year: result.rows[0].year,
      companyName: result.rows[0].company_name,
      fleetID: result.rows[0].id
    });
  } catch (error) {
    console.error('Error get device info:', error);
    res.status(500).json({ Status: "Error", message: "Internal server error" });
  } finally {
    client.release();
  }
});

app.post('/registerDevice', async (req, res) => {
  let data = req.body;

  /*
  data json format:
  {
      "deviceID":"123456"
  }
  */

  const client = await pool.connect();

  try {
    // Check if the company exists and is not deleted
    const result = await client.query(`
            select f.id, f.vehicle_name, f.vehicle_type, f.vehicle_status, f.make, f.model, f.year, f.is_registered
            from fleet f
            where f.device_id = $1
            and f.deleted_at is null`,
      [data.deviceID]
    );

    if (result.rows.length === 0) {
      const result = await client.query(`
                insert into fleet(device_id, is_registered) values($1, false)
                `, [data.deviceID]);
      return res.status(200).json({ Status: "OK", message: "Register device successfully", is_registered: false });
    }

    res.status(200).json({
      Status: "OK",
      message: "Device allready register",
      is_registered: result.rows[0].is_registered
    });
  } catch (error) {
    console.error('Error register device:', error);
    res.status(500).json({ Status: "Error", message: "Internal server error" });
  } finally {
    client.release();
  }
});

app.get("/getTest", async (req, res) => {
  res.status(200).json({ Status: "OK" });
});

app.get('/admin', (req, res) => {
  // อาจตรวจสอบสิทธิ์ (Auth) ก่อน
  // if (!req.user || req.user.role !== 'admin') return res.redirect('/login');
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('admin_home');
});

app.get('/admin/import', async (req, res) => {
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

app.post('/admin/import', upload.single('importFile'), async (req, res) => {
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

// API สำหรับรับข้อมูล impact
app.post('/impact', async (req, res) => {
  // รับข้อมูลจาก request body
  // ควรส่ง: device_id, staff_id, severity, g_force, location, occurred_at (ถ้ามี)
  const { device_id, staff_id, severity, g_force, location, occurred_at } = req.body;

  // ตรวจสอบข้อมูลที่จำเป็น: device_id, severity, g_force ต้องมี
  if (!device_id || !severity || !g_force) {
    return res.status(400).json({ status: 'Error', message: 'Missing required fields: device_id, severity, g_force' });
  }

  const client = await pool.connect();
  try {
    // ดึง fleet_id จากตาราง fleet โดยใช้ device_id
    const fleetQuery = `
      SELECT id
      FROM fleet
      WHERE device_id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const fleetResult = await client.query(fleetQuery, [device_id]);
    if (fleetResult.rows.length === 0) {
      return res.status(400).json({ status: 'Error', message: 'Invalid device_id or fleet not found' });
    }
    const fleet_id = fleetResult.rows[0].id;

    // Insert ข้อมูลลงใน impact_log โดยใช้ fleet_id ที่ได้มา
    const insertQuery = `
      INSERT INTO impact_log (
        fleet_id,
        staff_id,
        severity,
        g_force,
        "location"
      )
      VALUES ($1,(SELECT assigned_staff_id FROM "card" WHERE uid = $2 and deleted_at is null), $3, $4, $5)
      RETURNING id
    `;
    const result = await client.query(insertQuery, [
      fleet_id,
      staff_id || null,
      severity,
      g_force,
      location || null
    ]);

    res.status(201).json({ status: 'OK', impact_id: result.rows[0].id });
  } catch (error) {
    console.error('Error inserting impact:', error);
    res.status(500).json({ status: 'Error', message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Broadcast ข้อมูลตำแหน่งเมื่อมีการอัปเดต
app.post('/position', async (req, res) => {
  const { device_id, latitude, longitude, timestamp } = req.body;

  if (!device_id || latitude === undefined || longitude === undefined || !timestamp) {
    return res.status(400).json({
      Status: "Error",
      message: "Missing required fields (device_id, latitude, longitude, timestamp)"
    });
  }

  const client = await pool.connect();

  try {
    const fleetQuery = `
      SELECT f.id AS fleet_id, f.vehicle_name, f.company_id, c.name AS company_name
      FROM fleet f
      LEFT JOIN company c ON f.company_id = c.id
      WHERE f.device_id = $1 AND f.deleted_at IS NULL
      LIMIT 1
    `;
    const fleetResult = await client.query(fleetQuery, [device_id]);

    if (fleetResult.rows.length === 0) {
      return res.status(404).json({
        Status: "Error",
        message: "Invalid device_id or fleet not found"
      });
    }

    const fleet_id = fleetResult.rows[0].fleet_id;
    const vehicle_name = fleetResult.rows[0].vehicle_name;
    const company_id = fleetResult.rows[0].company_id;
    const company_name = fleetResult.rows[0].company_name;

    const insertHistoryQuery = `
      INSERT INTO fleet_location_history (
        fleet_id, latitude, longitude, recorded_at, device_id
      ) VALUES ($1, $2, $3, $4, $5)
    `;
    await client.query(insertHistoryQuery, [fleet_id, latitude, longitude, timestamp, device_id]);

    const updateFleetQuery = `
      UPDATE fleet
      SET latitude = $1, longitude = $2, updated_at = NOW()
      WHERE id = $3
    `;
    await client.query(updateFleetQuery, [latitude, longitude, fleet_id]);

    // สร้าง payload สำหรับ broadcast
    const payload = {
      id: fleet_id,
      name: vehicle_name,
      latitude,
      longitude,
      timestamp,
      companyId: company_id,
      companyName: company_name
    };

    // Broadcast ไปยัง room ของ super_admin
    io.to('super_admin').emit('positionUpdate', payload);

    // Broadcast ไปยัง room ของบริษัท
    io.to(`company_${company_id}`).emit('positionUpdate', payload);

    // Broadcast ไปยัง room ของ fleet
    io.to(`fleet_${fleet_id}`).emit('positionUpdate', payload);

    res.status(200).json({
      Status: "OK",
      message: "Position updated successfully"
    });
  } catch (error) {
    console.error('Error updating position:', error);
    res.status(500).json({
      Status: "Error",
      message: "Internal server error"
    });
  } finally {
    client.release();
  }
});

// เมื่อมีการเชื่อมต่อจาก client
io.on('connection', socket => {
  const user = socket.request.session.user;

  if (!user) {
    return socket.disconnect(); // ตัดการเชื่อมต่อหากไม่มี session
  }

  if (user.role === 'super_admin') {
    // Super Admin เข้าร่วม room ที่สามารถดูข้อมูลทั้งหมด
    socket.join('super_admin');
  } else {
    // Customer Admin หรือบทบาทอื่น
    socket.join(`company_${user.company_id}`); // เข้าร่วม room ของบริษัท

    // เข้าร่วม room ของ fleet ที่อนุญาต
    (user.fleet_ids || []).forEach(fleetId => {
      socket.join(`fleet_${fleetId}`);
    });
  }
});

// เปลี่ยนจาก app.listen เป็น server.listen
server.listen(8000, () => {
  console.log('app listening on port', 8000);
});