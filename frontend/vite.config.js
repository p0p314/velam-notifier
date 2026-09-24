import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  // Version de l'app (package.json) injectée au build → affichée dans l'UI.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // host: true → Vite écoute sur le réseau (accès LAN depuis le téléphone).
  server: { port: 5173, host: true },
  // Tests (Vitest) : DOM simulé par jsdom, stockage et fetch réinitialisés par test.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    restoreMocks: true,
  },
});
