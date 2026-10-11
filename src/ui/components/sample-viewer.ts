import { appState } from '../../state';

export class SampleViewer {
  private container: HTMLElement;
  private currentViewMode: 'preview' | 'schema' | 'extracted' = 'preview';

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    appState.subscribe(() => this.render());
  }

  public render() {
    const activeAlias = appState.activeTableAlias;
    const table = activeAlias ? appState.tables.get(activeAlias) : null;
    const profile = table?.profile;
    const hasExtractedData = appState.extractionResult !== null;

    if (!table || !profile) {
      this.container.innerHTML = `
        <div class="sample-viewer-empty">
          <span class="icon">🔍</span>
          <p>Sélectionnez ou déposez une table pour visualiser son profil et ses premières lignes.</p>
        </div>
      `;
      return;
    }

    this.container.innerHTML = `
      <div class="sample-viewer-panel">
        <div class="viewer-header">
          <div class="viewer-tabs">
            <button class="viewer-tab-btn ${this.currentViewMode === 'preview' ? 'active' : ''}" data-view="preview">
              <span>📋</span> Aperçu des lignes (head)
            </button>
            <button class="viewer-tab-btn ${this.currentViewMode === 'schema' ? 'active' : ''}" data-view="schema">
              <span>📊</span> Synthèse des colonnes (${profile.columns.length})
            </button>
            ${hasExtractedData ? `
              <button class="viewer-tab-btn ${this.currentViewMode === 'extracted' ? 'active' : ''}" data-view="extracted">
                <span>🎯</span> Échantillon ciblé par le LLM
              </button>
            ` : ''}
          </div>

          <div class="viewer-stats-badge">
            <span>Table : <strong>dfs['${profile.alias}']</strong></span>
            <span>(<strong>${profile.totalRowCount.toLocaleString()}</strong> lignes au total, ${profile.columns.length} colonnes)</span>
          </div>
        </div>

        <div class="viewer-content">
          ${this.currentViewMode === 'preview' ? this.renderPreviewTable(profile) : ''}
          ${this.currentViewMode === 'schema' ? this.renderSchemaSummary(profile) : ''}
          ${this.currentViewMode === 'extracted' ? this.renderExtractedSample() : ''}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderPreviewTable(profile: any): string {
    const records = profile.rawRecordsHead;
    if (!records || records.length === 0) {
      return `<div class="empty-data">Aucune donnée disponible pour l'aperçu.</div>`;
    }

    const columns = profile.columns.map((c: any) => c.name);

    return `
      <div class="table-scroll-container">
        <table class="data-table">
          <thead>
            <tr>
              <th class="row-num-col">#</th>
              ${columns.map((col: string) => {
                const colMeta = profile.columns.find((c: any) => c.name === col);
                const rawTypeStr = colMeta ? colMeta.rawType : '';
                const semType = colMeta?.semanticType;
                const hasSemantic = semType && semType !== rawTypeStr;
                return `
                  <th>
                    <div class="col-header-box">
                      <span class="col-name">${col}</span>
                      <div class="col-types-row">
                        <span class="col-type-tag">${rawTypeStr}</span>
                        ${hasSemantic ? `<span class="semantic-type-tag" title="Détection sémantique">${semType}</span>` : ''}
                      </div>
                    </div>
                  </th>
                `;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${records.map((row: any, idx: number) => `
              <tr>
                <td class="row-num-col">${idx + 1}</td>
                ${columns.map((col: string) => {
                  const val = row[col];
                  if (val === null || val === undefined) {
                    return `<td><span class="null-tag">null</span></td>`;
                  }
                  return `<td title="${String(val)}">${String(val)}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderSchemaSummary(profile: any): string {
    const totalSampled = profile.totalRowsSampled || 1;

    return `
      <div class="table-scroll-container">
        <table class="data-table schema-table">
          <thead>
            <tr>
              <th>Nom de la colonne</th>
              <th>Type brut Polars</th>
              <th>Format sémantique détecté</th>
              <th>Taux de valeurs nulles</th>
              <th>Valeurs uniques</th>
              <th>Exemples réels</th>
            </tr>
          </thead>
          <tbody>
            ${profile.columns.map((col: any) => {
              const nullPct = ((col.nullCount / totalSampled) * 100).toFixed(1);
              const hasSemantic = col.semanticType && col.semanticType !== col.rawType;
              return `
                <tr>
                  <td><strong>${col.name}</strong></td>
                  <td><span class="col-type-tag">${col.rawType}</span></td>
                  <td>
                    ${hasSemantic ? `
                      <span class="semantic-type-tag highlighted">${col.semanticType}</span>
                    ` : `
                      <span class="semantic-type-dim">Standard (${col.rawType})</span>
                    `}
                  </td>
                  <td>
                    <div class="null-progress-cell">
                      <div class="null-bar-container">
                        <div class="null-bar" style="width: ${nullPct}%"></div>
                      </div>
                      <span class="null-pct-text">${col.nullCount} (${nullPct}%)</span>
                    </div>
                  </td>
                  <td>${col.uniqueCount}</td>
                  <td>
                    <div class="sample-pills">
                      ${col.sampleValues.map((v: any) => `
                        <span class="sample-pill">${v === null ? 'null' : String(v)}</span>
                      `).join('')}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderExtractedSample(): string {
    const extracted = appState.extractionResult;
    const strategy = appState.extractionStrategy;

    if (!extracted) {
      return `<div class="empty-data">Aucun échantillon extrait pour le moment.</div>`;
    }

    return `
      <div class="extracted-sample-box">
        ${strategy ? `
          <div class="strategy-banner">
            <span class="icon">💡</span>
            <div>
              <strong>Stratégie d'extraction formulée par le LLM :</strong>
              <p>${strategy}</p>
            </div>
          </div>
        ` : ''}

        <div class="extracted-tables">
          ${Object.entries(extracted).map(([key, rows]: [string, any]) => {
            const list = Array.isArray(rows) ? rows : [];
            if (list.length === 0) return `<p>Sous-échantillon '${key}' vide.</p>`;
            const cols = Object.keys(list[0]);
            return `
              <div class="extracted-subtable">
                <h4>Échantillon : ${key} (${list.length} lignes)</h4>
                <div class="table-scroll-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        ${cols.map(c => `<th>${c}</th>`).join('')}
                      </tr>
                    </thead>
                    <tbody>
                      ${list.slice(0, 15).map((r: any) => `
                        <tr>
                          ${cols.map(c => `<td>${r[c] === null ? '<span class="null-tag">null</span>' : String(r[c])}</td>`).join('')}
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  private bindEvents() {
    this.container.querySelectorAll('.viewer-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.view as any;
        if (mode) {
          this.currentViewMode = mode;
          this.render();
        }
      });
    });
  }
}
