import logo from '../assets/logo.png'

export default function TitleBar() {
  return (
    <div
      className="flex items-center justify-between h-8 bg-gray-900 border-b border-gray-700 shrink-0 select-none"
      style={{ WebkitAppRegion: 'drag' }}
    >
      <img src={logo} alt="Dles Night" className="h-5 w-auto px-3 box-content" />

      <div className="flex" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={() => window.api.window.minimize()}
          className="w-[46px] h-8 flex items-center justify-center text-gray-400 hover:bg-gray-700 hover:text-white transition-colors text-sm"
          title="Minimize"
        >
          ─
        </button>
        <button
          onClick={() => window.api.window.maximize()}
          className="w-[46px] h-8 flex items-center justify-center text-gray-400 hover:bg-gray-700 hover:text-white transition-colors text-sm"
          title="Maximize"
        >
          □
        </button>
        <button
          onClick={() => window.api.window.close()}
          className="w-[46px] h-8 flex items-center justify-center text-gray-400 hover:bg-red-600 hover:text-white transition-colors text-sm"
          title="Close"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
