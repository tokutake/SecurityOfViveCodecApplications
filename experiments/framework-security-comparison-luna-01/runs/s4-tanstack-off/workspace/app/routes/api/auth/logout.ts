import { createFileRoute, redirect } from '@tanstack/react-router'

// Logout is handled via server function (logoutFn) in __root.tsx.
// This route handles direct GET navigation to /api/auth/logout gracefully.
export const Route = createFileRoute('/api/auth/logout')({
  loader: async () => {
    throw redirect({ href: '/', statusCode: 302 })
  },
})
