const { app, shell, BrowserWindow, dialog, ipcMain, session, WebContentsView } = require('electron')
const { join } = require('path')
const { autoUpdater } = require('electron-updater')
const icon = join(__dirname, '../../resources/icon.png')

let mainWindow = null
let dleView = null
let overlayWindow = null
// Last known game panel rect (viewport coords) — used to reposition overlay on parent move/resize
let lastPanelRect = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Dles Night',
    show: false,
    frame: false,
    transparent: true,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function syncOverlayBounds() {
  if (!overlayWindow || !mainWindow || !lastPanelRect || overlayWindow.isDestroyed()) return
  const parentBounds = mainWindow.getBounds()
  overlayWindow.setBounds({
    x: Math.round(parentBounds.x + lastPanelRect.x),
    y: Math.round(parentBounds.y + lastPanelRect.y),
    width: Math.round(lastPanelRect.width),
    height: Math.round(lastPanelRect.height),
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.jojo.dlesnightapp')

  // Strip headers that block iframe/webview embedding
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    delete headers['x-frame-options']
    delete headers['X-Frame-Options']
    delete headers['content-security-policy']
    delete headers['Content-Security-Policy']
    delete headers['content-security-policy-report-only']
    delete headers['Content-Security-Policy-Report-Only']
    callback({ responseHeaders: headers })
  })

  // Block common ad/tracking domains in the dle WebContentsView
  const adBlockPatterns = [
    '*://*.doubleclick.net/*',
    '*://*.googlesyndication.com/*',
    '*://*.googleadservices.com/*',
    '*://*.google-analytics.com/*',
    '*://*.adnxs.com/*',
    '*://*.adsrvr.org/*',
    '*://*.adcolony.com/*',
    '*://*.a3cloud.net/*',
    '*://*.amazon-adsystem.com/*',
    '*://*.casalemedia.com/*',
    '*://*.criteo.com/*',
    '*://*.criteo.net/*',
    '*://*.demdex.net/*',
    '*://*.moatads.com/*',
    '*://*.outbrain.com/*',
    '*://*.pubmatic.com/*',
    '*://*.rubiconproject.com/*',
    '*://*.scorecardresearch.com/*',
    '*://*.taboola.com/*',
    '*://*.turn.com/*',
    '*://*.yieldmanager.com/*',
    '*://*.ads.yahoo.com/*',
    '*://*.ad.youtube.com/*',
    '*://*.pagead2.googlesyndication.com/*',
    '*://*.tpc.googlesyndication.com/*',
    '*://*.googletagmanager.com/*',
    '*://*.facebook.net/*',
    '*://*.facebook.com/tr*',
    '*://*.hotjar.com/*',
    '*://*.smartadserver.com/*',
    '*://*.openx.net/*',
    '*://*.lijit.com/*',
    '*://*.indexww.com/*',
    '*://*.sharethrough.com/*',
    '*://*.snigelweb.com/*',
    '*://*.snigel.com/*',
    '*://*.adnuntius.com/*',
    '*://*.prebid.org/*',
    '*://cdn.privacy-mgmt.com/*',
    '*://*.confiant-integrations.net/*',
  ]

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: adBlockPatterns },
    (details, callback) => {
      callback({ cancel: true })
    }
  )

  // === DISPLAY MEDIA HANDLER ===
  // When renderer calls getDisplayMedia(), intercept it and provide
  // the dleView's webContents as the source — no picker dialog needed.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (dleView && dleView.webContents) {
      callback({ video: dleView.webContents.mainFrame, audio: dleView.webContents.mainFrame, enableLocalEcho: true })
    } else {
      callback({})
    }
  })

  // === IPC HANDLERS ===

  // Create the WebContentsView for the dle panel
  ipcMain.handle('dle-view:create', async () => {
    if (dleView) {
      return { success: true }
    }

    dleView = new WebContentsView({
      webPreferences: {
        sandbox: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
      }
    })

    mainWindow.contentView.addChildView(dleView)

    dleView.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Create transparent child BrowserWindow for canvas/notes overlay.
    // setIgnoreMouseEvents passes all input through to mainWindow below it in z-order.
    overlayWindow = new BrowserWindow({
      parent: mainWindow,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      }
    })

    overlayWindow.setIgnoreMouseEvents(true, { forward: true })

    const overlayUrl = !app.isPackaged && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL'] + '/overlay/index.html'
      : 'file://' + join(__dirname, '../renderer/overlay/index.html')

    try {
      await overlayWindow.loadURL(overlayUrl)
    } catch (err) {
      console.warn('overlay load warning:', err.message)
    }

    // Reposition overlay whenever mainWindow is moved or resized
    mainWindow.on('move', syncOverlayBounds)
    mainWindow.on('resize', syncOverlayBounds)

    return { success: true }
  })

  // Update dleView bounds (viewport coords) and reposition overlayWindow (screen coords)
  ipcMain.handle('dle-view:set-bounds', async (event, bounds) => {
    lastPanelRect = bounds

    if (dleView) {
      dleView.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      })
    }

    if (overlayWindow && !overlayWindow.isDestroyed() && mainWindow) {
      const parentBounds = mainWindow.getBounds()
      overlayWindow.setBounds({
        x: Math.round(parentBounds.x + bounds.x),
        y: Math.round(parentBounds.y + bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      })
      if (!overlayWindow.isVisible()) overlayWindow.show()
    }

    return { success: true }
  })

  // Navigate the WebContentsView to a dle URL
  ipcMain.handle('dle-view:navigate', async (event, url) => {
    if (dleView) {
      try {
        await dleView.webContents.loadURL(url)
      } catch (err) {
        // Some dle sites have flaky SSL or redirect in ways that
        // cause loadURL's promise to reject even though the page loads fine.
        console.warn(`dle-view:navigate warning for ${url}:`, err.message)
      }
      return { success: true }
    }
    return { success: false, error: 'No dle view' }
  })

  // Hide the WebContentsView and overlay
  ipcMain.handle('dle-view:hide', async () => {
    if (dleView && mainWindow) mainWindow.contentView.removeChildView(dleView)
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
    return { success: true }
  })

  // Show the WebContentsView and overlay
  ipcMain.handle('dle-view:show', async () => {
    if (dleView && mainWindow) mainWindow.contentView.addChildView(dleView)
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.show()
    return { success: true }
  })

  // Destroy the WebContentsView and overlay
  ipcMain.handle('dle-view:destroy', async () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      mainWindow.off('move', syncOverlayBounds)
      mainWindow.off('resize', syncOverlayBounds)
      overlayWindow.destroy()
      overlayWindow = null
    }
    if (dleView) {
      if (mainWindow) mainWindow.contentView.removeChildView(dleView)
      dleView.webContents.close()
      dleView = null
    }
    lastPanelRect = null
    return { success: true }
  })

  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow.close())

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  // Auto-update
  autoUpdater.checkForUpdatesAndNotify()

  autoUpdater.on('update-available', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update available',
      message: 'A new version of Dles Night is available and is being downloaded.',
    })
  })

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update ready',
      message: 'An update has been downloaded. Restart now to install it?',
      buttons: ['Yes', 'No'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
