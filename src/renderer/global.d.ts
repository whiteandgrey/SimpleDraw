// Augment HTMLElement with helper methods used by canvas-view.ts
interface HTMLElement {
    createDiv(className?: string): HTMLDivElement;
    createSpan(className?: string): HTMLSpanElement;
    createEl(tag: string, options?: { className?: string; text?: string }): HTMLElement;
}
