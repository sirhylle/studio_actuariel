import { EditorView, basicSetup } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { appState } from '../../state';
import { workerBridge } from '../../services/worker-client';
import { orchestrator } from '../../services/orchestrator';

export class CodeEditor {
  private container: HTMLElement;
  private editorView: EditorView | null = null;
  private lastRenderedCode = '';

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    this.initEditor();
    appState.subscribe(() => this.syncState());
    this.bindGlobalEvents();
  }

  private initEditor() {
    const editorHost = this.container.querySelector('#codemirror-host');
    if (!editorHost) return;

    editorHost.innerHTML = '';

    this.editorView = new EditorView({
      doc: appState.currentCode || '# Code Python Polars généré\n# Le DataFrame final doit être assigné à df_out\n',
      extensions: [
        basicSetup,
        python(),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newCode = update.state.doc.toString();
            this.lastRenderedCode = newCode;
            appState.setCode(newCode);
          }
        })
      ],
      parent: editorHost
    });
  }

  private syncState() {
    if (this.editorView && appState.currentCode !== this.lastRenderedCode) {
      this.lastRenderedCode = appState.currentCode;
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: appState.currentCode }
      });
    }

    this.renderResultPreview();
  }

  private async handleDryRun() {
    const code = this.editorView ? this.editorView.state.doc.toString() : appState.currentCode;
    if (!code.trim()) return;

    appState.setStatus('PROCESSING', 'Exécution Dry-Run sur échantillon...');
    appState.addLog("Lancement manuel d'un test Dry-Run...", 'info');

    try {
      const ast = await workerBridge.checkSyntax(code);
      if (!ast.valid) {
        throw (ast as any).error || new Error('Erreur de syntaxe');
      }

      const res = await workerBridge.executeDryRun(code);
      appState.setDryRunResult(res);
      appState.setStatus('READY', 'Dry-Run exécuté avec succès');
      appState.addLog(`Dry-Run réussi : ${res.outputRowCount} lignes produites dans df_out.`, 'success');
    } catch (err: any) {
      appState.setStatus('ERROR', `Échec Dry-Run : ${err.message || String(err)}`);
      appState.addLog(`Erreur Dry-Run : ${err.message || String(err)}`, 'error');
    }
  }

  private async handleFullRun() {
    const code = this.editorView ? this.editorView.state.doc.toString() : appState.currentCode;
    if (!code.trim()) return;

    appState.setStatus('PROCESSING', 'Exécution complète sur toutes les données...');
    appState.addLog("Lancement du calcul complet sur l'intégralité des données...", 'info');

    try {
      const res = await workerBridge.executeFull(code, ';');
      appState.setDryRunResult(res);
      appState.setStatus('READY', 'Exécution complète terminée');
      appState.addLog(`Calcul complet achevé avec succès (${res.outputRowCount} lignes générées).`, 'success');

      // Téléchargement automatique du fichier CSV généré
      if (res.outputCsvBuffer) {
        this.downloadCsv(res.outputCsvBuffer, 'studio_actuariel_resultat.csv');
      }
    } catch (err: any) {
      appState.setStatus('ERROR', `Échec exécution complète : ${err.message || String(err)}`);
      appState.addLog(`Erreur exécution complète : ${err.message || String(err)}`, 'error');
    }
  }

  private downloadCsv(buffer: Uint8Array, filename: string) {
    const blob = new Blob([buffer as any], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    appState.addLog(`Fichier CSV '${filename}' téléchargé.`, 'success');
  }

  private copyCode() {
    const code = this.editorView ? this.editorView.state.doc.toString() : appState.currentCode;
    navigator.clipboard.writeText(code);
    appState.addLog("Code Python copié dans le presse-papier.", 'info');
  }

  public render() {
    this.container.innerHTML = `
      <div class="code-editor-panel">
        <div class="editor-toolbar">
          <div class="toolbar-title">
            <span class="icon">🐍</span>
            <h3>Script Python (Polars vectorisé)</h3>
          </div>
          <div class="toolbar-actions">
            <button class="btn btn-secondary btn-sm" id="btn-copy-code" title="Copier le code">📋 Copier</button>
            <button class="btn btn-secondary btn-sm" id="btn-dry-run" title="Tester sur échantillon">▶️ Re-tester (Dry-Run)</button>
            <button class="btn btn-success btn-sm" id="btn-full-run" title="Exécuter et exporter CSV">⚡ Exécuter & Exporter CSV</button>
          </div>
        </div>

        <div class="codemirror-wrapper" id="codemirror-host"></div>

        <div class="editor-output-preview" id="editor-preview-container">
          <!-- Aperçu dynamique du résultat -->
        </div>

        <!-- Modal de dialogue pour dépassement du quota de retouches -->
        <div id="retry-dialog-host"></div>
      </div>
    `;

    this.bindEvents();
    this.renderResultPreview();
  }

  private renderResultPreview() {
    const previewContainer = this.container.querySelector('#editor-preview-container');
    if (!previewContainer) return;

    const res = appState.dryRunResult;
    if (!res) {
      previewContainer.innerHTML = `
        <div class="preview-empty">
          <span>ℹ️</span>
          <span>Le résultat de l'exécution apparaîtra ici après le test Dry-Run ou l'exécution complète.</span>
        </div>
      `;
      return;
    }

    const previewRows = res.headPreview || [];
    const cols: { name: string; dtype?: string }[] = res.outputColumns && res.outputColumns.length > 0
      ? res.outputColumns
      : (previewRows.length > 0 ? Object.keys(previewRows[0]).map(k => ({ name: k })) : []);

    previewContainer.innerHTML = `
      <div class="preview-box">
        <div class="preview-header">
          <div class="preview-stats">
            <strong>Résultat df_out :</strong>
            <span>${res.outputRowCount.toLocaleString()} lignes</span>
            <span>•</span>
            <span>${res.outputColCount} colonnes</span>
          </div>
        </div>

        <div class="table-scroll-container mini-preview">
          <table class="data-table">
            <thead>
              <tr>
                <th class="row-num-col">#</th>
                ${cols.map(c => `
                  <th>
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                      <span style="color: var(--text-main); font-weight: 600;">${c.name}</span>
                      ${c.dtype ? `<span style="font-size: 10px; font-weight: normal; color: var(--accent-blue); font-family: var(--font-mono);">${c.dtype}</span>` : ''}
                    </div>
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${previewRows.map((r, i) => `
                <tr>
                  <td class="row-num-col">${i + 1}</td>
                  ${cols.map(c => {
                    const val = r[c.name];
                    return `<td>${val === null ? '<span class="null-tag">null</span>' : String(val)}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    this.container.querySelector('#btn-dry-run')?.addEventListener('click', () => this.handleDryRun());
    this.container.querySelector('#btn-full-run')?.addEventListener('click', () => this.handleFullRun());
    this.container.querySelector('#btn-copy-code')?.addEventListener('click', () => this.copyCode());
  }

  private bindGlobalEvents() {
    window.addEventListener('studio:max-retries-reached', (e: any) => {
      const detail = e.detail;
      this.showRetryDialog(detail);
    });
  }

  private showRetryDialog(detail: any) {
    const dialogHost = this.container.querySelector('#retry-dialog-host');
    if (!dialogHost) return;

    const retryCount = detail.maxRetries || 2;

    dialogHost.innerHTML = `
      <div class="config-modal-backdrop">
        <div class="config-modal-card">
          <div class="modal-header">
            <div class="modal-title">
              <span class="icon">⚠️</span>
              <h3>Limite d'auto-réparations atteinte</h3>
            </div>
          </div>
          <div class="modal-body">
            <p>Le LLM n'a pas réussi à corriger automatiquement le code après les tentatives autorisées.</p>
            <div class="error-detail-box">
              <strong>Détail de l'erreur (${detail.error.phase}) :</strong>
              <p>${detail.error.message}</p>
              ${detail.error.traceback ? `<pre>${detail.error.traceback.slice(0, 300)}</pre>` : ''}
            </div>
            <p style="margin-top: 12px;">Que souhaitez-vous faire ?</p>
          </div>
          <div class="modal-footer" style="flex-wrap: wrap; gap: 8px;">
            <button class="btn btn-secondary" id="dlg-btn-manual">Corriger manuellement dans l'éditeur</button>
            <button class="btn btn-secondary" id="dlg-btn-modify">Modifier ma demande</button>
            <button class="btn btn-primary" id="dlg-btn-continue">Poursuivre la réparation (+${retryCount} tentatives)</button>
          </div>
        </div>
      </div>
    `;

    dialogHost.querySelector('#dlg-btn-manual')?.addEventListener('click', () => {
      dialogHost.innerHTML = '';
      appState.setStatus('READY', 'Code chargé dans l\'éditeur pour retouche manuelle.');
      if (this.editorView) {
        this.editorView.focus();
      }
    });

    dialogHost.querySelector('#dlg-btn-modify')?.addEventListener('click', () => {
      dialogHost.innerHTML = '';
      const promptEl = document.querySelector('#prompt-textarea') as HTMLTextAreaElement;
      if (promptEl) promptEl.focus();
    });

    dialogHost.querySelector('#dlg-btn-continue')?.addEventListener('click', () => {
      dialogHost.innerHTML = '';
      appState.addLog(`Poursuite de la réparation automatique pour ${retryCount} tentatives supplémentaires...`, 'info');
      orchestrator.runSelfHealingValidation(
        detail.failingCode,
        detail.instruction,
        detail.sampleData,
        0 // Réinitialise le compteur pour les tentatives supplémentaires
      );
    });
  }
}
