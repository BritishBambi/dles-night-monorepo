import { supabase } from './supabase'

export class StickyNotes {
  constructor(onUpdate, sessionId = 'nightsession') {
    this.sessionId = sessionId
    this.onUpdate = onUpdate
    this.channel = null
    this.notes = {}
    this._getRect = null
  }

  // Set a reference frame for coordinate normalization/denormalization.
  // getRect() must return { x, y, width, height } in viewport-absolute pixels.
  // If not set, falls back to { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }.
  setReferenceFrame(getRect) {
    this._getRect = getRect
  }

  _ref() {
    if (this._getRect) {
      const rect = this._getRect()
      if (rect) return rect
    }
    return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
  }

  async connect() {
    this.channel = supabase.channel(`notes-${this.sessionId}`, {
      config: { broadcast: { self: true } }
    })

    this.channel.on('broadcast', { event: 'note-add' }, ({ payload }) => {
      const note = payload.note
      const ref = this._ref()
      note.x = note.x * ref.width + ref.x
      note.y = note.y * ref.height + ref.y
      this.notes[note.id] = note
      this.onUpdate({ ...this.notes })
    })

    this.channel.on('broadcast', { event: 'note-move' }, ({ payload }) => {
      if (this.notes[payload.id]) {
        const ref = this._ref()
        this.notes[payload.id].x = payload.x * ref.width + ref.x
        this.notes[payload.id].y = payload.y * ref.height + ref.y
        this.onUpdate({ ...this.notes })
      }
    })

    this.channel.on('broadcast', { event: 'note-delete' }, ({ payload }) => {
      delete this.notes[payload.id]
      this.onUpdate({ ...this.notes })
    })

    this.channel.on('broadcast', { event: 'notes-clear' }, () => {
      this.notes = {}
      this.onUpdate({})
    })

    this.channel.on('broadcast', { event: 'notes-request' }, () => {
      if (Object.keys(this.notes).length === 0) return
      const ref = this._ref()
      const normalizedNotes = {}
      for (const [id, note] of Object.entries(this.notes)) {
        normalizedNotes[id] = {
          ...note,
          x: (note.x - ref.x) / ref.width,
          y: (note.y - ref.y) / ref.height
        }
      }
      this.channel.send({
        type: 'broadcast',
        event: 'notes-sync',
        payload: { notes: normalizedNotes }
      })
    })

    this.channel.on('broadcast', { event: 'notes-sync' }, ({ payload }) => {
      const ref = this._ref()
      const denormalizedNotes = {}
      for (const [id, note] of Object.entries(payload.notes)) {
        denormalizedNotes[id] = {
          ...note,
          x: note.x * ref.width + ref.x,
          y: note.y * ref.height + ref.y
        }
      }
      this.notes = { ...denormalizedNotes, ...this.notes }
      this.onUpdate({ ...this.notes })
    })

    await new Promise(resolve => {
      this.channel.subscribe(status => {
        if (status === 'SUBSCRIBED') resolve()
      })
    })

    // Ask for existing state after a short delay
    setTimeout(() => {
      this.channel.send({
        type: 'broadcast',
        event: 'notes-request',
        payload: {}
      })
    }, 500)
  }

  addNote(username, colour, text) {
    const note = {
      id: crypto.randomUUID(),
      username,
      colour,
      text,
      x: 0.1 + Math.random() * 0.6,
      y: 0.2 + Math.random() * 0.4,
      createdAt: Date.now()
    }
    this.notes[note.id] = note
    this.channel.send({
      type: 'broadcast',
      event: 'note-add',
      payload: { note }
    })
    return note
  }

  moveNote(id, x, y) {
    if (this.notes[id]) {
      const ref = this._ref()
      const normalizedX = (x - ref.x) / ref.width
      const normalizedY = (y - ref.y) / ref.height
      this.notes[id].x = normalizedX * ref.width + ref.x
      this.notes[id].y = normalizedY * ref.height + ref.y
      this.channel.send({
        type: 'broadcast',
        event: 'note-move',
        payload: { id, x: normalizedX, y: normalizedY }
      })
    }
  }

  deleteNote(id) {
    delete this.notes[id]
    this.channel.send({
      type: 'broadcast',
      event: 'note-delete',
      payload: { id }
    })
  }

  clearAll() {
    this.notes = {}
    this.channel.send({
      type: 'broadcast',
      event: 'notes-clear',
      payload: {}
    })
  }

  disconnect() {
    if (this.channel) supabase.removeChannel(this.channel)
  }
}
