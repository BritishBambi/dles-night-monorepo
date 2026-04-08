import { supabase } from './supabase'

export class SessionSync {
  constructor(onEvent, onPresenceUpdate, sessionId = 'nightsession') {
    this.sessionId = sessionId
    this.onEvent = onEvent
    this.onPresenceUpdate = onPresenceUpdate
    this.channel = null
    this.activeDles = []
  }

  setActiveDles(arr) {
    this.activeDles = arr
  }

  async connect(username, colour) {
    this.channel = supabase.channel(`session-${this.sessionId}`, {
      config: {
        broadcast: { self: true },
        presence: { key: username }
      }
    })

    // Track who's in the room
    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel.presenceState()
      const users = Object.values(state).flat().map(u => ({
        username: u.username,
        colour: u.colour
      }))
      if (this.onPresenceUpdate) this.onPresenceUpdate(users)
    })

    this.channel.on('broadcast', { event: 'result' }, ({ payload }) => {
      this.onEvent({ type: 'result', ...payload })
    })

    this.channel.on('broadcast', { event: 'advance' }, ({ payload }) => {
      this.onEvent({ type: 'advance', ...payload })
    })

    this.channel.on('broadcast', { event: 'end-session' }, ({ payload }) => {
      this.onEvent({ type: 'end-session', ...payload })
    })

    this.channel.on('broadcast', { event: 'session-request' }, () => {
      // Someone joined late — respond with current state
      // This gets handled in App.jsx via onEvent
      this.onEvent({ type: 'state-request' })
    })

    this.channel.on('broadcast', { event: 'session-sync' }, ({ payload }) => {
      this.onEvent({ type: 'state-sync', ...payload })
    })

    this.channel.on('broadcast', { event: 'dle-list-sync' }, ({ payload }) => {
      this.onEvent({ type: 'dle-list-sync', ...payload })
    })

    await new Promise(resolve => {
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Announce presence
          await this.channel.track({ username, colour })
          resolve()
        }
      })
    })

    // Request current state in case session is already running
    setTimeout(() => {
      this.channel.send({
        type: 'broadcast',
        event: 'session-request',
        payload: {}
      })
    }, 500)
  }

  broadcastResult(entry, currentIndex, sessionResults, winRate) {
    this.channel.send({
      type: 'broadcast',
      event: 'result',
      payload: { entry, currentIndex, sessionResults, winRate }
    })
  }

  broadcastAdvance(currentIndex) {
    this.channel.send({
      type: 'broadcast',
      event: 'advance',
      payload: { currentIndex }
    })
  }

  broadcastEndSession(sessionResults, winRate) {
    this.channel.send({
      type: 'broadcast',
      event: 'end-session',
      payload: { sessionResults, winRate }
    })
  }

  broadcastDleList() {
    this.channel.send({
      type: 'broadcast',
      event: 'dle-list-sync',
      payload: { dleList: this.activeDles }
    })
  }

  broadcastState(sessionResults, currentIndex, sessionComplete) {
    this.channel.send({
      type: 'broadcast',
      event: 'session-sync',
      payload: { sessionResults, currentIndex, sessionComplete, dleList: this.activeDles }
    })
  }

  disconnect() {
    if (this.channel) {
      supabase.removeChannel(this.channel)
      this.channel = null
    }
  }
}
