import { appState } from '../../state';
import { orchestrator } from '../../services/orchestrator';
import { PromptAttachment } from '../../types/protocol';

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
    if (!text && appState.promptAttachments.length === 0) {
      alert("Veuillez saisir une consigne métier ou joindre un fichier de code.");
      return;
    }

    const finalInstruction = text || "Traite et traduis les fichiers joints selon les meilleures pratiques actuarielles Polars vectorisées.";
    appState.setPromptInstruction(finalInstruction);
    orchestrator.processInstruction(finalInstruction);
  }

  private setTemplate(text: string) {
    const textarea = this.container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.value = text;
      appState.setPromptInstruction(text);
    }
  }

  private async handleFilesDrop(files: FileList | File[]) {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const content = await file.text();
        const lines = content.split('\n').length;
        const ext = file.name.split('.').pop()?.toLowerCase();
        const isCode = ext === 'sas' || ext === 'py' || ext === 'sql';

        appState.addPromptAttachment({
          id: `file_${Date.now()}_${file.name}`,
          type: isCode ? 'code' : 'file',
          title: `${file.name} (${(file.size / 1024).toFixed(1)} Ko)`,
          content,
          metadata: {
            filename: file.name,
            sizeBytes: file.size,
            lineCount: lines
          }
        });
        appState.addLog(`Fichier joint au prompt : ${file.name} (${lines} lignes).`, 'success');
      } catch (err: any) {
        appState.addLog(`Impossible de lire le fichier joint ${file.name} : ${err.message}`, 'error');
      }
    }
  }

  public render() {
    const isProcessing = appState.status === 'PROCESSING';
    const statusMsg = appState.statusMessage;
    const transformations = appState.transformationsApplied;
    const warnings = appState.warnings;
    const instruction = appState.promptInstruction || '';
    const attachments = appState.promptAttachments || [];

    this.container.innerHTML = `
      <div class="prompt-box-panel" id="prompt-box-panel">
        <div class="prompt-box-header">
          <div class="prompt-title">
            <span class="icon">💬</span>
            <h3>Consigne actuarielle & Pièces jointes de contexte</h3>
          </div>
          <div class="prompt-templates">
            <span class="template-label">Exemples rapides :</span>
            <button class="template-btn" data-tmpl="join">Jointure Contrats & Sinistres</button>
            <button class="template-btn" data-tmpl="clean">Typage monétaire & Dates</button>
            <button class="template-btn" data-tmpl="agg">Agrégation par produit</button>
          </div>
        </div>

        <!-- Barre des pièces jointes (Badges / Chips) -->
        <div class="prompt-attachments-zone">
          <div class="prompt-attachments-bar">
            <div class="attachments-chips-list">
              ${attachments.length === 0 ? `
                <span class="attachments-empty-hint">Glissez un fichier SAS/code ici ou joignez le code/erreur ci-dessous.</span>
              ` : ''}

              ${attachments.map(att => `
                <div class="attachment-chip ${att.type}" data-id="${att.id}">
                  <span class="chip-icon">${att.type === 'code' ? '🐍' : att.type === 'error' ? '⚠️' : '📎'}</span>
                  <span class="chip-title" title="${att.title}">${att.title}</span>
                  <div class="chip-actions">
                    <button type="button" class="btn-chip-action btn-preview-att" data-id="${att.id}" title="Prévisualiser le contenu">👁️</button>
                    <button type="button" class="btn-chip-action btn-remove-att" data-id="${att.id}" title="Retirer">✕</button>
                  </div>
                </div>
              `).join('')}
            </div>

            <div class="attachments-actions-right">
              <button type="button" class="btn-attach-shortcut" id="btn-browse-file" title="Joindre un fichier (SAS, Python, SQL, texte...)">
                📎 Joindre un fichier
              </button>
              ${appState.currentCode.trim() ? `
                <button type="button" class="btn-attach-shortcut" id="btn-quick-code" title="Joindre le code actuel de l'éditeur Python">
                  🐍 Joindre code éditeur
                </button>
              ` : ''}
              ${(appState.lastError && appState.currentCode.trim()) ? `
                <button type="button" class="btn-attach-shortcut error-trigger" id="btn-quick-error" title="Joindre le contexte d'erreur actuel">
                  ⚠️ Joindre l'erreur
                </button>
              ` : ''}
              <input type="file" id="prompt-file-input" style="display:none;" multiple accept=".sas,.py,.sql,.txt,.csv,.tsv,.md" />
            </div>
          </div>
        </div>

        <div class="prompt-input-wrapper" id="prompt-drop-target">
          <textarea
            id="prompt-textarea"
            class="prompt-textarea"
            placeholder="Exemple : Évolue le code joint pour ajouter le calcul du ratio S/P, ou traduis ce script SAS en Polars..."
            rows="3"
            ${isProcessing ? 'disabled' : ''}
          >${instruction}</textarea>
          <div class="drop-overlay" id="prompt-drop-overlay">
            <span>📥 Déposez vos fichiers de code (SAS, Python, texte...) pour les joindre</span>
          </div>
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

        <!-- Modal d'aperçu d'une pièce jointe -->
        <div id="attachment-preview-modal-host"></div>
      </div>
    `;

    this.bindEvents();
  }

  private showAttachmentModal(attachment: PromptAttachment) {
    const modalHost = this.container.querySelector('#attachment-preview-modal-host');
    if (!modalHost) return;

    modalHost.innerHTML = `
      <div class="config-modal-backdrop">
        <div class="config-modal-card attachment-preview-modal">
          <div class="modal-header">
            <div class="modal-title">
              <span class="icon">${attachment.type === 'code' ? '🐍' : attachment.type === 'error' ? '⚠️' : '📎'}</span>
              <h3>${attachment.title}</h3>
            </div>
            <button class="btn-icon close-btn" id="btn-close-att-modal" title="Fermer">✕</button>
          </div>
          <div class="modal-body" style="padding: 12px 16px;">
            <div class="attachment-meta-info">
              <span>Type : <strong>${attachment.type}</strong></span>
              ${attachment.metadata?.lineCount ? `<span>• <strong>${attachment.metadata.lineCount}</strong> lignes</span>` : ''}
              ${attachment.metadata?.sizeBytes ? `<span>• <strong>${(attachment.metadata.sizeBytes / 1024).toFixed(1)}</strong> Ko</span>` : ''}
            </div>
            <div class="attachment-content-pre-box">
              <pre>${attachment.content}</pre>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary btn-sm" id="btn-copy-att-content">📋 Copier le contenu</button>
            <button class="btn btn-primary btn-sm" id="btn-close-att-footer">Fermer</button>
          </div>
        </div>
      </div>
    `;

    const closeFn = () => { modalHost.innerHTML = ''; };
    modalHost.querySelector('#btn-close-att-modal')?.addEventListener('click', closeFn);
    modalHost.querySelector('#btn-close-att-footer')?.addEventListener('click', closeFn);
    modalHost.querySelector('.config-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('config-modal-backdrop')) closeFn();
    });

    modalHost.querySelector('#btn-copy-att-content')?.addEventListener('click', () => {
      navigator.clipboard.writeText(attachment.content);
      appState.addLog("Contenu de la pièce jointe copié.", 'info');
    });
  }

  private bindEvents() {
    this.container.querySelector('#btn-generate')?.addEventListener('click', () => this.handleGenerate());

    // Maintien de la consigne lors de la frappe
    const textarea = this.container.querySelector('#prompt-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.addEventListener('input', () => {
        appState.promptInstruction = textarea.value;
      });
    }

    // Exemples rapides
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

    // Raccourcis pour joindre code et erreur
    this.container.querySelector('#btn-quick-code')?.addEventListener('click', () => {
      const code = appState.currentCode;
      if (!code.trim()) return;
      const lines = code.trim().split('\n').length;
      appState.addPromptAttachment({
        id: 'code_current',
        type: 'code',
        title: `Code Python éditeur (${lines} lignes)`,
        content: code,
        metadata: { lineCount: lines }
      });
    });

    this.container.querySelector('#btn-quick-error')?.addEventListener('click', () => {
      const err = appState.lastError;
      if (!err) return;
      appState.addPromptAttachment({
        id: `err_${Date.now()}`,
        type: 'error',
        title: `Erreur ${err.phase || 'RUNTIME'}`,
        content: `Message : ${err.message}\n` + (err.traceback ? `Traceback :\n${err.traceback}` : ''),
        metadata: { errorPhase: err.phase }
      });
    });

    // Sélection de fichier
    const fileInput = this.container.querySelector('#prompt-file-input') as HTMLInputElement;
    this.container.querySelector('#btn-browse-file')?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', () => {
      if (fileInput.files) {
        this.handleFilesDrop(fileInput.files);
        fileInput.value = '';
      }
    });

    // Actions sur les chips (Aperçu et Suppression)
    this.container.querySelectorAll('.btn-preview-att').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        const att = appState.promptAttachments.find(a => a.id === id);
        if (att) this.showAttachmentModal(att);
      });
    });

    this.container.querySelectorAll('.btn-remove-att').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        if (id) appState.removePromptAttachment(id);
      });
    });

    // Drag & drop de fichiers sur la zone de prompt
    const dropTarget = this.container.querySelector('#prompt-drop-target') as HTMLElement;
    const overlay = this.container.querySelector('#prompt-drop-overlay') as HTMLElement;

    if (dropTarget) {
      dropTarget.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (overlay) overlay.style.display = 'flex';
      });

      dropTarget.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (overlay) overlay.style.display = 'none';
      });

      dropTarget.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (overlay) overlay.style.display = 'none';
        if (e.dataTransfer && e.dataTransfer.files) {
          this.handleFilesDrop(e.dataTransfer.files);
        }
      });
    }
  }
}
