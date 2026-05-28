// Application Shell — manages canvas instance, file operations, settings, and menu events

import { SimpleDrawCanvas } from './canvas-view';
import { SimpleDrawSettings, DEFAULT_SETTINGS } from './settings';
import { setLanguage } from './locale';
import { SettingsWindow } from './settings-window';
import { t } from './locale';

export class AppShell {
    private canvas: SimpleDrawCanvas;
    private settings: SimpleDrawSettings;
    private cleanupMenu: (() => void) | null = null;

    constructor() {
        this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        this.canvas = new SimpleDrawCanvas(this.settings);
    }

    async init(): Promise<void> {
        // 先注册 IPC 监听器（同步），确保 did-finish-load 等事件不会丢失
        this.cleanupMenu = window.simpledraw.onMenuEvent((event: string, ...args: any[]) => {
            this.handleMenuEvent(event, args);
        });

        window.simpledraw.onCloseRequest(async () => {
            if (!this.canvas.isDirty) {
                window.simpledraw.closeWindow();
                return;
            }
            const choice = await this.showCloseDialog();
            if (choice === 'save') {
                const saved = await this.canvas.saveFile();
                if (saved) window.simpledraw.closeWindow();
            } else if (choice === 'discard') {
                window.simpledraw.closeWindow();
            }
        });

        // 再执行异步初始化
        await this.loadSettings();

        // 重要：将加载后的设置同步到 canvas，否则修改不会生效（如网格显隐）
        Object.assign(this.canvas.settings, this.settings);
        this.canvas.engine.settings = this.canvas.settings;

        const container = document.getElementById('canvas-container')!;
        this.canvas.mount(container);

        // 通知主进程渲染进程已就绪，可以接收文件打开等命令
        window.simpledraw.sendReady();

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.handleNewFile();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
                if (!this.canvas.engine.editingTextboxId && !this.canvas.engine.editingArrowId) {
                    e.preventDefault();
                    this.handleSave();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's' && e.shiftKey) {
                if (!this.canvas.engine.editingTextboxId && !this.canvas.engine.editingArrowId) {
                    e.preventDefault();
                    this.handleSaveAs();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
                if (!this.canvas.engine.editingTextboxId && !this.canvas.engine.editingArrowId) {
                    e.preventDefault();
                    this.canvas.exportToPNG();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === ',') {
                e.preventDefault();
                this.openSettings();
            }
        });
    }

    private async showCloseDialog(): Promise<'save' | 'discard' | 'cancel'> {
        return new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.style.cssText = `
                border: 1px solid var(--border-color);
                border-radius: 8px;
                padding: 0;
                background: var(--bg-primary);
                color: var(--text-normal);
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                max-width: 400px;
                width: 100%;
            `;
            dialog.innerHTML = `
                <div style="padding:20px">
                    <h3 style="margin:0 0 8px 0;font-size:16px">有未保存的更改</h3>
                    <p style="margin:0 0 16px 0;font-size:13px;color:var(--text-muted)">
                        当前文件有未保存的更改，是否保存后再退出？
                    </p>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button id="close-dlg-save" style="padding:6px 16px;border:none;border-radius:4px;background:var(--accent-color);color:white;cursor:pointer;font-size:13px">保存</button>
                        <button id="close-dlg-discard" style="padding:6px 16px;border:1px solid var(--border-color);border-radius:4px;background:transparent;color:var(--text-normal);cursor:pointer;font-size:13px">不保存</button>
                        <button id="close-dlg-cancel" style="padding:6px 16px;border:1px solid var(--border-color);border-radius:4px;background:transparent;color:var(--text-normal);cursor:pointer;font-size:13px">取消</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);
            dialog.showModal();

            const close = (result: 'save' | 'discard' | 'cancel') => {
                dialog.close();
                dialog.remove();
                resolve(result);
            };

            dialog.querySelector('#close-dlg-save')!.addEventListener('click', () => close('save'));
            dialog.querySelector('#close-dlg-discard')!.addEventListener('click', () => close('discard'));
            dialog.querySelector('#close-dlg-cancel')!.addEventListener('click', () => close('cancel'));

            // 点击 backdrop 取消
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close('cancel');
            });
        });
    }

    private async loadSettings(): Promise<void> {
        try {
            const saved = await window.simpledraw.settings.load();
            if (saved && Object.keys(saved).length > 0) {
                this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
                setLanguage(this.settings.language);
            }
        } catch { /* use defaults */ }
    }

    private async saveSettings(): Promise<void> {
        await window.simpledraw.settings.save(this.settings as any);
    }

    private handleMenuEvent(event: string, args: any[]): void {
        switch (event) {
            case 'new': this.handleNewFile(); break;
            case 'open': this.handleOpenFile(args[0] as string); break;
            case 'save': this.handleSave(); break;
            case 'save-as': this.handleSaveAs(); break;
            case 'export': this.canvas.exportToPNG(); break;
            case 'settings': this.openSettings(); break;
        }
    }

    private handleNewFile(): void {
        window.simpledraw.openNewWindow();
    }

    private async handleOpenFile(filePath?: string): Promise<void> {
        if (this.canvas.isDirty) {
            const confirmed = confirm('当前文件有未保存的更改，是否继续？');
            if (!confirmed) return;
        }
        if (filePath) {
            await this.canvas.openFile(filePath);
        }
    }

    private async handleSave(): Promise<void> {
        await this.canvas.saveFile();
    }

    private async handleSaveAs(): Promise<void> {
        await this.canvas.saveFileAs();
    }

    async openSettings(): Promise<void> {
        const win = new SettingsWindow(this.settings, async (newSettings) => {
            this.settings = newSettings;
            Object.assign(this.canvas.settings, this.settings);
            this.canvas.engine.settings = this.canvas.settings;
            this.canvas.updateMenuButtons();
            this.canvas.updateSnapButton();
            this.canvas.requestRender();
            await this.saveSettings();
        });
        await win.open();
    }

    destroy(): void {
        if (this.cleanupMenu) {
            this.cleanupMenu();
            this.cleanupMenu = null;
        }
        this.canvas.unmount();
    }
}
