import './globals.css'
import Navbar from '@/components/Navbar'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="flex-grow">
          {children}
        </main>
        <footer className="bg-white shadow-inner mt-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="text-center text-gray-600">
              <p>© 2026 AiMarketing. 保留所有权利。</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}