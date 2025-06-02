// server.js - Node.js Express backend with MySQL connection
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files

// MySQL connection configuration
const dbConfig = {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '1324',
    database: 'dormitory_db',
    charset: 'utf8mb4'
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Initialize database connection
async function initDatabase() {
    try {
        const connection = await pool.getConnection();
        await connection.execute("SET NAMES 'utf8mb4'");
        await connection.execute("SET character_set_connection = 'utf8mb4'");
        await connection.execute("SET character_set_results = 'utf8mb4'");
        await connection.execute("SET character_set_client = 'utf8mb4'");
        connection.release();
        console.log('База даних підключена успішно!');
    } catch (error) {
        console.error('Помилка підключення до бази даних:', error);
        process.exit(1);
    }
}

// API Routes

// Get all students
app.get('/api/students', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM students ORDER BY student_id');
        res.json(rows);
    } catch (error) {
        console.error('Помилка отримання студентів:', error);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Add new student
app.post('/api/students', async (req, res) => {
    try {
        const { name, birthDate, gender, phone, group, passport } = req.body;

        const [result] = await pool.execute(
            'INSERT INTO students(full_name, birth_date, gender, phone, university_group, passport_number) VALUES (?, ?, ?, ?, ?, ?)',
            [name, birthDate, gender, phone, group, passport]
        );

        res.json({
            success: true,
            message: 'Студента додано успішно!',
            studentId: result.insertId
        });
    } catch (error) {
        console.error('Помилка додавання студента:', error);
        res.status(500).json({ error: 'Помилка додавання студента' });
    }
});

// Delete student
app.delete('/api/students/:id', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const studentId = parseInt(req.params.id);

        // Delete related settlements
        await connection.execute('DELETE FROM settlements WHERE student_id = ?', [studentId]);

        // Delete related payments
        await connection.execute('DELETE FROM payments WHERE student_id = ?', [studentId]);

        // Delete student
        const [result] = await connection.execute('DELETE FROM students WHERE student_id = ?', [studentId]);

        await connection.commit();

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Студента успішно видалено!' });
        } else {
            res.status(404).json({ error: 'Студента не знайдено' });
        }
    } catch (error) {
        await connection.rollback();
        console.error('Помилка видалення студента:', error);
        res.status(500).json({ error: 'Помилка видалення студента' });
    } finally {
        connection.release();
    }
});

