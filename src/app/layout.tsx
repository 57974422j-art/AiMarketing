'use client'

import './globals.css'
import Navbar from '@/components/Navbar'
import { AuthProvider } from './providers'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-950 text-gray-100">
        <AuthProvider>
          <Navbar />
          <main className="flex-grow">
            {children}
          </main>
          <footer className="border-t border-white/10 bg-gray-950 mt-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="text-center">
                <p className="text-mono-sm text-gray-500">
                  © 2026 AIMARKETING SYSTEM v2.0 // ALL RIGHTS RESERVED
                </p>
              </div>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  )
}