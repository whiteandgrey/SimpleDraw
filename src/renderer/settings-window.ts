// Settings Window — standalone version (replaces Obsidian PluginSettingTab)

import { SimpleDrawSettings, getArrowShapes, ArrowShape, ShortcutBinding, getShortcutActions, TextShortcutAction, bindingLabel, DEFAULT_SETTINGS, validateColor, AnchorScheme } from './settings';
import { t, setLanguage, Language } from './locale';

export class SettingsWindow {
    private dialog: HTMLDialogElement;
    private settings: SimpleDrawSettings;
    private onSave: (settings: SimpleDrawSettings) => Promise<void>;

    constructor(settings: SimpleDrawSettings, onSave: (settings: SimpleDrawSettings) => Promise<void>) {
        this.settings = JSON.parse(JSON.stringify(settings));
        this.onSave = onSave;
    }

    async open(): Promise<void> {
        // Create dialog
        this.dialog = document.createElement('dialog');
        this.dialog.style.minWidth = '500px';
        this.dialog.style.maxWidth = '650px';
        this.dialog.style.border = '1px solid var(--border-color)';
        this.dialog.style.borderRadius = '8px';
        this.dialog.style.padding = '0';
        this.dialog.style.background = 'var(--bg-primary)';
        this.dialog.style.color = 'var(--text-normal)';
        this.dialog.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';

        const container = document.createElement('div');
        container.style.padding = '24px';
        container.style.maxHeight = '80vh';
        container.style.overflowY = 'auto';

        // Title
        const title = document.createElement('h2');
        title.textContent = t('settings.title');
        title.style.margin = '0 0 20px 0';
        title.style.color = 'var(--text-normal)';
        container.appendChild(title);

        // ========== 基础设置 ==========
        const basicSection = this.createCollapsibleSection(t('settings.group.basic'), true);
        basicSection.body.appendChild(this.createSettingRow(
            t('settings.language.name'), t('settings.language.desc'),
            this.createDropdown([
                { value: 'zh', label: t('language.zh') },
                { value: 'en', label: t('language.en') },
            ], this.settings.language, (val) => {
                this.settings.language = val as Language;
            })
        ));
        basicSection.body.appendChild(this.createSettingRow(
            t('settings.showGrid.name'), t('settings.showGrid.desc'),
            this.createToggle(this.settings.showGrid, (val) => { this.settings.showGrid = val; })
        ));
        basicSection.body.appendChild(this.createSettingRow(
            t('settings.showAnchorDots.name'), t('settings.showAnchorDots.desc'),
            this.createToggle(this.settings.showAnchorDots, (val) => { this.settings.showAnchorDots = val; })
        ));
        basicSection.body.appendChild(this.createSettingRow(
            t('settings.textboxDefaultFontSize.name'), t('settings.textboxDefaultFontSize.desc'),
            this.createSlider(8, 72, 1, this.settings.textboxDefaultFontSize, (val) => { this.settings.textboxDefaultFontSize = val; })
        ));
        container.appendChild(basicSection.container);

        // ========== 吸附功能 ==========
        const snapSection = this.createCollapsibleSection(t('settings.group.snap'), false);
        snapSection.body.appendChild(this.createSettingRow(
            t('settings.anchorScheme.name'), t('settings.anchorScheme.desc'),
            this.createDropdown([
                { value: 'scheme1', label: t('settings.anchorScheme.scheme1') },
                { value: 'scheme2', label: t('settings.anchorScheme.scheme2') },
            ], this.settings.anchorScheme, (val) => {
                this.settings.anchorScheme = val as AnchorScheme;
            })
        ));
        snapSection.body.appendChild(this.createSettingRow(
            t('settings.snapPreviewRadius.name'), t('settings.snapPreviewRadius.desc'),
            this.createSlider(4, 20, 1, this.settings.snapPreviewRadius, (val) => { this.settings.snapPreviewRadius = val; })
        ));
        container.appendChild(snapSection.container);

        // ========== 箭头设置 ==========
        const arrowSection = this.createCollapsibleSection(t('settings.group.arrow'), false);
        arrowSection.body.appendChild(this.createSettingRow(
            t('settings.arrowStrokeWidth.name'), t('settings.arrowStrokeWidth.desc'),
            this.createSlider(1, 5, 1, this.settings.arrowStrokeWidth, (val) => { this.settings.arrowStrokeWidth = val; })
        ));
        arrowSection.body.appendChild(this.createSettingRow(
            t('settings.arrowHeadSize.name'), t('settings.arrowHeadSize.desc'),
            this.createSlider(6, 20, 2, this.settings.arrowHeadSize, (val) => { this.settings.arrowHeadSize = val; })
        ));
        arrowSection.body.appendChild(this.createSettingRow(
            t('settings.arrowShape.name'), t('settings.arrowShape.desc'),
            this.createDropdown(
                getArrowShapes().map(s => ({ value: s.value, label: s.label })),
                this.settings.arrowShape,
                (val) => { this.settings.arrowShape = val as ArrowShape; }
            )
        ));
        container.appendChild(arrowSection.container);

        // ========== 元素颜色 ==========
        const colorSection = this.createCollapsibleSection(t('settings.group.color'), false);
        colorSection.body.appendChild(this.createColorRow(
            t('settings.textboxFillColor.name'), t('settings.textboxFillColor.desc'),
            this.settings.textboxFillColor, (val) => { this.settings.textboxFillColor = val; }
        ));
        colorSection.body.appendChild(this.createColorRow(
            t('settings.textboxBorderColor.name'), t('settings.textboxBorderColor.desc'),
            this.settings.textboxBorderColor, (val) => { this.settings.textboxBorderColor = val; }
        ));
        colorSection.body.appendChild(this.createColorRow(
            t('settings.arrowColor.name'), t('settings.arrowColor.desc'),
            this.settings.arrowColor, (val) => { this.settings.arrowColor = val; }
        ));
        container.appendChild(colorSection.container);

        // ========== 图片插入 ==========
        const imageSection = this.createCollapsibleSection(t('settings.group.image'), true);
        imageSection.body.appendChild(this.createSettingRow(
            t('settings.showImageScalePrompt.name'), t('settings.showImageScalePrompt.desc'),
            this.createToggle(this.settings.showImageScalePrompt, (val) => { this.settings.showImageScalePrompt = val; })
        ));
        imageSection.body.appendChild(this.createSettingRow(
            t('settings.imageScaleWithTextBox.name'), t('settings.imageScaleWithTextBox.desc'),
            this.createToggle(this.settings.imageScaleWithTextBox, (val) => { this.settings.imageScaleWithTextBox = val; })
        ));
        container.appendChild(imageSection.container);

        // ========== 快捷键 ==========
        const shortcutSection = this.createCollapsibleSection(t('settings.group.shortcuts'), false);
        const shortcutListEl = document.createElement('div');
        shortcutSection.body.appendChild(shortcutListEl);
        this.renderShortcutList(shortcutListEl);
        const addBtn = document.createElement('button');
        addBtn.textContent = t('settings.shortcuts.add');
        addBtn.style.marginTop = '8px';
        addBtn.style.padding = '6px 12px';
        addBtn.style.border = '1px solid var(--border-color)';
        addBtn.style.borderRadius = '4px';
        addBtn.style.background = 'var(--bg-secondary)';
        addBtn.style.color = 'var(--text-normal)';
        addBtn.style.cursor = 'pointer';
        addBtn.addEventListener('click', () => this.startAddShortcut(shortcutListEl));
        shortcutSection.body.appendChild(addBtn);
        container.appendChild(shortcutSection.container);

        // Buttons
        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '8px';
        btnRow.style.justifyContent = 'flex-end';
        btnRow.style.marginTop = '24px';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = t('export.cancelBtn');
        cancelBtn.style.padding = '8px 20px';
        cancelBtn.style.border = '1px solid var(--border-color)';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.background = 'var(--bg-secondary)';
        cancelBtn.style.color = 'var(--text-normal)';
        cancelBtn.style.cursor = 'pointer';
        cancelBtn.addEventListener('click', () => this.dialog.close());

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存设置';
        saveBtn.style.padding = '8px 20px';
        saveBtn.style.border = 'none';
        saveBtn.style.borderRadius = '4px';
        saveBtn.style.background = 'var(--accent-color)';
        saveBtn.style.color = 'white';
        saveBtn.style.cursor = 'pointer';
        saveBtn.addEventListener('click', async () => {
            // 校验颜色格式，无效则恢复默认
            const colorChecks: { key: keyof SimpleDrawSettings; val: string; label: string }[] = [
                { key: 'textboxFillColor', val: this.settings.textboxFillColor, label: t('settings.textboxFillColor.name') },
                { key: 'textboxBorderColor', val: this.settings.textboxBorderColor, label: t('settings.textboxBorderColor.name') },
                { key: 'arrowColor', val: this.settings.arrowColor, label: t('settings.arrowColor.name') },
            ];
            for (const c of colorChecks) {
                const valid = validateColor(c.val);
                if (!valid) {
                    alert(t('settings.color.invalid', { color: c.label }));
                    (this.settings as any)[c.key] = (DEFAULT_SETTINGS as any)[c.key];
                } else {
                    (this.settings as any)[c.key] = valid;
                }
            }
            setLanguage(this.settings.language);
            await this.onSave(this.settings);
            this.dialog.close();
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        container.appendChild(btnRow);

        this.dialog.appendChild(container);
        document.body.appendChild(this.dialog);

        this.dialog.showModal();

        // Close on backdrop click
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) this.dialog.close();
        });

