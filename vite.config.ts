import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  experimental: {
    // The same build runs at / and /connect/d/<device>. HTML URLs are
    // prefixed by remoteHtml; JS preloads and imported assets must resolve
    // beside their importing module, not against the public website root.
    // Keep HTML root-relative so device links also work without a final slash.
    renderBuiltUrl(_filename, { hostType }) {
      return { relative: hostType !== 'html' };
    },
  },
  build: {
    // Browser tests build into an isolated throwaway directory so they never
    // replace assets served by an already-running local SessionDeck instance.
    outDir: process.env.SESSIONDECK_CLIENT_DIR || 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@xterm/')) return 'terminal';
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react';
        },
      },
    },
  },
  server: { host: '127.0.0.1' },
});
