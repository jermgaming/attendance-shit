let io = null;

export function initEmitter(serverIo) {
  io = serverIo;
}

export function toTeachers(sessionId, event, payload) {
  io?.to(`session:${sessionId}:teacher`).emit(event, payload);
}

export function toSessionRoom(sessionId, event, payload) {
  io?.to(`session:${sessionId}`).emit(event, payload);
}

export function toStudents(event, payload) {
  io?.to('role:student').emit(event, payload);
}
