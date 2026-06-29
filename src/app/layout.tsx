'use client'

import './globals.css'
import Navbar from '@/components/Navbar'
import ToastContainer from '@/components/Toast'
import AIGuide from '@/components/AIGuide'
import { AuthProvider } from './providers'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#6366f1" />
      </head>
      <body className="min-h-screen bg-[#0a0a0f] text-gray-100 flex flex-col">
        <AuthProvider>
          <Navbar />
          <ToastContainer />
          <AIGuide />
          <main className="flex-1">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  )
}