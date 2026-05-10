import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-bg-soft min-h-screen flex items-center justify-center px-4">
      {children}
    </div>
  )
}
