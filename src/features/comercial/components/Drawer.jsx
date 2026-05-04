export default function Drawer({ open, onClose, title, children, width = 'max-w-xl' }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div
        className={`h-full w-full ${width} overflow-y-auto border-l border-stone-200 bg-[#faf9f7] p-6 shadow-xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-stone-200 pb-4">
          <h2 className="text-xl font-semibold text-stone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-white"
          >
            Cerrar
          </button>
        </div>
        <div className="pt-5">{children}</div>
      </div>
    </div>
  )
}
