import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';

let mainWindow: BrowserWindow | null = null;

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const RECENT_PATH = path.join(app.getPath('userData'), 'recent.json');

// ---- Settings helpers ----

async function loadSettings(): Promise<Record<string, any>> {
    try {
        const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {};
    }
}

async function saveSettings(settings: Record<string, any>): Promise<void> {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

// ---- Recent files ----

async function getRecentFiles(): Promise<string[]> {
    try {
        const data = await fs.readFile(RECENT_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function addRecentFile(filePath: string): Promise<void> {
    const recent = await getRecentFiles();
    const filtered = recent.filter(f => f !== filePath);
    filtered.unshift(filePath);
    await fs.writeFile(RECENT_PATH, JSON.stringify(filtered.slice(0, 20), null, 2), 'utf-8');
}

// ---- DPI & GPU ----
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// ---- Window creation ----

function createWindow(): void {
    mainWindow = new BrowserWindow({
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
    const template: Electron.MenuItemConstructorOptions[] = [
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
                        const result = await dialog.showOpenDialog(mainWindow!, {
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
                ...(process.platform === 'darwin' ? [{ role: 'close' as const }] : [{
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
                        const ver = app.getVersion();
                        dialog.showMessageBox(mainWindow!, {
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

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    // ---- Window close handling ----
    // 渲染进程处理完确认后，通知主进程直接关闭
    ipcMain.on('app:close-directly', () => {
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

function setupIpcHandlers(): void {
    // File operations
    ipcMain.handle('file:read', async (_event, filePath: string) => {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return { success: true, data };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
        try {
            const dir = path.dirname(filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            await fs.writeFile(filePath, content, 'utf-8');
            await addRecentFile(filePath);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('file:exists', async (_event, filePath: string) => {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    });

    ipcMain.handle('file:show-save-dialog', async (_event, defaultPath?: string) => {
        const result = await dialog.showSaveDialog(mainWindow!, {
            title: '保存 SimpleDraw 文件',
            defaultPath,
            filters: [{ name: 'SimpleDraw 文件', extensions: ['simpledraw'] }],
        });
        if (result.canceled) return null;
        return result.filePath;
    });

    ipcMain.handle('file:pick-image', async () => {
        const result = await dialog.showOpenDialog(mainWindow!, {
            title: '选择图片',
            filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'] }],
            properties: ['openFile'],
        });
        if (result.canceled) return null;
        return result.filePaths[0];
    });

    ipcMain.handle('file:show-export-dialog', async (_event, defaultPath?: string) => {
        const result = await dialog.showSaveDialog(mainWindow!, {
            title: '导出为 PNG',
            defaultPath,
            filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        });
        if (result.canceled) return null;
        return result.filePath;
    });

    ipcMain.handle('file:write-binary', async (_event, filePath: string, base64Data: string) => {
        try {
            const dir = path.dirname(filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.writeFile(filePath, buffer);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('file:get-recent', async () => {
        return await getRecentFiles();
    });

    ipcMain.handle('file:get-user-data-path', () => {
        return app.getPath('userData');
    });

    // Settings operations
    ipcMain.handle('settings:load', async () => {
        return await loadSettings();
    });

    ipcMain.handle('settings:save', async (_event, settings: Record<string, any>) => {
        await saveSettings(settings);
        return { success: true };
    });
}

// ---- 多窗口支持 ----

// 检查命令行参数中是否有 .simpledraw 文件（每个进程/窗口独立处理）
const cmdFile = process.argv.find(a => a.endsWith('.simpledraw') && !a.startsWith('-'));

// ---- App lifecycle ----

app.whenReady().then(() => {
    setupIpcHandlers();
    createWindow();

    // 启动时如果有命令行文件参数，渲染进程就绪后自动打开
    if (cmdFile) {
        const openedFile = cmdFile;
        ipcMain.handleOnce('app:renderer-ready', () => {
            const absPath = path.resolve(openedFile);
            if (mainWindow) {
                mainWindow.webContents.send('menu-open', absPath);
            }
        });
    }

    // macOS: 点击 Dock 图标时若没有窗口则创建一个
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// macOS: 拖文件到 Dock 图标
app.on('open-file', (_event, filePath) => {
    const absPath = path.resolve(filePath);
    if (mainWindow) {
        mainWindow.webContents.send('menu-open', absPath);
        mainWindow.focus();
    }
});
