import { useState, useEffect, useRef } from 'react'
import TitleBar from './TitleBar'

const CATEGORIES = [
  'All',
  'Words', 'Music', 'Geography', 'Math/Logic', 'Movies/TV',
  'Video Games', 'Sports', 'Trivia', 'History', 'Science/Nature',
  'Colors', 'Estimation', 'Food', 'Card/Board Games',
  'Shapes/Patterns', 'Vehicles', 'Miscellaneous'
]

const CATEGORY_COLORS = {
  'Words':            { active: 'bg-blue-600',    inactive: 'bg-blue-950 text-blue-300',    border: 'border-blue-600' },
  'Music':            { active: 'bg-pink-600',    inactive: 'bg-pink-950 text-pink-300',    border: 'border-pink-600' },
  'Geography':        { active: 'bg-green-600',   inactive: 'bg-green-950 text-green-300',  border: 'border-green-600' },
  'Math/Logic':       { active: 'bg-purple-600',  inactive: 'bg-purple-950 text-purple-300',border: 'border-purple-600' },
  'Movies/TV':        { active: 'bg-red-600',     inactive: 'bg-red-950 text-red-300',      border: 'border-red-600' },
  'Video Games':      { active: 'bg-violet-600',  inactive: 'bg-violet-950 text-violet-300',border: 'border-violet-600' },
  'Sports':           { active: 'bg-orange-500',  inactive: 'bg-orange-950 text-orange-300',border: 'border-orange-500' },
  'Trivia':           { active: 'bg-sky-600',     inactive: 'bg-sky-950 text-sky-300',      border: 'border-sky-600' },
  'History':          { active: 'bg-amber-700',   inactive: 'bg-amber-950 text-amber-300',  border: 'border-amber-700' },
  'Science/Nature':   { active: 'bg-teal-600',    inactive: 'bg-teal-950 text-teal-300',    border: 'border-teal-600' },
  'Colors':           { active: 'bg-amber-500',   inactive: 'bg-amber-950 text-amber-300',  border: 'border-amber-500' },
  'Estimation':       { active: 'bg-yellow-500',  inactive: 'bg-yellow-950 text-yellow-300',border: 'border-yellow-500' },
  'Food':             { active: 'bg-lime-600',    inactive: 'bg-lime-950 text-lime-300',    border: 'border-lime-600' },
  'Card/Board Games': { active: 'bg-cyan-600',    inactive: 'bg-cyan-950 text-cyan-300',    border: 'border-cyan-600' },
  'Shapes/Patterns':  { active: 'bg-indigo-600',  inactive: 'bg-indigo-950 text-indigo-300',border: 'border-indigo-600' },
  'Vehicles':         { active: 'bg-slate-500',   inactive: 'bg-slate-800 text-slate-300',  border: 'border-slate-500' },
  'Miscellaneous':    { active: 'bg-zinc-500',    inactive: 'bg-zinc-800 text-zinc-300',    border: 'border-zinc-500' },
}

