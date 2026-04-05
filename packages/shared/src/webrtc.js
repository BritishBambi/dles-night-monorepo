import { supabase } from './supabase'

export class DlesRTC {
  constructor(onStream, sessionId = 'dles-default') {
    this.peerConnections = {}
    this.localStream = null
    this.channel = null
    this.isHost = false
    this.viewerId = crypto.randomUUID()
    this.onStream = onStream
    this.sessionId = sessionId
    this.offerSent = false
    this.connected = false
  }

  // HOST: start capturing screen and broadcasting
  async startBroadcast() {
    // 1. Get screen capture using getDisplayMedia
    // Request video only, no audio needed
    this.localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false
    })
    this.isHost = true

    // 2. Join the signalling channel as host
    this.channel = supabase.channel(`dles-${this.sessionId}`, {
      config: {
        broadcast: { self: false },
      }
    })

    // 3. Listen for viewer-offer messages from viewers wanting to connect
    this.channel.on('broadcast', { event: 'viewer-offer' }, async ({ payload }) => {
      console.log('Host received viewer-offer from:', payload.viewerId)
      await this._handleViewerOffer(payload.viewerId, payload.offer)
    })

    // 4. Listen for ICE candidates from viewers
    this.channel.on('broadcast', { event: 'viewer-ice' }, async ({ payload }) => {
      const pc = this.peerConnections[payload.viewerId]
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
      }
    })

    await new Promise((resolve) => {
      this.channel.subscribe((status) => {
        console.log('Host channel status:', status)
        if (status === 'SUBSCRIBED') {
          resolve()
        }
      })
    })
    let readyCount = 0
    const broadcastReady = () => {
      if (!this.channel) return
      this.channel.send({
        type: 'broadcast',
        event: 'host-ready',
        payload: { ready: true }
      })
      readyCount++
      if (readyCount < 5) setTimeout(broadcastReady, 2000)
    }
    setTimeout(broadcastReady, 500)
    return this.localStream
  }

  // HOST: broadcast using an already-acquired MediaStream
  async startBroadcastWithStream(stream) {
    this.localStream = stream
    this.isHost = true

    this.channel = supabase.channel(`dles-${this.sessionId}`, {
      config: {
        broadcast: { self: false },
      }
    })

    this.channel.on('broadcast', { event: 'viewer-offer' }, async ({ payload }) => {
      console.log('Host received viewer-offer from:', payload.viewerId)
      await this._handleViewerOffer(payload.viewerId, payload.offer)
    })

    this.channel.on('broadcast', { event: 'viewer-ice' }, async ({ payload }) => {
      const pc = this.peerConnections[payload.viewerId]
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
      }
    })

    await new Promise((resolve) => {
      this.channel.subscribe((status) => {
        console.log('Host channel status:', status)
        if (status === 'SUBSCRIBED') {
          resolve()
        }
      })
    })

    let readyCount = 0
    const broadcastReady = () => {
      if (!this.channel) return
      this.channel.send({
        type: 'broadcast',
        event: 'host-ready',
        payload: { ready: true }
      })
      readyCount++
      if (readyCount < 5) setTimeout(broadcastReady, 2000)
    }
    setTimeout(broadcastReady, 500)

    return this.localStream
  }

  // HOST: handle an incoming offer from a viewer
  async _handleViewerOffer(viewerId, offer) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    this.peerConnections[viewerId] = pc

    // Add local stream tracks to this peer connection
    this.localStream.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream)
    })

    // Send ICE candidates to this specific viewer
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.channel.send({
          type: 'broadcast',
          event: 'host-ice',
          payload: { targetViewer: viewerId, candidate }
        })
      }
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    // Send answer back to the viewer
    this.channel.send({
      type: 'broadcast',
      event: 'host-answer',
      payload: { targetViewer: viewerId, answer }
    })
    console.log('Host sent answer to viewer:', viewerId)
  }

  // VIEWER: join session and request stream from host
  async joinAsViewer() {
    this.channel = supabase.channel(`dles-${this.sessionId}`, {
      config: { broadcast: { self: false } }
    })

    const makePc = () => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      })
      pc.ontrack = ({ streams }) => {
        console.log('Viewer got track!')
        if (streams[0]) {
          this.connected = true
          this.onStream(streams[0])
        }
      }
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          this.channel.send({
            type: 'broadcast',
            event: 'viewer-ice',
            payload: { viewerId: this.viewerId, candidate }
          })
        }
      }
      return pc
    }

    this.peerConnections['host'] = makePc()

    const sendOfferWithPc = (pc) => this._sendOffer(pc)

    // Register ALL listeners before subscribing
    this.channel.on('broadcast', { event: 'test-message' }, ({ payload }) => {
      console.log('Viewer received test message:', payload.text)
    })

    this.channel.on('broadcast', { event: 'host-ready' }, async () => {
      if (this.connected) return // already have a stream, ignore
      console.log('Viewer received host-ready, resetting and sending fresh offer')

      // Close old peer connection and make a fresh one
      if (this.peerConnections['host']) {
        this.peerConnections['host'].close()
      }
      const newPc = makePc()
      this.peerConnections['host'] = newPc

      await sendOfferWithPc(newPc)
    })

    this.channel.on('broadcast', { event: 'host-answer' }, async ({ payload }) => {
      console.log('Viewer received host-answer, targeting:', payload.targetViewer, 'my id:', this.viewerId)
      if (payload.targetViewer === this.viewerId) {
        const pc = this.peerConnections['host']
        console.log('Viewer setting remote description')
        await pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
      }
    })

    this.channel.on('broadcast', { event: 'host-ice' }, async ({ payload }) => {
      if (payload.targetViewer === this.viewerId) {
        await this.peerConnections['host'].addIceCandidate(new RTCIceCandidate(payload.candidate))
      }
    })

    // Subscribe AFTER all listeners are registered
    await new Promise((resolve) => {
      this.channel.subscribe((status) => {
        console.log('Viewer channel status:', status)
        if (status === 'SUBSCRIBED') resolve()
      })
    })

    // Send offer after subscribe in case host is already live
    setTimeout(() => sendOfferWithPc(this.peerConnections['host']), 500)
  }

  async _sendOffer(pc) {
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.channel.send({
      type: 'broadcast',
      event: 'viewer-offer',
      payload: { viewerId: this.viewerId, offer }
    })
  }

  async reconnect() {
    this.connected = false
    this.offerSent = false

    if (this.peerConnections['host']) {
      this.peerConnections['host'].close()
      delete this.peerConnections['host']
    }

    const newPc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    this.peerConnections['host'] = newPc

    newPc.ontrack = ({ streams }) => {
      if (streams[0]) {
        this.connected = true
        this.onStream(streams[0])
      }
    }

    newPc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.channel.send({
          type: 'broadcast',
          event: 'viewer-ice',
          payload: { viewerId: this.viewerId, candidate }
        })
      }
    }

    await this._sendOffer(newPc)
  }

  resetForReconnect() {
    this.connected = false
    if (this.peerConnections['host']) {
      this.peerConnections['host'].close()
      delete this.peerConnections['host']
    }
  }

  // Clean up everything
  disconnect() {
    Object.values(this.peerConnections).forEach(pc => pc.close())
    this.peerConnections = {}
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop())
      this.localStream = null
    }
    if (this.channel) {
      supabase.removeChannel(this.channel)
      this.channel = null
    }
  }
}