// Get all rooms
app.get('/api/rooms', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM rooms ORDER BY room_id');
        res.json(rows);
    } catch (error) {
        console.error('Помилка отримання кімнат:', error);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Get available rooms
app.get('/api/rooms/available', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT r.room_id, r.room_number, r.capacity,
                   COALESCE(occupied.count, 0) as occupied_count,
                   (r.capacity - COALESCE(occupied.count, 0)) as available_spots
            FROM rooms r
                     LEFT JOIN (
                SELECT room_id, COUNT(*) as count
                FROM settlements
                GROUP BY room_id
            ) occupied ON r.room_id = occupied.room_id
            WHERE (r.capacity - COALESCE(occupied.count, 0)) > 0
            ORDER BY r.room_number
        `);
        res.json(rows);
    } catch (error) {
        console.error('Помилка отримання доступних кімнат:', error);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Add new settlement
app.post('/api/settlements', async (req, res) => {
    try {
        const { studentId, roomNumber, settleDate } = req.body; // Changed roomId to roomNumber

        // Check if student exists
        const [studentCheck] = await pool.execute(
            'SELECT student_id FROM students WHERE student_id = ?',
            [studentId]
        );

        if (studentCheck.length === 0) {
            return res.status(400).json({ error: 'Студента не знайдено' });
        }

        // Check if student is already settled
        const [existingSettlement] = await pool.execute(
            'SELECT student_id FROM settlements WHERE student_id = ?',
            [studentId]
        );

        if (existingSettlement.length > 0) {
            return res.status(400).json({ error: 'Студент вже поселений в кімнаті' });
        }

        // Find room by room_number and get room_id
        const [roomCheck] = await pool.execute(
            'SELECT room_id, capacity FROM rooms WHERE room_number = ?',
            [roomNumber]
        );

        if (roomCheck.length === 0) {
            return res.status(400).json({ error: 'Кімнату з таким номером не знайдено' });
        }

        const roomId = roomCheck[0].room_id;
        const capacity = roomCheck[0].capacity;

        // Check room capacity
        const [occupantsCount] = await pool.execute(
            'SELECT COUNT(*) as count FROM settlements WHERE room_id = ?',
            [roomId]
        );

        if (occupantsCount[0].count >= capacity) {
            return res.status(400).json({ error: 'Кімната повністю зайнята' });
        }

        // Insert new settlement using room_id (internal)
        await pool.execute(
            'INSERT INTO settlements(student_id, room_id, settle_date) VALUES (?, ?, ?)',
            [studentId, roomId, settleDate]
        );

        res.json({ success: true, message: 'Студента поселено успішно!' });
    } catch (error) {
        console.error('Помилка поселення студента:', error);

        // Handle specific MySQL errors
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Студент вже поселений або кімната зайнята' });
        }

        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ error: 'Некоректний ID студента' });
        }

        res.status(500).json({ error: 'Помилка поселення студента: ' + error.message });
    }
});

// Get all settlements - UPDATED to show room_number
app.get('/api/settlements', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT
                s.student_id,
                st.full_name,
                r.room_number,
                s.settle_date
            FROM settlements s
                     JOIN students st ON s.student_id = st.student_id
                     JOIN rooms r ON s.room_id = r.room_id
            ORDER BY s.settle_date DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Помилка отримання поселень:', error);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Evict student (remove settlement)
app.delete('/api/settlements/student/:id', async (req, res) => {
    try {
        const studentId = parseInt(req.params.id);

        const [result] = await pool.execute('DELETE FROM settlements WHERE student_id = ?', [studentId]);

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Студента виселено успішно!' });
        } else {
            res.status(404).json({ error: 'Поселення не знайдено' });
        }
    } catch (error) {
        console.error('Помилка виселення студента:', error);
        res.status(500).json({ error: 'Помилка виселення студента' });
    }
});

// Get all payments
app.get('/api/payments', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM payments ORDER BY payment_date DESC');
        res.json(rows);
    } catch (error) {
        console.error('Помилка отримання оплат:', error);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Get payments by student
app.get('/api/payments/student/:id', async (req, res) => {
    try {
        const studentId = parseInt(req.params.id);
        const [rows] = await pool.execute(
            'SELECT payment_date, amount, payment_method FROM payments WHERE student_id = ? ORDER BY payment_date',
            [studentId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Помилка отримання оплат студента:', error);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Add new payment
app.post('/api/payments', async (req, res) => {
    try {
        const { studentId, paymentDate, amount, paymentMethod } = req.body;

        await pool.execute(
            'INSERT INTO payments(student_id, payment_date, amount, payment_method) VALUES (?, ?, ?, ?)',
            [studentId, paymentDate, amount, paymentMethod]
        );

        res.json({ success: true, message: 'Оплату додано успішно!' });
    } catch (error) {
        console.error('Помилка додавання оплати:', error);
        res.status(500).json({ error: 'Помилка додавання оплати' });
    }
});

// Get statistics
app.get('/api/statistics', async (req, res) => {
    try {
        const [studentsCount] = await pool.execute('SELECT COUNT(*) as count FROM students');
        const [settlementsCount] = await pool.execute('SELECT COUNT(*) as count FROM settlements');
        const [paymentsCount] = await pool.execute('SELECT COUNT(*) as count FROM payments');

        res.json({
            totalStudents: studentsCount[0].count,
            totalSettlements: settlementsCount[0].count,
            totalPayments: paymentsCount[0].count
        });
    } catch (error) {
        console.error('Помилка отримання статистики:', error);
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function startServer() {  // <- was "sync function", should be "async function"
    await initDatabase();
    app.listen(PORT, () => {
        console.log(`Сервер запущено на http://localhost:${PORT}`);
        console.log('Відкрийте браузер та перейдіть за адресою: http://localhost:3000');
    });
}

// Fix 2: Add CORS middleware to handle cross-origin requests
// Add this BEFORE your routes, after creating the app:


app.use(cors({
    origin: 'http://localhost:63342', // Allow requests from IntelliJ's server
    credentials: true
}));

startServer().catch(console.error);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nЗакриття з\'єднання з базою даних...');
    await pool.end();
    process.exit(0);
});