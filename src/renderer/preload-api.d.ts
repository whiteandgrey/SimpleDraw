// Type declarations for window.simpledraw (exposed by preload)

interface FileAPI {
    read(filePath: string): Promise<{ success: boolean; data?: string; error?: string }>;
    write(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
    exists(filePath: string): Promise<boolean>;
    showSaveDialog(defaultPath?: string): Promise<string | null>;
    showExportDialog(defaultPath?: string): Promise<string | null>;
    writeBinary(filePath: string, base64Data: string): Promise<{ success: boolean; error?: string }>;
    getRecent(): Promise<string[]>;
    getUserDataPath(): Promise<string>;
    pickImage(): Promise<string | null>;
}

interface SettingsAPI {
    load(): Promise<Record<string, any>>;
    save(settings: Record<string, any>): Promise<{ success: boolean }>;
}

interface SimpleDrawAPI {
    file: FileAPI;
    settings: SettingsAPI;
    onMenuEvent(callback: (event: string, ...args: any[]) => void): () => void;
    onCloseRequest(handler: () => void): void;
    closeWindow(): void;
    sendReady(): void;
    openNewWindow(): void;
}

interface Window {
    simpledraw: SimpleDrawAPI;
}
