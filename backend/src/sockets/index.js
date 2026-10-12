import { Server } from 'socket.io';
import { query } from '../db/pool.js';
import { getAuthSession } from '../services/authSessionService.js';
import { initEmitter } from './emitter.js';

export function setupSockets(httpServer) {
  const io = new Server(httpServer, { path: '/socket.io' });
  initEmitter(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const session = token ? await getAuthSession(token) : null;
      if (!session) return next(new Error('UNAUTHENTICATED'));
      const { rows } = await query(
        'SELECT id, name, role, section, roll_number, is_active FROM users WHERE id = $1',
        [session.userId],
      );
      const user = rows[0];
      if (!user || !user.is_active) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    socket.join(`role:${user.role}`);

    if (user.role === 'student') {
      const { rows } = await query(
        `SELECT id FROM class_sessions
         WHERE status = 'open' AND (section IS NULL OR section = $1)
         ORDER BY started_at DESC LIMIT 1`,
        [user.section],
      );
      if (rows[0]) socket.join(`session:${rows[0].id}`);
    }

    socket.on('session:join', async (payload = {}, ack) => {
      if (user.role !== 'teacher' && user.role !== 'admin') return;
      const sessionId = payload.sessionId;
      if (!sessionId) return;
      const { rows } = await query('SELECT teacher_id FROM class_sessions WHERE id = $1', [sessionId]);
      if (!rows[0]) return;
      if (user.role === 'teacher' && rows[0].teacher_id !== user.id) return;
      socket.join(`session:${sessionId}`);
      socket.join(`session:${sessionId}:teacher`);
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('session:leave', (payload = {}) => {
      const sessionId = payload.sessionId;
      if (!sessionId) return;
      socket.leave(`session:${sessionId}`);
      socket.leave(`session:${sessionId}:teacher`);
    });
  });

  return io;
}
