import { app, shell, BrowserWindow, ipcMain, session, WebContentsView } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let mainWindow = null
let dleView = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Dles Night',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

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

    return { success: true }
  })

  // Update the bounds of the WebContentsView
  ipcMain.handle('dle-view:set-bounds', async (event, bounds) => {
    if (dleView) {
      dleView.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      })
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

  // Hide the WebContentsView
  ipcMain.handle('dle-view:hide', async () => {
    if (dleView && mainWindow) {
      mainWindow.contentView.removeChildView(dleView)
    }
    return { success: true }
  })

  // Show the WebContentsView again
  ipcMain.handle('dle-view:show', async () => {
    if (dleView && mainWindow) {
      mainWindow.contentView.addChildView(dleView)
    }
    return { success: true }
  })

  // Destroy the WebContentsView
  ipcMain.handle('dle-view:destroy', async () => {
    if (dleView) {
      if (mainWindow) {
        mainWindow.contentView.removeChildView(dleView)
      }
      dleView.webContents.close()
      dleView = null
    }
    return { success: true }
  })

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
