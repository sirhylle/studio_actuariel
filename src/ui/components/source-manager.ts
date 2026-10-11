import { appState, LoadedTable } from '../../state';
import { workerBridge } from '../../services/worker-client';

export class SourceManager {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    appState.subscribe(() => this.render());
  }

  private slugifyAlias(name: string): string {
    return name
      .replace(/\.[^/.]+$/, '') // retire l'extension
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^([0-9])/, '_$1'); // préfixe si commence par un chiffre
  }

  private async handleFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let baseAlias = this.slugifyAlias(file.name);
      
      // Assurer un alias unique
      let alias = baseAlias;
      let counter = 1;
      while (appState.tables.has(alias)) {
        alias = `${baseAlias}_${++counter}`;
      }

      appState.addLog(`Lecture du fichier ${file.name} (${(file.size / 1024).toFixed(1)} Ko)...`, 'info');

      try {
        const buffer = await file.arrayBuffer();
        
        // Détection heuristique du séparateur par défaut
        const sampleText = new TextDecoder('utf-8').decode(buffer.slice(0, 4096));
        const countSemi = (sampleText.match(/;/g) || []).length;
        const countComma = (sampleText.match(/,/g) || []).length;
        const countTab = (sampleText.match(/\t/g) || []).length;
        const countPipe = (sampleText.match(/\|/g) || []).length;

        let detectedSep = ';';
        if (countComma > countSemi && countComma > countTab && countComma > countPipe) detectedSep = ',';
        else if (countTab > countSemi && countTab > countComma && countTab > countPipe) detectedSep = '\t';
        else if (countPipe > countSemi && countPipe > countComma && countPipe > countTab) detectedSep = '|';

        const sampleSize = 1000;

        const tableItem: LoadedTable = {
          alias,
          fileName: file.name,
          buffer,
          separator: detectedSep,
          sampleSize
        };

        appState.addTable(tableItem);
        await this.loadAndProfileTable(tableItem);

      } catch (err: any) {
        appState.addLog(`Erreur de lecture du fichier ${file.name}: ${err.message || String(err)}`, 'error');
      }
    }
  }

  private async loadAndProfileTable(table: LoadedTable) {
    try {
      appState.addLog(`Chargement et profiling Polars de dfs['${table.alias}']...`, 'info');
      const profile = await workerBridge.loadTable(
        table.alias,
        table.fileName,
        table.buffer,
        table.separator,
        table.sampleSize
      );

      appState.updateTable(table.alias, { profile });
      appState.addLog(`Table '${table.alias}' profilée avec succès (${profile.columns.length} colonnes).`, 'success');
    } catch (err: any) {
      appState.addLog(`Erreur lors du profiling de '${table.alias}': ${err.message || String(err)}`, 'error');
    }
  }

  private async handleRemove(alias: string) {
    try {
      await workerBridge.unloadTable(alias);
      appState.removeTable(alias);
      appState.addLog(`Table '${alias}' déchargée de la mémoire.`, 'info');
    } catch (err: any) {
      appState.addLog(`Erreur lors du déchargement de '${alias}': ${err.message || String(err)}`, 'error');
    }
  }

  public render() {
    const tablesList = Array.from(appState.tables.values());

    this.container.innerHTML = `
      <div class="source-manager-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="icon">📁</span>
            <h3>Sources de données (${tablesList.length})</h3>
          </div>
        </div>

        <div class="drop-zone" id="drop-zone">
          <div class="drop-zone-content">
            <span class="drop-icon">📥</span>
            <p class="drop-title">Glissez vos fichiers CSV / TSV ici</p>
            <p class="drop-subtitle">ou <label class="browse-link" for="file-input">parcourir vos dossiers</label></p>
            <input type="file" id="file-input" multiple accept=".csv,.tsv,.txt" style="display: none;" />
          </div>
        </div>

        <div class="tables-list">
          ${tablesList.length === 0 ? `
            <div class="empty-state">
              <p>Aucune table chargée.</p>
              <small>Déposez des fichiers CSV/TSV pour commencer.</small>
              <button class="btn btn-secondary btn-sm" id="btn-load-demo-data" style="margin-top: 12px; width: 100%;">
                📂 Charger les tables d'exemple (contrats & sinistres)
              </button>
            </div>
          ` : ''}

          ${tablesList.map(t => {
            const isSelected = appState.activeTableAlias === t.alias;
            const profile = t.profile;
            return `
              <div class="table-card ${isSelected ? 'selected' : ''}" data-alias="${t.alias}">
                <div class="table-card-top">
                  <div class="table-alias-badge">
                    <span class="code-tag">dfs['${t.alias}']</span>
                  </div>
                  <button class="btn-icon delete-btn" title="Supprimer la table" data-remove="${t.alias}">🗑️</button>
                </div>

                <div class="table-filename" title="${t.fileName}">${t.fileName}</div>

                <div class="table-controls">
                  <div class="control-group-full">
                    <label>Séparateur :</label>
                    <select class="sep-select" data-alias="${t.alias}">
                      <option value=";" ${t.separator === ';' ? 'selected' : ''}>; (point-virgule)</option>
                      <option value="," ${t.separator === ',' ? 'selected' : ''}>, (virgule)</option>
                      <option value="\t" ${t.separator === '\t' ? 'selected' : ''}>\t (tabulation)</option>
                      <option value="|" ${t.separator === '|' ? 'selected' : ''}>| (pipe)</option>
                    </select>
                  </div>
                </div>

                ${profile ? `
                  <div class="table-meta-bar">
                    <span class="meta-highlight"><strong>${profile.totalRowCount.toLocaleString()}</strong> lignes</span>
                    <span class="meta-sep">•</span>
                    <span><strong>${profile.columns.length}</strong> colonnes</span>
                  </div>
                ` : `
                  <div class="table-loading-bar">⏳ Profiling en cours...</div>
                `}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    const dropZone = this.container.querySelector('#drop-zone');
    const fileInput = this.container.querySelector('#file-input') as HTMLInputElement;

    if (dropZone && fileInput) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });

      dropZone.addEventListener('drop', (e: any) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        this.handleFiles(e.dataTransfer.files);
      });

      fileInput.addEventListener('change', () => {
        this.handleFiles(fileInput.files);
        fileInput.value = '';
      });
    }

    // Gestion de la sélection d'une table
    this.container.querySelectorAll('.table-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.delete-btn') || target.closest('select') || target.closest('input')) {
          return;
        }
        const alias = (card as HTMLElement).dataset.alias;
        if (alias) appState.setActiveTable(alias);
      });
    });

    // Suppression
    this.container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const alias = (btn as HTMLElement).dataset.remove;
        if (alias) this.handleRemove(alias);
      });
    });

    // Changement de séparateur
    this.container.querySelectorAll('.sep-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        e.stopPropagation();
        const alias = (select as HTMLElement).dataset.alias;
        const val = (select as HTMLSelectElement).value;
        if (!alias) return;
        const table = appState.tables.get(alias);
        if (table) {
          table.separator = val;
          appState.updateTable(alias, { separator: val });
          await this.loadAndProfileTable(table);
        }
      });
    });

    // Bouton de chargement des données de démo
    this.container.querySelector('#btn-load-demo-data')?.addEventListener('click', () => {
      this.loadDemoData();
    });
  }

  private async loadDemoData() {
    try {
      appState.setStatus('PROCESSING', "Chargement du jeu d'essai actuariel...");
      appState.addLog("Chargement automatique des tables d'exemple (contrats.csv, sinistres.csv)...", 'info');

      const r1 = await fetch('./test_data/contrats.csv');
      const b1 = await r1.arrayBuffer();
      const f1 = new File([b1], 'contrats.csv', { type: 'text/csv' });

      const r2 = await fetch('./test_data/sinistres.csv');
      const b2 = await r2.arrayBuffer();
      const f2 = new File([b2], 'sinistres.csv', { type: 'text/csv' });

      await this.handleFiles([f1, f2]);

      appState.setStatus('READY', 'Jeu d\'essai chargé avec succès');
      appState.addLog("Données d'essai 'contrats' et 'sinistres' prêtes pour analyse.", 'success');
    } catch (e: any) {
      appState.setStatus('ERROR', `Erreur chargement démo: ${e.message}`);
      appState.addLog(`Échec chargement démo : ${e.message}`, 'error');
    }
  }
}
