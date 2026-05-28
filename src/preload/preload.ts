import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('simpledraw', {
    // File operations
    file: {
        read: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
        write: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
        exists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
        showSaveDialog: (defaultPath?: string) => ipcRenderer.invoke('file:show-save-dialog', defaultPath),
        showExportDialog: (defaultPath?: string) => ipcRenderer.invoke('file:show-export-dialog', defaultPath),
        writeBinary: (filePath: string, base64Data: string) => ipcRenderer.invoke('file:write-binary', filePath, base64Data),
        pickImage: () => ipcRenderer.invoke('file:pick-image'),
        getRecent: () => ipcRenderer.invoke('file:get-recent'),
        getUserDataPath: () => ipcRenderer.invoke('file:get-user-data-path'),
    },

    // Settings
    settings: {
        load: () => ipcRenderer.invoke('settings:load'),
        save: (settings: Record<string, any>) => ipcRenderer.invoke('settings:save', settings),
    },

    // Menu events from main process
    onMenuEvent: (callback: (event: string, ...args: any[]) => void) => {
        const handlers: Record<string, (...args: any[]) => void> = {
            'menu-new': () => callback('new'),
            'menu-open': (_event: any, filePath: string) => callback('open', filePath),
            'menu-save': () => callback('save'),
            'menu-save-as': () => callback('save-as'),
            'menu-export': () => callback('export'),
            'menu-settings': () => callback('settings'),
        };
        for (const [channel, handler] of Object.entries(handlers)) {
            ipcRenderer.on(channel, handler);
        }
        return () => {
            for (const [channel, handler] of Object.entries(handlers)) {
                ipcRenderer.removeListener(channel, handler);
            }
        };
    },

    // Close request from main → 渲染进程处理确认
    onCloseRequest: (handler: () => void) => {
        ipcRenderer.on('app:request-close', () => handler());
    },

    // 通知主进程直接关闭窗口
    closeWindow: () => {
        ipcRenderer.send('app:close-directly');
    },

    // 通知主进程渲染进程已就绪
    sendReady: () => {
        // 唯一标记：初始文件路径（如果命令行有的话）
        ipcRenderer.invoke('app:renderer-ready');
    },

    // 新建窗口
    openNewWindow: () => {
        ipcRenderer.invoke('app:open-new-window');
    },
});
