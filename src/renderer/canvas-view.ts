// Canvas View — standalone version (no Obsidian dependency)

import { toCanvas } from 'html-to-image';
import { SimpleDrawEngine } from './engine';
import { ExportModal } from './export-modal';
import { SimpleDrawSettings, ShortcutBinding, actionToMarkdown } from './settings';
import { t } from './locale';
import { renderMarkdownToHTML } from './markdown-renderer';
import {
    SimpleDrawData, InteractionMode, ElementData, TextBoxData, ArrowData,
    AnchorType, ArrowConnection, FreePoint, ArrowDirection,
    GRID_SIZE, ANCHOR_SIZE, SNAP_DISTANCE,
    MIN_TEXTBOX_WIDTH, MIN_TEXTBOX_HEIGHT,
    DEFAULT_TEXTBOX_WIDTH, DEFAULT_TEXTBOX_HEIGHT,
    DEFAULT_DATA,
} from './types';

type ToastLevel = 'info' | 'error' | 'success';

function showToast(message: string, level: ToastLevel = 'info', duration: number = 3000): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${level}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

export class SimpleDrawCanvas {
    public engine: SimpleDrawEngine;
    public settings: SimpleDrawSettings;
    public currentFilePath: string | null = null;
    public isDirty: boolean = false;

    // DOM elements
    public containerEl: HTMLElement;
    public viewportEl: HTMLElement;
    public zoomLayerEl: HTMLElement;
    public gridEl: HTMLElement;
    public svgLayer: SVGElement;
    public elementsLayer: HTMLElement;
    public previewLayer: HTMLElement;
    public selectionBox: HTMLElement;
    public menuEl: HTMLElement;
    public textboxEditorEl: HTMLElement | null = null;
    public arrowEditorEl: HTMLElement | null = null;
    public labelEditorEl: HTMLElement | null = null;

    // Menu buttons
    public btnInsertTextbox: HTMLElement;
    public btnInsertArrow: HTMLElement;
    public btnFitView: HTMLElement;
    public btnClear: HTMLElement;
    public btnSnapToggle: HTMLElement;

    private animFrameId: number = 0;
    private needsRender: boolean = true;
    private lastCanvasMouse: { x: number; y: number } = { x: 0, y: 0 };
    private _resizeObserver: ResizeObserver | null = null;
    private _fallbackChannel: MessageChannel | null = null;

    // Direction menu
    directionMenuEl: HTMLElement | null = null;
    directionBtns: Map<string, HTMLElement> = new Map();

    // Title bar elements
    private titleFilepathEl: HTMLElement;
    private statusModeEl: HTMLElement;
    private statusZoomEl: HTMLElement;
    private statusElementsEl: HTMLElement;

    // Unsaved indicator
    private unsavedIndicator: HTMLElement;

    constructor(settings: SimpleDrawSettings) {
        this.settings = settings;
        this.engine = new SimpleDrawEngine(settings);
    }

    // --- Text Formatting Shortcuts ---

    private applyFormattingShortcut(e: KeyboardEvent, ta: HTMLTextAreaElement): boolean {
        const isCtrl = e.ctrlKey || e.metaKey;
        if (!isCtrl) return false;

        const shortcuts = this.settings.shortcuts || [];
        const key = e.key.toLowerCase();
        const code = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : key;
        const binding = shortcuts.find(
            (b: ShortcutBinding) => b.ctrl === isCtrl && b.shift === e.shiftKey && b.alt === e.altKey && (b.key === key || b.key === code)
        );
        if (!binding) return false;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const el = ta;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        const sel = val.substring(start, end);
        const meta = actionToMarkdown(binding.action, sel);

        if (meta.prompt) {
            const dialog = document.getElementById('link-prompt-dialog') as HTMLDialogElement;
            const input = document.getElementById('link-url') as HTMLInputElement;
            if (dialog && input) {
                input.value = '';
                dialog.showModal();
                const handleConfirm = () => {
                    const url = input.value;
                    if (url) {
                        const result = '[' + (sel || t('link.fallbackText')) + '](' + url + ')';
                        el.value = val.substring(0, start) + result + val.substring(end);
                        el.selectionStart = start;
                        el.selectionEnd = start + result.length;
                    }
                    dialog.removeEventListener('close', handleClose);
                };
                const handleCancel = () => {
                    dialog.removeEventListener('close', handleClose);
                };
                const handleClose = () => {
                    if (dialog.returnValue === 'confirm') handleConfirm();
                    else handleCancel();
                };
                dialog.addEventListener('close', handleClose, { once: true });
                document.getElementById('link-cancel')?.addEventListener('click', () => {
                    dialog.close('cancel');
                });
                document.getElementById('link-confirm')?.addEventListener('click', () => {
                    dialog.close('confirm');
                });
                input.focus();
            }
        } else {
            const w = meta.wrap;
            const result = w + sel + w;
            el.value = val.substring(0, start) + result + val.substring(end);
            el.selectionStart = start + w.length;
            el.selectionEnd = start + w.length + sel.length;
        }
        return true;
    }

    // --- Mount / Lifecycle ---

    mount(container: HTMLElement): void {
        this.buildDOM(container);
        this.setupEventListeners();
        this.setupEngineCallbacks();

        // Capture keydown at document level for text formatting shortcuts
        document.addEventListener('keydown', this.onCaptureKeyDown, true);

        // Initial render
        this.needsRender = true;
        this.animFrameId = 0;
        this.rebuildAll();
        this.startRenderLoop();
        this.containerEl.focus();

        // Get title bar elements
        this.titleFilepathEl = document.getElementById('titlebar-filepath')!;
        this.statusModeEl = document.getElementById('statusbar-mode')!;
        this.statusZoomEl = document.getElementById('statusbar-zoom')!;
        this.statusElementsEl = document.getElementById('statusbar-elements')!;

        this.unsavedIndicator = document.createElement('span');
        this.unsavedIndicator.id = 'unsaved-indicator';
        this.unsavedIndicator.textContent = ' ●';
        this.unsavedIndicator.style.color = '#e53935';
        this.unsavedIndicator.style.display = 'none';
        document.getElementById('titlebar-title')?.appendChild(this.unsavedIndicator);

        this.updateTitleBar();
        this.updateStatusBar();
    }

