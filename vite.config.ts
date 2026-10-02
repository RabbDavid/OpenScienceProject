import { defineConfig, resolveConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve Vite's own defaults without loading this config recursively. Keep its deny rules
// when adding the ignored locations where operators store credentials and databases.
export default defineConfig(async () => {
  const defaults = await resolveConfig({ configFile: false }, 'serve');
  return {
    plugins: [react()],
    build: { target: 'es2023' },
    server: {
      fs: {
        deny: [
          ...defaults.server.fs.deny,
          '**/.local/**',
          '**/data/**',
          '**/.vercel/**',
          '*.env',
          '*.{sqlite,sqlite-*,db,dump}',
        ],
      },
    },
  };
});
