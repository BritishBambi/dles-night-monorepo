import { supabase } from './supabase'

export class DlesRTC {
  constructor(onStream, sessionId = 'dles-default', iceServers = null) {
    this.peerConnections = {}
    this.localStream = null
    this.channel = null
    this.isHost = false
    this.viewerId = crypto.randomUUID()
    this.onStream = onStream
    this.sessionId = sessionId
    this.iceServers = iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]
    this.offerSent = false
    this.connected = false
    this.offerInFlight = false
    this.hasStream = false
    this._offerTimeout = null
    this.onConnectionState = null
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
        if (status === 'SUBSCRIBED') {
          resolve()
        }
      })
    })
    this._startReadyBroadcast()
    return this.localStream
  }

  // HOST: broadcast using an already-acquired MediaStream
  async startBroadcastWithStream(stream) {
    this.localStream = stream
    this.isHost = true

    if (this.channel) {
      supabase.removeChannel(this.channel)
      this.channel = null
    }

    this.channel = supabase.channel(`dles-${this.sessionId}`, {
      config: {
        broadcast: { self: false },
      }
    })

    this.channel.on('broadcast', { event: 'viewer-offer' }, async ({ payload }) => {
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
        if (status === 'SUBSCRIBED') {
          resolve()
        }
      })
    })
    this._startReadyBroadcast()
    return this.localStream
  }

  _startReadyBroadcast() {
    let readyCount = 0
    const broadcast = () => {
      if (!this.channel) return
      this.channel.send({
        type: 'broadcast',
        event: 'host-ready',
        payload: { ready: true }
      })
      readyCount++
      if (readyCount < 5) setTimeout(broadcast, 2000)
    }
    setTimeout(broadcast, 500)
  }

  // HOST: handle an incoming offer from a viewer
  async _handleViewerOffer(viewerId, offer) {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers
    })
    this.peerConnections[viewerId] = pc

    // Add local stream tracks to this peer connection
    this.localStream.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream)
    })

    pc.oniceconnectionstatechange = () => {
    }

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
  }

  _makePc() {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers
    })
    pc.pendingCandidates = []
    pc.remoteDescriptionSet = false
    pc.ontrack = ({ streams }) => {
      if (streams[0] && !this.connected) {
        this.connected = true
        this.hasStream = true
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
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      if (this.onConnectionState) {
        this.onConnectionState(state)
      }
      if (state === 'failed' && !this.isHost) {
        console.warn('[DlesRTC] ICE connection failed, attempting reconnect...')
        this.reconnect()
      }
    }
    return pc
  }

  // VIEWER: join session and request stream from host
  async joinAsViewer() {
    this.channel = supabase.channel(`dles-${this.sessionId}`, {
      config: { broadcast: { self: false } }
    })

    this.peerConnections['host'] = this._makePc()

    const sendOfferWithPc = (pc) => this._sendOffer(pc)

    // Register ALL listeners before subscribing
    this.channel.on('broadcast', { event: 'test-message' }, ({ payload: _payload }) => {
    })

    this.channel.on('broadcast', { event: 'host-ready' }, async () => {
      if (this.offerInFlight) return
      if (this.connected && this.hasStream) return // stream is live and healthy, leave it alone
      if (this.connected && !this.hasStream) {
        // Connected to signalling but no stream yet — reset and renegotiate
        this.connected = false
        if (this.peerConnections['host']) {
          this.peerConnections['host'].close()
          delete this.peerConnections['host']
        }
      }

      // Close old peer connection and make a fresh one
      if (this.peerConnections['host']) {
        this.peerConnections['host'].close()
      }
      const newPc = this._makePc()
      this.peerConnections['host'] = newPc

      await sendOfferWithPc(newPc)
    })

    this.channel.on('broadcast', { event: 'host-answer' }, async ({ payload }) => {
      if (payload.targetViewer === this.viewerId) {
        const pc = this.peerConnections['host']
        if (pc.remoteDescriptionSet) return
        await pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
        pc.remoteDescriptionSet = true
        clearTimeout(this._offerTimeout)
        this.offerInFlight = false
        for (const candidate of pc.pendingCandidates) {
          await pc.addIceCandidate(candidate)
        }
        pc.pendingCandidates = []
      }
    })

    this.channel.on('broadcast', { event: 'host-ice' }, async ({ payload }) => {
      if (payload.targetViewer === this.viewerId) {
        const pc = this.peerConnections['host']
        const candidate = new RTCIceCandidate(payload.candidate)
        if (!pc.remoteDescription) {
          pc.pendingCandidates.push(candidate)
        } else {
          await pc.addIceCandidate(candidate)
        }
      }
    })

    // Subscribe AFTER all listeners are registered
    await new Promise((resolve) => {
      this.channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve()
      })
    })

    // Send offer after subscribe in case host is already live
    setTimeout(() => {
      if (!this.offerInFlight) sendOfferWithPc(this.peerConnections['host'])
    }, 500)
  }

  async _sendOffer(pc) {
    this.offerInFlight = true
    this._offerTimeout = setTimeout(() => {
      if (this.offerInFlight) {
        console.error('[DlesRTC] Offer timed out — resetting offerInFlight')
        this.offerInFlight = false
      }
    }, 10000)
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
    this.hasStream = false
    this.offerSent = false

    if (this.peerConnections['host']) {
      this.peerConnections['host'].close()
      delete this.peerConnections['host']
    }

    const newPc = this._makePc()
    this.peerConnections['host'] = newPc

    await this._sendOffer(newPc)
  }

  resetForReconnect() {
    this.connected = false
    if (this.peerConnections['host']) {
      this.peerConnections['host'].close()
      delete this.peerConnections['host']
    }
  }

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
