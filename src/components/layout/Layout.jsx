import { useState } from 'react'
import Sidebar from './Sidebar'

function HamburgerIcon({ open }) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      {open ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
      )}
    </svg>
  )
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f1e8]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-[280px] shrink-0 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="shrink-0 border-b border-[#e7e0d6]/80 bg-[#f6f1e8]/90 backdrop-blur-md">
          <div className="flex h-16 items-center gap-4 px-4 md:px-8">
            {/* Hamburger (mobile only) */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-600 shadow-sm transition hover:bg-stone-50 lg:hidden"
              aria-label="Abrir menú"
            >
              <HamburgerIcon open={false} />
            </button>

            <div className="flex-1">
              <p className="hidden text-[11px] font-bold uppercase tracking-[0.18em] text-stone-400 sm:block">
                Legucorp Pro · ERP Operativo
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-500 shadow-sm md:block">
                v1.0
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2f5d50] text-xs font-bold text-white shadow-sm">
                LP
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
