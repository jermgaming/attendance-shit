import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      auth: { token: localStorage.getItem('token') },
      reconnectionDelayMax: 5000,
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'UNAUTHENTICATED') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
