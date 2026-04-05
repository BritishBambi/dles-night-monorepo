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
      this.notes[payload.note.id] = payload.note
      this.onUpdate({ ...this.notes })
    })

    this.channel.on('broadcast', { event: 'note-move' }, ({ payload }) => {
      if (this.notes[payload.id]) {
        this.notes[payload.id].x = payload.x
        this.notes[payload.id].y = payload.y
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
      this.channel.send({
        type: 'broadcast',
        event: 'notes-sync',
        payload: { notes: this.notes }
      })
    })

    this.channel.on('broadcast', { event: 'notes-sync' }, ({ payload }) => {
      // Merge incoming notes with any we already have
      this.notes = { ...payload.notes, ...this.notes }
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
      x: Math.random() * (window.innerWidth * 0.5) + window.innerWidth * 0.1,
      y: Math.random() * (window.innerHeight * 0.4) + window.innerHeight * 0.2,
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
      this.notes[id].x = x
      this.notes[id].y = y
      this.channel.send({
        type: 'broadcast',
        event: 'note-move',
        payload: { id, x, y }
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
