import { supabase } from '@dles-night/shared'

const SESSION_ID = 'nightsession'

// --- Canvas ---

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

canvas.width = window.innerWidth
canvas.height = window.innerHeight

window.addEventListener('resize', () => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  ctx.putImageData(imageData, 0, 0)
})

function drawSegment(from, to, tool, colour, size) {
  if (!from || !to) return
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = colour
  ctx.lineWidth = tool === 'eraser' ? size * 6 : size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
}

function drawStroke(stroke) {
  for (let i = 1; i < stroke.path.length; i++) {
    drawSegment(stroke.path[i - 1], stroke.path[i], stroke.tool, stroke.colour, stroke.size)
  }
}

supabase
  .channel(`canvas-${SESSION_ID}`, { config: { broadcast: { self: false } } })
  .on('broadcast', { event: 'stroke' }, ({ payload }) => drawStroke(payload.stroke))
  .on('broadcast', { event: 'clear-canvas' }, () =>
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  )
  .subscribe()

// --- Sticky Notes ---

const notesContainer = document.getElementById('notes')
const noteEls = {}

function safeColour(c) {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#E8500A'
}

function escapeHtml(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

function addNoteEl(note) {
  if (noteEls[note.id]) return
  const el = document.createElement('div')
  const colour = safeColour(note.colour)
  el.style.cssText = `
    position: absolute;
    left: ${note.x}px; top: ${note.y}px;
    width: 192px;
    background: #111827;
    border: 1px solid ${colour};
    border-radius: 12px;
    padding: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    font-family: system-ui, sans-serif;
  `
  el.innerHTML = `
    <div style="margin-bottom:4px">
      <span style="color:${colour};font-size:11px;font-weight:600">${escapeHtml(note.username)}</span>
    </div>
    <p style="color:#e5e7eb;font-size:13px;margin:0;word-wrap:break-word">${escapeHtml(note.text)}</p>
  `
  noteEls[note.id] = el
  notesContainer.appendChild(el)
}

function clearAllNotes() {
  notesContainer.innerHTML = ''
  Object.keys(noteEls).forEach(id => delete noteEls[id])
}

const notesChannel = supabase
  .channel(`notes-${SESSION_ID}`, { config: { broadcast: { self: true } } })
  .on('broadcast', { event: 'note-add' }, ({ payload }) => addNoteEl(payload.note))
  .on('broadcast', { event: 'note-move' }, ({ payload }) => {
    const el = noteEls[payload.id]
    if (el) { el.style.left = payload.x + 'px'; el.style.top = payload.y + 'px' }
  })
  .on('broadcast', { event: 'note-delete' }, ({ payload }) => {
    const el = noteEls[payload.id]
    if (el) { el.remove(); delete noteEls[payload.id] }
  })
  .on('broadcast', { event: 'notes-clear' }, clearAllNotes)
  .on('broadcast', { event: 'notes-sync' }, ({ payload }) =>
    Object.values(payload.notes).forEach(addNoteEl)
  )
  .subscribe(status => {
    if (status !== 'SUBSCRIBED') return
    setTimeout(() => {
      notesChannel.send({ type: 'broadcast', event: 'notes-request', payload: {} })
    }, 500)
  })
