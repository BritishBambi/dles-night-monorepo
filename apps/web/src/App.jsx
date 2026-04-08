import { useState, useRef, useEffect } from 'react'
import { DlesRTC, SharedCanvas, SessionChat, SessionSync, StickyNotes, supabase, DLES } from '@dles-night/shared'

const SESSION_ID = 'nightsession'

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  })
}

function StickyNote({ note, onMove, onDelete }) {
  const ref = useRef(null)
  const dragging = useRef(false)
  const offset = useRef({ x: 0, y: 0 })

  const onMouseDown = (e) => {
    if (e.target.closest('button')) return
    dragging.current = true
    offset.current = {
      x: e.clientX - note.x,
      y: e.clientY - note.y
    }
    e.preventDefault()
  }

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current) return
      onMove(note.id, e.clientX - offset.current.x, e.clientY - offset.current.y)
    }
    const onMouseUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [note.id, onMove])

  return (
    <div
      ref={ref}
      onMouseDown={onMouseDown}
      className="absolute pointer-events-auto select-none w-48 bg-gray-900 border rounded-xl shadow-lg p-3 flex flex-col gap-1 cursor-grab active:cursor-grabbing"
      style={{ left: note.x, top: note.y, borderColor: note.colour }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: note.colour }}>
          {note.username}
        </span>
        <button
          onClick={() => onDelete(note.id)}
          className="text-gray-600 hover:text-red-400 text-xs leading-none"
        >
          ✕
        </button>
      </div>
      <p className="text-sm text-gray-200 break-words">{note.text}</p>
    </div>
  )
}

function getVideoContentRect(videoEl, panelEl) {
  const panelRect = panelEl.getBoundingClientRect()
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
    return { x: 0, y: 0, width: panelRect.width, height: panelRect.height }
  }
  const videoRatio = videoEl.videoWidth / videoEl.videoHeight
  const panelRatio = panelRect.width / panelRect.height
  let contentWidth, contentHeight, offsetX, offsetY
  if (videoRatio > panelRatio) {
    // Video wider than panel — letterbox top/bottom
    contentWidth = panelRect.width
    contentHeight = panelRect.width / videoRatio
    offsetX = 0
    offsetY = (panelRect.height - contentHeight) / 2
  } else {
    // Video taller than panel — letterbox left/right
    contentHeight = panelRect.height
    contentWidth = panelRect.height * videoRatio
    offsetX = (panelRect.width - contentWidth) / 2
    offsetY = 0
  }
  return { x: offsetX, y: offsetY, width: contentWidth, height: contentHeight }
}

