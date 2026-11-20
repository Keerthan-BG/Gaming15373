const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

app.commandLine.appendSwitch('force_high_performance_gpu')

const developmentUrl = 'http://127.0.0.1:5173'
let mainWindow
let viteProcess
let rendererEntry

function waitForVite(url) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000
    const poll = () => {
      if (viteProcess?.exitCode !== null && viteProcess?.exitCode !== undefined) {
        reject(new Error(`Vite exited with code ${viteProcess.exitCode}`))
        return
      }
      const request = http.get(url, (response) => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) resolve()
        else retry()
      })
      request.setTimeout(1000, () => request.destroy())
      request.on('error', retry)
      function retry() {
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for the Vite development server.'))
        } else {
          setTimeout(poll, 250)
        }
      }
    }
    poll()
  })
}

async function resolveRendererEntry() {
  if (app.isPackaged) {
    return { type: 'file', path: path.join(app.getAppPath(), 'dist', 'index.html') }
  }

  const customDevUrl = process.env.ECHOES_VITE_DEV_SERVER_URL
  if (customDevUrl) return { type: 'url', url: customDevUrl }

  const viteCli = path.join(app.getAppPath(), 'node_modules', 'vite', 'bin', 'vite.js')
  const nodeExecutable = process.env.npm_node_execpath || 'node'
  viteProcess = spawn(nodeExecutable, [viteCli, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: app.getAppPath(),
    stdio: 'inherit',
    windowsHide: true,
  })
  viteProcess.once('error', (error) => console.error('Unable to start Vite:', error))
  await waitForVite(developmentUrl)
  return { type: 'url', url: developmentUrl }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (rendererEntry.type === 'url') mainWindow.loadURL(rendererEntry.url)
  else mainWindow.loadFile(rendererEntry.path)
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  try {
    rendererEntry = await resolveRendererEntry()
    createWindow()
  } catch (error) {
    dialog.showErrorBox('ECHOES OF THE UNKNOWN', error.message)
    app.quit()
  }
})

app.on('before-quit', () => {
  if (viteProcess && !viteProcess.killed) viteProcess.kill()
})

app.on('window-all-closed', () => app.quit())
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && rendererEntry) createWindow()
})
