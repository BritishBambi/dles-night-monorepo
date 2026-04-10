import { useState, useEffect, useRef } from 'react'
import TitleBar from './TitleBar'

const CATEGORIES = [
  'All',
  'Words', 'Music', 'Geography', 'Math/Logic', 'Movies/TV',
  'Video Games', 'Sports', 'Trivia', 'History', 'Science/Nature',
  'Colors', 'Estimation', 'Food', 'Card/Board Games',
  'Shapes/Patterns', 'Vehicles', 'Miscellaneous'
]

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
        setAllDles(data.map(d => ({ name: d.name, url: d.url, category: d.category ?? 'Miscellaneous' })))
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
    <div className="flex flex-col h-screen w-screen bg-gray-950 text-white overflow-hidden">
      <TitleBar />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel — Active list */}
        <div className="flex flex-col w-2/5 border-r border-gray-800 bg-gray-950">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
            <h2 className="text-base font-semibold text-white">Tonight's Dles</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-300">
              {activeDles.length} {activeDles.length === 1 ? 'dle' : 'dles'}
            </span>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {activeDles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
                <p className="text-gray-600 text-sm">No dles added yet</p>
                <p className="text-gray-700 text-xs">Add some from the list on the right</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {activeDles.map((dle, index) => (
                  <div
                    key={dle.url}
                    draggable
                    onDragStart={e => onDragStart(e, index)}
                    onDragOver={e => onDragOver(e, index)}
                    onDrop={e => onDrop(e, index)}
                    onDragEnd={onDragEnd}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700 group transition-colors cursor-grab active:cursor-grabbing"
                  >
                    {/* Drag handle */}
                    <span className="text-gray-600 group-hover:text-gray-500 select-none text-base leading-none shrink-0">
                      ⠿
                    </span>
                    {/* Index + name */}
                    <span className="text-xs text-gray-600 font-mono w-5 shrink-0 text-right">
                      {index + 1}
                    </span>
                    <span className="flex-1 text-sm text-gray-200 truncate">
                      {dle.name}
                    </span>
                    {/* Remove */}
                    <button
                      onClick={() => removeDle(dle.url)}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — Aukspot browser */}
        <div className="flex flex-col flex-1 bg-gray-950">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
            <h2 className="text-base font-semibold text-white">All Dles</h2>
            {!loading && !fetchError && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-300">
                {allDles.length} total
              </span>
            )}
          </div>

          {/* Search */}
          <div className="px-4 pt-3 pb-2 shrink-0">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search dles..."
                className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Category pills */}
          <div
            ref={categoryBarRef}
            className="flex gap-1.5 px-4 pb-3 overflow-x-auto shrink-0 scrollbar-none"
            style={{ scrollbarWidth: 'none' }}
          >
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? 'text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                }`}
                style={activeCategory === cat ? { backgroundColor: '#E8500A' } : {}}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Dle list */}
          <div className="flex-1 overflow-y-auto px-3 pb-2">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-6 h-6 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
                <p className="text-sm text-gray-500">Loading dle list...</p>
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
                <p className="text-gray-500 text-sm">Couldn't load the dle list</p>
                <p className="text-gray-700 text-xs">Check your connection and reopen the editor</p>
              </div>
            ) : filteredDles.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-gray-600 text-sm">No dles match your search</p>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredDles.map(dle => {
                  const isActive = activeUrls.has(dle.url)
                  return (
                    <div
                      key={dle.url}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-gray-900/50 opacity-50'
                          : 'hover:bg-gray-900'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{dle.name}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{dle.category}</p>
                      </div>
                      <button
                        onClick={() => toggleDle(dle)}
                        className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
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
      <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 bg-gray-900 shrink-0">
        <button
          onClick={onClose}
          className="px-5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-sm font-medium transition-colors"
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
            className="px-6 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: activeDles.length > 0 ? '#E8500A' : undefined }}
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  )
}
