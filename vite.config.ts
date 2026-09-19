import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { configDefaults } from 'vitest/config'
import { PREVIEW_CONTENT_SECURITY_POLICY } from './src/csp'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Local git worktrees under .worktrees/ and .claude/worktrees/ carry
    // other branches' checkouts, whose tests vitest would otherwise pick up
    // from the repo root and run against this branch's state.
    exclude: [...configDefaults.exclude, '**/.worktrees/**', '**/.claude/**'],
  },
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
    // verify better — there the policy sits on the real build, and the only
    // thing it relaxes for the local setup is connect-src.
  },
  preview: {
    // The only thing in this repo that sends a policy at all. It sends the
    // preview variant: the shipped policy (CONTENT_SECURITY_POLICY, what a
    // host has to be configured to send) plus loopback in connect-src, so
    // the local relay and Blossom server stay reachable and the other
    // directives can be walked against a loaded space. The two are derived
    // from one set of directives and src/csp.test.ts asserts they differ in
    // connect-src and nowhere else.
    headers: { 'Content-Security-Policy': PREVIEW_CONTENT_SECURITY_POLICY },
  },
})
