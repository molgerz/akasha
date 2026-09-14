import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { CONTENT_SECURITY_POLICY } from './src/csp'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 5173 is taken by a container on this machine
  server: {
    port: 5273,
    strictPort: true,
    // No CSP on the dev server, on purpose. @vitejs/plugin-react injects an
    // inline <script type="module"> (the Fast Refresh preamble) into
    // index.html and the HMR client opens a WebSocket to the dev server, so a
    // dev policy would need 'unsafe-inline' in script-src plus ws: and http:
    // in connect-src for the local relay and Blossom. That neuters the one
    // directive this ticket is about while adding a second policy to keep in
    // sync, and it would verify nothing that `npm run preview` does not
    // verify better — there the real header sits on the real build.
  },
  preview: {
    // The only thing in this repo that actually sends the policy. See
    // src/csp.ts: a real host still has to be configured to send it too.
    headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
  },
})
