import { appState } from './state';
import { workerBridge } from './services/worker-client';
import { SourceManager } from './ui/components/source-manager';
import { SampleViewer } from './ui/components/sample-viewer';
import { ConfigPanel } from './ui/components/config-panel';
import { PromptBox } from './ui/components/prompt-box';
import { CodeEditor } from './ui/components/code-editor';
import { ConsoleLogs } from './ui/components/console-logs';
import { orchestrator } from './services/orchestrator';

const appEl = document.getElementById('app');

if (appEl) {
  appEl.innerHTML = `
    <header class="app-header">
      <div class="brand-section">
        <span class="brand-logo">📊</span>
        <div class="brand-title">Studio Actuariel In-Browser</div>
        <span class="brand-badge">Pyodide 0.27 • Polars 1.18</span>
      </div>

      <div class="header-actions">
        <button class="btn-header-cfg" id="btn-open-config" title="Configurer l'endpoint LLM d'entreprise">
          <span class="cfg-indicator-dot" id="cfg-dot"></span>
          <span>⚙️ Configuration LLM</span>
        </button>

        <div class="status-badge" id="pyodide-status">
          <span class="status-dot loading" id="status-dot"></span>
          <span id="status-label">Chargement de Pyodide...</span>
        </div>
      </div>
    </header>

    <div class="main-layout">
      <aside class="sidebar" id="sidebar-container"></aside>

      <main class="work-area">
        <div id="prompt-box-root"></div>

        <div class="work-tabs-bar">
          <button class="work-tab-item active" data-tab="editor" id="tab-btn-editor">
            <span>🐍</span> Script Python & Résultat
          </button>
          <button class="work-tab-item" data-tab="viewer" id="tab-btn-viewer">
            <span>📋</span> Données sources & Profiling
          </button>
          <button class="work-tab-item" data-tab="logs" id="tab-btn-logs">
            <span>📜</span> Journal d'exécution
          </button>
        </div>

        <div class="tab-view-container">
          <div id="tab-view-editor" style="display: flex; flex-direction: column; height: 100%;"></div>
          <div id="tab-view-viewer" style="display: none; flex-direction: column; height: 100%;"></div>
          <div id="tab-view-logs" style="display: none; flex-direction: column; height: 100%;"></div>
        </div>
      </main>
    </div>

    <div id="config-modal-root"></div>
  `;
}

let configPanelInstance: ConfigPanel | null = null;

function updateHeaderStatus() {
  const statusDot = document.getElementById('status-dot');
  const statusLabel = document.getElementById('status-label');
  const cfgDot = document.getElementById('cfg-dot');

  if (cfgDot) {
    const isConfigured = !!appState.llmConfig.token || appState.llmConfig.useMock;
    cfgDot.className = `cfg-indicator-dot ${isConfigured ? 'configured' : ''}`;
  }

  if (!statusDot || !statusLabel) return;
  statusDot.className = 'status-dot';

  switch (appState.status) {
    case 'LOADING':
      statusDot.classList.add('loading');
      statusLabel.textContent = appState.statusMessage || 'Initialisation...';
      break;
    case 'READY':
      statusDot.classList.add('ready');
      statusLabel.textContent = 'Pyodide & Polars Prêts';
      break;
    case 'PROCESSING':
      statusDot.classList.add('processing');
      statusLabel.textContent = appState.statusMessage || 'Calcul en cours...';
      break;
    case 'ERROR':
      statusDot.classList.add('error');
      statusLabel.textContent = appState.statusMessage || 'Erreur Wasm';
      break;
    default:
      statusDot.classList.add('loading');
      statusLabel.textContent = 'Non initialisé';
  }
}

function switchWorkTab(tab: 'editor' | 'viewer' | 'logs') {
  document.querySelectorAll('.work-tab-item').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });

  const editorView = document.getElementById('tab-view-editor');
  const viewerView = document.getElementById('tab-view-viewer');
  const logsView = document.getElementById('tab-view-logs');

  if (editorView) editorView.style.display = tab === 'editor' ? 'flex' : 'none';
  if (viewerView) viewerView.style.display = tab === 'viewer' ? 'flex' : 'none';
  if (logsView) logsView.style.display = tab === 'logs' ? 'flex' : 'none';
}

appState.subscribe(updateHeaderStatus);

async function initApplication() {
  const sidebarContainer = document.getElementById('sidebar-container');
  const promptContainer = document.getElementById('prompt-box-root');
  const editorContainer = document.getElementById('tab-view-editor');
  const viewerContainer = document.getElementById('tab-view-viewer');
  const logsContainer = document.getElementById('tab-view-logs');
  const configModalRoot = document.getElementById('config-modal-root');

  if (sidebarContainer) new SourceManager(sidebarContainer);
  if (promptContainer) new PromptBox(promptContainer);
  if (editorContainer) new CodeEditor(editorContainer);
  if (viewerContainer) new SampleViewer(viewerContainer);
  if (logsContainer) new ConsoleLogs(logsContainer);
  if (configModalRoot) configPanelInstance = new ConfigPanel(configModalRoot);

  document.getElementById('btn-open-config')?.addEventListener('click', () => {
    configPanelInstance?.toggle(true);
  });

  document.getElementById('tab-btn-editor')?.addEventListener('click', () => switchWorkTab('editor'));
  document.getElementById('tab-btn-viewer')?.addEventListener('click', () => switchWorkTab('viewer'));
  document.getElementById('tab-btn-logs')?.addEventListener('click', () => switchWorkTab('logs'));

  (window as any).appState = appState;
  (window as any).workerBridge = workerBridge;
  (window as any).orchestrator = orchestrator;

  try {
    appState.setStatus('LOADING', 'Chargement de Pyodide & Polars Wasm...');
    await workerBridge.init();
    appState.setStatus('READY', 'Prêt');
    appState.addLog('Environnement WebAssembly Pyodide + Polars initialisé avec succès.', 'success');
  } catch (err: any) {
    appState.setStatus('ERROR', `Erreur Wasm: ${err.message || String(err)}`);
    appState.addLog(`Échec initialisation Wasm: ${err.message || String(err)}`, 'error');
  }
}

initApplication();
