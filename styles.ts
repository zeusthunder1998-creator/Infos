@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* Light theme (default) */
:root, :root[data-theme="light"] {
  --bg: #faf9f7;
  --card-bg: #ffffff;
  --soft-bg: #f5f4f0;
  --border: rgba(80, 90, 130, 0.18);
  --border-strong: rgba(80, 90, 130, 0.35);
  --text-primary: #1a1a1a;
  --text-secondary: #5a5a5a;
  --text-tertiary: #9a9a9a;
  --accent: #7b64f5;
  --accent-soft: rgba(123, 100, 245, 0.1);
  --accent-text: #5a48c7;
  --danger: #e24b4a;
  --danger-soft: rgba(226, 75, 74, 0.1);
  --success: #3b6d11;
  --success-soft: rgba(99, 153, 34, 0.12);
  --warn-soft: rgba(250, 199, 117, 0.15);
  --warn-text: #854f0b;
  --warn-border: rgba(250, 199, 117, 0.3);
  --shadow-card: 0 1px 3px rgba(0,0,0,0.03);
  --shadow-pop: 0 12px 32px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08);
  --modal-backdrop: rgba(30, 30, 40, 0.4);
}

/* Dark theme */
:root[data-theme="dark"] {
  --bg: #141416;
  --card-bg: #1d1d21;
  --soft-bg: #26262b;
  --border: rgba(180, 185, 210, 0.12);
  --border-strong: rgba(180, 185, 210, 0.25);
  --text-primary: #ececee;
  --text-secondary: #a7a7ae;
  --text-tertiary: #6e6e76;
  --accent: #9d88ff;
  --accent-soft: rgba(157, 136, 255, 0.18);
  --accent-text: #b9a8ff;
  --danger: #f06a69;
  --danger-soft: rgba(240, 106, 105, 0.18);
  --success: #8bc85a;
  --success-soft: rgba(139, 200, 90, 0.15);
  --warn-soft: rgba(250, 199, 117, 0.12);
  --warn-text: #f5c97c;
  --warn-border: rgba(250, 199, 117, 0.25);
  --shadow-card: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-pop: 0 12px 32px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.35);
  --modal-backdrop: rgba(0, 0, 0, 0.6);
}

/* Auto dark mode when no explicit preference */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --bg: #141416;
    --card-bg: #1d1d21;
    --soft-bg: #26262b;
    --border: rgba(180, 185, 210, 0.12);
    --border-strong: rgba(180, 185, 210, 0.25);
    --text-primary: #ececee;
    --text-secondary: #a7a7ae;
    --text-tertiary: #6e6e76;
    --accent: #9d88ff;
    --accent-soft: rgba(157, 136, 255, 0.18);
    --accent-text: #b9a8ff;
    --danger: #f06a69;
    --danger-soft: rgba(240, 106, 105, 0.18);
    --success: #8bc85a;
    --success-soft: rgba(139, 200, 90, 0.15);
    --warn-soft: rgba(250, 199, 117, 0.12);
    --warn-text: #f5c97c;
    --warn-border: rgba(250, 199, 117, 0.25);
    --shadow-card: 0 1px 3px rgba(0,0,0,0.3);
    --shadow-pop: 0 12px 32px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.35);
    --modal-backdrop: rgba(0, 0, 0, 0.6);
  }
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text-primary);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  transition: background 0.2s, color 0.2s;
}

input, textarea, button, select { font-family: inherit; }

@keyframes infosFadeIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
@keyframes infosPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@keyframes infosDot { 0%, 80%, 100% { opacity: 0.2; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
@keyframes infosSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes infosModalIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
@keyframes infosBackdropIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes infosNewPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(123, 100, 245, 0.4); } 50% { box-shadow: 0 0 0 6px rgba(123, 100, 245, 0); } }
@keyframes infosItemEnter { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

.infos-input:hover { border-color: rgba(80, 90, 130, 0.5) !important; }
.infos-input:focus { border-color: var(--accent) !important; outline: none; box-shadow: 0 0 0 3px var(--accent-soft); }
.infos-btn:hover { background: var(--soft-bg); }
.infos-btn-primary:hover { filter: brightness(1.1); box-shadow: 0 4px 12px var(--accent-soft); }
.infos-btn-primary:active { transform: translateY(1px); }
.infos-tab:hover { color: var(--text-primary) !important; }
.infos-item { transition: box-shadow 0.15s, transform 0.15s, border-color 0.15s; }
.infos-item:hover { box-shadow: var(--shadow-card); }
.infos-pill:active { transform: scale(0.96); }
.infos-dropdown { animation: infosSlideUp 0.18s ease-out; }
.infos-modal-backdrop { animation: infosBackdropIn 0.15s ease-out; }
.infos-modal { animation: infosModalIn 0.2s ease-out; }
.infos-new-badge { animation: infosNewPulse 2s ease-in-out infinite; display: inline-block; }
.infos-item-enter { animation: infosItemEnter 0.25s ease-out; }

/* Reorder arrow buttons (mobile-friendly alternative to drag) */
.infos-arrow-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 5px;
  font-size: 12px;
  line-height: 1;
  padding: 0;
  transition: all 0.15s;
}
.infos-arrow-btn:hover:not(:disabled) { background: var(--soft-bg); color: var(--text-primary); border-color: var(--border-strong); }
.infos-arrow-btn:disabled { opacity: 0.3; cursor: not-allowed; }

@media (max-width: 600px) {
  .infos-grid3 { grid-template-columns: 1fr !important; }
  .infos-grid2 { grid-template-columns: 1fr !important; }
  .infos-tabs { overflow-x: auto; flex-wrap: nowrap !important; }
}