function App() {
  const [screen, setScreen] = useState('menu') // 'menu' | 'username' | 'game'
  const [streamVolume, setStreamVolume] = useState(() => parseFloat(localStorage.getItem('streamVolume') ?? '1'))
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewerStream, setViewerStream] = useState(null)
  const [activeTool, setActiveTool] = useState('pen')
  const [activeColour, setActiveColour] = useState('#E8500A')
  const [drawMode, setDrawMode] = useState(false)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [username, setUsername] = useState('')
  const [usernameColour, setUsernameColour] = useState('#E8500A')
  const [sessionResults, setSessionResults] = useState([])
  const [winRate, setWinRate] = useState(null)
  const [notes, setNotes] = useState({})
  const [sessionNotes, setSessionNotes] = useState([])
  const [newNoteText, setNewNoteText] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [showRecap, setShowRecap] = useState(false)
  const [connectedUsers, setConnectedUsers] = useState([])
  const [copied, setCopied] = useState(false)
  const [streamStatus, setStreamStatus] = useState(null)
  const [needsUnmute, setNeedsUnmute] = useState(false)
  const rtcRef = useRef(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const panelRef = useRef(null)
  const sharedCanvasRef = useRef(null)
  const chatRef = useRef(null)
  const messagesEndRef = useRef(null)
  const notesRef = useRef(null)
  const recapRef = useRef(null)
  const sessionSyncRef = useRef(null)
  const currentIndexRef = useRef(currentIndex)
  const usernameColourPickerRef = useRef(null)
  const toolbarColourPickerRef = useRef(null)
  const connectionTimeoutRef = useRef(null)
  const [toolbarPos, setToolbarPos] = useState({ x: 16, y: 80 })
  const toolbarDragging = useRef(false)
  const toolbarOffset = useRef({ x: 0, y: 0 })

  const joinAsViewer = async () => {
    setStreamStatus('connecting')
    rtcRef.current = new DlesRTC((stream) => {
      setViewerStream(stream)
      setStreamStatus('connected')
    }, SESSION_ID, ICE_SERVERS)
    rtcRef.current.onConnectionState = (state) => setStreamStatus(state)
    await rtcRef.current.joinAsViewer()
  }

  useEffect(() => {
    if (videoRef.current && viewerStream) {
      videoRef.current.srcObject = viewerStream
      videoRef.current.muted = true
      videoRef.current.play()
        .then(() => {
          videoRef.current.muted = false
          videoRef.current.volume = streamVolume
          setNeedsUnmute(false)
        })
        .catch(err => {
          console.warn('Autoplay blocked:', err)
          setNeedsUnmute(true)
        })
    }
  }, [viewerStream])

  // Show a warning if ICE stays in a pending state for more than 15 seconds
  useEffect(() => {
    if (streamStatus === 'connecting' || streamStatus === 'new' || streamStatus === 'checking') {
      connectionTimeoutRef.current = setTimeout(() => {
        setStreamStatus('timeout')
      }, 15000)
    } else {
      clearTimeout(connectionTimeoutRef.current)
    }
    return () => clearTimeout(connectionTimeoutRef.current)
  }, [streamStatus])

  // Resize canvas to match actual video content area when stream connects or video dimensions change
  useEffect(() => {
    if (!viewerStream || !videoRef.current || !canvasRef.current || !panelRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    const panel = panelRef.current

    const sizeToVideo = () => {
      if (!video.videoWidth) return
      const rect = getVideoContentRect(video, panel)
      canvas.width = Math.round(rect.width)
      canvas.height = Math.round(rect.height)
      canvas.style.left = Math.round(rect.x) + 'px'
      canvas.style.top = Math.round(rect.y) + 'px'
      canvas.style.width = Math.round(rect.width) + 'px'
      canvas.style.height = Math.round(rect.height) + 'px'
    }

    video.addEventListener('loadedmetadata', sizeToVideo)
    video.addEventListener('resize', sizeToVideo)
    if (video.videoWidth) sizeToVideo()

    return () => {
      video.removeEventListener('loadedmetadata', sizeToVideo)
      video.removeEventListener('resize', sizeToVideo)
    }
  }, [viewerStream])

  useEffect(() => {
    return () => {
      if (rtcRef.current) rtcRef.current.disconnect()
    }
  }, [])

  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => {
    if (screen !== 'game') return
    fetchWinRate()
  }, [screen])

  useEffect(() => {
    if (screen !== 'game') return

    const ss = new SessionSync(
      (event) => {
        if (event.type === 'result') {
          setSessionResults(event.sessionResults)
          if (event.winRate) setWinRate(event.winRate)
        }
        if (event.type === 'advance') {
          setCurrentIndex(event.currentIndex)
        }
        if (event.type === 'end-session') {
          setSessionResults(event.sessionResults)
          if (event.winRate) setWinRate(event.winRate)
          setShowRecap(true)
        }
        if (event.type === 'state-sync') {
          setSessionResults(event.sessionResults)
          setCurrentIndex(event.currentIndex)
        }
      },
      (users) => setConnectedUsers(users),
    )

    sessionSyncRef.current = ss
    ss.connect(username, usernameColour)

    return () => ss.disconnect()
  }, [screen])

  const fetchWinRate = async () => {
    const { data } = await supabase.from('win_rate').select('*').single()
    if (data) setWinRate(data)
  }

  useEffect(() => {
    if (screen !== 'game') return
    const sn = new StickyNotes((updatedNotes) => {
      setNotes(updatedNotes)
      // Add any new notes to the session log
      setSessionNotes(prev => {
        const existingIds = new Set(prev.map(n => n.id))
        const newNotes = Object.values(updatedNotes).filter(n => !existingIds.has(n.id))
        if (newNotes.length === 0) return prev
        return [...prev, ...newNotes.map(n => ({
          ...n,
          dleName: DLES[currentIndexRef.current]?.name || 'Unknown'
        }))]
      })
    })

    // Align note coordinates to the actual video content area
    sn.setReferenceFrame(() => {
      const video = videoRef.current
      const panel = panelRef.current
      if (!video || !panel || !video.videoWidth) return null
      const contentRect = getVideoContentRect(video, panel)
      const panelRect = panel.getBoundingClientRect()
      return {
        x: panelRect.x + contentRect.x,
        y: panelRect.y + contentRect.y,
        width: contentRect.width,
        height: contentRect.height,
      }
    })

    notesRef.current = sn
    sn.connect()
    return () => sn.disconnect()
  }, [screen])

  useEffect(() => {
    if (screen !== 'game') return
    const chat = new SessionChat((msg) => {
      setMessages(prev => [...prev, msg])
    })
    chatRef.current = chat
    chat.connect()
    return () => chat.disconnect()
  }, [screen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (screen !== 'game' || !canvasRef.current || !panelRef.current) return

    const canvas = canvasRef.current
    const panel = panelRef.current

    // Size canvas to full panel initially (video content rect applied later when stream loads)
    const panelRect = panel.getBoundingClientRect()
    canvas.width = Math.round(panelRect.width)
    canvas.height = Math.round(panelRect.height)
    canvas.style.left = '0px'
    canvas.style.top = '0px'

    const userId = rtcRef.current?.viewerId || crypto.randomUUID()
    const sc = new SharedCanvas(canvas, userId)
    sharedCanvasRef.current = sc
    sc.connect().then(() => sc.attachListeners())

    const handleResize = () => {
      const video = videoRef.current
      let x = 0, y = 0, w, h
      if (video && video.videoWidth) {
        const rect = getVideoContentRect(video, panel)
        x = Math.round(rect.x); y = Math.round(rect.y)
        w = Math.round(rect.width); h = Math.round(rect.height)
      } else {
        const r = panel.getBoundingClientRect()
        w = Math.round(r.width); h = Math.round(r.height)
      }
      canvas.style.left = x + 'px'
      canvas.style.top = y + 'px'
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      canvas.width = w
      canvas.height = h
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      sc.disconnect()
    }
  }, [screen])

  const handleEndSession = async () => {
    const { data } = await supabase.from('win_rate').select('*').single()
    const currentWinRate = data || winRate
    setWinRate(currentWinRate)
    sessionSyncRef.current?.broadcastEndSession(sessionResults, currentWinRate)
    setShowRecap(true)
  }

  const copyResult = () => {
    const tonightWins = sessionResults.filter(r => r.result === 'win').length
    const tonightPct = sessionResults.length > 0
      ? Math.round((tonightWins / sessionResults.length) * 100) : 0
    const allTimePct = winRate?.total_played > 0
      ? Math.round((winRate.total_won / winRate.total_played) * 100) : 0

    const resultLines = sessionResults.map(r =>
      `${r.result === 'win' ? '✅' : '❌'} ${r.name}`
    ).join('\n')

    const userLine = connectedUsers.length > 0
      ? `\n👥 Tonight's crew: ${connectedUsers.map(u => u.username).join(', ')}`
      : ''

    const text = `🎮 Dles Night — ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}

${resultLines}

🏆 Tonight: ${tonightWins}/${sessionResults.length} (${tonightPct}%)
📊 All Time: ${winRate ? `${winRate.total_won}/${winRate.total_played}` : '—'} (${allTimePct}%)${userLine}

powered by Jojo labs`

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const submitNote = () => {
    if (!newNoteText.trim() || !notesRef.current) return
    notesRef.current.addNote(username, usernameColour, newNoteText.trim())
    setNewNoteText('')
    setShowNoteInput(false)
  }

  const sendMessage = () => {
    if (!chatInput.trim() || !chatRef.current) return
    chatRef.current.send(username, chatInput, usernameColour)
    setChatInput('')
  }

  const onToolbarMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return
    toolbarDragging.current = true
    toolbarOffset.current = {
      x: e.clientX - toolbarPos.x,
      y: e.clientY - toolbarPos.y
    }
    e.preventDefault()
  }

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!toolbarDragging.current) return
      setToolbarPos({
        x: Math.max(0, Math.min(e.clientX - toolbarOffset.current.x, window.innerWidth - 56)),
        y: Math.max(0, Math.min(e.clientY - toolbarOffset.current.y, window.innerHeight - 56)),
      })
    }
    const onMouseUp = () => { toolbarDragging.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Main menu
  if (screen === 'menu') {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {/* Settings cog — top right */}
        <div className="flex justify-end px-4 pt-3">
          <button
            disabled
            className="w-8 h-8 flex items-center justify-center text-gray-700 cursor-not-allowed"
            title="Settings (coming soon)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>

        {/* Centre content */}
        <div className="flex-1 flex flex-col items-center justify-center gap-8">
          <img src="/logo.png" alt="Dles Night" className="h-20 w-auto" />

          <button
            onClick={() => setScreen('username')}
            className="px-10 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-lg font-semibold transition-colors"
          >
            Join Lobby
          </button>
        </div>
      </div>
    )
  }

  // Username / colour picker
  if (screen === 'username') {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-6">
        <img src="/logo.png" alt="Dles Night" className="h-16 w-auto" />
        <div className="flex flex-col items-center gap-3">
          <p className="text-gray-400">What's your name?</p>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && username.trim()) { joinAsViewer(); setScreen('game') } }}
            placeholder="Enter your name..."
            className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 w-64 text-center"
            autoFocus
          />
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-gray-400">Pick your colour</p>

            {/* Hidden native colour input */}
            <input
              type="color"
              ref={usernameColourPickerRef}
              value={usernameColour}
              onChange={e => setUsernameColour(e.target.value)}
              className="sr-only"
            />

            {/* Visible styled button that triggers it */}
            <button
              onClick={() => usernameColourPickerRef.current.click()}
              className="relative w-12 h-12 rounded-full hover:scale-110 transition-transform"
              style={{
                background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                padding: '2px'
              }}
              title="Pick a colour"
            >
              <span
                className="block w-full h-full rounded-full"
                style={{ backgroundColor: usernameColour }}
              />
            </button>

            {/* Quick presets */}
            <div className="flex gap-2 flex-wrap justify-center">
              {['#FF0000','#FF6600','#FFCC00','#99CC00','#00CC00',
                '#00CC99','#00CCCC','#0066FF','#3300CC','#6600CC',
                '#CC00CC','#FF0099','#FFFFFF'].map(c => (
                <button
                  key={c}
                  onClick={() => setUsernameColour(c)}
                  className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: usernameColour === c ? 'white' : 'transparent'
                  }}
                />
              ))}
            </div>

            {/* Live preview */}
            <p className="text-sm font-semibold" style={{ color: usernameColour }}>
              {username || 'Your name'}
            </p>
          </div>
          <button
            onClick={() => { if (username.trim()) { joinAsViewer(); setScreen('game') } }}
            className="px-6 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-semibold"
          >
            Let's go
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 text-white">

      {/* Top bar */}
      <header className="relative flex items-center px-4 h-12 border-b border-gray-800 shrink-0">
        <img src="/logo.png" alt="Dles Night" className="h-8 w-auto" />
        <span className="absolute left-1/2 -translate-x-1/2 text-sm text-gray-400">
          {DLES[currentIndex].name} — Game {currentIndex + 1} of {DLES.length}
        </span>
        <div className="ml-auto flex items-center gap-4">
          {winRate && (
            <div className="text-sm text-gray-400">
              All time: <span className="text-orange-400 font-semibold">{winRate.total_won}/{winRate.total_played}</span>
              <span className="text-gray-600 ml-1">
                ({winRate.total_played > 0 ? Math.round((winRate.total_won / winRate.total_played) * 100) : 0}%)
              </span>
            </div>
          )}
          <button
            onClick={handleEndSession}
            className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm"
          >
            End Session
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden w-full">

        {/* Main panel — 75% */}
        <div className="flex flex-col flex-1 h-full border-r border-gray-800 min-h-0 overflow-hidden">

          {/* Panel area */}
          <div ref={panelRef} className="relative flex-1 min-h-0">

            <canvas
              ref={canvasRef}
              className="absolute z-10"
              style={{
                cursor: drawMode ? (activeTool === 'eraser' ? 'cell' : 'crosshair') : 'default',
                pointerEvents: drawMode ? 'auto' : 'none'
              }}
            />

            {viewerStream ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                Waiting for Julie to start streaming...
              </div>
            )}
            {needsUnmute && (
              <div className="absolute inset-0 flex items-center justify-center">
                <button
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.muted = false
                      videoRef.current.volume = streamVolume
                      videoRef.current.play().catch(() => {})
                    }
                    setNeedsUnmute(false)
                  }}
                  className="px-5 py-3 bg-gray-900/90 hover:bg-gray-800 text-white text-sm rounded-xl border border-gray-700 backdrop-blur-sm"
                >
                  🔇 Click to unmute
                </button>
              </div>
            )}
            {streamStatus && !['connected', 'completed'].includes(streamStatus) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
                <div className="text-center px-6 max-w-sm">
                  {streamStatus === 'failed' ? (
                    <p className="text-red-400 text-sm">Connection failed — your network may be blocking the stream. Click Reconnect to try again.</p>
                  ) : streamStatus === 'disconnected' ? (
                    <p className="text-yellow-400 text-sm">Stream disconnected — attempting to reconnect...</p>
                  ) : streamStatus === 'timeout' ? (
                    <p className="text-yellow-400 text-sm">Taking longer than expected — try clicking Reconnect or switching networks.</p>
                  ) : (
                    <p className="text-gray-400 text-sm">Connecting to stream...</p>
                  )}
                </div>
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2 bg-gray-950">
              <button
                onClick={async () => {
                  setViewerStream(null)
                  setStreamStatus('connecting')
                  await rtcRef.current.reconnect()
                }}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  streamStatus === 'failed' || streamStatus === 'timeout'
                    ? 'bg-orange-600 hover:bg-orange-500 text-white animate-pulse'
                    : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
                }`}
              >
                ↺ Reconnect Stream
              </button>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-xs select-none">{streamVolume === 0 ? '🔇' : '🔊'}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={streamVolume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setStreamVolume(v)
                    localStorage.setItem('streamVolume', v)
                    if (videoRef.current) videoRef.current.volume = v
                  }}
                  className="volume-slider"
                  style={{
                    background: `linear-gradient(to right, #E8500A 0%, #E8500A ${streamVolume * 100}%, #374151 ${streamVolume * 100}%, #374151 100%)`
                  }}
                />
              </div>
            </div>
          </div>

        </div>

        {/* Right sidebar — chat */}
        <div className="w-80 shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col h-full">
          <div className="px-4 py-3 border-b border-gray-800">
            <p className="text-sm font-semibold text-gray-300">Chat</p>
            <p className="text-xs text-gray-500">
              Chatting as <span style={{ color: usernameColour }}>{username}</span>
            </p>
            {connectedUsers.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Online:{' '}
                {connectedUsers.map((u, i) => (
                  <span key={u.username}>
                    <span style={{ color: u.colour }}>{u.username}</span>
                    {i < connectedUsers.length - 1 && <span className="text-gray-600">, </span>}
                  </span>
                ))}
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
            {messages.length === 0 && (
              <p className="text-xs text-gray-600 text-center mt-4">No messages yet...</p>
            )}
            {messages.map((msg, i) => (
              <div key={msg.timestamp ?? i} className="flex flex-col gap-0.5">
                <span className="text-xs font-medium" style={{ color: msg.colour || '#E8500A' }}>{msg.username}</span>
                <span className="text-sm text-gray-200 bg-gray-800 rounded-lg px-3 py-1.5 break-words">{msg.text}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-3 py-3 border-t border-gray-800 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
            <button
              onClick={sendMessage}
              className="px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-semibold"
            >
              →
            </button>
          </div>
        </div>

      </div>

      {/* Sticky notes overlay */}
      <div className="fixed inset-0 z-30 pointer-events-none">
        {Object.values(notes).map(note => (
          <StickyNote
            key={note.id}
            note={note}
            onMove={(id, x, y) => notesRef.current?.moveNote(id, x, y)}
            onDelete={(id) => notesRef.current?.deleteNote(id)}
          />
        ))}
      </div>

      {/* Draggable vertical toolbar */}
      <div
        onMouseDown={onToolbarMouseDown}
        className="fixed z-50 flex flex-col items-center gap-2 bg-gray-900/90 backdrop-blur border border-gray-700 rounded-2xl px-2 py-3 shadow-xl cursor-grab active:cursor-grabbing select-none"
        style={{ left: toolbarPos.x, top: toolbarPos.y }}
      >
        {/* Drag handle indicator */}
        <div className="flex flex-col gap-0.5 mb-1 opacity-40">
          <div className="w-4 h-0.5 bg-gray-400 rounded" />
          <div className="w-4 h-0.5 bg-gray-400 rounded" />
          <div className="w-4 h-0.5 bg-gray-400 rounded" />
        </div>

        {/* Draw toggle */}
        <button
          onClick={() => setDrawMode(prev => !prev)}
          className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center transition-colors ${drawMode ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          title={drawMode ? 'Drawing on' : 'Drawing off'}
        >
          ✏️
        </button>

        {/* Pen */}
        <button
          onClick={() => { setActiveTool('pen'); sharedCanvasRef.current?.setTool('pen') }}
          className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${activeTool === 'pen' && drawMode ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          title="Pen"
        >
          🖊
        </button>

        {/* Eraser */}
        <button
          onClick={() => { setActiveTool('eraser'); sharedCanvasRef.current?.setTool('eraser') }}
          className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${activeTool === 'eraser' && drawMode ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          title="Eraser"
        >
          🧹
        </button>

        {/* Note */}
        <button
          onClick={() => setShowNoteInput(prev => !prev)}
          className={`w-8 h-8 rounded-lg text-sm transition-colors ${showNoteInput ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          title="Add note"
        >
          📝
        </button>

        {/* Divider */}
        <div className="w-4 h-px bg-gray-700 my-1" />

        {/* Rainbow colour picker */}
        <input
          type="color"
          ref={toolbarColourPickerRef}
          value={activeColour}
          onChange={e => {
            setActiveColour(e.target.value)
            sharedCanvasRef.current?.setColour(e.target.value)
          }}
          className="sr-only"
        />
        <button
          onClick={() => toolbarColourPickerRef.current.click()}
          className="relative w-8 h-8 rounded-full hover:scale-110 transition-transform"
          style={{
            background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
            padding: '2px'
          }}
          title="Pick colour"
        >
          <span
            className="block w-full h-full rounded-full"
            style={{ backgroundColor: activeColour }}
          />
        </button>

        {/* Quick presets — vertical */}
        {['#E8500A','#ffffff','#facc15','#4ade80','#60a5fa','#f472b6','#ef4444','#a855f7'].map(c => (
          <button
            key={c}
            onClick={() => {
              setActiveColour(c)
              sharedCanvasRef.current?.setColour(c)
            }}
            className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
            style={{
              backgroundColor: c,
              borderColor: activeColour === c ? 'white' : 'transparent'
            }}
          />
        ))}

        {/* Divider */}
        <div className="w-4 h-px bg-gray-700 my-1" />

        {/* Clear */}
        <button
          onClick={() => sharedCanvasRef.current?.broadcastClear()}
          className="w-8 h-8 rounded-lg text-sm bg-gray-700 hover:bg-red-900 text-gray-300 hover:text-white transition-colors"
          title="Clear canvas"
        >
          🗑
        </button>
      </div>

      {/* Note input popup — position near toolbar */}
      {showNoteInput && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-xl p-3 flex gap-2 shadow-xl w-72"
          style={{ left: Math.min(toolbarPos.x + 56, window.innerWidth - 296), top: toolbarPos.y }}
        >
          <input
            type="text"
            value={newNoteText}
            onChange={e => setNewNoteText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitNote()}
            placeholder="Type a note..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
            autoFocus
          />
          <button
            onClick={submitNote}
            className="px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-semibold"
          >
            Add
          </button>
        </div>
      )}

      {/* Recap overlay */}
      {showRecap && (
        <div className="fixed inset-0 z-50 bg-gray-950 overflow-y-auto flex flex-col items-center py-12 px-6">

          <div
            ref={recapRef}
            className="w-full max-w-[600px] bg-gray-900 rounded-2xl p-8 flex flex-col gap-6"
          >
            {/* Header */}
            <div className="text-center">
              <h1 className="text-3xl font-bold text-orange-600">
                Dles Night
              </h1>
              <p className="text-[13px] text-gray-400 mt-1">
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>

            {/* Win rates */}
            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  label: 'Tonight',
                  score: `${sessionResults.filter(r => r.result === 'win').length}/${sessionResults.length}`,
                  pct: sessionResults.length > 0
                    ? Math.round((sessionResults.filter(r => r.result === 'win').length / sessionResults.length) * 100)
                    : 0
                },
                {
                  label: 'All Time',
                  score: winRate ? `${winRate.total_won}/${winRate.total_played}` : '—',
                  pct: winRate?.total_played > 0
                    ? Math.round((winRate.total_won / winRate.total_played) * 100)
                    : 0
                }
              ].map(stat => (
                <div key={stat.label} className="bg-gray-800 rounded-xl p-4 text-center">
                  <p className="text-[11px] text-gray-500 mb-1">{stat.label}</p>
                  <p className="text-3xl font-bold text-white leading-none">{stat.score}</p>
                  <p className="text-[13px] font-semibold text-orange-600 mt-0.5">{stat.pct}%</p>
                </div>
              ))}
            </div>

            {/* Dle results */}
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider">
                Tonight's Games
              </p>
              {sessionResults.map((r, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-2">
                  <span className="text-sm text-gray-200">{r.name}</span>
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                    r.result === 'win' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'
                  }`}>
                    {r.result === 'win' ? '✓ Win' : '✗ Fail'}
                  </span>
                </div>
              ))}
            </div>

            {/* Session notes log */}
            {sessionNotes.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-[11px] text-gray-500 uppercase tracking-wider">
                  Notes from Tonight
                </p>
                {sessionNotes.map((note, i) => (
                  <div
                    key={note.id || i}
                    className="flex flex-col gap-1 bg-gray-800 rounded-lg px-3.5 py-2.5 border-l-[3px]"
                    style={{ borderColor: note.colour }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-semibold" style={{ color: note.colour }}>
                        {note.username}
                      </span>
                      <span className="text-[10px] text-gray-600">
                        {note.dleName}
                      </span>
                    </div>
                    <p className="text-[13px] text-gray-300">
                      {note.text}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <p className="text-center text-[11px] text-gray-700">
              Dles Night — powered by chaos
            </p>
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={copyResult}
              className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-semibold"
            >
              {copied ? '✓ Copied!' : '📋 Copy Result'}
            </button>
            <button
              onClick={() => setShowRecap(false)}
              className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-semibold"
            >
              Back to Session
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
