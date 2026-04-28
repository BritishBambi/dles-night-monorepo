import { supabase } from '@dles-night/shared'

const SESSION_ID = 'nightsession'

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
    // Denormalize coordinates and lineWidth for local rendering
    const from = {
      x: stroke.path[i - 1].x * canvas.width,
      y: stroke.path[i - 1].y * canvas.height
    }
    const to = {
      x: stroke.path[i].x * canvas.width,
      y: stroke.path[i].y * canvas.height
    }
    const denormalizedSize = stroke.size * canvas.width

    drawSegment(from, to, stroke.tool, stroke.colour, denormalizedSize)
  }
}

supabase
  .channel(`canvas-${SESSION_ID}`, { config: { broadcast: { self: false } } })
  .on('broadcast', { event: 'stroke' }, ({ payload }) => drawStroke(payload.stroke))
  .on('broadcast', { event: 'clear-canvas' }, () =>
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  )
  .subscribe()

const notesContainer = document.getElementById('notes')
const noteEls = {}

function safeColour(c) {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#E8500A'
}

function addNoteEl(note) {
  if (noteEls[note.id]) return
  const el = document.createElement('div')
  const colour = safeColour(note.colour)
  const x = note.x * window.innerWidth
  const y = note.y * window.innerHeight
  el.style.cssText = `
    position: absolute;
    left: ${x}px; top: ${y}px;
    width: 192px;
    background: #111827;
    border: 1px solid ${colour};
    border-radius: 12px;
    padding: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    font-family: system-ui, sans-serif;
  `

  const header = document.createElement('div')
  header.style.marginBottom = '4px'
  const usernameSpan = document.createElement('span')
  usernameSpan.style.cssText = `color:${colour};font-size:11px;font-weight:600`
  usernameSpan.textContent = note.username
  header.appendChild(usernameSpan)

  const textP = document.createElement('p')
  textP.style.cssText = 'color:#e5e7eb;font-size:13px;margin:0;word-wrap:break-word'
  textP.textContent = note.text

  el.appendChild(header)
  el.appendChild(textP)
  noteEls[note.id] = el
  notesContainer.appendChild(el)
}

function clearAllNotes() {
  notesContainer.replaceChildren()
  Object.keys(noteEls).forEach(id => delete noteEls[id])
}

const notesChannel = supabase
  .channel(`notes-${SESSION_ID}`, { config: { broadcast: { self: true } } })
  .on('broadcast', { event: 'note-add' }, ({ payload }) => addNoteEl(payload.note))
  .on('broadcast', { event: 'note-move' }, ({ payload }) => {
    const el = noteEls[payload.id]
    if (el) {
      // Denormalize coordinates for display
      const x = payload.x * window.innerWidth
      const y = payload.y * window.innerHeight
      el.style.left = x + 'px'
      el.style.top = y + 'px'
    }
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
