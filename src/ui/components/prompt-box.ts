import { appState } from '../../state';
import { orchestrator } from '../../services/orchestrator';

export class PromptBox {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    appState.subscribe(() => this.render());
  }

  private handleGenerate() {
    const textarea = this.container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    const text = textarea?.value?.trim();
    if (!text) {
      alert("Veuillez saisir une consigne métier ou coller un bloc de code SAS.");
      return;
    }

    appState.setPromptInstruction(text);
    orchestrator.processInstruction(text);
  }

  private setTemplate(text: string) {
    const textarea = this.container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.value = text;
      appState.setPromptInstruction(text);
    }
  }

  public render() {
    const isProcessing = appState.status === 'PROCESSING';
    const statusMsg = appState.statusMessage;
    const transformations = appState.transformationsApplied;
    const warnings = appState.warnings;
    const instruction = appState.promptInstruction || '';

    this.container.innerHTML = `
      <div class="prompt-box-panel">
        <div class="prompt-box-header">
          <div class="prompt-title">
            <span class="icon">💬</span>
            <h3>Consigne actuarielle ou Code SAS source</h3>
          </div>
          <div class="prompt-templates">
            <span class="template-label">Exemples rapides :</span>
            <button class="template-btn" data-tmpl="join">Jointure Contrats & Sinistres</button>
            <button class="template-btn" data-tmpl="clean">Typage monétaire & Dates</button>
            <button class="template-btn" data-tmpl="agg">Agrégation par produit</button>
          </div>
        </div>

        <div class="prompt-input-wrapper">
          <textarea
            id="prompt-textarea"
            class="prompt-textarea"
            placeholder="Exemple : Joindre les tables 'contrats' et 'sinistres' sur num_police, nettoyer les montants français avec virgule, sommer les coûts de sinistres par contrat et calculer la marge technique..."
            rows="4"
            ${isProcessing ? 'disabled' : ''}
          >${instruction}</textarea>
        </div>

        <div class="prompt-actions-bar">
          <button class="btn btn-primary generate-btn" id="btn-generate" ${isProcessing ? 'disabled' : ''}>
            ${isProcessing ? `
              <span class="spinner">🔄</span>
              <span>Traitement en cours...</span>
            ` : `
              <span>✨ Générer & Traduire en Polars</span>
            `}
          </button>
        </div>

        ${isProcessing ? `
          <div class="processing-progress-bar">
            <div class="progress-indicator">
              <span class="pulse-dot"></span>
              <span class="progress-text">${statusMsg}</span>
            </div>
          </div>
        ` : ''}

        ${transformations.length > 0 ? `
          <div class="transformations-summary">
            <div class="summary-header">
              <span class="icon">✨</span>
              <strong>Opérations appliquées par l'IA :</strong>
            </div>
            <ul class="summary-list">
              ${transformations.map(t => `<li>${t}</li>`).join('')}
            </ul>

            ${warnings.length > 0 ? `
              <div class="warnings-box">
                <span class="icon">⚠️</span>
                <div>
                  <strong>Avertissements sémantiques :</strong>
                  <ul>
                    ${warnings.map(w => `<li>${w}</li>`).join('')}
                  </ul>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    this.container.querySelector('#btn-generate')?.addEventListener('click', () => this.handleGenerate());

    this.container.querySelectorAll('.template-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.tmpl;
        if (type === 'join') {
          this.setTemplate(`/* SAS Data Step à traduire */
data work.contrats_sinistres;
  merge contrats(in=a) sinistres(in=b);
  by num_police;
  if a;
  charge_totale = sum(cout_regle, 0);
  marge = prime_annuelle - charge_totale - frais_gestion;
run;`);
        } else if (type === 'clean') {
          this.setTemplate(`Nettoyer la table 'contrats' :
1. Convertir 'prime_annuelle' et 'frais_gestion' en Float64 (décimales à virgule française).
2. Convertir 'date_effet' en format Date.
3. Remplacer les valeurs nulles ou sentinelles par 0.0 pour les montants.`);
        } else if (type === 'agg') {
          this.setTemplate(`Calculer les statistiques actuarielles par code_produit sur la table 'contrats' :
- Nombre de polices par produit
- Somme totale des primes annuelles
- Prime moyenne par contrat`);
        }
      });
    });
  }
}