export default function DleEditor({ onClose, initialDles }) {
  const [activeDles, setActiveDles] = useState(() => {
    try {
      const saved = localStorage.getItem('dleList')
      if (saved) return JSON.parse(saved)
    } catch {}
    return initialDles ?? []
  })
  const [allDles, setAllDles] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const dragIndex = useRef(null)
  const categoryBarRef = useRef(null)

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/aukspot/dles/main/src/lib/data/dles.json')
      .then(r => r.json())
      .then(data => {
        setAllDles(data.map(d => ({ name: d.name, url: d.url, category: d.category ?? 'Miscellaneous', description: d.description ?? '' })))
        setLoading(false)
      })
      .catch(() => {
        setFetchError(true)
        setLoading(false)
      })
  }, [])

  const activeUrls = new Set(activeDles.map(d => d.url))

  const filteredDles = allDles.filter(d => {
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase())
    const matchCategory = activeCategory === 'All' || d.category === activeCategory
    return matchSearch && matchCategory
  })

  const toggleDle = (dle) => {
    if (activeUrls.has(dle.url)) {
      setActiveDles(prev => prev.filter(d => d.url !== dle.url))
    } else {
      setActiveDles(prev => [...prev, { name: dle.name, url: dle.url }])
    }
  }

  const removeDle = (url) => {
    setActiveDles(prev => prev.filter(d => d.url !== url))
  }

  const handleSave = () => {
    localStorage.setItem('dleList', JSON.stringify(activeDles))
    onClose()
  }

  // Drag-and-drop reorder
  const onDragStart = (e, index) => {
    dragIndex.current = index
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e, index) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (e, index) => {
    e.preventDefault()
    const from = dragIndex.current
    if (from === null || from === index) return
    setActiveDles(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(index, 0, moved)
      return next
    })
    dragIndex.current = null
  }

  const onDragEnd = () => {
    dragIndex.current = null
  }

  return (
    <div className="dle-editor flex flex-col h-screen w-full bg-gray-950 text-white overflow-hidden">
      <style>{`
        .dle-editor ::-webkit-scrollbar { width: 6px; }
        .dle-editor ::-webkit-scrollbar-track { background: transparent; }
        .dle-editor ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
        .dle-editor ::-webkit-scrollbar-thumb:hover { background: #4B5563; }
      `}</style>
      <TitleBar />

      {/* Main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel — Active list, fixed width */}
        <div className="flex flex-col w-64 shrink-0 border-r border-gray-800 bg-gray-950 overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 shrink-0">
            <h2 className="text-sm font-semibold text-white">Tonight's Dles</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-400">
              {activeDles.length}
            </span>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto py-1">
            {activeDles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center px-4">
                <p className="text-gray-600 text-xs">No dles added yet</p>
                <p className="text-gray-700 text-xs">Add from the list →</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {activeDles.map((dle, index) => (
                  <div
                    key={dle.url}
                    draggable
                    onDragStart={e => onDragStart(e, index)}
                    onDragOver={e => onDragOver(e, index)}
                    onDrop={e => onDrop(e, index)}
                    onDragEnd={onDragEnd}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-900 group transition-colors cursor-grab active:cursor-grabbing"
                  >
                    <span className="text-gray-700 group-hover:text-gray-500 select-none text-sm leading-none shrink-0">⠿</span>
                    <span className="text-xs text-gray-600 font-mono w-4 shrink-0 text-right">{index + 1}</span>
                    <span className="flex-1 text-sm text-gray-300 truncate min-w-0">{dle.name}</span>
                    <button
                      onClick={() => removeDle(dle.url)}
                      className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-xs"
                      title="Remove"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — Aukspot browser, fills remaining width */}
        <div className="flex flex-col flex-1 min-w-0 bg-gray-950 overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 shrink-0">
            <h2 className="text-sm font-semibold text-white">All Dles</h2>
            {!loading && !fetchError && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-400">
                {filteredDles.length}{activeCategory !== 'All' || search ? ` / ${allDles.length}` : ''}
              </span>
            )}
          </div>

          {/* Search */}
          <div className="px-3 pt-2 pb-1.5 shrink-0">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-8 pr-7 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-xs"
                >✕</button>
              )}
            </div>
          </div>

          {/* Category pills */}
          <div
            ref={categoryBarRef}
            className="flex flex-wrap gap-1 px-3 pb-1.5 shrink-0"
          >
            {CATEGORIES.map(cat => {
              const isSelected = activeCategory === cat
              const colors = cat === 'All'
                ? { active: 'bg-orange-500', inactive: 'bg-gray-800 text-gray-300' }
                : CATEGORY_COLORS[cat] ?? { active: 'bg-gray-600', inactive: 'bg-gray-800 text-gray-300' }
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                    isSelected ? `${colors.active} text-white` : colors.inactive
                  }`}
                >
                  {cat}
                </button>
              )
            })}
          </div>

          {/* Dle list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-5 h-5 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
                <p className="text-xs text-gray-500">Loading...</p>
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center px-8">
                <p className="text-gray-500 text-sm">Couldn't load dle list</p>
                <p className="text-gray-700 text-xs">Check your connection and reopen</p>
              </div>
            ) : filteredDles.length === 0 ? (
              <div className="flex items-center justify-center h-24">
                <p className="text-gray-600 text-sm">No matches</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {filteredDles.map(dle => {
                  const isActive = activeUrls.has(dle.url)
                  const borderClass = CATEGORY_COLORS[dle.category]?.border ?? 'border-gray-700'
                  return (
                    <div
                      key={dle.url}
                      className={`flex items-center gap-2 pl-2 pr-3 py-1.5 border-l-2 ${borderClass} transition-colors ${
                        isActive ? 'opacity-40' : 'hover:bg-gray-900'
                      }`}
                    >
                      <span className="text-sm text-gray-200 shrink-0">{dle.name}</span>
                      {dle.description && (
                        <span className="flex-1 text-xs text-gray-500 truncate min-w-0">— {dle.description}</span>
                      )}
                      {!dle.description && <span className="flex-1" />}
                      <span className="text-xs text-gray-600 shrink-0">{dle.category}</span>
                      <button
                        onClick={() => toggleDle(dle)}
                        className={`shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs font-semibold transition-colors ${
                          isActive
                            ? 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'
                            : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                        title={isActive ? 'Remove from list' : 'Add to list'}
                      >
                        {isActive ? '✓' : '+'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-800 bg-gray-900 shrink-0">
        <button
          onClick={onClose}
          className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-sm font-medium transition-colors"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {activeDles.length === 0 && (
            <p className="text-xs text-gray-600">Add at least one dle to save</p>
          )}
          <button
            onClick={handleSave}
            disabled={activeDles.length === 0}
            className="px-5 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: activeDles.length > 0 ? '#E8500A' : undefined }}
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  )
}
