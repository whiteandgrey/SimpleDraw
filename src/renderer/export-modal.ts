// Export PNG Modal — 对标原版插件导出界面

import { t } from './locale';

export interface ExportOptions {
    filePath: string;
    showGrid: boolean;
    transparentBg: boolean;
}

export class ExportModal {
    private dialog: HTMLDialogElement;
    private pathInput: HTMLInputElement;
    private gridToggle: HTMLInputElement;
    private gridToggleRow: HTMLElement;
    private bgToggle: HTMLInputElement;

    constructor(
        private defaultPath: string,
        private onExport: (opts: ExportOptions) => void,
    ) {}

    async open(): Promise<void> {
        this.dialog = document.createElement('dialog');
        this.dialog.style.cssText = `
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0;
            background: var(--bg-primary);
            color: var(--text-normal);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            min-width: 480px;
            max-width: 560px;
        `;

        const container = document.createElement('div');
        container.style.padding = '24px';

        // Title
        const title = document.createElement('h2');
        title.textContent = t('export.title');
        title.style.cssText = 'margin: 0 0 20px 0; font-size: 18px; color: var(--text-normal);';
        container.appendChild(title);

        // ------ 保存路径 ------
        container.appendChild(this.createFieldLabel(
            t('export.path.name'), t('export.path.desc')
        ));

        const pathRow = document.createElement('div');
        pathRow.style.cssText = 'display:flex; gap:8px; margin-bottom:16px; align-items:center;';

        this.pathInput = document.createElement('input');
        this.pathInput.type = 'text';
        this.pathInput.value = this.defaultPath;
        this.pathInput.style.cssText = `
            flex:1; padding:6px 8px; border:1px solid var(--border-color);
            border-radius:4px; background:var(--bg-primary); color:var(--text-normal);
            font-family: var(--font-mono); font-size:13px;
        `;
        pathRow.appendChild(this.pathInput);

        const browseBtn = document.createElement('button');
        browseBtn.textContent = t('export.path.browse');
        browseBtn.style.cssText = `
            padding:6px 14px; border:1px solid var(--border-color);
            border-radius:4px; background:var(--bg-secondary);
            color:var(--text-normal); cursor:pointer; font-size:13px;
            white-space:nowrap;
        `;
        browseBtn.addEventListener('click', async () => {
            const path = await window.simpledraw.file.showExportDialog(this.pathInput.value);
            if (path) this.pathInput.value = path;
        });
        pathRow.appendChild(browseBtn);
        container.appendChild(pathRow);

        // ------ 显示网格（默认不显示）------
        this.gridToggleRow = this.createToggleRow(
            t('export.grid.name'), t('export.grid.desc'),
            false,
            (el) => { this.gridToggle = el; }
        );
        container.appendChild(this.gridToggleRow);

        // ------ 透明背景 — 选中时自动取消网格，但用户可手动重新开启------
        container.appendChild(this.createToggleRow(
            t('export.transparent.name'), t('export.transparent.desc'),
            false,
            (el) => {
                this.bgToggle = el;
                el.addEventListener('change', () => {
                    if (el.checked && this.gridToggle.checked) {
                        this.gridToggle.checked = false;
                        // 同步更新 grid toggle 的滑块 UI
                        const slider = this.gridToggle.nextElementSibling as HTMLElement | null;
                        if (slider) {
                            slider.style.background = '#ccc';
                            const knob = slider.firstChild as HTMLElement | null;
                            if (knob) knob.style.left = '2px';
                        }
                    }
                });
            }
        ));

        // ------ 按钮 ------
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; gap:8px; justify-content:flex-end; margin-top:24px;';

        const exportBtn = document.createElement('button');
        exportBtn.textContent = t('export.exportBtn');
        exportBtn.style.cssText = `
            padding:8px 24px; border:none; border-radius:4px;
            background:var(--accent-color); color:white; cursor:pointer; font-size:14px;
        `;
        exportBtn.addEventListener('click', () => this.doExport());

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = t('export.cancelBtn');
        cancelBtn.style.cssText = `
            padding:8px 24px; border:1px solid var(--border-color);
            border-radius:4px; background:transparent; color:var(--text-normal);
            cursor:pointer; font-size:14px;
        `;
        cancelBtn.addEventListener('click', () => this.close());

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(exportBtn);
        container.appendChild(btnRow);

        this.dialog.appendChild(container);
        document.body.appendChild(this.dialog);
        this.dialog.showModal();

        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) this.close();
        });
        this.dialog.addEventListener('close', () => {
            this.dialog.remove();
        });

        this.pathInput.focus();
        this.pathInput.select();
    }

    private doExport(): void {
        this.onExport({
            filePath: this.pathInput.value || this.defaultPath,
            showGrid: this.gridToggle?.checked ?? this.defaultShowGrid,
            transparentBg: this.bgToggle?.checked ?? false,
        });
        this.close();
    }

    private close(): void {
        this.dialog.close();
        this.dialog.remove();
    }

    private createFieldLabel(name: string, desc: string): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-bottom:4px;';
        const n = document.createElement('div');
        n.textContent = name;
        n.style.cssText = 'font-weight:500; font-size:13px; color:var(--text-normal);';
        const d = document.createElement('div');
        d.textContent = desc;
        d.style.cssText = 'font-size:11px; color:var(--text-muted); margin-top:1px;';
        wrapper.appendChild(n);
        wrapper.appendChild(d);
        return wrapper;
    }

    private createToggleRow(
        name: string, desc: string, checked: boolean,
        onCreated: (el: HTMLInputElement) => void
    ): HTMLElement {
        const row = document.createElement('div');
        row.style.cssText = `
            display:flex; align-items:center; justify-content:space-between;
            padding:10px 0; border-bottom: 1px solid var(--border-color);
        `;

        const textDiv = document.createElement('div');
        textDiv.style.cssText = 'flex:1; margin-right:16px;';
        const n = document.createElement('div');
        n.textContent = name;
        n.style.cssText = 'font-weight:500; font-size:13px; color:var(--text-normal);';
        const d = document.createElement('div');
        d.textContent = desc;
        d.style.cssText = 'font-size:11px; color:var(--text-muted); margin-top:1px;';
        textDiv.appendChild(n);
        textDiv.appendChild(d);
        row.appendChild(textDiv);

        const toggle = document.createElement('label');
        toggle.style.cssText = 'display:inline-flex; align-items:center; cursor:pointer;';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.style.display = 'none';
        onCreated(input, toggle);

        const slider = document.createElement('span');
        slider.style.cssText = `
            width:36px; height:20px; background:${checked ? 'var(--accent-color)' : '#ccc'};
            border-radius:10px; position:relative; transition:background 0.2s;
        `;
        const knob = document.createElement('span');
        knob.style.cssText = `
            position:absolute; width:16px; height:16px; background:white;
            border-radius:50%; top:2px; left:${checked ? '18px' : '2px'};
            transition:left 0.2s;
        `;
        slider.appendChild(knob);
        toggle.appendChild(input);
        toggle.appendChild(slider);

        toggle.addEventListener('click', () => {
            const newVal = !input.checked;
            input.checked = newVal;
            slider.style.background = newVal ? 'var(--accent-color)' : '#ccc';
            knob.style.left = newVal ? '18px' : '2px';
        });

        row.appendChild(toggle);
        return row;
    }
}
