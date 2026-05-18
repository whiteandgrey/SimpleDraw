// Markdown renderer — standalone version
// Uses marked + KaTeX for math rendering

import { marked } from 'marked';
import katex from 'katex';

// Configure marked
marked.setOptions({
    breaks: true,
    gfm: true,
});

function renderMathExpression(expr: string, displayMode: boolean): string {
    try {
        return katex.renderToString(expr, {
            throwOnError: false,
            displayMode,
            output: 'html',
        });
    } catch {
        // If KaTeX fails, return the original expression wrapped appropriately
        const delim = displayMode ? '$$' : '$';
        return delim + expr + delim;
    }
}

function renderMarkdown(markdown: string): string {
    if (!markdown.trim()) return '';

    let processed = markdown;

    // Highlight ==text==
    processed = processed.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // Task lists
    processed = processed.replace(/- \[x\] /gi, '- ✅ ');
    processed = processed.replace(/- \[ \] /gi, '- ☐ ');

    // --- Math rendering ---
    // Step 1: Extract and render display math ($$...$$) first
    const mathPlaceholders: string[] = [];
    let placeholderIdx = 0;

    // Display math: $$...$$
    processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_match, expr: string) => {
        const html = renderMathExpression(expr.trim(), true);
        const placeholder = `␀MATH${placeholderIdx}␀`;
        mathPlaceholders[placeholderIdx] = html;
        placeholderIdx++;
        return placeholder;
    });

    // Inline math: $...$ (single $, but not at start of word with number like $100)
    processed = processed.replace(/(?<!\d)\$([^$\s][^$]*?)\$(?!\d)/g, (_match, expr: string) => {
        const html = renderMathExpression(expr.trim(), false);
        const placeholder = `␀MATH${placeholderIdx}␀`;
        mathPlaceholders[placeholderIdx] = html;
        placeholderIdx++;
        return placeholder;
    });

    // Step 2: Render markdown to HTML
    let html = marked.parse(processed) as string;

    // Step 3: Replace math placeholders with rendered KaTeX HTML
    for (let i = 0; i < mathPlaceholders.length; i++) {
        html = html.replace(`␀MATH${i}␀`, mathPlaceholders[i]!);
    }

    return html;
}

export function renderMarkdownToHTML(
    markdown: string,
    containerEl: HTMLElement,
    baseFilePath?: string | null,
): void {
    containerEl.innerHTML = renderMarkdown(markdown);

    // Resolve image paths against the .simpledraw file's directory
    if (baseFilePath) {
        const dir = baseFilePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
        containerEl.querySelectorAll('img[src]').forEach(img => {
            const src = img.getAttribute('src')!;
            if (src.startsWith('file://') || src.startsWith('data:') || src.startsWith('http')) return;

            // 绝对路径（/开头 或 Windows 盘符开头）→ 直接转 file://
            if (src.startsWith('/') || /^[A-Za-z]:[\\/]/.test(src)) {
                img.src = 'file:///' + src.replace(/\\/g, '/').replace(/^\//, '');
                return;
            }

            // 相对路径 → 基于 .simpledraw 文件目录解析
            const clean = src.replace(/\\/g, '/').replace(/^\.\//, '');
            const resolved = dir + '/' + clean;
            img.src = 'file:///' + resolved.replace(/^\//, '');
        });
    }

    // Make links open in external browser
    containerEl.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        if (href && !href.startsWith('#')) {
            a.addEventListener('click', (e) => {
                e.preventDefault();
            });
            a.setAttribute('target', '_blank');
        }
    });
}
