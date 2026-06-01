"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
let mainWindow = null;
const SETTINGS_PATH = path.join(electron_1.app.getPath('userData'), 'settings.json');
const RECENT_PATH = path.join(electron_1.app.getPath('userData'), 'recent.json');
// ---- Settings helpers ----
async function loadSettings() {
    try {
        const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return {};
    }
}
async function saveSettings(settings) {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}
// ---- Recent files ----
async function getRecentFiles() {
    try {
        const data = await fs.readFile(RECENT_PATH, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return [];
    }
}
async function addRecentFile(filePath) {
    const recent = await getRecentFiles();
    const filtered = recent.filter(f => f !== filePath);
    filtered.unshift(filePath);
    await fs.writeFile(RECENT_PATH, JSON.stringify(filtered.slice(0, 20), null, 2), 'utf-8');
}
// ---- DPI & GPU ----
electron_1.app.commandLine.appendSwitch('high-dpi-support', '1');
electron_1.app.commandLine.appendSwitch('ignore-gpu-blocklist');
// ---- Window creation ----
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'SimpleDraw',
        icon: path.join(__dirname, '../../assets/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false,
        },
    });
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    // Build application menu
    const template = [
        {
            label: '文件',
            submenu: [
                {
                    label: '新建',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => mainWindow?.webContents.send('menu-new'),
                },
                {
                    label: '打开',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
                            filters: [{ name: 'SimpleDraw 文件', extensions: ['simpledraw'] }],
                            properties: ['openFile'],
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow?.webContents.send('menu-open', result.filePaths[0]);
                            await addRecentFile(result.filePaths[0]);
                        }
                    },
                },
                {
                    label: '保存',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => mainWindow?.webContents.send('menu-save'),
                },
                {
                    label: '另存为...',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => mainWindow?.webContents.send('menu-save-as'),
                },
                { type: 'separator' },
                {
                    label: '导出为 PNG...',
                    accelerator: 'CmdOrCtrl+E',
                    click: () => mainWindow?.webContents.send('menu-export'),
                },
                { type: 'separator' },
                {
                    label: '设置',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => mainWindow?.webContents.send('menu-settings'),
                },
                { type: 'separator' },
                ...(process.platform === 'darwin' ? [{ role: 'close' }] : [{
                        label: '退出',
                        accelerator: 'CmdOrCtrl+Q',
                        click: () => mainWindow?.close(),
                    }]),
            ],
        },
        {
            label: '编辑',
            submenu: [
                { role: 'undo', label: '撤销' },
                { role: 'redo', label: '重做' },
                { type: 'separator' },
                { role: 'cut', label: '剪切' },
                { role: 'copy', label: '复制' },
                { role: 'paste', label: '粘贴' },
                { role: 'delete', label: '删除' },
            ],
        },
        {
            label: '视图',
            submenu: [
                { role: 'reload', label: '刷新' },
                { role: 'toggleDevTools', label: '开发者工具' },
                { type: 'separator' },
                { role: 'zoomIn', label: '放大' },
                { role: 'zoomOut', label: '缩小' },
                { role: 'resetZoom', label: '重置缩放' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '全屏' },
            ],
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '关于 SimpleDraw',
                    click: () => {
                        const ver = electron_1.app.getVersion();
                        electron_1.dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '关于 SimpleDraw',
                            message: 'SimpleDraw v' + ver,
                            detail: '轻量级流程图绘制工具\n\n基于 Electron 构建',
                        });
                    },
                },
            ],
        },
    ];
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
    // ---- Window close handling ----
    // 渲染进程处理完确认后，通知主进程直接关闭
    electron_1.ipcMain.on('app:close-directly', () => {
        if (mainWindow) {
            mainWindow.destroy();
        }
    });
    // 阻止默认关闭，让渲染进程处理确认
    mainWindow.on('close', (e) => {
        e.preventDefault();
        mainWindow?.webContents.send('app:request-close');
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// ---- IPC Handlers ----
function setupIpcHandlers() {
    // File operations
    electron_1.ipcMain.handle('file:read', async (_event, filePath) => {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return { success: true, data };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('file:write', async (_event, filePath, content) => {
        try {
            const dir = path.dirname(filePath);
            if (!(0, fs_1.existsSync)(dir)) {
                (0, fs_1.mkdirSync)(dir, { recursive: true });
            }
            await fs.writeFile(filePath, content, 'utf-8');
            await addRecentFile(filePath);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('file:exists', async (_event, filePath) => {
        try {
            await fs.access(filePath);
            return true;
        }
        catch {
            return false;
        }
    });
    electron_1.ipcMain.handle('file:show-save-dialog', async (_event, defaultPath) => {
        const result = await electron_1.dialog.showSaveDialog(mainWindow, {
            title: '保存 SimpleDraw 文件',
            defaultPath,
            filters: [{ name: 'SimpleDraw 文件', extensions: ['simpledraw'] }],
        });
        if (result.canceled)
            return null;
        return result.filePath;
    });
    electron_1.ipcMain.handle('file:pick-image', async () => {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: '选择图片',
            filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'] }],
            properties: ['openFile'],
        });
        if (result.canceled)
            return null;
        return result.filePaths[0];
    });
    electron_1.ipcMain.handle('file:show-export-dialog', async (_event, defaultPath) => {
        const result = await electron_1.dialog.showSaveDialog(mainWindow, {
            title: '导出为 PNG',
            defaultPath,
            filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        });
        if (result.canceled)
            return null;
        return result.filePath;
    });
    electron_1.ipcMain.handle('file:write-binary', async (_event, filePath, base64Data) => {
        try {
            const dir = path.dirname(filePath);
            if (!(0, fs_1.existsSync)(dir)) {
                (0, fs_1.mkdirSync)(dir, { recursive: true });
            }
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.writeFile(filePath, buffer);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('file:get-recent', async () => {
        return await getRecentFiles();
    });
    electron_1.ipcMain.handle('file:get-user-data-path', () => {
        return electron_1.app.getPath('userData');
    });
    // Settings operations
    electron_1.ipcMain.handle('settings:load', async () => {
        return await loadSettings();
    });
    electron_1.ipcMain.handle('settings:save', async (_event, settings) => {
        await saveSettings(settings);
        return { success: true };
    });
    // ---- 新建窗口（独立窗口，不覆盖 mainWindow） ----
    electron_1.ipcMain.handle('app:open-new-window', () => {
        const win = new electron_1.BrowserWindow({
            width: 1280,
            height: 800,
            minWidth: 800,
            minHeight: 600,
            title: 'SimpleDraw',
            icon: path.join(__dirname, '../../assets/icon.png'),
            webPreferences: {
                preload: path.join(__dirname, '../preload/preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                backgroundThrottling: false,
            },
        });
        win.loadFile(path.join(__dirname, '../renderer/index.html'));
        win.on('closed', () => {
            // 自动清理，不做额外处理
        });
    });
}
// ---- 多窗口支持 ----
// 检查命令行参数中是否有 .simpledraw 文件（每个进程/窗口独立处理）
const cmdFile = process.argv.find(a => a.endsWith('.simpledraw') && !a.startsWith('-'));
// ---- App lifecycle ----
electron_1.app.whenReady().then(() => {
    setupIpcHandlers();
    createWindow();
    // 启动时如果有命令行文件参数，渲染进程就绪后自动打开
    if (cmdFile) {
        const openedFile = cmdFile;
        electron_1.ipcMain.handleOnce('app:renderer-ready', () => {
            const absPath = path.resolve(openedFile);
            if (mainWindow) {
                mainWindow.webContents.send('menu-open', absPath);
            }
        });
    }
    // macOS: 点击 Dock 图标时若没有窗口则创建一个
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// macOS: 拖文件到 Dock 图标
electron_1.app.on('open-file', (_event, filePath) => {
    const absPath = path.resolve(filePath);
    if (mainWindow) {
        mainWindow.webContents.send('menu-open', absPath);
        mainWindow.focus();
    }
});
//# sourceMappingURL=main.js.map