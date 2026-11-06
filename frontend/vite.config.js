import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  server: {
    host: '0.0.0.0',
    port: 5173,

    https: {
      key: fs.readFileSync(
        path.resolve(__dirname, 'cert/localhost+2-key.pem')
      ),
      cert: fs.readFileSync(
        path.resolve(__dirname, 'cert/localhost+2.pem')
      ),
    },

    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});