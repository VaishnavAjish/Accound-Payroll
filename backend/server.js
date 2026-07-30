require('dotenv').config(); // Trigger nodemon
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', require('./routes/auth'));
app.use('/employees', require('./routes/employees'));
app.use('/periods', require('./routes/periods'));
app.use('/rates', require('./routes/rates'));
app.use('/polish', require('./routes/polish'));
app.use('/dhar', require('./routes/dhar'));
app.use('/maxi', require('./routes/maxi'));
app.use('/verification', require('./routes/verification'));
app.use('/master-data', require('./routes/masterData'));
app.use('/portal', require('./routes/employeePortal'));
app.use('/notifications', require('./routes/notifications'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/admin', require('./routes/admin'));
app.use('/rbac', require('./routes/rbac'));

// Centralized error handler -- unexpected errors never leak internals to the
// client, but are logged server-side (MPS 1: Security priority).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));

// force restart
