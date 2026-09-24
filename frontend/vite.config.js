import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host: true → Vite écoute sur le réseau (accès LAN depuis le téléphone).
  server: { port: 5173, host: true },
  // Tests (Vitest) : DOM simulé par jsdom, stockage et fetch réinitialisés par test.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    restoreMocks: true,
  },
});
