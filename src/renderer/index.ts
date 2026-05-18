// SimpleDraw Desktop — Renderer Entry Point

import { AppShell } from './app-shell';

const app = new AppShell();

// Initialize the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}

// Handle Ctrl+, for settings (also handled by app-shell, but here as global listener)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        app.openSettings();
    }
});
