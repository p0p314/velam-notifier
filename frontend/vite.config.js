import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host: true → Vite écoute sur le réseau (accès LAN depuis le téléphone).
  server: { port: 5173, host: true },
});
