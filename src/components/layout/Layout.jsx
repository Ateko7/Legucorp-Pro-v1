import Sidebar from './Sidebar'

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-[#f6f1e8] text-stone-800">
      <div className="flex min-h-screen">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#f8f4ec]/90 backdrop-blur">
            <div className="flex h-20 items-center justify-between px-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Legucorp Pro V1
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-stone-800">
                  Panel operativo
                </h1>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm text-stone-500 shadow-sm md:block">
                  ERP de operaciones
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2f5d50] text-sm font-semibold text-white shadow-sm">
                  LP
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 px-8 py-8">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}