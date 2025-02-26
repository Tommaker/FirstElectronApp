const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron')
const path = require('path')

let preferencesWindow = null;

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

  // 创建应用菜单
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open',
          accelerator: process.platform === 'darwin' ? 'Cmd+O' : 'Ctrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [
                { name: 'Log Files', extensions: ['txt', 'log'] }
              ]
            });
            if (!result.canceled) {
              win.webContents.send('file-opened', result.filePaths[0]);
            }
          }
        },
        {
          label: 'Preferences',
          accelerator: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,',
          click: () => {
            if (preferencesWindow === null) {
              preferencesWindow = new BrowserWindow({
                width: 400,
                height: 300,
                modal: true,
                parent: win,
                resizable: false,
                minimizable: false,
                maximizable: false,
                title: 'Preferences',
                webPreferences: {
                  nodeIntegration: true,
                  contextIsolation: false
                }
              });

              preferencesWindow.loadFile('preferences.html');
              
              // 阻止默认标题的设置
              preferencesWindow.on('page-title-updated', (e) => {
                e.preventDefault();
              });

              preferencesWindow.on('closed', () => {
                preferencesWindow = null;
              });
            } else {
              preferencesWindow.focus();
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ];

  // 创建菜单
  const menu = Menu.buildFromTemplate(template);
  
  // 设置为应用菜单
  Menu.setApplicationMenu(menu);
}

// 添加 IPC 处理器来处理设置更新
ipcMain.on('update-font-settings', (event, settings) => {
  // 广播新的字体设置到主窗口
  BrowserWindow.getAllWindows().forEach(window => {
    if (window !== preferencesWindow) {
      window.webContents.send('font-settings-changed', settings);
    }
  });
});

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