        this.dialog.addEventListener('close', () => {
            this.dialog.remove();
        });
    }

    private createSettingRow(name: string, desc: string, control: HTMLElement): HTMLElement {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '12px 0';
        row.style.borderBottom = '1px solid var(--border-color)';

        const textDiv = document.createElement('div');
        textDiv.style.flex = '1';
        textDiv.style.marginRight = '16px';

        const nameEl = document.createElement('div');
        nameEl.textContent = name;
        nameEl.style.fontWeight = '500';
        nameEl.style.color = 'var(--text-normal)';

        const descEl = document.createElement('div');
        descEl.textContent = desc;
        descEl.style.fontSize = '12px';
        descEl.style.color = 'var(--text-muted)';
        descEl.style.marginTop = '2px';

        textDiv.appendChild(nameEl);
        textDiv.appendChild(descEl);

        row.appendChild(textDiv);
        row.appendChild(control);

        return row;
    }

    private createCollapsibleSection(title: string, expanded: boolean): { container: HTMLElement; body: HTMLElement } {
        const container = document.createElement('div');
        container.style.marginBottom = '4px';
        container.style.border = '1px solid var(--border-color)';
        container.style.borderRadius = '6px';
        container.style.overflow = 'hidden';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.padding = '8px 12px';
        header.style.cursor = 'pointer';
        header.style.background = 'var(--bg-secondary)';
        header.style.userSelect = 'none';

        const arrow = document.createElement('span');
        arrow.textContent = expanded ? '▼' : '▶';
        arrow.style.fontSize = '10px';
        arrow.style.marginRight = '8px';
        arrow.style.color = 'var(--text-muted)';
        arrow.style.transition = 'transform 0.15s';

        const label = document.createElement('span');
        label.textContent = title;
        label.style.fontWeight = '600';
        label.style.fontSize = '13px';
        label.style.color = 'var(--text-normal)';

        header.appendChild(arrow);
        header.appendChild(label);

        const body = document.createElement('div');
        body.style.padding = '0 12px';
        body.style.display = expanded ? '' : 'none';

        header.addEventListener('click', () => {
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : '';
            arrow.textContent = isOpen ? '▶' : '▼';
        });

        container.appendChild(header);
        container.appendChild(body);

        return { container, body };
    }

    private createToggle(value: boolean, onChange: (val: boolean) => void): HTMLElement {
        const toggle = document.createElement('label');
        toggle.style.display = 'inline-flex';
        toggle.style.alignItems = 'center';
        toggle.style.cursor = 'pointer';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = value;
        input.style.display = 'none';

        const slider = document.createElement('span');
        slider.style.width = '36px';
        slider.style.height = '20px';
        slider.style.background = value ? 'var(--accent-color)' : '#ccc';
        slider.style.borderRadius = '10px';
        slider.style.position = 'relative';
        slider.style.transition = 'background 0.2s';

        const knob = document.createElement('span');
        knob.style.position = 'absolute';
        knob.style.width = '16px';
        knob.style.height = '16px';
        knob.style.background = 'white';
        knob.style.borderRadius = '50%';
        knob.style.top = '2px';
        knob.style.left = value ? '18px' : '2px';
        knob.style.transition = 'left 0.2s';

        slider.appendChild(knob);
        toggle.appendChild(input);
        toggle.appendChild(slider);

        toggle.addEventListener('click', () => {
            const newVal = !input.checked;
            input.checked = newVal;
            slider.style.background = newVal ? 'var(--accent-color)' : '#ccc';
            knob.style.left = newVal ? '18px' : '2px';
            onChange(newVal);
        });

        return toggle;
    }

    private createDropdown(options: { value: string; label: string }[], current: string, onChange: (val: string) => void): HTMLElement {
        const select = document.createElement('select');
        select.style.padding = '4px 8px';
        select.style.border = '1px solid var(--border-color)';
        select.style.borderRadius = '4px';
        select.style.background = 'var(--bg-primary)';
        select.style.color = 'var(--text-normal)';
        select.style.cursor = 'pointer';

        for (const opt of options) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === current) option.selected = true;
            select.appendChild(option);
        }

        select.addEventListener('change', () => onChange(select.value));
        return select;
    }

    private createSlider(min: number, max: number, step: number, current: number, onChange: (val: number) => void): HTMLElement {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '8px';

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(current);

        const valueDisplay = document.createElement('span');
        valueDisplay.textContent = String(current);
        valueDisplay.style.fontSize = '12px';
        valueDisplay.style.color = 'var(--text-muted)';
        valueDisplay.style.minWidth = '24px';
        valueDisplay.style.textAlign = 'center';

        input.addEventListener('input', () => {
            const val = parseInt(input.value);
            valueDisplay.textContent = String(val);
            onChange(val);
        });

        container.appendChild(input);
        container.appendChild(valueDisplay);
        return container;
    }

    private createColorRow(name: string, desc: string, current: string, onChange: (val: string) => void): HTMLElement {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.padding = '12px 0';
        row.style.borderBottom = '1px solid var(--border-color)';

        const textDiv = document.createElement('div');
        textDiv.style.flex = '1';
        textDiv.style.marginRight = '16px';
        const nameEl = document.createElement('div');
        nameEl.textContent = name;
        nameEl.style.fontWeight = '500';
        nameEl.style.color = 'var(--text-normal)';
        const descEl = document.createElement('div');
        descEl.textContent = desc;
        descEl.style.fontSize = '12px';
        descEl.style.color = 'var(--text-muted)';
        descEl.style.marginTop = '2px';
        textDiv.appendChild(nameEl);
        textDiv.appendChild(descEl);
        row.appendChild(textDiv);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = current;
        input.style.width = '100px';
        input.style.padding = '4px 8px';
        input.style.border = '1px solid var(--border-color)';
        input.style.borderRadius = '4px';
        input.style.background = 'var(--bg-primary)';
        input.style.color = 'var(--text-normal)';
        input.style.fontFamily = 'var(--font-mono)';
        input.style.fontSize = '13px';
        input.addEventListener('input', () => onChange(input.value));
        row.appendChild(input);

        return row;
    }

    private renderShortcutList(container: HTMLElement): void {
        container.innerHTML = '';
        for (const [i, binding] of this.settings.shortcuts.entries()) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.padding = '6px 0';
            row.style.borderBottom = '1px solid var(--border-color)';

            const label = getShortcutActions().find(a => a.value === binding.action);
            const actionName = label ? label.label : binding.action;

            const text = document.createElement('span');
            text.textContent = bindingLabel(binding) + '  →  ' + actionName;
            text.style.color = 'var(--text-normal)';

            const delBtn = document.createElement('button');
            delBtn.textContent = t('settings.shortcuts.delete');
            delBtn.style.marginLeft = 'auto';
            delBtn.style.padding = '2px 8px';
            delBtn.style.border = '1px solid #e53935';
            delBtn.style.borderRadius = '3px';
            delBtn.style.background = 'transparent';
            delBtn.style.color = '#e53935';
            delBtn.style.cursor = 'pointer';
            delBtn.addEventListener('click', () => {
                this.settings.shortcuts.splice(i, 1);
                this.renderShortcutList(container);
            });

            row.appendChild(text);
            row.appendChild(delBtn);
            container.appendChild(row);
        }
    }

    private startAddShortcut(listContainer: HTMLElement): void {
        const recEl = document.createElement('div');
        recEl.style.marginTop = '8px';
        recEl.style.padding = '12px';
        recEl.style.border = '1px solid var(--accent-color)';
        recEl.style.borderRadius = '6px';
        recEl.style.background = 'var(--bg-secondary)';

        const label = document.createElement('span');
        label.textContent = t('settings.shortcuts.recording');
        label.style.color = 'var(--text-normal)';
        recEl.appendChild(label);

        let capturedBinding: ShortcutBinding | null = null;

        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const keyMap: Record<string, string> = {
                'Control': '', 'Shift': '', 'Alt': '', 'Meta': '',
            };
            if (e.key in keyMap) return;

            capturedBinding = {
                ctrl: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey,
                key: e.key.toLowerCase(),
                action: 'bold' as TextShortcutAction,
            };

            document.removeEventListener('keydown', handler, true);
            showEditor();
        };

        document.addEventListener('keydown', handler, true);

        const showEditor = () => {
            recEl.innerHTML = '';

            const binding = capturedBinding!;
            const keyLabel = document.createElement('span');
            keyLabel.textContent = t('settings.shortcuts.keyLabel') + bindingLabel(binding);
            keyLabel.style.color = 'var(--text-normal)';
            recEl.appendChild(keyLabel);

            const dropdown = document.createElement('select');
            dropdown.style.marginLeft = '8px';
            dropdown.style.padding = '2px 4px';
            dropdown.style.border = '1px solid var(--border-color)';
            dropdown.style.borderRadius = '3px';
            dropdown.style.background = 'var(--bg-primary)';
            dropdown.style.color = 'var(--text-normal)';

            for (const a of getShortcutActions()) {
                const opt = document.createElement('option');
                opt.value = a.value;
                opt.textContent = a.label;
                dropdown.appendChild(opt);
            }

            recEl.appendChild(dropdown);

            const btnRow = document.createElement('div');
            btnRow.style.marginTop = '8px';
            btnRow.style.display = 'flex';
            btnRow.style.gap = '8px';

            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = t('settings.shortcuts.confirm');
            confirmBtn.style.padding = '4px 12px';
            confirmBtn.style.border = 'none';
            confirmBtn.style.borderRadius = '3px';
            confirmBtn.style.background = 'var(--accent-color)';
            confirmBtn.style.color = 'white';
            confirmBtn.style.cursor = 'pointer';
            confirmBtn.addEventListener('click', async () => {
                binding.action = dropdown.value as TextShortcutAction;
                const idx = this.settings.shortcuts.findIndex(
                    b => b.ctrl === binding.ctrl && b.shift === binding.shift && b.alt === binding.alt && b.key === binding.key
                );
                if (idx >= 0) {
                    this.settings.shortcuts[idx] = binding;
                } else {
                    this.settings.shortcuts.push(binding);
                }
                recEl.remove();
                this.renderShortcutList(listContainer);
            });

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = t('settings.shortcuts.cancel');
            cancelBtn.style.padding = '4px 12px';
            cancelBtn.style.border = '1px solid var(--border-color)';
            cancelBtn.style.borderRadius = '3px';
            cancelBtn.style.background = 'transparent';
            cancelBtn.style.color = 'var(--text-normal)';
            cancelBtn.style.cursor = 'pointer';
            cancelBtn.addEventListener('click', () => {
                document.removeEventListener('keydown', handler, true);
                recEl.remove();
            });

            btnRow.appendChild(confirmBtn);
            btnRow.appendChild(cancelBtn);
            recEl.appendChild(btnRow);
        };

        // Insert before the add button
        const parent = listContainer.parentNode!;
        parent.insertBefore(recEl, listContainer.nextSibling);
    }
}
