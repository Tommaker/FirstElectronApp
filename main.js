const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: true  // 确保开发者工具可用
    }
  })

  win.loadFile('index.html').then(() => {
    console.log('index.html loaded successfully');
  }).catch((err) => {
    console.error('Failed to load index.html:', err);
  });

  // 修改开发者工具的配置
  win.webContents.openDevTools({
    mode: 'right',  // 在右侧打开开发者工具
    activate: false // 不自动激活开发者工具面板
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Open',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [
                { name: 'Log Files', extensions: ['txt', 'log'] }
              ]
            })
            if (!result.canceled) {
              win.webContents.send('file-opened', result.filePaths[0])
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ])

  Menu.setApplicationMenu(menu)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})