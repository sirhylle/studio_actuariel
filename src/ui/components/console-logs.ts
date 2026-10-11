import { appState, LogEntry } from '../../state';

export class ConsoleLogs {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    appState.subscribe(() => this.render());
  }

  public render() {
    const logs = appState.logs;

    this.container.innerHTML = `
      <div class="console-logs-panel">
        <div class="console-header">
          <div class="console-title">
            <span class="icon">📜</span>
            <h3>Journal d'exécution & Traces (${logs.length})</h3>
          </div>
          <button class="btn-clear-logs" id="btn-clear-logs" title="Effacer les logs">Effacer</button>
        </div>

        <div class="console-content">
          ${logs.length === 0 ? `
            <div class="empty-logs">Aucun événement enregistré.</div>
          ` : `
            <div class="log-entries">
              ${logs.map(log => this.renderLogEntry(log)).join('')}
            </div>
          `}
        </div>
      </div>
    `;

    this.container.querySelector('#btn-clear-logs')?.addEventListener('click', () => {
      appState.logs = [];
      this.render();
    });
  }

  private renderLogEntry(log: LogEntry): string {
    let icon = 'ℹ️';
    if (log.level === 'success') icon = '✅';
    else if (log.level === 'warn') icon = '⚠️';
    else if (log.level === 'error') icon = '❌';

    return `
      <div class="log-entry ${log.level}">
        <span class="log-time">${log.timestamp}</span>
        <span class="log-icon">${icon}</span>
        <span class="log-msg">${log.message}</span>
      </div>
    `;
  }
}
