const { ipcRenderer } = require('electron');

// 获取元素引用
const fontFamily = document.getElementById('fontFamily');
const fontSize = document.getElementById('fontSize');
const btnApply = document.getElementById('btnApply');
const btnCancel = document.getElementById('btnCancel');
const previewText = document.getElementById('previewText');

// 默认设置
const defaultSettings = {
    fontFamily: 'Arial',
    fontSize: 12
};

// 加载已保存的设置
try {
    const savedSettings = localStorage.getItem('fontSettings');
    const settings = savedSettings ? JSON.parse(savedSettings) : defaultSettings;
    
    // 设置表单值
    fontFamily.value = settings.fontFamily || defaultSettings.fontFamily;
    fontSize.value = settings.fontSize || defaultSettings.fontSize;
    
    // 应用到预览
    updatePreview(settings);
} catch (error) {
    console.error('Failed to load saved settings:', error);
    fontFamily.value = defaultSettings.fontFamily;
    fontSize.value = defaultSettings.fontSize;
    updatePreview(defaultSettings);
}

// 添加实时预览
function updatePreview(settings) {
    previewText.style.fontFamily = settings.fontFamily;
    previewText.style.fontSize = `${settings.fontSize}px`;
}

// 监听设置变化
fontFamily.addEventListener('change', () => {
    updatePreview({
        fontFamily: fontFamily.value,
        fontSize: parseInt(fontSize.value)
    });
});

fontSize.addEventListener('input', () => {
    updatePreview({
        fontFamily: fontFamily.value,
        fontSize: parseInt(fontSize.value)
    });
});

// 应用按钮点击事件
btnApply.addEventListener('click', () => {
    const settings = {
        fontFamily: fontFamily.value,
        fontSize: Math.max(8, Math.min(24, parseInt(fontSize.value) || 12))
    };
    
    // 保存设置到本地存储
    localStorage.setItem('fontSettings', JSON.stringify(settings));
    
    // 发送设置到主进程
    ipcRenderer.send('update-font-settings', settings);
    
    // 关闭窗口
    window.close();
});

// 取消按钮点击事件
btnCancel.addEventListener('click', () => {
    window.close();
});
