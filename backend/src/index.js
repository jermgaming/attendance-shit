import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import express from 'express';
import helmet from 'helmet';

import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { seedStaff } from './services/seedService.js';
import { recoverOpenSessions } from './services/rotationService.js';
import { setupSockets } from './sockets/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authenticate, requireRole } from './middleware/auth.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import studentsRoutes from './routes/students.js';
import sessionsRoutes from './routes/sessions.js';
import markRoutes from './routes/mark.js';
import meRoutes from './routes/me.js';
import reportsRoutes from './routes/reports.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy ? 'loopback, linklocal, uniquelocal' : false);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(express.json({ limit: '100kb' }));

app.use('/api/v1', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sessions', authenticate, markRoutes);
app.use('/api/v1/sessions', authenticate, requireRole('teacher', 'admin'), sessionsRoutes);
app.use('/api/v1/students', authenticate, requireRole('teacher', 'admin'), studentsRoutes);
app.use('/api/v1/me', authenticate, requireRole('student'), meRoutes);
app.use('/api/v1/reports', authenticate, requireRole('teacher', 'admin'), reportsRoutes);


app.use(express.static(path.join(__dirname, "../public")));

const publicDir = path.join(process.cwd(), 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}

app.use('/api', notFoundHandler);
app.use(errorHandler);

const server = http.createServer(app);
setupSockets(server);

async function main() {
  await runMigrations();
  await seedStaff();
  await recoverOpenSessions();

  server.listen(config.port, () => {
    const nets = Object.values(os.networkInterfaces()).flat();
    const lan = config.publicUrl
      || (() => {
        const ip = nets.find((n) => n && n.family === 'IPv4' && !n.internal);
        return ip ? `http://${ip.address}:${config.port}` : null;
      })();
    console.log(`Attendance app listening on port ${config.port}`);
    if (lan) console.log(`LAN address for the projector QR: ${lan}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
