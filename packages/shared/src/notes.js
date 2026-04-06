import { supabase } from './supabase'

export class StickyNotes {
  constructor(onUpdate, sessionId = 'nightsession') {
    this.sessionId = sessionId
    this.onUpdate = onUpdate
    this.channel = null
    this.notes = {}
  }

  async connect() {
    this.channel = supabase.channel(`notes-${this.sessionId}`, {
      config: { broadcast: { self: true } }
    })

    this.channel.on('broadcast', { event: 'note-add' }, ({ payload }) => {
      const note = payload.note
      // Denormalize coordinates when storing
      note.x = note.x * window.innerWidth
      note.y = note.y * window.innerHeight
      this.notes[note.id] = note
      this.onUpdate({ ...this.notes })
    })

    this.channel.on('broadcast', { event: 'note-move' }, ({ payload }) => {
      if (this.notes[payload.id]) {
        // Denormalize coordinates when storing
        this.notes[payload.id].x = payload.x * window.innerWidth
        this.notes[payload.id].y = payload.y * window.innerHeight
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
      // Normalize coordinates before sending in sync
      const normalizedNotes = {}
      for (const [id, note] of Object.entries(this.notes)) {
        normalizedNotes[id] = {
          ...note,
          x: note.x / window.innerWidth,
          y: note.y / window.innerHeight
        }
      }
      this.channel.send({
        type: 'broadcast',
        event: 'notes-sync',
        payload: { notes: normalizedNotes }
      })
    })

    this.channel.on('broadcast', { event: 'notes-sync' }, ({ payload }) => {
      // Merge incoming notes with any we already have, denormalizing coordinates
      const denormalizedNotes = {}
      for (const [id, note] of Object.entries(payload.notes)) {
        denormalizedNotes[id] = {
          ...note,
          x: note.x * window.innerWidth,
          y: note.y * window.innerHeight
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
      // Normalize coordinates before storing and broadcasting
      const normalizedX = x / window.innerWidth
      const normalizedY = y / window.innerHeight
      this.notes[id].x = normalizedX
      this.notes[id].y = normalizedY
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