    unmount(): void {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = 0;
        }
        if (this._fallbackChannel) {
            this._fallbackChannel.port1.onmessage = null;
            this._fallbackChannel = null;
        }
        this.needsRender = false;
        this.closeEditors();
        this.hideDirectionMenu();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        document.removeEventListener('keydown', this.onCaptureKeyDown, true);
    }

    // --- DOM Construction ---

    buildDOM(container: HTMLElement): void {
        container.innerHTML = '';
        container.style.position = 'relative';
        container.style.overflow = 'hidden';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.userSelect = 'none';

        this.containerEl = container.createDiv('simpledraw-container');
        this.containerEl.style.width = '100%';
        this.containerEl.style.height = '100%';
        this.containerEl.style.position = 'relative';
        this.containerEl.style.overflow = 'hidden';
        this.containerEl.style.cursor = 'default';
        this.containerEl.setAttribute('tabindex', '0');

        this.viewportEl = this.containerEl.createDiv('simpledraw-viewport');
        this.viewportEl.style.position = 'absolute';
        this.viewportEl.style.transformOrigin = '0 0';
        this.viewportEl.style.width = '100%';
        this.viewportEl.style.height = '100%';

        // zoom 层 — 子元素在此层内被 zoom 属性高质量缩放
        this.zoomLayerEl = this.viewportEl.createDiv('simpledraw-zoom-layer');
        this.zoomLayerEl.style.position = 'absolute';
        this.zoomLayerEl.style.top = '0';
        this.zoomLayerEl.style.left = '0';
        this.zoomLayerEl.style.width = '100%';
        this.zoomLayerEl.style.height = '100%';
        this.zoomLayerEl.style.transformOrigin = '0 0';
        this.zoomLayerEl.style.overflow = 'visible';

        this.gridEl = this.zoomLayerEl.createDiv('simpledraw-grid');
        this.gridEl.style.position = 'absolute';
        this.gridEl.style.top = '-5000px';
        this.gridEl.style.left = '-5000px';
        this.gridEl.style.width = '10000px';
        this.gridEl.style.height = '10000px';
        this.gridEl.style.pointerEvents = 'none';
        this.gridEl.style.zIndex = '0';

        // SVG layer for arrows
        this.svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgLayer.classList.add('simpledraw-svg');
        this.svgLayer.style.position = 'absolute';
        this.svgLayer.style.top = '0';
        this.svgLayer.style.left = '0';
        this.svgLayer.style.width = '100%';
        this.svgLayer.style.height = '100%';
        this.svgLayer.style.pointerEvents = 'none';
        this.svgLayer.style.overflow = 'visible';
        this.zoomLayerEl.appendChild(this.svgLayer);

        // Elements layer for textboxes
        this.elementsLayer = this.zoomLayerEl.createDiv('simpledraw-elements');
        this.elementsLayer.style.position = 'absolute';
        this.elementsLayer.style.top = '0';
        this.elementsLayer.style.left = '0';
        this.elementsLayer.style.width = '100%';
        this.elementsLayer.style.height = '100%';
        this.elementsLayer.style.pointerEvents = 'none';
        this.elementsLayer.style.overflow = 'visible';
        this.elementsLayer.style.zIndex = '10';

        this.previewLayer = this.zoomLayerEl.createDiv('simpledraw-preview');
        this.previewLayer.style.position = 'absolute';
        this.previewLayer.style.top = '0';
        this.previewLayer.style.left = '0';
        this.previewLayer.style.width = '100%';
        this.previewLayer.style.height = '100%';
        this.previewLayer.style.pointerEvents = 'none';
        this.previewLayer.style.zIndex = '20';

        this.selectionBox = this.zoomLayerEl.createDiv('simpledraw-selection');
        this.selectionBox.style.position = 'absolute';
        this.selectionBox.style.border = '2px dashed #4a90d9';
        this.selectionBox.style.backgroundColor = 'rgba(74, 144, 217, 0.1)';
        this.selectionBox.style.display = 'none';
        this.selectionBox.style.pointerEvents = 'none';
        this.selectionBox.style.zIndex = '30';

        // Menu bar (top-left corner, outside viewport)
        this.menuEl = this.containerEl.createDiv('simpledraw-menu');
        this.menuEl.style.position = 'absolute';
        this.menuEl.style.top = '8px';
        this.menuEl.style.left = '8px';
        this.menuEl.style.zIndex = '100';
        this.menuEl.style.display = 'flex';
        this.menuEl.style.gap = '4px';
        this.menuEl.style.background = 'var(--bg-primary)';
        this.menuEl.style.border = '1px solid var(--border-color)';
        this.menuEl.style.borderRadius = '6px';
        this.menuEl.style.padding = '4px';
        this.menuEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';

        this.btnInsertTextbox = this.createMenuButton('T', t('toolbar.insertTextbox'));
        this.btnInsertArrow = this.createMenuButton('→', t('toolbar.insertArrow'));
        this.btnFitView = this.createMenuButton('⊞', t('toolbar.fitView'));
        this.btnClear = this.createMenuButton('✕', t('toolbar.clear'));
        this.btnSnapToggle = this.createMenuButton('⟷', t('toolbar.toggleSnap'));

        this.menuEl.appendChild(this.btnInsertTextbox);
        this.menuEl.appendChild(this.btnInsertArrow);
        this.menuEl.appendChild(this.btnFitView);
        this.menuEl.appendChild(this.btnClear);
        this.menuEl.appendChild(this.btnSnapToggle);

        // Store references in engine
        this.engine.container = this.containerEl;
        this.engine.svgLayer = this.svgLayer;
        this.engine.elementsLayer = this.elementsLayer;
        this.engine.previewLayer = this.previewLayer;
        this.engine.selectionBox = this.selectionBox;
    }

    createMenuButton(label: string, title: string): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'simpledraw-menu-btn';
        btn.textContent = label;
        btn.title = title;
        btn.style.width = '28px';
        btn.style.height = '28px';
        btn.style.border = '1px solid transparent';
        btn.style.borderRadius = '4px';
        btn.style.background = 'transparent';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.fontSize = '14px';
        btn.style.color = 'var(--text-normal)';
        return btn;
    }

    // --- Engine Callbacks ---

    setupEngineCallbacks(): void {
        this.engine.onChange = () => {
            this.markDirty();
            this.requestRender();
        };
        this.engine.onModeChange = () => {
            this.updateMenuButtons();
            if (this.engine.mode !== InteractionMode.InsertArrow) {
                this.hideDirectionMenu();
            }
            this.requestRender();
            this.updateStatusBar();
        };
        this.engine.onSelectionChange = () => {
            this.updateSelectionDisplay();
            this.requestRender();
            this.updateStatusBar();
        };
        this.engine.onEditTextbox = (id: string) => {
            this.startEditingTextbox(id);
        };
        this.engine.onEditArrow = (id: string) => {
            this.showArrowEditor(id);
        };
        this.engine.renderMarkdown = (markdown: string, el: HTMLElement, _sourcePath: string) => {
            renderMarkdownToHTML(markdown, el);
            return Promise.resolve();
        };
    }

    // --- Event Listeners ---

    setupEventListeners(): void {
        this.containerEl.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.containerEl.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.containerEl.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.containerEl.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
        this.containerEl.addEventListener('dblclick', this.onDblClick.bind(this));
        this.containerEl.addEventListener('contextmenu', this.onContextMenu.bind(this));
        this.containerEl.addEventListener('keydown', this.onKeyDown.bind(this));

        this.elementsLayer.addEventListener('dragstart', (e) => { e.preventDefault(); });

        this.btnInsertTextbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleTextboxMode();
        });
        this.btnInsertArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleArrowMode();
        });
        this.btnFitView.addEventListener('click', (e) => {
            e.stopPropagation();
            this.engine.fitToView();
            this.requestRender();
        });
        this.btnClear.addEventListener('click', (e) => {
            e.stopPropagation();
            this.engine.clearCanvas();
            this.rebuildAll();
        });

        this.updateSnapButton();
        this.btnSnapToggle.addEventListener('click', async (e) => {
            e.stopPropagation();
            this.settings.snapEnabled = !this.settings.snapEnabled;
            this.updateSnapButton();
            await this.saveSettings();
        });

        if (!this._resizeObserver) {
            this._resizeObserver = new ResizeObserver(() => {
                this.requestRender();
            });
        }
        this._resizeObserver.observe(this.containerEl);

        // Keyboard capture for text formatting shortcuts
        document.addEventListener('keydown', this.onCaptureKeyDown, true);
    }

    private onCaptureKeyDown = (e: KeyboardEvent): void => {
        if (!this.engine?.editingTextboxId) return;
        const ta = this.textboxEditorEl?.querySelector('textarea');
        if (!ta || document.activeElement !== ta) return;
        this.applyFormattingShortcut(e, ta as HTMLTextAreaElement);
    };

    // --- Mode Toggle ---

    toggleTextboxMode(): void {
        if (this.engine.mode === InteractionMode.InsertTextBox) {
            this.engine.setMode(InteractionMode.None);
        } else {
            this.engine.setMode(InteractionMode.InsertTextBox);
        }
        this.updateMenuButtons();
        this.updateStatusBar();
    }

    toggleArrowMode(): void {
        if (this.engine.mode === InteractionMode.InsertArrow) {
            this.engine.setMode(InteractionMode.None);
            this.hideDirectionMenu();
        } else {
            this.engine.setMode(InteractionMode.InsertArrow);
            this.showDirectionMenu();
        }
        this.updateMenuButtons();
        this.updateStatusBar();
    }

    // --- Direction Menu ---

    showDirectionMenu(): void {
        if (this.directionMenuEl) return;

        this.directionMenuEl = this.containerEl.createDiv('simpledraw-direction-menu');
        this.directionMenuEl.style.position = 'absolute';
        this.directionMenuEl.style.top = '48px';
        this.directionMenuEl.style.left = '8px';
        this.directionMenuEl.style.zIndex = '100';
        this.directionMenuEl.style.display = 'flex';
        this.directionMenuEl.style.flexDirection = 'column';
        this.directionMenuEl.style.gap = '2px';
        this.directionMenuEl.style.background = 'var(--bg-primary)';
        this.directionMenuEl.style.border = '1px solid var(--border-color)';
        this.directionMenuEl.style.borderRadius = '6px';
        this.directionMenuEl.style.padding = '4px';
        this.directionMenuEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';

        const label = this.directionMenuEl.createDiv();
        label.textContent = t('directionMenu.label');
        label.style.fontSize = '10px';
        label.style.color = 'var(--text-muted)';
        label.style.textAlign = 'center';
        label.style.marginBottom = '2px';

        const dirs: { dir: ArrowDirection; label: string }[] = [
            { dir: 'up', label: '↑' },
            { dir: 'down', label: '↓' },
            { dir: 'left', label: '←' },
            { dir: 'right', label: '→' },
        ];

        for (const d of dirs) {
            const btn = document.createElement('button');
            btn.textContent = d.label;
            btn.title = d.dir;
            btn.style.width = '28px';
            btn.style.height = '28px';
            btn.style.border = '1px solid transparent';
            btn.style.borderRadius = '4px';
            btn.style.background = this.engine.arrowDirection === d.dir ? 'var(--accent-bg)' : 'transparent';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '14px';
            btn.style.color = 'var(--text-normal)';
            btn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.engine.arrowDirection = d.dir;
                this.updateDirectionButtons();
            });
            this.directionMenuEl.appendChild(btn);
            this.directionBtns.set(d.dir, btn);
        }

        this.containerEl.addEventListener('keydown', this.onDirectionKey);
    }

    hideDirectionMenu(): void {
        if (this.directionMenuEl) {
            this.directionMenuEl.remove();
            this.directionMenuEl = null;
            this.directionBtns.clear();
        }
        this.containerEl.removeEventListener('keydown', this.onDirectionKey);
    }

    onDirectionKey = (e: KeyboardEvent): void => {
        if (this.engine.mode !== InteractionMode.InsertArrow) return;
        switch (e.key) {
            case 'ArrowUp': e.preventDefault(); this.engine.arrowDirection = 'up'; break;
            case 'ArrowDown': e.preventDefault(); this.engine.arrowDirection = 'down'; break;
            case 'ArrowLeft': e.preventDefault(); this.engine.arrowDirection = 'left'; break;
            case 'ArrowRight': e.preventDefault(); this.engine.arrowDirection = 'right'; break;
            default: return;
        }
        this.updateDirectionButtons();
    };

    updateDirectionButtons(): void {
        for (const [dir, btn] of this.directionBtns) {
            btn.style.background = this.engine.arrowDirection === dir ? 'var(--accent-bg)' : 'transparent';
        }
    }

    getTempConnection(x: number, y: number): ArrowConnection | FreePoint {
        const snapped = this.engine.findNearestAnchor(x, y);
        if (snapped) {
            return { elementId: snapped.elementId, anchor: snapped.anchor };
        }
        return { x, y };
    }

    updateMenuButtons(): void {
        const isTextboxMode = this.engine.mode === InteractionMode.InsertTextBox;
        const isArrowMode = this.engine.mode === InteractionMode.InsertArrow;

        this.btnInsertTextbox.style.borderColor = isTextboxMode ? 'var(--accent-color)' : 'transparent';
        this.btnInsertTextbox.style.background = isTextboxMode ? 'var(--accent-bg)' : 'transparent';

        this.btnInsertArrow.style.borderColor = isArrowMode ? 'var(--accent-color)' : 'transparent';
        this.btnInsertArrow.style.background = isArrowMode ? 'var(--accent-bg)' : 'transparent';
    }

    updateSnapButton(): void {
        const on = this.settings.snapEnabled;
        this.btnSnapToggle.style.borderColor = on ? 'var(--accent-color)' : 'transparent';
        this.btnSnapToggle.style.background = on ? 'var(--accent-bg)' : 'transparent';
        this.btnSnapToggle.style.opacity = on ? '1' : '0.5';
    }

    // --- Mouse Handlers ---

    onMouseDown(e: MouseEvent): void {
        const target = e.target as HTMLElement;

        if (target !== this.containerEl && target !== this.viewportEl &&
            !target.closest('.simpledraw-label-resize-handle') &&
            !target.closest('[data-arrow-label-id]') &&
            (target.closest('.simpledraw-menu') ||
             target.closest('.simpledraw-textbox-editor') ||
             target.closest('.simpledraw-arrow-editor') ||
             target.closest('.simpledraw-arrow-label-editor'))) {
            return;
        }

        this.containerEl.focus();
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);

        // Middle mouse button for panning
        if (e.button === 1) {
            e.preventDefault();
            this.engine.dragging = {
                type: 'pan',
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                startX: this.engine.data.viewState.panX,
                startY: this.engine.data.viewState.panY,
            };
            this.containerEl.style.cursor = 'grabbing';
            return;
        }

        if (e.button === 0) {
            this.handleLeftMouseDown(e, canvasPos);
        }
    }

    handleLeftMouseDown(e: MouseEvent, pos: { x: number; y: number }): void {
        const ctrlOrShift = e.ctrlKey || e.shiftKey;

        switch (this.engine.mode) {
            case InteractionMode.InsertTextBox:
                this.handleTextboxInsertDown(pos);
                break;
            case InteractionMode.InsertArrow:
                this.handleArrowInsertDown(pos);
                break;
            case InteractionMode.None:
                this.handleDefaultMouseDown(e, pos, ctrlOrShift);
                break;
        }
    }

    handleTextboxInsertDown(pos: { x: number; y: number }): void {
        if (!this.engine.textBoxInsertState.firstClick) {
            this.engine.textBoxInsertState.firstClick = { x: pos.x, y: pos.y };
            this.requestRender();
        } else {
            const first = this.engine.textBoxInsertState.firstClick;
            const x = Math.min(first.x, pos.x);
            const y = Math.min(first.y, pos.y);
            const w = Math.abs(pos.x - first.x);
            const h = Math.abs(pos.y - first.y);

            if (w < MIN_TEXTBOX_WIDTH && h < MIN_TEXTBOX_HEIGHT) {
                const cx = first.x;
                const cy = first.y;
                const id = this.engine.createTextBox(cx - DEFAULT_TEXTBOX_WIDTH/2, cy - DEFAULT_TEXTBOX_HEIGHT/2, DEFAULT_TEXTBOX_WIDTH, DEFAULT_TEXTBOX_HEIGHT);
                this.engine.setMode(InteractionMode.None);
                this.startEditingTextbox(id);
            } else {
                const id = this.engine.createTextBox(x, y, Math.max(w, MIN_TEXTBOX_WIDTH), Math.max(h, MIN_TEXTBOX_HEIGHT));
                this.engine.setMode(InteractionMode.None);
                this.startEditingTextbox(id);
            }
        }
    }

    handleArrowInsertDown(pos: { x: number; y: number }): void {
        if (!this.engine.arrowInsertState.firstClick) {
            const snapped = this.engine.findNearestAnchor(pos.x, pos.y);
            if (snapped) {
                this.engine.arrowInsertState.firstClick = { x: snapped.x, y: snapped.y };
            } else {
                this.engine.arrowInsertState.firstClick = { x: pos.x, y: pos.y };
            }
            this.engine.arrowInsertState.mouseX = pos.x;
            this.engine.arrowInsertState.mouseY = pos.y;
            this.requestRender();
        } else {
            const startX = this.engine.arrowInsertState.firstClick.x;
            const startY = this.engine.arrowInsertState.firstClick.y;
            const snapped = this.engine.findNearestAnchor(pos.x, pos.y);
            let endX = pos.x;
            let endY = pos.y;

            if (snapped) {
                endX = snapped.x;
                endY = snapped.y;
            }

            const startSnap = this.engine.findNearestAnchor(startX, startY);
            let startConn: ArrowConnection | FreePoint;
            if (startSnap) {
                startConn = { elementId: startSnap.elementId, anchor: startSnap.anchor };
            } else {
                startConn = { x: startX, y: startY };
            }

            let endConn: ArrowConnection | FreePoint;
            if (snapped) {
                endConn = { elementId: snapped.elementId, anchor: snapped.anchor };
            } else {
                endConn = { x: endX, y: endY };
            }

            this.engine.createArrow(startConn, endConn);
            this.engine.setMode(InteractionMode.None);
            this.hideDirectionMenu();
        }
    }

    handleDefaultMouseDown(e: MouseEvent, pos: { x: number; y: number }, additive: boolean): void {
        // 1. Arrow label resize handles (stay DOM-based for handle detection)
        const labelHandle = (e.target as HTMLElement).closest('[data-label-handle-id]') as HTMLElement | null;
        if (labelHandle) {
            const arrowId = labelHandle.dataset.labelHandleId!;
            const handle = labelHandle.dataset.handle!;
            const arrow = this.engine.data.elements.find(
                e => e.id === arrowId && e.type === 'arrow'
            ) as ArrowData | undefined;
            if (arrow && this.engine.selectedIds.has(arrowId)) {
                const labelDom = this.elementsLayer.querySelector(
                    `[data-arrow-label-id="arrow-label-${arrowId}"]`) as HTMLElement | null;
                const zoom = this.engine.data.viewState.zoom;
                const curW = labelDom ? labelDom.getBoundingClientRect().width / zoom : (arrow.labelWidth ?? 120);
                const curH = labelDom ? labelDom.getBoundingClientRect().height / zoom : (arrow.labelHeight ?? 30);
                this.engine.dragging = {
                    type: 'label-resize',
                    arrowId: arrowId,
                    startMouseX: pos.x,
                    startMouseY: pos.y,
                    startX: 0,
                    startY: 0,
                    startWidth: curW,
                    startHeight: curH,
                    resizeHandle: handle,
                };
                this.containerEl.style.cursor = 'nwse-resize';
                return;
            }
        }

        // 2. Label text click → 逻辑双击：未选中则选中，已选中则编辑
        const labelArrow = this.engine.getLabelAt(pos.x, pos.y);
        if (labelArrow) {
            if (this.engine.selectedIds.has(labelArrow.id)) {
                this.startArrowLabelEditor(labelArrow.id);
            } else {
                this.engine.selectElement(labelArrow.id, additive);
                this.requestRender();
            }
            return;
        }

        // 3. Close any open editors
        this.closeEditors();

        // 4. Check all textboxes for resize handle hits
        for (const el of this.engine.data.elements) {
            if (el.type !== 'textbox') continue;
            const tb = el as TextBoxData;
            if (tb.locked) continue;
            const handle = this.engine.getResizeHandle(tb, pos.x, pos.y);
            if (handle) {
                this.engine.selectElement(tb.id, additive);
                this.engine.dragging = {
                    type: 'resize',
                    startMouseX: pos.x,
                    startMouseY: pos.y,
                    startX: tb.x,
                    startY: tb.y,
                    startWidth: tb.width,
                    startHeight: tb.height,
                    resizeHandle: handle,
                    textboxId: tb.id,
                };
                this.containerEl.style.cursor = 'nwse-resize';
                return;
            }
        }

        // 5. Check if clicking on an element
        const clickedEl = this.engine.getElementAt(pos.x, pos.y);

        if (clickedEl) {
            // Locked textbox: select but do NOT start drag
            if (clickedEl.type === 'textbox' && (clickedEl as TextBoxData).locked) {
                if (additive) {
                    this.engine.selectElement(clickedEl.id, true);
                } else if (!this.engine.selectedIds.has(clickedEl.id)) {
                    this.engine.selectElement(clickedEl.id, false);
                }
                return;
            }

            if (additive) {
                this.engine.selectElement(clickedEl.id, true);
            } else if (!this.engine.selectedIds.has(clickedEl.id)) {
                this.engine.selectElement(clickedEl.id, false);
            }

            const idsToMove = new Set(this.engine.selectedIds);
            this.engine.dragging = {
                type: 'move',
                elementIds: idsToMove,
                startMouseX: e.clientX,
                startMouseY: e.clientY,
                startX: pos.x,
                startY: pos.y,
            };
            this.containerEl.style.cursor = 'move';
            return;
        }

        if (!additive) {
            this.engine.clearSelection();
        }

        this.engine.selectionState = {
            startX: pos.x,
            startY: pos.y,
            currentX: pos.x,
            currentY: pos.y,
            active: true,
        };

        this.engine.dragging = {
            type: 'move',
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startX: pos.x,
            startY: pos.y,
        };

        this.containerEl.style.cursor = 'crosshair';
    }

    onMouseMove(e: MouseEvent): void {
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);
        this.lastCanvasMouse = canvasPos;

        if (this.engine.mode === InteractionMode.InsertArrow) {
            this.engine.arrowInsertState.mouseX = canvasPos.x;
            this.engine.arrowInsertState.mouseY = canvasPos.y;
            if (this.engine.arrowInsertState.firstClick) {
                this.requestRender();
            } else {
                this.requestRender();
            }
        }

        if (this.engine.mode === InteractionMode.InsertTextBox && this.engine.textBoxInsertState.firstClick) {
            this.requestRender();
        }

        if (this.engine.dragging?.type === 'pan') {
            const dx = e.clientX - this.engine.dragging.startMouseX;
            const dy = e.clientY - this.engine.dragging.startMouseY;
            this.engine.data.viewState.panX = this.engine.dragging.startX + dx;
            this.engine.data.viewState.panY = this.engine.dragging.startY + dy;
            this.updateViewportTransform();
            return;
        }

        if (this.engine.dragging?.type === 'resize' && this.engine.dragging.textboxId) {
            const el = this.engine.data.elements.find(e => e.id === this.engine.dragging!.textboxId) as TextBoxData | undefined;
            if (el && this.engine.dragging.startWidth != null && this.engine.dragging.startHeight != null) {
                const handle = this.engine.dragging.resizeHandle;
                const dx = canvasPos.x - this.engine.dragging.startMouseX;
                const dy = canvasPos.y - this.engine.dragging.startMouseY;
                const origX = this.engine.dragging.startX;
                const origY = this.engine.dragging.startY;
                const origW = this.engine.dragging.startWidth;
                const origH = this.engine.dragging.startHeight;

                if (handle === 'se') {
                    el.width = Math.max(MIN_TEXTBOX_WIDTH, origW + dx);
                    el.height = Math.max(MIN_TEXTBOX_HEIGHT, origH + dy);
                } else if (handle === 'sw') {
                    const newW = Math.max(MIN_TEXTBOX_WIDTH, origW - dx);
                    el.x = origX + origW - newW;
                    el.width = newW;
                    el.height = Math.max(MIN_TEXTBOX_HEIGHT, origH + dy);
                } else if (handle === 'ne') {
                    el.width = Math.max(MIN_TEXTBOX_WIDTH, origW + dx);
                    const newH = Math.max(MIN_TEXTBOX_HEIGHT, origH - dy);
                    el.y = origY + origH - newH;
                    el.height = newH;
                } else if (handle === 'nw') {
                    const newW = Math.max(MIN_TEXTBOX_WIDTH, origW - dx);
                    el.x = origX + origW - newW;
                    el.width = newW;
                    const newH = Math.max(MIN_TEXTBOX_HEIGHT, origH - dy);
                    el.y = origY + origH - newH;
                    el.height = newH;
                }
                el.autoSize = false;
                if (this.settings.snapEnabled) {
                    this.engine.computeResizeSnap(el.id, handle!);
                }
                this.engine.notifyChange();
                this.requestRender();
            }
            return;
        }

        // Arrow label resize (symmetric around midpoint, delta-based with 2x factor)
        if (this.engine.dragging?.type === 'label-resize' && this.engine.dragging.arrowId) {
            const arrow = this.engine.data.elements.find(
                e => e.id === this.engine.dragging!.arrowId && e.type === 'arrow'
            ) as ArrowData | undefined;
            if (arrow && this.engine.dragging.startWidth != null && this.engine.dragging.startHeight != null) {
                const dx = canvasPos.x - this.engine.dragging.startMouseX;
                const dy = canvasPos.y - this.engine.dragging.startMouseY;
                const origW = this.engine.dragging.startWidth;
                const origH = this.engine.dragging.startHeight;
                arrow.labelWidth = Math.max(30, origW + 2 * dx);
                arrow.labelHeight = Math.max(12, origH + 2 * dy);
                this.engine.notifyChange();
                this.requestRender();
            }
            return;
        }

        if (this.engine.selectionState?.active) {
            this.engine.selectionState.currentX = canvasPos.x;
            this.engine.selectionState.currentY = canvasPos.y;
            this.requestRender();
            return;
        }

        if (this.engine.dragging?.type === 'move' && this.engine.dragging.elementIds) {
            const dx = canvasPos.x - this.engine.dragging.startX;
            const dy = canvasPos.y - this.engine.dragging.startY;

            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                this.engine.moveElements(this.engine.dragging.elementIds, dx, dy);
                this.engine.dragging.startX = canvasPos.x;
                this.engine.dragging.startY = canvasPos.y;
                if (this.settings.snapEnabled) {
                    this.engine.computeAlignmentPreview(this.engine.dragging.elementIds);
                }
                this.requestRender();
            }
            return;
        }
    }

    onMouseUp(e: MouseEvent): void {
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);

        if (this.engine.selectionState?.active && this.engine.dragging) {
            const additive = e.ctrlKey || e.shiftKey;
            this.engine.selectElementsInRect(
                this.engine.selectionState.startX,
                this.engine.selectionState.startY,
                canvasPos.x,
                canvasPos.y,
                additive
            );
            this.engine.selectionState = null;
            this.containerEl.style.cursor = 'default';
        }

        if (this.engine.dragging?.type === 'move' && this.engine.dragging.elementIds && this.settings.snapEnabled) {
            this.engine.applyAlignmentSnap(this.engine.dragging.elementIds);
        }
        if (this.engine.dragging?.type === 'resize' && this.engine.dragging.textboxId && this.engine.dragging.resizeHandle && this.settings.snapEnabled) {
            this.engine.applyResizeSnap(this.engine.dragging.textboxId, this.engine.dragging.resizeHandle);
        }

        if (this.engine.dragging && this.engine.dragging.type !== 'pan') {
            this.engine.saveHistory();
        }

        this.engine.clearAlignmentSnap();
        this.engine.clearResizeSnap();
        this.engine.dragging = null;
        this.containerEl.style.cursor = 'default';
        this.requestRender();
    }

    onWheel(e: WheelEvent): void {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.engine.zoomAt(e.clientX, e.clientY, e.deltaY);
            this.updateViewportTransform();
            this.updateStatusBar();
        }
    }

    onDblClick(e: MouseEvent): void {
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);

        // getLabelAt 兜底（仅用于浏览器仍能触达 dblclick 的场景）
        const labelArrow = this.engine.getLabelAt(canvasPos.x, canvasPos.y);
        if (labelArrow) {
            this.startArrowLabelEditor(labelArrow.id);
            return;
        }

        const el = this.engine.getElementAt(canvasPos.x, canvasPos.y);
        if (el && el.type === 'textbox') {
            this.startEditingTextbox(el.id);
        } else if (el && el.type === 'arrow') {
            this.showArrowEditor(el.id);
        }
    }

    onContextMenu(e: MouseEvent): void {
        e.preventDefault();
        const canvasPos = this.engine.screenToCanvas(e.clientX, e.clientY);
        const el = this.engine.getElementAt(canvasPos.x, canvasPos.y);
        if (!el || el.type !== 'textbox') return;

        if (!this.engine.selectedIds.has(el.id)) {
            this.engine.selectElement(el.id, false);
        }

        // Show custom context menu
        this.showCustomContextMenu(e.clientX, e.clientY, el.id);
    }

    showCustomContextMenu(x: number, y: number, elementId: string): void {
        const existing = document.querySelector('.custom-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'custom-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.zIndex = '10000';
        menu.style.background = 'var(--bg-primary)';
        menu.style.border = '1px solid var(--border-color)';
        menu.style.borderRadius = '6px';
        menu.style.padding = '4px';
        menu.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
        menu.style.minWidth = '120px';

        const bringToFront = menu.createDiv();
        bringToFront.textContent = t('contextMenu.bringToFront');
        bringToFront.style.padding = '6px 12px';
        bringToFront.style.cursor = 'pointer';
        bringToFront.style.borderRadius = '3px';
        bringToFront.addEventListener('mouseenter', () => { bringToFront.style.background = 'var(--hover-bg)'; });
        bringToFront.addEventListener('mouseleave', () => { bringToFront.style.background = ''; });
        bringToFront.addEventListener('click', () => {
            this.engine.sendTextboxToFront(elementId);
            this.rebuildAll();
            menu.remove();
        });

        const sendToBack = menu.createDiv();
        sendToBack.textContent = t('contextMenu.sendToBack');
        sendToBack.style.padding = '6px 12px';
        sendToBack.style.cursor = 'pointer';
        sendToBack.style.borderRadius = '3px';
        sendToBack.addEventListener('mouseenter', () => { sendToBack.style.background = 'var(--hover-bg)'; });
        sendToBack.addEventListener('mouseleave', () => { sendToBack.style.background = ''; });
        sendToBack.addEventListener('click', () => {
            this.engine.sendTextboxToBack(elementId);
            this.rebuildAll();
            menu.remove();
        });

        menu.appendChild(bringToFront);
        menu.appendChild(sendToBack);

        const tbEl = this.engine.data.elements.find(e => e.id === elementId && e.type === 'textbox') as TextBoxData | undefined;
        if (tbEl) {
            const lockItem = menu.createDiv();
            lockItem.textContent = tbEl.locked ? t('contextMenu.unlock') : t('contextMenu.lock');
            lockItem.style.padding = '6px 12px';
            lockItem.style.cursor = 'pointer';
            lockItem.style.borderRadius = '3px';
            lockItem.addEventListener('mouseenter', () => { lockItem.style.background = 'var(--hover-bg)'; });
            lockItem.addEventListener('mouseleave', () => { lockItem.style.background = ''; });
            lockItem.addEventListener('click', () => {
                tbEl.locked = !tbEl.locked;
                this.rebuildAll();
                menu.remove();
            });
            menu.appendChild(lockItem);
        }

        document.body.appendChild(menu);

        const closeMenu = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('mousedown', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeMenu), 0);
    }

    onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            this.engine.cancelCurrentMode();
            this.closeEditors();
            this.updateMenuButtons();
            this.requestRender();
            return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.engine.editingTextboxId) return;
            if (this.engine.editingArrowId) return;
            if (this.engine.labelEditorArrowId) return;
            if (this.engine.selectedIds.size > 0) {
                const toDelete = new Set<string>();
                for (const id of this.engine.selectedIds) {
                    const el = this.engine.data.elements.find(e => e.id === id);
                    if (el?.type === 'textbox' && (el as TextBoxData).locked) continue;
                    toDelete.add(id);
                }
                if (toDelete.size > 0) {
                    this.engine.deleteElements(toDelete);
                    this.closeEditors();
                    this.requestRender();
                }
            }
            return;
        }

        // When editing label textarea, let browser handle all keys natively
        if (this.engine.labelEditorArrowId) {
            return;
        }

        // Undo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            if (this.engine.editingTextboxId || this.engine.editingArrowId) return;
            e.preventDefault();
            this.engine.undo();
            this.rebuildAll();
            this.updateStatusBar();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' && e.shiftKey || e.key === 'Z')) {
            if (this.engine.editingTextboxId || this.engine.editingArrowId) return;
            e.preventDefault();
            this.engine.redo();
            this.rebuildAll();
            this.updateStatusBar();
            return;
        }

        if (this.engine.editingTextboxId) {
            return;
        }

        // Copy
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            if (this.engine.editingArrowId) return;
            if (this.engine.selectedIds.size > 0) {
                e.preventDefault();
                this.copySelectedElements();
            }
            return;
        }

        // Paste
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            if (this.engine.editingArrowId) return;
            e.preventDefault();
            this.pasteFromClipboard();
            return;
        }
    }

    // --- Textbox Editor ---

    startEditingTextbox(id: string): void {
        const el = this.engine.data.elements.find(e => e.id === id && e.type === 'textbox') as TextBoxData | undefined;
        if (!el) return;

        this.closeEditors();
        this.engine.editingTextboxId = id;

        this.textboxEditorEl = this.containerEl.createDiv('simpledraw-textbox-editor');
        this.textboxEditorEl.style.position = 'absolute';
        this.textboxEditorEl.style.zIndex = '200';
        this.textboxEditorEl.style.background = 'var(--bg-primary)';
        this.textboxEditorEl.style.border = '2px solid var(--accent-color)';
        this.textboxEditorEl.style.borderRadius = '4px';
        this.textboxEditorEl.style.padding = '8px';
        this.textboxEditorEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
        this.textboxEditorEl.style.minWidth = '250px';
        this.textboxEditorEl.style.maxWidth = '500px';

        this.positionTextboxEditor(el);

        // Row 1: basic formatting controls
        const toolbar1 = this.textboxEditorEl.createDiv('simpledraw-editor-toolbar');
        toolbar1.style.display = 'flex';
        toolbar1.style.gap = '4px';
        toolbar1.style.marginBottom = '6px';
        toolbar1.style.alignItems = 'center';

        // Visibility toggle
        const visBtn = this.createSmallButton(el.visible ? '👁' : '👁‍🗨', t('textboxEditor.toggleVisibility'));
        visBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            el.visible = !el.visible;
            visBtn.textContent = el.visible ? '👁' : '👁‍🗨';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar1.appendChild(visBtn);

        // Fill toggle
        const fillBtn = this.createSmallButton(el.fillEnabled ? '▣' : '□', t('textboxEditor.toggleFill'));
        fillBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            el.fillEnabled = !el.fillEnabled;
            if (el.fillEnabled) {
                el.visible = true;
                visBtn.textContent = '👁';
            }
            fillBtn.textContent = el.fillEnabled ? '▣' : '□';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar1.appendChild(fillBtn);

        // Alignment buttons
        const alignGroup = document.createElement('div');
        alignGroup.style.display = 'flex';
        alignGroup.style.gap = '2px';
        alignGroup.style.marginLeft = '8px';
        alignGroup.style.borderLeft = '1px solid var(--border-color)';
        alignGroup.style.paddingLeft = '8px';

        const vAligns: { label: string; value: 'top' | 'middle' | 'bottom'; title: string }[] = [
            { label: '⊤', value: 'top', title: t('textboxEditor.align.top') },
            { label: '⊟', value: 'middle', title: t('textboxEditor.align.middle') },
            { label: '⊥', value: 'bottom', title: t('textboxEditor.align.bottom') },
        ];
        const hAligns: { label: string; value: 'left' | 'center' | 'right'; title: string }[] = [
            { label: '⊏', value: 'left', title: t('textboxEditor.align.left') },
            { label: '⊜', value: 'center', title: t('textboxEditor.align.center') },
            { label: '⊐', value: 'right', title: t('textboxEditor.align.right') },
        ];

        const vAlignBtns: HTMLElement[] = [];
        const hAlignBtns: HTMLElement[] = [];

        const updateAlignHighlights = () => {
            for (let i = 0; i < vAligns.length; i++) {
                const btn = vAlignBtns[i];
                if (btn) btn.style.background = el.vAlign === vAligns[i]!.value ? 'var(--accent-bg)' : 'transparent';
            }
            for (let i = 0; i < hAligns.length; i++) {
                const btn = hAlignBtns[i];
                if (btn) btn.style.background = el.hAlign === hAligns[i]!.value ? 'var(--accent-bg)' : 'transparent';
            }
        };

        for (const a of vAligns) {
            const btn = this.createSmallButton(a.label, a.title);
            vAlignBtns.push(btn);
            btn.addEventListener('click', () => {
                el.vAlign = a.value;
                updateAlignHighlights();
                this.engine.notifyChange();
                this.requestRender();
            });
            alignGroup.appendChild(btn);
        }

        for (const a of hAligns) {
            const btn = this.createSmallButton(a.label, a.title);
            hAlignBtns.push(btn);
            btn.addEventListener('click', () => {
                el.hAlign = a.value;
                updateAlignHighlights();
                this.engine.notifyChange();
                this.requestRender();
            });
            alignGroup.appendChild(btn);
        }

        updateAlignHighlights();
        toolbar1.appendChild(alignGroup);

        // Writing mode toggle
        const wmBtn = this.createSmallButton(t('textboxEditor.writingModeLabel'), t('textboxEditor.writingMode'));
        const updateWmBtn = () => {
            wmBtn.style.background = (el.writingMode ?? 'horizontal-tb') === 'vertical-rl'
                ? 'var(--accent-bg)' : 'transparent';
        };
        updateWmBtn();
        wmBtn.addEventListener('click', () => {
            el.writingMode = (el.writingMode ?? 'horizontal-tb') === 'vertical-rl'
                ? 'horizontal-tb' : 'vertical-rl';
            updateWmBtn();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar1.appendChild(wmBtn);

        // Shape selector
        const shapes: { label: string; value: string; titleKey: string }[] = [
            { label: '□', value: 'rectangle', titleKey: 'textboxEditor.shape.rectangle' },
            { label: '○', value: 'ellipse', titleKey: 'textboxEditor.shape.ellipse' },
            { label: '◇', value: 'diamond', titleKey: 'textboxEditor.shape.diamond' },
        ];
        const shapeBtns: HTMLElement[] = [];
        const updateShapeHighlights = () => {
            const cur = el.shape ?? 'rectangle';
            for (let i = 0; i < shapes.length; i++) {
                shapeBtns[i]!.style.background = shapes[i]!.value === cur
                    ? 'var(--accent-bg)' : 'transparent';
            }
        };
        for (const s of shapes) {
            const btn = this.createSmallButton(s.label, t(s.titleKey));
            shapeBtns.push(btn);
            btn.addEventListener('click', () => {
                el.shape = s.value as any;
                updateShapeHighlights();
                this.engine.saveHistory();
                this.engine.notifyChange();
                this.requestRender();
            });
            toolbar1.appendChild(btn);
        }
        updateShapeHighlights();

        // Lock toggle
        const lockBtn = this.createSmallButton(
            el.locked ? '🔒' : '🔓',
            t('textboxEditor.toggleLock')
        );
        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            el.locked = !el.locked;
            lockBtn.textContent = el.locked ? '🔒' : '🔓';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        toolbar1.appendChild(lockBtn);

        // Confirm button
        const confirmBtn = this.createSmallButton('✓', t('textboxEditor.confirm'));
        confirmBtn.style.background = 'var(--accent-color)';
        confirmBtn.style.color = 'white';
        confirmBtn.addEventListener('click', () => {
            this.closeEditors();
            this.requestRender();
        });
        toolbar1.appendChild(confirmBtn);

        // Row 2: image insert + font size
        const toolbar2 = this.textboxEditorEl.createDiv('simpledraw-editor-toolbar');
        toolbar2.style.display = 'flex';
        toolbar2.style.gap = '4px';
        toolbar2.style.marginBottom = '8px';
        toolbar2.style.alignItems = 'center';

        // Insert Image button
        const imgBtn = this.createSmallButton('图', t('textboxEditor.insertImage'));
        imgBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const filePath = await window.simpledraw.file.pickImage();
                if (!filePath) return;
                let scale = '100';
                if (this.settings.showImageScalePrompt) {
                    const input = await this.showWidthDialog();
                    if (input === null) return; // user cancelled
                    if (input) scale = input;
                }
                const suffix = this.settings.imageScaleWithTextBox ? '%' : 'px';
                let syntax = `<img src="${filePath}"`;
                if (scale && !isNaN(Number(scale)) && Number(scale) > 0) {
                    syntax += ` width="${Number(scale)}${suffix}"`;
                }
                syntax += `>`;
                const textarea = this.textboxEditorEl?.querySelector('textarea');
                if (textarea) {
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    textarea.value = textarea.value.substring(0, start) + syntax + textarea.value.substring(end);
                    textarea.selectionStart = textarea.selectionEnd = start + syntax.length;
                    textarea.focus();
                    // 直接更新编辑中的文本框数据并触发布局重绘
                    el.content = textarea.value;
                    this.engine.saveHistory();
                    this.engine.notifyChange();
                }
            } catch (err) {
                console.error('插入图片失败:', err);
            }
        });
        toolbar2.appendChild(imgBtn);

        // Separator
        const sep = toolbar2.createDiv();
        sep.style.width = '1px';
        sep.style.height = '20px';
        sep.style.background = 'var(--border-color)';
        sep.style.margin = '0 4px';
        toolbar2.appendChild(sep);

        // Font size controls
        const sizeDisplay = toolbar2.createSpan();
        sizeDisplay.textContent = (el.fontSize ?? 16) + 'px';
        sizeDisplay.style.fontSize = '12px';
        sizeDisplay.style.color = 'var(--text-muted)';
        sizeDisplay.style.marginRight = '2px';
        sizeDisplay.style.minWidth = '30px';
        sizeDisplay.style.textAlign = 'right';

        const updateSizeDisplay = () => {
            sizeDisplay.textContent = (el.fontSize ?? 16) + 'px';
        };

        const shrinkBtn = this.createSmallButton('A-', t('textboxEditor.fontSize.shrink'));
        shrinkBtn.addEventListener('click', () => {
            el.fontSize = Math.max(8, (el.fontSize ?? 16) - 2);
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        const growBtn = this.createSmallButton('A+', t('textboxEditor.fontSize.grow'));
        growBtn.addEventListener('click', () => {
            el.fontSize = Math.min(72, (el.fontSize ?? 16) + 2);
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        const resetBtn = this.createSmallButton('R', t('textboxEditor.fontSize.reset'));
        resetBtn.addEventListener('click', () => {
            el.fontSize = this.settings.textboxDefaultFontSize ?? 16;
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        toolbar2.appendChild(sizeDisplay);
        toolbar2.appendChild(shrinkBtn);
        toolbar2.appendChild(growBtn);
        toolbar2.appendChild(resetBtn);

        // Textarea
        const textarea = this.textboxEditorEl.createEl('textarea');
        textarea.style.width = '100%';
        textarea.style.minHeight = '100px';
        textarea.style.resize = 'both';
        textarea.style.border = '1px solid var(--border-color)';
        textarea.style.borderRadius = '4px';
        textarea.style.padding = '6px';
        textarea.style.background = 'var(--bg-primary)';
        textarea.style.color = 'var(--text-normal)';
        textarea.style.fontFamily = 'var(--font-family)';
        textarea.style.fontSize = (this.settings.textboxDefaultFontSize ?? 16) + 'px';
        textarea.value = el.content;
        // Immediately grow to fit existing content
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(100, textarea.scrollHeight) + 'px';
        textarea.focus();

        textarea.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.stopPropagation();
                this.closeEditors();
                this.requestRender();
                return;
            }
            if (this.applyFormattingShortcut(ev, textarea)) return;
        });

        textarea.addEventListener('input', () => {
            el.content = textarea.value;
            textarea.style.height = 'auto';
            textarea.style.height = Math.max(100, textarea.scrollHeight) + 'px';
            this.requestRender();
        });

        this.requestRender();
    }

    autoSizeTextbox(el: TextBoxData): void {
        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.width = el.width + 'px';
        temp.style.wordWrap = 'break-word';
        temp.style.fontFamily = 'var(--font-family)';
        temp.style.fontSize = (el.fontSize ?? 16) + 'px';
        temp.style.padding = '8px';
        temp.style.boxSizing = 'border-box';
        temp.textContent = el.content || ' ';
        document.body.appendChild(temp);

        const scrollHeight = temp.scrollHeight;
        const scrollWidth = temp.scrollWidth;
        document.body.removeChild(temp);

        el.width = Math.max(MIN_TEXTBOX_WIDTH, Math.min(scrollWidth + 20, 600));
        el.height = Math.max(MIN_TEXTBOX_HEIGHT, Math.min(scrollHeight + 10, 400));
    }

    positionTextboxEditor(el: TextBoxData): void {
        if (!this.textboxEditorEl) return;
        const screen = this.engine.canvasToScreen(el.x, el.y);
        const viewRect = this.containerEl.getBoundingClientRect();

        let left = Math.max(0, screen.x);
        const editorHeight = 200;
        let top = screen.y + el.height * this.engine.data.viewState.zoom + 5;
        if (top + editorHeight > viewRect.height) {
            top = screen.y - editorHeight;
        }
        top = Math.max(0, top);

        this.textboxEditorEl.style.left = left + 'px';
        this.textboxEditorEl.style.top = top + 'px';
    }

    createSmallButton(label: string, title: string): HTMLElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.title = title;
        btn.style.width = '24px';
        btn.style.height = '24px';
        btn.style.border = '1px solid transparent';
        btn.style.borderRadius = '3px';
        btn.style.background = 'transparent';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.color = 'var(--text-normal)';
        return btn;
    }

    /** 弹出图片缩放比例输入对话框（替代 Electron 中已移除的 window.prompt） */
    private async showWidthDialog(): Promise<string | null> {
        return new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.style.border = 'none';
            dialog.style.borderRadius = '8px';
            dialog.style.padding = '0';
            dialog.style.background = 'transparent';
            dialog.innerHTML = `
                <div style="padding:16px;background:var(--bg-primary);color:var(--text-normal);border-radius:8px">
                    <div style="margin-bottom:4px;font-size:14px">${t('insertImage.width')}</div>
                    <div style="margin-bottom:12px;font-size:12px;color:var(--text-muted)">${t('insertImage.widthPlaceholder')}</div>
                    <div style="display:flex;align-items:center;gap:4px">
                        <input type="number" min="1" max="200" id="sd-width-input" value="100"
                            style="flex:1;padding:6px;box-sizing:border-box;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-primary);color:var(--text-normal)">
                        <span style="font-size:14px;color:var(--text-muted)">%</span>
                    </div>
                    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
                        <button id="sd-prompt-cancel" style="padding:4px 12px;border:1px solid var(--border-color);border-radius:4px;background:transparent;color:var(--text-normal);cursor:pointer">${t('common.cancel')}</button>
                        <button id="sd-prompt-ok" style="padding:4px 12px;border:none;border-radius:4px;background:var(--accent-color);color:white;cursor:pointer">${t('common.confirm')}</button>
                    </div>
                </div>`;
            document.body.appendChild(dialog);

            const input = dialog.querySelector('#sd-width-input') as HTMLInputElement;
            dialog.querySelector('#sd-prompt-cancel')!.addEventListener('click', () => { dialog.close(); resolve(null); });
            dialog.querySelector('#sd-prompt-ok')!.addEventListener('click', () => { dialog.close(); resolve(input.value); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { dialog.close(); resolve(input.value); }
                if (e.key === 'Escape') { dialog.close(); resolve(null); }
            });
            dialog.addEventListener('close', () => {
                resolve(null);
                dialog.remove();
            });

            dialog.showModal();
            input.focus();
            input.select();
        });
    }

    // --- Arrow Editor ---

    showArrowEditor(id: string): void {
        const el = this.engine.data.elements.find(e => e.id === id && e.type === 'arrow') as ArrowData | undefined;
        if (!el) return;

        this.closeEditors();
        this.engine.editingArrowId = id;

        const start = this.engine.resolveConnection(el.startConnection);
        const screen = this.engine.canvasToScreen(start.x, start.y);

        this.arrowEditorEl = this.containerEl.createDiv('simpledraw-arrow-editor');
        this.arrowEditorEl.style.position = 'absolute';
        this.arrowEditorEl.style.zIndex = '200';
        this.arrowEditorEl.style.background = 'var(--bg-primary)';
        this.arrowEditorEl.style.border = '2px solid var(--accent-color)';
        this.arrowEditorEl.style.borderRadius = '4px';
        this.arrowEditorEl.style.padding = '4px';
        this.arrowEditorEl.style.display = 'flex';
        this.arrowEditorEl.style.gap = '4px';
        this.arrowEditorEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
        this.arrowEditorEl.style.left = Math.max(0, screen.x) + 'px';
        this.arrowEditorEl.style.top = Math.max(0, screen.y - 40) + 'px';

        const startBtn = this.createSmallButton(el.showStartArrow ? '◀' : '—', t('arrowEditor.toggleStart'));
        startBtn.addEventListener('click', () => {
            el.showStartArrow = !el.showStartArrow;
            startBtn.textContent = el.showStartArrow ? '◀' : '—';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(startBtn);

        const endBtn = this.createSmallButton(el.showEndArrow ? '▶' : '—', t('arrowEditor.toggleEnd'));
        endBtn.addEventListener('click', () => {
            el.showEndArrow = !el.showEndArrow;
            endBtn.textContent = el.showEndArrow ? '▶' : '—';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(endBtn);

        const dashBtn = this.createSmallButton(el.dashed ? '┅' : '━', t('arrowEditor.toggleDash'));
        dashBtn.addEventListener('click', () => {
            el.dashed = !el.dashed;
            dashBtn.textContent = el.dashed ? '┅' : '━';
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(dashBtn);

        const labelBtn = this.createSmallButton('T', t('arrowEditor.toggleLabel'));
        labelBtn.style.fontWeight = 'bold';
        labelBtn.addEventListener('click', () => {
            el.labelVisible = !el.labelVisible;
            if (el.labelVisible && !el.labelContent) {
                this.closeEditors();
                this.startArrowLabelEditor(id);
            } else {
                this.engine.saveHistory();
                this.engine.notifyChange();
                this.requestRender();
            }
        });
        this.arrowEditorEl.appendChild(labelBtn);

        const delBtn = this.createSmallButton('✕', t('arrowEditor.delete'));
        delBtn.addEventListener('click', () => {
            this.engine.deleteElement(id);
            this.closeEditors();
            this.requestRender();
        });
        this.arrowEditorEl.appendChild(delBtn);
    }

    startArrowLabelEditor(arrowId: string): void {
        const arrow = this.engine.data.elements.find(e => e.id === arrowId && e.type === 'arrow') as ArrowData | undefined;
        if (!arrow) return;

        this.closeEditors();
        this.engine.labelEditorArrowId = arrowId;
        arrow.labelVisible = true;

        const mid = this.engine.getArrowMidpoint(arrow);
        const screen = this.engine.canvasToScreen(mid.x, mid.y);

        this.labelEditorEl = this.containerEl.createDiv('simpledraw-arrow-label-editor');
        this.labelEditorEl.style.left = Math.max(0, screen.x - 100) + 'px';
        this.labelEditorEl.style.top = Math.max(0, screen.y - 20) + 'px';
        this.labelEditorEl.style.display = 'block';
        this.labelEditorEl.style.minWidth = '200px';
        this.labelEditorEl.style.maxWidth = '500px';

        // Row 1: font size controls + confirm (above textarea)
        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.gap = '4px';
        toolbar.style.alignItems = 'center';
        toolbar.style.marginBottom = '8px';
        this.labelEditorEl.appendChild(toolbar);

        // Row 2: textarea (below toolbar)
        const textarea = document.createElement('textarea');
        textarea.value = arrow.labelContent ?? '';
        // Immediately grow to fit existing content
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
        textarea.placeholder = t('arrowLabelEditor.placeholder');
        textarea.style.width = '100%';
        textarea.style.minHeight = '60px';
        textarea.style.resize = 'both';
        textarea.style.border = '1px solid var(--border-color)';
        textarea.style.borderRadius = '4px';
        textarea.style.padding = '6px';
        textarea.style.background = 'var(--bg-primary)';
        textarea.style.color = 'var(--text-normal)';
        textarea.style.fontSize = (arrow.labelFontSize ?? 16) + 'px';
        textarea.style.fontFamily = 'inherit';
        textarea.style.boxSizing = 'border-box';
        this.labelEditorEl.appendChild(textarea);

        // Font size controls + confirm
        const sizeDisplay = document.createElement('span');
        sizeDisplay.textContent = (arrow.labelFontSize ?? 16) + 'px';
        sizeDisplay.style.fontSize = '12px';
        sizeDisplay.style.color = 'var(--text-muted)';
        sizeDisplay.style.minWidth = '30px';
        sizeDisplay.style.textAlign = 'right';

        const updateSizeDisplay = () => {
            sizeDisplay.textContent = (arrow.labelFontSize ?? 16) + 'px';
        };

        const shrinkBtn = this.createSmallButton('A-', t('textboxEditor.fontSize.shrink'));
        shrinkBtn.addEventListener('click', () => {
            arrow.labelFontSize = Math.max(8, (arrow.labelFontSize ?? 16) - 2);
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        const growBtn = this.createSmallButton('A+', t('textboxEditor.fontSize.grow'));
        growBtn.addEventListener('click', () => {
            arrow.labelFontSize = Math.min(72, (arrow.labelFontSize ?? 16) + 2);
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        const resetBtn = this.createSmallButton('R', t('textboxEditor.fontSize.reset'));
        resetBtn.addEventListener('click', () => {
            arrow.labelFontSize = 16;
            updateSizeDisplay();
            this.engine.saveHistory();
            this.engine.notifyChange();
            this.requestRender();
        });

        toolbar.appendChild(sizeDisplay);
        toolbar.appendChild(shrinkBtn);
        toolbar.appendChild(growBtn);
        toolbar.appendChild(resetBtn);

        // Position toggle buttons
        const positions: Array<{ key: 'overlap' | 'above' | 'below'; icon: string }> = [
            { key: 'overlap', icon: '⊥' },
            { key: 'above', icon: '↑' },
            { key: 'below', icon: '↓' },
        ];
        const currentPos = arrow.labelPosition ?? 'overlap';
        for (const p of positions) {
            const posBtn = this.createSmallButton(p.icon, t('arrowLabelEditor.position.' + p.key));
            posBtn.style.marginLeft = p.key === 'overlap' ? '8px' : '0';
            if (p.key === currentPos) {
                posBtn.style.background = 'var(--accent)';
                posBtn.style.color = 'var(--accent-text)';
            }
            posBtn.addEventListener('click', () => {
                arrow.labelPosition = p.key;
                this.engine.saveHistory();
                this.engine.notifyChange();
                this.requestRender();
                this.startArrowLabelEditor(arrowId);
            });
            toolbar.appendChild(posBtn);
        }

        const doneBtn = this.createSmallButton('✓', t('arrowLabelEditor.confirm'));
        doneBtn.style.marginLeft = 'auto';
        doneBtn.addEventListener('click', () => {
            this.closeEditors();
            this.requestRender();
        });
        toolbar.appendChild(doneBtn);

        textarea.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.stopPropagation();
                this.closeEditors();
                this.requestRender();
                return;
            }
        });

        textarea.addEventListener('input', () => {
            arrow.labelContent = textarea.value;
            textarea.style.height = 'auto';
            textarea.style.height = Math.max(60, textarea.scrollHeight) + 'px';
            this.requestRender();
        });

        textarea.focus();
        textarea.select();
    }

    closeEditors(): void {
        // Save textbox editor
        if (this.textboxEditorEl && this.engine.editingTextboxId) {
            const textarea = this.textboxEditorEl.querySelector('textarea') as HTMLTextAreaElement | null;
            if (textarea) {
                const el = this.engine.data.elements.find(
                    e => e.id === this.engine.editingTextboxId && e.type === 'textbox'
                ) as TextBoxData | undefined;
                if (el) {
                    const newContent = textarea.value;
                    if (el.content !== newContent) {
                        el.content = newContent;
                        if (el.autoSize && newContent.trim()) {
                            this.autoSizeTextbox(el);
                        }
                        this.engine.saveHistory();
                        this.engine.notifyChange();
                    }
                }
            }
        }

        // Save label editor
        if (this.labelEditorEl && this.engine.labelEditorArrowId) {
            const textarea = this.labelEditorEl.querySelector('textarea') as HTMLTextAreaElement | null;
            if (textarea) {
                const arrow = this.engine.data.elements.find(
                    e => e.id === this.engine.labelEditorArrowId && e.type === 'arrow'
                ) as ArrowData | undefined;
                if (arrow) {
                    const value = textarea.value;
                    if (value.trim()) {
                        arrow.labelContent = value;
                        this.engine.saveHistory();
                    } else {
                        arrow.labelContent = undefined;
                        arrow.labelVisible = false;
                        this.engine.saveHistory();
                    }
                    this.engine.notifyChange();
                }
            }
        }

        if (this.textboxEditorEl) {
            this.textboxEditorEl.remove();
            this.textboxEditorEl = null;
        }
        if (this.arrowEditorEl) {
            this.arrowEditorEl.remove();
            this.arrowEditorEl = null;
        }
        if (this.labelEditorEl) {
            this.labelEditorEl.remove();
            this.labelEditorEl = null;
        }
        this.engine.editingTextboxId = null;
        this.engine.editingArrowId = null;
        this.engine.labelEditorArrowId = null;
    }

    // --- Markdown Rendering in Textboxes ---

    async renderMarkdownInElement(markdown: string, el: HTMLElement): Promise<void> {
        renderMarkdownToHTML(markdown, el);
    }

    async rebuildTextboxContent(id: string): Promise<void> {
        const tb = this.engine.data.elements.find(e => e.id === id && e.type === 'textbox') as TextBoxData | undefined;
        if (tb) {
            this.renderTextboxDOM(tb);
        }
    }

    applyTextAlignment(el: HTMLElement, tb: TextBoxData): void {
        const parent = el.parentElement;
        if (parent) {
            parent.style.display = '';
            parent.style.justifyContent = '';
            parent.style.alignItems = '';
        }

        const isVertical = (tb.writingMode ?? 'horizontal-tb') === 'vertical-rl';
        el.style.writingMode = tb.writingMode ?? 'horizontal-tb';

        el.style.display = 'flex';
        el.style.flexDirection = isVertical ? 'row' : 'column';
        el.style.width = '100%';
        el.style.height = '100%';

        if (isVertical) {
            switch (tb.vAlign) {
                case 'top': el.style.justifyContent = 'flex-start'; break;
                case 'middle': el.style.justifyContent = 'center'; break;
                case 'bottom': el.style.justifyContent = 'flex-end'; break;
            }
            switch (tb.hAlign) {
                case 'left': el.style.alignItems = 'flex-start'; break;
                case 'center': el.style.alignItems = 'center'; break;
                case 'right': el.style.alignItems = 'flex-end'; break;
            }
            el.style.textAlign = 'start';
        } else {
            switch (tb.vAlign) {
                case 'top': el.style.justifyContent = 'flex-start'; break;
                case 'middle': el.style.justifyContent = 'center'; break;
                case 'bottom': el.style.justifyContent = 'flex-end'; break;
            }
            el.style.textAlign = tb.hAlign;
        }
    }

    // --- Rendering ---

    startRenderLoop(): void {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = 0;
        }

        const loop = () => {
            if (this.needsRender) {
                this.needsRender = false;
                this.render();
            }
            this.animFrameId = requestAnimationFrame(loop);
        };
        this.animFrameId = requestAnimationFrame(loop);

        if (!this._fallbackChannel) {
            const channel = new MessageChannel();
            this._fallbackChannel = channel;
            channel.port1.onmessage = () => {
                if (this.needsRender) {
                    this.needsRender = false;
                    this.render();
                    channel.port2.postMessage(null);
                }
            };
        }
    }

    requestRender(): void {
        if (!this.needsRender) {
            this.needsRender = true;
            if (this._fallbackChannel) {
                this._fallbackChannel.port2.postMessage(null);
            }
        }
        if (!this.animFrameId) {
            this.startRenderLoop();
        }
    }

    updateViewportTransform(): void {
        const vs = this.engine.data.viewState;
        // viewport 只做平移（transform 不受 zoom 影响，坐标计算不变）
        this.viewportEl.style.transform = `translate(${vs.panX}px, ${vs.panY}px)`;
        // zoom 层使用 CSS zoom 实现高质量缩放（直接以目标分辨率渲染，无插值）
        this.zoomLayerEl.style.zoom = `${vs.zoom}`;
        this.updateGrid();
    }

    updateGrid(): void {
        const vs = this.engine.data.viewState;
        if (this.settings.showGrid) {
            const gs = this.settings.gridSize || GRID_SIZE;
            this.gridEl.style.backgroundImage = `
                repeating-linear-gradient(rgba(128,128,128,0.15) 0px, rgba(128,128,128,0.15) 1px, transparent 1px, transparent ${gs}px),
                repeating-linear-gradient(90deg, rgba(128,128,128,0.15) 0px, rgba(128,128,128,0.15) 1px, transparent 1px, transparent ${gs}px)
            `;
            this.gridEl.style.backgroundSize = `${gs}px ${gs}px`;
            const xOff = ((-vs.panX % gs) + gs) % gs;
            const yOff = ((-vs.panY % gs) + gs) % gs;
            this.gridEl.style.backgroundPosition = `${xOff}px ${yOff}px`;
            this.gridEl.style.display = 'block';
        } else {
            this.gridEl.style.display = 'none';
        }
    }

    render(): void {
        this.updateViewportTransform();
        this.renderTextboxes();
        this.renderArrows();
        this.renderPreviews();
        this.renderSelectionBox();
    }

    renderArrows(): void {
        this.svgLayer.innerHTML = '';
        this.elementsLayer.querySelectorAll('.simpledraw-anchored-arrow').forEach(el => el.remove());

        const arrowW = this.settings.arrowStrokeWidth;
        const headSize = this.settings.arrowHeadSize;
        const accentColor = getComputedStyle(this.containerEl).getPropertyValue('--accent-color').trim() || '#4a90d9';
        const mutedColor = this.settings.arrowColor || getComputedStyle(this.containerEl).getPropertyValue('--text-normal').trim() || '#333333';

        const connectedIds = (arrow: ArrowData): string[] => {
            const ids: string[] = [];
            if ('elementId' in arrow.startConnection) ids.push(arrow.startConnection.elementId);
            if ('elementId' in arrow.endConnection)   ids.push(arrow.endConnection.elementId);
            return ids;
        };

        const renderInto = (svg: SVGElement, arrow: ArrowData, isSelected: boolean) => {
            const strokeColor = isSelected ? accentColor : mutedColor;
            const strokeW = isSelected ? arrowW + 1 : arrowW;
            const points = this.engine.buildArrowPath(arrow.startConnection, arrow.endConnection, arrow.arrowDirection);

            if (points.length >= 2) {
                const linePts = points.slice();
                if (arrow.showEndArrow) {
                    const last = points[points.length - 1]!;
                    const prev = points[points.length - 2]!;
                    const eAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
                    linePts[linePts.length - 1] = {
                        x: last.x - Math.cos(eAngle) * headSize,
                        y: last.y - Math.sin(eAngle) * headSize,
                    };
                }
                const lineOrigin = linePts[0]!;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const d = 'M ' + lineOrigin.x + ' ' + lineOrigin.y + linePts.slice(1).map(p => ' L ' + p.x + ' ' + p.y).join('');
                path.setAttribute('d', d);
                path.style.stroke = strokeColor;
                path.setAttribute('stroke-width', String(strokeW));
                if (arrow.dashed) {
                    path.setAttribute('stroke-dasharray', '6,4');
                }
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke-linejoin', 'round');
                svg.appendChild(path);
            }

            if (arrow.showEndArrow && points.length >= 2) {
                const last = points[points.length - 1]!;
                const prev = points[points.length - 2]!;
                this.drawArrowhead(last.x, last.y, prev.x, prev.y, strokeColor, headSize, false, svg);
            }

            if (arrow.showStartArrow && points.length >= 2) {
                const first = points[0]!;
                const next = points[1]!;
                this.drawArrowhead(first.x, first.y, next.x, next.y, strokeColor, headSize, true, svg);
            }

            const start = this.engine.resolveConnection(arrow.startConnection);
            const end = this.engine.resolveConnection(arrow.endConnection);
            if (this.settings.showAnchorDots) {
                this.drawAnchorDot(start.x, start.y, isSelected ? accentColor : mutedColor, svg);
                this.drawAnchorDot(end.x, end.y, isSelected ? accentColor : mutedColor, svg);
            }
        };

        for (const el of this.engine.data.elements) {
            if (el.type !== 'arrow') continue;
            const arrow = el as ArrowData;
            const isSelected = this.engine.selectedIds.has(arrow.id);

            const ids = connectedIds(arrow);
            if (ids.length > 0) {
                const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                arrowSvg.classList.add('simpledraw-anchored-arrow');
                arrowSvg.style.position = 'absolute';
                arrowSvg.style.top = '0';
                arrowSvg.style.left = '0';
                arrowSvg.style.width = '100%';
                arrowSvg.style.height = '100%';
                arrowSvg.style.pointerEvents = 'none';
                arrowSvg.style.overflow = 'visible';

                renderInto(arrowSvg, arrow, isSelected);

                let maxIdx = -1;
                let insertAfter: Element | null = null;
                for (const id of ids) {
                    const idx = this.engine.data.elements.findIndex(e => e.id === id);
                    if (idx > maxIdx) {
                        maxIdx = idx;
                        insertAfter = this.elementsLayer.querySelector(`[data-id="${id}"]`);
                    }
                }
                if (insertAfter && insertAfter.parentNode) {
                    insertAfter.parentNode.insertBefore(arrowSvg, insertAfter.nextSibling);
                } else {
                    this.elementsLayer.appendChild(arrowSvg);
                }
            } else {
                renderInto(this.svgLayer, arrow, isSelected);
            }
        }

        // Arrow label rendering
        const existingLabels = new Set<string>();
        for (const el of this.engine.data.elements) {
            if (el.type !== 'arrow') continue;
            const arrow = el as ArrowData;
            if (!arrow.labelVisible) continue;

            const mid = this.engine.getArrowMidpoint(arrow);
            const offset = this.engine.getLabelOffset(arrow, arrow.labelPosition ?? 'overlap');
            const labelId = 'arrow-label-' + arrow.id;
            existingLabels.add(labelId);

            let labelEl = this.elementsLayer.querySelector(`[data-arrow-label-id="${labelId}"]`) as HTMLElement | null;
            if (!labelEl) {
                labelEl = document.createElement('div');
                labelEl.setAttribute('data-arrow-label-id', labelId);
                labelEl.className = 'simpledraw-arrow-label';
                labelEl.style.position = 'absolute';
                labelEl.style.pointerEvents = 'auto';
                labelEl.style.transform = 'translate(-50%, -50%)';
                labelEl.style.background = 'transparent';
                labelEl.style.border = 'none';
                labelEl.style.padding = '2px 4px';
                labelEl.style.textAlign = 'center';
                labelEl.style.cursor = 'pointer';
                labelEl.style.wordBreak = 'break-word';
                labelEl.style.boxSizing = 'border-box';
                this.elementsLayer.appendChild(labelEl);
            }
            const fontSize = arrow.labelFontSize ?? 16;
            const writingMode = arrow.labelWritingMode ?? 'horizontal-tb';
            labelEl.style.left = (mid.x + offset.x) + 'px';
            labelEl.style.top = (mid.y + offset.y) + 'px';
            labelEl.style.transform = 'translate(-50%, -50%)';
            labelEl.style.writingMode = writingMode;
            labelEl.style.fontSize = fontSize + 'px';

            // Apply explicit width/height if set
            if (arrow.labelWidth) {
                labelEl.style.width = arrow.labelWidth + 'px';
                labelEl.style.maxWidth = 'none';
            } else {
                labelEl.style.width = '';
                labelEl.style.maxWidth = '200px';
            }
            if (arrow.labelHeight) {
                labelEl.style.height = arrow.labelHeight + 'px';
                labelEl.style.overflow = 'hidden';
            } else {
                labelEl.style.height = '';
                labelEl.style.overflow = 'visible';
            }

            const contentEl = labelEl.querySelector('.simpledraw-arrow-label-content') as HTMLElement | null;
            if (arrow.labelContent?.trim()) {
                if (labelEl.getAttribute('data-rendered') !== arrow.labelContent) {
                    contentEl?.remove();
                    labelEl.querySelector('.simpledraw-arrow-label-placeholder')?.remove();
                    const newContent = document.createElement('div');
                    newContent.className = 'simpledraw-arrow-label-content';
                    labelEl.appendChild(newContent);
                    this.renderMarkdownInElement(arrow.labelContent, newContent);
                    labelEl.setAttribute('data-rendered', arrow.labelContent);
                }
            } else {
                contentEl?.remove();
                labelEl.removeAttribute('data-rendered');
                if (!labelEl.querySelector('.simpledraw-arrow-label-placeholder')) {
                    const ph = document.createElement('div');
                    ph.className = 'simpledraw-arrow-label-placeholder';
                    ph.textContent = t('arrowLabelEditor.placeholder');
                    labelEl.appendChild(ph);
                }
            }

            // Resize handles (only when arrow is selected and not actively in label editor)
            const isSelected = this.engine.selectedIds.has(arrow.id);
            const isEditingLabel = (this.engine.labelEditorArrowId === arrow.id);
            if (isSelected && !isEditingLabel) {
                const handles = labelEl.querySelectorAll('.simpledraw-label-resize-handle');
                if (handles.length === 0) {
                    for (const pos of ['se', 'sw', 'ne', 'nw']) {
                        const h = document.createElement('div');
                        h.className = 'simpledraw-label-resize-handle';
                        h.dataset.labelHandleId = arrow.id;
                        h.dataset.handle = pos;
                        h.style.position = 'absolute';
                        h.style.width = '8px';
                        h.style.height = '8px';
                        h.style.background = 'var(--accent-color)';
                        h.style.cursor = pos === 'se' || pos === 'nw' ? 'nwse-resize' : 'nesw-resize';
                        h.style.zIndex = '10';
                        h.style.pointerEvents = 'auto';
                        switch (pos) {
                            case 'se': h.style.bottom = '-4px'; h.style.right = '-4px'; break;
                            case 'sw': h.style.bottom = '-4px'; h.style.left = '-4px'; break;
                            case 'ne': h.style.top = '-4px'; h.style.right = '-4px'; break;
                            case 'nw': h.style.top = '-4px'; h.style.left = '-4px'; break;
                        }
                        labelEl.appendChild(h);
                    }
                }
            } else {
                labelEl.querySelectorAll('.simpledraw-label-resize-handle').forEach(h => h.remove());
            }
        }
        // Remove stale label elements
        this.elementsLayer.querySelectorAll('[data-arrow-label-id]').forEach(el => {
            const id = el.getAttribute('data-arrow-label-id')!;
            if (!existingLabels.has(id)) el.remove();
        });

        // Diamond textbox borders
        for (const el of this.engine.data.elements) {
            if (el.type !== 'textbox') continue;
            const tb = el as TextBoxData;
            if ((tb.shape ?? 'rectangle') !== 'diamond') continue;
            if (!tb.visible && !this.engine.selectedIds.has(tb.id)) continue;
            const isSelected = this.engine.selectedIds.has(tb.id);
            const strokeColor = isSelected ? accentColor : mutedColor;
            const strokeW = isSelected ? arrowW + 1 : arrowW;
            const w = tb.width;
            const h = tb.height;
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', `${tb.x + w / 2},${tb.y} ${tb.x + w},${tb.y + h / 2} ${tb.x + w / 2},${tb.y + h} ${tb.x},${tb.y + h / 2}`);
            poly.setAttribute('fill', 'none');
            poly.style.stroke = strokeColor;
            poly.setAttribute('stroke-width', String(strokeW));
            poly.setAttribute('stroke-linejoin', 'round');
            this.svgLayer.appendChild(poly);
        }
    }

    drawArrowhead(tipX: number, tipY: number, fromX: number, fromY: number, color: string, size: number, reverse: boolean, parentSvg?: SVGElement): void {
        const angle = Math.atan2(tipY - fromY, tipX - fromX);
        const baseX = tipX - Math.cos(angle) * size;
        const baseY = tipY - Math.sin(angle) * size;

        const shape = this.settings.arrowShape;
        const halfW = size * 0.45;

        if (shape === 'circle') {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(tipX));
            circle.setAttribute('cy', String(tipY));
            circle.setAttribute('r', String(size * 0.4));
            circle.style.fill = color;
            (parentSvg || this.svgLayer).appendChild(circle);
            return;
        }

        if (shape === 'v-shape') {
            const armLen = size / Math.cos(0.6);
            const lx1 = tipX - Math.cos(angle + 0.6) * armLen;
            const ly1 = tipY - Math.sin(angle + 0.6) * armLen;
            const lx2 = tipX - Math.cos(angle - 0.6) * armLen;
            const ly2 = tipY - Math.sin(angle - 0.6) * armLen;

            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            poly.setAttribute('points', `${lx1},${ly1} ${tipX},${tipY} ${lx2},${ly2}`);
            poly.style.stroke = color;
            poly.setAttribute('stroke-width', String(this.settings.arrowStrokeWidth));
            poly.setAttribute('fill', 'none');
            poly.setAttribute('stroke-linejoin', 'round');
            (parentSvg || this.svgLayer).appendChild(poly);
            return;
        }

        const perpX = Math.cos(angle + Math.PI / 2);
        const perpY = Math.sin(angle + Math.PI / 2);

        const bx = baseX + perpX * halfW;
        const by = baseY + perpY * halfW;
        const cx = baseX - perpX * halfW;
        const cy = baseY - perpY * halfW;

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', `${tipX},${tipY} ${bx},${by} ${cx},${cy}`);

        if (shape === 'open-triangle') {
            poly.style.stroke = color;
            poly.setAttribute('stroke-width', String(this.settings.arrowStrokeWidth));
            poly.style.fill = 'none';
            poly.setAttribute('stroke-linejoin', 'round');
        } else {
            poly.style.fill = color;
        }
        (parentSvg || this.svgLayer).appendChild(poly);
    }

    drawAnchorDot(x: number, y: number, color: string, parentSvg?: SVGElement): void {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x.toString());
        circle.setAttribute('cy', y.toString());
        circle.setAttribute('r', '2.5');
        circle.style.fill = color;
        circle.style.stroke = '#fff';
        circle.setAttribute('stroke-width', '0.5');
        (parentSvg || this.svgLayer).appendChild(circle);
    }

    renderTextboxes(): void {
        for (const el of this.engine.data.elements) {
            if (el.type !== 'textbox') continue;
            const tb = el as TextBoxData;
            this.renderTextboxDOM(tb);
        }
        const validIds = new Set(this.engine.data.elements.filter(e => e.type === 'textbox').map(e => e.id));
        this.elementsLayer.querySelectorAll('.simpledraw-textbox').forEach(el => {
            const id = (el as HTMLElement).dataset.id;
            if (id && !validIds.has(id)) {
                el.remove();
            }
        });
    }

    renderTextboxDOM(tb: TextBoxData): void {
        let wrapper = this.elementsLayer.querySelector(`[data-id="${tb.id}"]`) as HTMLElement | null;
        let container: HTMLElement | null;
        let content: HTMLElement | null;

        if (!wrapper) {
            wrapper = this.elementsLayer.createDiv('simpledraw-textbox');
            wrapper.dataset.id = tb.id;
            wrapper.style.position = 'absolute';
            wrapper.style.pointerEvents = 'auto';

            container = wrapper.createDiv('simpledraw-textbox-inner');
            container.style.position = 'relative';
            container.style.borderRadius = '0px';
            container.style.boxSizing = 'border-box';
            container.style.overflow = 'hidden';

            content = container.createDiv('simpledraw-textbox-content');
            content.style.padding = '4px';
            content.style.boxSizing = 'border-box';

            const positions = ['se', 'sw', 'ne', 'nw'] as const;
            for (const pos of positions) {
                const handle = wrapper.createDiv('simpledraw-resize-handle');
                handle.dataset.handle = pos;
                handle.style.position = 'absolute';
                handle.style.width = '8px';
                handle.style.height = '8px';
                handle.style.background = 'var(--accent-color)';
                handle.style.borderRadius = '0px';
                handle.style.pointerEvents = 'auto';
                handle.style.cursor = this.getResizeCursor(pos);
                handle.style.zIndex = '10';
                switch (pos) {
                    case 'se': handle.style.bottom = '-4px'; handle.style.right = '-4px'; break;
                    case 'sw': handle.style.bottom = '-4px'; handle.style.left = '-4px'; break;
                    case 'ne': handle.style.top = '-4px'; handle.style.right = '-4px'; break;
                    case 'nw': handle.style.top = '-4px'; handle.style.left = '-4px'; break;
                }
            }
        } else {
            container = wrapper.querySelector('.simpledraw-textbox-inner') as HTMLElement;
            content = wrapper.querySelector('.simpledraw-textbox-content') as HTMLElement;
        }

        if (!container || !content) return;

        const isSelected = this.engine.selectedIds.has(tb.id);
        const isEditing = this.engine.editingTextboxId === tb.id;

        wrapper.style.left = tb.x + 'px';
        wrapper.style.top = tb.y + 'px';
        wrapper.style.width = tb.width + 'px';
        wrapper.style.height = tb.height + 'px';

        container.style.width = '100%';
        container.style.height = '100%';

        const isClipped = (tb.shape ?? 'rectangle') === 'diamond';

        if (!tb.visible) {
            wrapper.style.setProperty('background', 'transparent', 'important');
            container.style.setProperty('background', 'transparent', 'important');
            content.style.setProperty('background', 'transparent', 'important');
            for (const child of Array.from(content.children)) {
                (child as HTMLElement).style.setProperty('background', 'transparent', 'important');
                (child as HTMLElement).style.setProperty('background-color', 'transparent', 'important');
            }
            if (isSelected || isEditing) {
                if (isClipped) {
                    container.style.border = 'none';
                } else {
                    container.style.borderColor = 'var(--accent-color)';
                    container.style.borderWidth = '2px';
                    container.style.borderStyle = 'solid';
                }
            } else {
                container.style.border = 'none';
            }
        } else if (tb.fillEnabled) {
            const fillColor = this.settings.textboxFillColor || 'var(--bg-primary, #ffffff)';
            const borderColor = this.settings.textboxBorderColor || 'var(--text-normal)';
            wrapper.style.setProperty('background', isClipped ? 'transparent' : fillColor, 'important');
            if (isClipped) {
                container.style.border = 'none';
            } else {
                container.style.borderColor = isSelected || isEditing ? 'var(--accent-color)' : borderColor;
                container.style.borderWidth = (isSelected || isEditing) ? '2px' : '1px';
                container.style.borderStyle = 'solid';
            }
            container.style.setProperty('background', fillColor, 'important');
            content.style.removeProperty('background');
            content.style.setProperty('background-color', 'transparent', 'important');
        } else {
            wrapper.style.setProperty('background', 'transparent', 'important');
            if (isClipped) {
                container.style.border = 'none';
            } else {
                const borderColor = this.settings.textboxBorderColor || 'var(--text-normal)';
                container.style.borderColor = isSelected || isEditing ? 'var(--accent-color)' : borderColor;
                container.style.borderWidth = (isSelected || isEditing) ? '2px' : '1px';
                container.style.borderStyle = 'solid';
            }
            container.style.setProperty('background', 'transparent', 'important');
            content.style.setProperty('background', 'transparent', 'important');
            for (const child of Array.from(content.children)) {
                (child as HTMLElement).style.setProperty('background', 'transparent', 'important');
                (child as HTMLElement).style.setProperty('background-color', 'transparent', 'important');
            }
        }

        const shape = tb.shape ?? 'rectangle';
        if (shape === 'ellipse') {
            container.style.borderRadius = '50%';
            container.style.clipPath = 'none';
            container.style.overflow = '';
            wrapper.style.borderRadius = '50%';
        } else if (shape === 'diamond') {
            container.style.borderRadius = '0';
            container.style.clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
            container.style.overflow = 'visible';
        } else {
            container.style.borderRadius = '';
            container.style.clipPath = 'none';
            container.style.overflow = '';
        }

        content.style.display = '';
        content.style.width = '100%';
        content.style.height = '100%';
        content.style.fontSize = (tb.fontSize ?? 16) + 'px';

        this.applyTextAlignment(content, tb);

        const currentRendered = content.getAttribute('data-rendered-content') ?? '';
        if (currentRendered !== tb.content) {
            content.innerHTML = '';
            content.setAttribute('data-rendered-content', tb.content);
            if (tb.content.trim()) {
                renderMarkdownToHTML(tb.content, content, this.currentFilePath);
            }
        }

        const handles = wrapper.querySelectorAll('.simpledraw-resize-handle');
        handles.forEach(h => {
            (h as HTMLElement).style.display = (isSelected && !isEditing) ? 'block' : 'none';
        });

        // Lock indicator overlay
        let lockIcon = wrapper.querySelector('.simpledraw-lock-icon') as HTMLElement | null;
        if (tb.locked) {
            if (!lockIcon) {
                lockIcon = wrapper.createDiv('simpledraw-lock-icon');
                lockIcon.textContent = '🔒';
                lockIcon.style.position = 'absolute';
                lockIcon.style.top = '2px';
                lockIcon.style.right = '2px';
                lockIcon.style.fontSize = '12px';
                lockIcon.style.zIndex = '20';
                lockIcon.style.pointerEvents = 'none';
                lockIcon.style.opacity = '0.7';
            }
        } else {
            if (lockIcon) lockIcon.remove();
        }
    }

    getResizeCursor(handle: string): string {
        switch (handle) {
            case 'se': case 'nw': return 'nwse-resize';
            case 'sw': case 'ne': return 'nesw-resize';
            default: return 'nwse-resize';
        }
    }

    renderPreviews(): void {
        this.previewLayer.innerHTML = '';

        if (this.engine.mode === InteractionMode.InsertTextBox && this.engine.textBoxInsertState.firstClick) {
            const fc = this.engine.textBoxInsertState.firstClick;
            const mx = this.lastCanvasMouse.x;
            const my = this.lastCanvasMouse.y;
            const x = Math.min(fc.x, mx);
            const y = Math.min(fc.y, my);
            const w = Math.abs(mx - fc.x);
            const h = Math.abs(my - fc.y);

            const preview = this.previewLayer.createDiv('simpledraw-preview-rect');
            preview.style.position = 'absolute';
            preview.style.left = x + 'px';
            preview.style.top = y + 'px';
            preview.style.width = Math.max(w, 1) + 'px';
            preview.style.height = Math.max(h, 1) + 'px';
            preview.style.border = '2px dashed var(--accent-color)';
            preview.style.backgroundColor = 'rgba(74, 144, 217, 0.05)';
            preview.style.pointerEvents = 'none';
        }

        if (this.engine.mode === InteractionMode.InsertArrow && !this.engine.arrowInsertState.firstClick) {
            const mx = this.engine.arrowInsertState.mouseX;
            const my = this.engine.arrowInsertState.mouseY;
            const snapped = this.engine.findNearestAnchor(mx, my);
            if (snapped) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.style.position = 'absolute';
                svg.style.top = '0';
                svg.style.left = '0';
                svg.style.width = '100%';
                svg.style.height = '100%';
                svg.style.pointerEvents = 'none';
                svg.style.overflow = 'visible';
                const snapCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                snapCircle.setAttribute('cx', String(snapped.x));
                snapCircle.setAttribute('cy', String(snapped.y));
                snapCircle.setAttribute('r', String(this.settings.snapPreviewRadius ?? 8));
                snapCircle.style.fill = 'rgba(74, 144, 217, 0.3)';
                snapCircle.style.stroke = '#4a90d9';
                snapCircle.setAttribute('stroke-width', '2');
                svg.appendChild(snapCircle);
                this.previewLayer.appendChild(svg);
            }
        }

        if (this.engine.mode === InteractionMode.InsertArrow && this.engine.arrowInsertState.firstClick) {
            const fc = this.engine.arrowInsertState.firstClick;
            let mx = this.engine.arrowInsertState.mouseX;
            let my = this.engine.arrowInsertState.mouseY;

            const snapped = this.engine.findNearestAnchor(mx, my);
            if (snapped) {
                mx = snapped.x;
                my = snapped.y;
                const snapCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.style.position = 'absolute';
                svg.style.top = '0';
                svg.style.left = '0';
                svg.style.width = '100%';
                svg.style.height = '100%';
                svg.style.pointerEvents = 'none';
                svg.style.overflow = 'visible';
                snapCircle.setAttribute('cx', String(snapped.x));
                snapCircle.setAttribute('cy', String(snapped.y));
                snapCircle.setAttribute('r', String(this.settings.snapPreviewRadius ?? 8));
                snapCircle.style.fill = 'rgba(74, 144, 217, 0.3)';
                snapCircle.style.stroke = '#4a90d9';
                snapCircle.setAttribute('stroke-width', '2');
                svg.appendChild(snapCircle);
                this.previewLayer.appendChild(svg);
            }

            {
                const startDot = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                startDot.style.position = 'absolute';
                startDot.style.top = '0';
                startDot.style.left = '0';
                startDot.style.width = '100%';
                startDot.style.height = '100%';
                startDot.style.pointerEvents = 'none';
                startDot.style.overflow = 'visible';
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', String(fc.x));
                circle.setAttribute('cy', String(fc.y));
                circle.setAttribute('r', '5');
                circle.style.fill = '#4a90d9';
                startDot.appendChild(circle);
                this.previewLayer.appendChild(startDot);
            }

            const tempStartConn: ArrowConnection | FreePoint = this.getTempConnection(fc.x, fc.y);
            const tempEndConn: ArrowConnection | FreePoint = snapped
                ? { elementId: snapped.elementId, anchor: snapped.anchor }
                : { x: mx, y: my };

            const previewPoints = this.engine.buildArrowPath(tempStartConn, tempEndConn, this.engine.arrowDirection);

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.position = 'absolute';
            svg.style.top = '0';
            svg.style.left = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.pointerEvents = 'none';
            svg.style.overflow = 'visible';

            {
                const pLinePts = previewPoints.slice();
                const pLast = previewPoints[previewPoints.length - 1]!;
                const pPrev = previewPoints[previewPoints.length - 2]!;
                const pEAngle = Math.atan2(pLast.y - pPrev.y, pLast.x - pPrev.x);
                pLinePts[pLinePts.length - 1] = {
                    x: pLast.x - Math.cos(pEAngle) * 8,
                    y: pLast.y - Math.sin(pEAngle) * 8,
                };
                if (pLinePts.length >= 1) {
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const d = 'M ' + pLinePts[0]!.x + ' ' + pLinePts[0]!.y + pLinePts.slice(1).map(p => ' L ' + p.x + ' ' + p.y).join('');
                    line.setAttribute('d', d);
                    line.style.stroke = '#4a90d9';
                    line.setAttribute('stroke-width', '2');
                    line.setAttribute('stroke-dasharray', '5,5');
                    line.setAttribute('fill', 'none');
                    svg.appendChild(line);
                }
            }

            if (previewPoints.length >= 2) {
                const last = previewPoints[previewPoints.length - 1]!;
                const prev = previewPoints[previewPoints.length - 2]!;
                const pAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
                const pSize = 8;
                const pHalfW = pSize * 0.45;
                const baseX = last.x - Math.cos(pAngle) * pSize;
                const baseY = last.y - Math.sin(pAngle) * pSize;
                const perpPX = Math.cos(pAngle + Math.PI / 2);
                const perpPY = Math.sin(pAngle + Math.PI / 2);

                const arrowPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                arrowPoly.setAttribute('points',
                    `${last.x},${last.y} ${baseX + perpPX * pHalfW},${baseY + perpPY * pHalfW} ${baseX - perpPX * pHalfW},${baseY - perpPY * pHalfW}`);
                arrowPoly.style.fill = '#4a90d9';
                svg.appendChild(arrowPoly);
            }

            this.previewLayer.appendChild(svg);
        }

        // Resize snap 预览线
        if (this.engine.resizeSnap.active) {
            const accentColor = getComputedStyle(this.containerEl).getPropertyValue('--accent-color').trim() || '#4a90d9';
            for (const line of this.engine.resizeSnap.lines) {
                const el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.pointerEvents = 'none';
                el.style.background = accentColor;
                const isVert = Math.abs(line.x1 - line.x2) < 1;
                if (isVert) {
                    el.style.left = line.x1 + 'px';
                    el.style.top = line.y1 + 'px';
                    el.style.width = '1px';
                    el.style.height = (line.y2 - line.y1) + 'px';
                } else {
                    el.style.left = line.x1 + 'px';
                    el.style.top = line.y1 + 'px';
                    el.style.width = (line.x2 - line.x1) + 'px';
                    el.style.height = '1px';
                }
                el.style.opacity = '0.6';
                el.style.zIndex = '30';
                this.previewLayer.appendChild(el);
            }
        }

        if (this.engine.alignmentSnap.active) {
            const accentColor = getComputedStyle(this.containerEl).getPropertyValue('--accent-color').trim() || '#4a90d9';
            for (const line of this.engine.alignmentSnap.lines) {
                const el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.pointerEvents = 'none';
                el.style.background = accentColor;
                const isVert = Math.abs(line.x1 - line.x2) < 1;
                if (isVert) {
                    el.style.left = line.x1 + 'px';
                    el.style.top = line.y1 + 'px';
                    el.style.width = '1px';
                    el.style.height = (line.y2 - line.y1) + 'px';
                } else {
                    el.style.left = line.x1 + 'px';
                    el.style.top = line.y1 + 'px';
                    el.style.width = (line.x2 - line.x1) + 'px';
                    el.style.height = '1px';
                }
                el.style.opacity = '0.6';
                el.style.zIndex = '30';
                this.previewLayer.appendChild(el);
            }
        }
    }

    renderSelectionBox(): void {
        const ss = this.engine.selectionState;
        if (ss?.active) {
            const x = Math.min(ss.startX, ss.currentX);
            const y = Math.min(ss.startY, ss.currentY);
            const w = Math.abs(ss.currentX - ss.startX);
            const h = Math.abs(ss.currentY - ss.startY);
            this.selectionBox.style.display = 'block';
            this.selectionBox.style.left = x + 'px';
            this.selectionBox.style.top = y + 'px';
            this.selectionBox.style.width = w + 'px';
            this.selectionBox.style.height = h + 'px';
        } else {
            this.selectionBox.style.display = 'none';
        }
    }

    updateSelectionDisplay(): void {
        this.requestRender();
    }

    rebuildAll(): void {
        this.elementsLayer.innerHTML = '';
        this.updateMenuButtons();
        this.requestRender();
    }

    // --- Clipboard (Copy / Paste) ---

    private async copySelectedElements(): Promise<void> {
        const selected = this.engine.data.elements.filter(el => {
            if (el.type === 'textbox' && (el as TextBoxData).locked) return false;
            return this.engine.selectedIds.has(el.id);
        });
        if (selected.length === 0) return;
        const data = JSON.stringify({ _simpledraw: true, version: 1, elements: JSON.parse(JSON.stringify(selected)) });
        try {
            await navigator.clipboard.writeText(data);
        } catch { /* clipboard not available */ }
    }

    private async pasteFromClipboard(): Promise<void> {
        let text: string;
        try {
            text = await navigator.clipboard.readText();
        } catch { return; }
        if (!text) return;

        let data: any;
        try { data = JSON.parse(text); } catch { data = null; }

        if (data && data._simpledraw && Array.isArray(data.elements)) {
            await this.pasteElements(data.elements);
        } else {
            this.createTextboxFromContent(text);
        }
    }

    private async pasteElements(elements: ElementData[]): Promise<void> {
        const pos = this.lastCanvasMouse;
        let minX = Infinity, minY = Infinity;
        const oldIds: string[] = [];
        for (const el of elements) {
            if (el.type === 'textbox') {
                minX = Math.min(minX, el.x);
                minY = Math.min(minY, el.y);
                oldIds.push(el.id);
            }
        }
        if (minX === Infinity) return;

        const offX = pos.x - minX;
        const offY = pos.y - minY;
        const newIds: string[] = [];
        const idMap = new Map<string, string>();

        for (const el of elements) {
            if (el.type === 'textbox') {
                const tb = el as TextBoxData;
                const newId = this.engine.createTextBox(
                    tb.x + offX, tb.y + offY, tb.width, tb.height
                );
                const newTb = this.engine.data.elements.find(e => e.id === newId) as TextBoxData;
                if (newTb) {
                    newTb.content = tb.content;
                    newTb.visible = tb.visible;
                    newTb.fillEnabled = tb.fillEnabled;
                    newTb.hAlign = tb.hAlign;
                    newTb.vAlign = tb.vAlign;
                    newTb.autoSize = tb.autoSize;
                    newTb.shape = tb.shape ?? 'rectangle';
                    newTb.fontSize = tb.fontSize ?? 16;
                    newTb.writingMode = tb.writingMode ?? 'horizontal-tb';
                }
                idMap.set(tb.id, newId);
                newIds.push(newId);
            }
        }

        for (const el of elements) {
            if (el.type !== 'arrow') continue;
            const ar = el as ArrowData;
            const mapConn = (conn: ArrowConnection | FreePoint): ArrowConnection | FreePoint => {
                if ('elementId' in conn && idMap.has(conn.elementId)) {
                    return { elementId: idMap.get(conn.elementId)!, anchor: conn.anchor };
                }
                if ('elementId' in conn) return conn;
                return { x: conn.x + offX, y: conn.y + offY };
            };
            this.engine.createArrow(mapConn(ar.startConnection), mapConn(ar.endConnection));
            const newAr = this.engine.data.elements[this.engine.data.elements.length - 1] as ArrowData;
            newAr.arrowDirection = ar.arrowDirection;
            newAr.showStartArrow = ar.showStartArrow;
            newAr.showEndArrow = ar.showEndArrow;
            if (ar.dashed) newAr.dashed = true;
        }

        this.engine.selectedIds.clear();
        for (const id of newIds) this.engine.selectedIds.add(id);
        if (this.engine.onSelectionChange) this.engine.onSelectionChange();

        this.engine.saveHistory();
        this.engine.notifyChange();
        this.rebuildAll();
    }

    private createTextboxFromContent(content: string): void {
        const pos = this.lastCanvasMouse;
        const id = this.engine.createTextBox(
            pos.x - DEFAULT_TEXTBOX_WIDTH / 2,
            pos.y - DEFAULT_TEXTBOX_HEIGHT / 2,
            DEFAULT_TEXTBOX_WIDTH,
            DEFAULT_TEXTBOX_HEIGHT
        );
        const tb = this.engine.data.elements.find(e => e.id === id) as TextBoxData;
        if (tb) {
            tb.content = content;
            if (content.trim()) {
                this.autoSizeTextbox(tb);
            }
        }
        this.engine.saveHistory();
        this.engine.notifyChange();
        this.rebuildAll();
    }

    // --- Export to PNG ---

    async exportToPNG(): Promise<void> {
        const elements = this.engine.data.elements;
        if (elements.length === 0) {
            showToast(t('notice.emptyCanvas'), 'info');
            return;
        }

        const defaultName = 'drawing_' + SimpleDrawEngine.generateFileName().replace('.simpledraw', '') + '.png';

        // 弹出导出选项对话框（路径、网格、透明背景）
        const modal = new ExportModal(defaultName, async (opts) => {
            await this.doExport(opts);
        });
        await modal.open();
    }

    async doExport(options: { filePath: string; showGrid: boolean; transparentBg: boolean }): Promise<void> {
        const elements = this.engine.data.elements;
        if (elements.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of elements) {
            const bounds = this.engine.getElementBounds(el);
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        }

        const padding = 50;
        minX = Math.floor(minX - padding);
        minY = Math.floor(minY - padding);
        maxX = Math.ceil(maxX + padding);
        maxY = Math.ceil(maxY + padding);

        const w = Math.max(maxX - minX, 400);
        const h = Math.max(maxY - minY, 300);

        const offscreen = document.createElement('div');
        offscreen.style.position = 'fixed';
        offscreen.style.left = '0';
        offscreen.style.top = '0';
        offscreen.style.width = '0';
        offscreen.style.height = '0';
        offscreen.style.overflow = 'hidden';
        offscreen.style.pointerEvents = 'none';
        offscreen.style.backgroundColor = 'transparent';
        document.body.appendChild(offscreen);

        if (options.showGrid) {
            const gs = this.settings.gridSize || GRID_SIZE;
            const grid = document.createElement('div');
            grid.style.position = 'absolute';
            grid.style.left = '0px';
            grid.style.top = '0px';
            grid.style.width = w + 'px';
            grid.style.height = h + 'px';
            grid.style.pointerEvents = 'none';
            grid.style.zIndex = '1';
            grid.style.backgroundImage = `
                repeating-linear-gradient(rgba(128,128,128,0.15) 0px, rgba(128,128,128,0.15) 1px, transparent 1px, transparent ${gs}px),
                repeating-linear-gradient(90deg, rgba(128,128,128,0.15) 0px, rgba(128,128,128,0.15) 1px, transparent 1px, transparent ${gs}px)
            `;
            grid.style.backgroundSize = `${gs}px ${gs}px`;
            const xOff = ((-minX % gs) + gs) % gs;
            const yOff = ((-minY % gs) + gs) % gs;
            grid.style.backgroundPosition = `${xOff}px ${yOff}px`;
            offscreen.appendChild(grid);
        }

        const svgClone = this.svgLayer.cloneNode(true) as SVGElement;
        svgClone.style.position = 'absolute';
        svgClone.style.left = '0px';
        svgClone.style.top = '0px';
        svgClone.style.width = w + 'px';
        svgClone.style.height = h + 'px';
        svgClone.style.transform = `translate(${-minX}px, ${-minY}px)`;
        svgClone.style.pointerEvents = 'none';
        svgClone.style.overflow = 'visible';
        offscreen.appendChild(svgClone);

        const elementsClone = this.elementsLayer.cloneNode(true) as HTMLElement;
        // Remove lock icons from exported image
        elementsClone.querySelectorAll('.simpledraw-lock-icon').forEach(el => el.remove());
        elementsClone.style.position = 'absolute';
        elementsClone.style.left = '0px';
        elementsClone.style.top = '0px';
        elementsClone.style.width = w + 'px';
        elementsClone.style.height = h + 'px';
        elementsClone.style.transform = `translate(${-minX}px, ${-minY}px)`;
        elementsClone.style.pointerEvents = 'none';
        elementsClone.style.overflow = 'visible';
        offscreen.appendChild(elementsClone);

        offscreen.offsetHeight;
        await document.fonts.ready;

        const captureOpts: Record<string, any> = {
            width: w,
            height: h,
            pixelRatio: 2,
            style: {
                position: 'absolute',
                left: '0',
                top: '0',
                overflow: 'visible',
            },
        };
        if (!options.transparentBg) {
            const bgColor = getComputedStyle(this.containerEl)
                .getPropertyValue('--bg-primary').trim() || '#ffffff';
            captureOpts.backgroundColor = bgColor;
        }
        const canvas = await toCanvas(offscreen, captureOpts);

        document.body.removeChild(offscreen);

        const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const base64 = btoa(binary);

        await window.simpledraw.file.writeBinary(options.filePath, base64);
        showToast(t('notice.exported', { name: options.filePath.split(/[/\\]/).pop()! }), 'success');
    }

    // --- File Operations ---

    async newFile(): Promise<void> {
        this.engine.loadData(JSON.parse(JSON.stringify(DEFAULT_DATA)));
        this.currentFilePath = null;
        this.isDirty = false;
        this.rebuildAll();
        this.updateTitleBar();
        this.updateStatusBar();
    }

    async openFile(filePath: string): Promise<void> {
        const result = await window.simpledraw.file.read(filePath);
        if (!result.success || !result.data) {
            showToast('无法打开文件: ' + (result.error || '未知错误'), 'error');
            return;
        }
        try {
            const parsed = JSON.parse(result.data) as SimpleDrawData;
            if (parsed && parsed.elements && parsed.viewState) {
                for (const el of parsed.elements) {
                    if (el.type === 'arrow' && !(el as any).arrowDirection) {
                        (el as any).arrowDirection = 'right';
                    }
                }
                this.engine.loadData(parsed);
            } else {
                this.engine.loadData(JSON.parse(JSON.stringify(DEFAULT_DATA)));
            }
        } catch {
            this.engine.loadData(JSON.parse(JSON.stringify(DEFAULT_DATA)));
        }
        this.currentFilePath = filePath;
        this.isDirty = false;
        this.rebuildAll();
        this.updateTitleBar();
        this.updateStatusBar();
    }

    async saveFile(): Promise<boolean> {
        if (this.currentFilePath) {
            const data = JSON.stringify(this.engine.getData(), null, 2);
            const result = await window.simpledraw.file.write(this.currentFilePath, data);
            if (result.success) {
                this.isDirty = false;
                this.updateTitleBar();
                return true;
            } else {
                showToast('保存失败: ' + (result.error || '未知错误'), 'error');
                return false;
            }
        } else {
            return this.saveFileAs();
        }
    }

    async saveFileAs(): Promise<boolean> {
        const defaultName = SimpleDrawEngine.generateFileName();
        const filePath = await window.simpledraw.file.showSaveDialog(defaultName);
        if (!filePath) return false;

        this.currentFilePath = filePath;
        return this.saveFile();
    }

    // --- Mark dirty ---

    markDirty(): void {
        if (!this.isDirty) {
            this.isDirty = true;
            this.updateTitleBar();
        }
    }

    // --- Title Bar & Status Bar ---

    updateTitleBar(): void {
        const titleEl = document.getElementById('titlebar-title');
        if (titleEl) {
            if (this.currentFilePath) {
                const name = this.currentFilePath.split(/[/\\]/).pop() || 'SimpleDraw';
                titleEl.textContent = name;
            } else {
                titleEl.textContent = 'SimpleDraw';
            }
        }
        if (this.unsavedIndicator) {
            this.unsavedIndicator.style.display = this.isDirty ? 'inline' : 'none';
        }
        if (this.titleFilepathEl) {
            this.titleFilepathEl.textContent = this.currentFilePath ? ' — ' + this.currentFilePath : ' — 未保存';
        }
    }

    updateStatusBar(): void {
        if (this.statusModeEl) {
            const mode = this.engine.mode;
            let modeText = '';
            switch (mode) {
                case InteractionMode.InsertTextBox: modeText = '插入文本框'; break;
                case InteractionMode.InsertArrow: modeText = '插入箭头'; break;
                default: modeText = '选择';
            }
            this.statusModeEl.textContent = '模式: ' + modeText;
        }
        if (this.statusZoomEl) {
            this.statusZoomEl.textContent = '缩放: ' + Math.round(this.engine.data.viewState.zoom * 100) + '%';
        }
        if (this.statusElementsEl) {
            const tbCount = this.engine.data.elements.filter(e => e.type === 'textbox').length;
            const arCount = this.engine.data.elements.filter(e => e.type === 'arrow').length;
            this.statusElementsEl.textContent = `文本框: ${tbCount}  箭头: ${arCount}`;
        }
    }

    // --- Settings proxy ---

    async saveSettings(): Promise<void> {
        await window.simpledraw.settings.save(this.settings as any);
    }
}

// Helper: extend Element prototype for createDiv/createEl/createSpan
interface Element {
    createDiv(className?: string): HTMLDivElement;
    createSpan(className?: string): HTMLSpanElement;
    createEl(tag: string, options?: any): HTMLElement;
}

// Add helper methods to HTMLElement
function addCreateHelpers() {
    if (!HTMLElement.prototype.createDiv) {
        HTMLElement.prototype.createDiv = function(className?: string): HTMLDivElement {
            const div = document.createElement('div');
            if (className) div.className = className;
            this.appendChild(div);
            return div;
        };
        HTMLElement.prototype.createSpan = function(className?: string): HTMLSpanElement {
            const span = document.createElement('span');
            if (className) span.className = className;
            this.appendChild(span);
            return span;
        };
        HTMLElement.prototype.createEl = function(tag: string, options?: any): HTMLElement {
            const el = document.createElement(tag);
            if (options?.className) el.className = options.className;
            if (options?.text) el.textContent = options.text;
            this.appendChild(el);
            return el;
        };
    }
}

addCreateHelpers();
