import { supabase } from './supabase'

export class SharedCanvas {
  constructor(canvasEl, userId, sessionId = 'nightsession') {
    this.canvas = canvasEl
    this.ctx = canvasEl.getContext('2d')
    this.userId = userId
    this.sessionId = sessionId
    this.channel = null
    this.isDrawing = false
    this.currentPath = []
    this.tool = 'pen' // 'pen' | 'eraser'
    this.colour = '#E8500A'
    this.size = 4
    this.allStrokes = []
  }

  async connect() {
    this.channel = supabase.channel(`canvas-${this.sessionId}`, {
      config: { broadcast: { self: false } }
    })

    // Receive strokes from other users
    this.channel.on('broadcast', { event: 'stroke' }, ({ payload }) => {
      this.drawStroke(payload.stroke)
      this.allStrokes.push(payload.stroke)
    })

    // Receive canvas clear
    this.channel.on('broadcast', { event: 'clear-canvas' }, () => {
      this.clearLocal()
    })

    await new Promise(resolve => {
      this.channel.subscribe(status => {
        if (status === 'SUBSCRIBED') resolve()
      })
    })
  }

  // Attach mouse/touch event listeners to the canvas
  attachListeners() {
    this.canvas.addEventListener('mousedown', this._onDown.bind(this))
    this.canvas.addEventListener('mousemove', this._onMove.bind(this))
    this.canvas.addEventListener('mouseup', this._onUp.bind(this))
    this.canvas.addEventListener('mouseleave', this._onUp.bind(this))
  }

  _onDown(e) {
    this.isDrawing = true
    this.currentPath = [this._getPos(e)]
  }

  _onMove(e) {
    if (!this.isDrawing) return
    const pos = this._getPos(e)
    this.currentPath.push(pos)
    // Draw locally as user draws
    this._drawSegment(
      this.currentPath[this.currentPath.length - 2],
      pos,
      this.tool,
      this.colour,
      this.size
    )
  }

  _onUp() {
    if (!this.isDrawing || this.currentPath.length === 0) return
    this.isDrawing = false

    const stroke = {
      path: this.currentPath,
      tool: this.tool,
      colour: this.colour,
      size: this.size,
      userId: this.userId
    }

    this.allStrokes.push(stroke)

    // Broadcast completed stroke to others
    this.channel.send({
      type: 'broadcast',
      event: 'stroke',
      payload: { stroke }
    })

    this.currentPath = []
  }

  _getPos(e) {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }

  _drawSegment(from, to, tool, colour, size) {
    if (!from || !to) return
    const ctx = this.ctx
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

  drawStroke(stroke) {
    for (let i = 1; i < stroke.path.length; i++) {
      this._drawSegment(stroke.path[i - 1], stroke.path[i], stroke.tool, stroke.colour, stroke.size)
    }
  }

  clearLocal() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.allStrokes = []
  }

  broadcastClear() {
    this.clearLocal()
    this.channel.send({
      type: 'broadcast',
      event: 'clear-canvas',
      payload: {}
    })
  }

  setTool(tool) { this.tool = tool }
  setColour(colour) { this.colour = colour }
  setSize(size) { this.size = size }

  disconnect() {
    if (this.channel) supabase.removeChannel(this.channel)
  }
}
