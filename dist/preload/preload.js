"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('simpledraw', {
    // File operations
    file: {
        read: (filePath) => electron_1.ipcRenderer.invoke('file:read', filePath),
        write: (filePath, content) => electron_1.ipcRenderer.invoke('file:write', filePath, content),
        exists: (filePath) => electron_1.ipcRenderer.invoke('file:exists', filePath),
        showSaveDialog: (defaultPath) => electron_1.ipcRenderer.invoke('file:show-save-dialog', defaultPath),
        showExportDialog: (defaultPath) => electron_1.ipcRenderer.invoke('file:show-export-dialog', defaultPath),
        writeBinary: (filePath, base64Data) => electron_1.ipcRenderer.invoke('file:write-binary', filePath, base64Data),
        pickImage: () => electron_1.ipcRenderer.invoke('file:pick-image'),
        getRecent: () => electron_1.ipcRenderer.invoke('file:get-recent'),
        getUserDataPath: () => electron_1.ipcRenderer.invoke('file:get-user-data-path'),
    },
    // Settings
    settings: {
        load: () => electron_1.ipcRenderer.invoke('settings:load'),
        save: (settings) => electron_1.ipcRenderer.invoke('settings:save', settings),
    },
    // Menu events from main process
    onMenuEvent: (callback) => {
        const handlers = {
            'menu-new': () => callback('new'),
            'menu-open': (_event, filePath) => callback('open', filePath),
            'menu-save': () => callback('save'),
            'menu-save-as': () => callback('save-as'),
            'menu-export': () => callback('export'),
            'menu-settings': () => callback('settings'),
        };
        for (const [channel, handler] of Object.entries(handlers)) {
            electron_1.ipcRenderer.on(channel, handler);
        }
        return () => {
            for (const [channel, handler] of Object.entries(handlers)) {
                electron_1.ipcRenderer.removeListener(channel, handler);
            }
        };
    },
    // Close request from main → 渲染进程处理确认
    onCloseRequest: (handler) => {
        electron_1.ipcRenderer.on('app:request-close', () => handler());
    },
    // 通知主进程直接关闭窗口
    closeWindow: () => {
        electron_1.ipcRenderer.send('app:close-directly');
    },
    // 通知主进程渲染进程已就绪
    sendReady: () => {
        // 唯一标记：初始文件路径（如果命令行有的话）
        electron_1.ipcRenderer.invoke('app:renderer-ready');
    },
    // 新建窗口
    openNewWindow: () => {
        electron_1.ipcRenderer.invoke('app:open-new-window');
    },
});
//# sourceMappingURL=preload.js.map