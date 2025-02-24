const { app, BrowserWindow } = require('electron')

app.on('ready', () => {
    let win = new BrowserWindow({ width: 800, height: 600 })
    // 加载远程URL
    win.loadURL('https://www.n.cn')
    }
)