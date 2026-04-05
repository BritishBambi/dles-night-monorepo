import { supabase } from './supabase'

export class SessionChat {
  constructor(onMessage, sessionId = 'nightsession') {
    this.sessionId = sessionId
    this.onMessage = onMessage
    this.channel = null
  }

  async connect() {
    this.channel = supabase.channel(`chat-${this.sessionId}`, {
      config: { broadcast: { self: true } }
    })

    this.channel.on('broadcast', { event: 'message' }, ({ payload }) => {
      this.onMessage(payload)
    })

    await new Promise(resolve => {
      this.channel.subscribe(status => {
        if (status === 'SUBSCRIBED') resolve()
      })
    })
  }

  send(username, text, colour = '#E8500A') {
    if (!text.trim()) return
    this.channel.send({
      type: 'broadcast',
      event: 'message',
      payload: {
        username,
        text: text.trim(),
        colour,
        timestamp: Date.now()
      }
    })
  }

  disconnect() {
    if (this.channel) supabase.removeChannel(this.channel)
  }
}
