import { appState } from '../../state';
import { llmService } from '../../services/llm-service';

export class ConfigPanel {
  private container: HTMLElement;
  public isOpen = false;
  private testStatus: { status: 'idle' | 'testing' | 'success' | 'error'; message?: string; latency?: number } = { status: 'idle' };

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  public toggle(force?: boolean) {
    this.isOpen = force !== undefined ? force : !this.isOpen;
    if (this.isOpen) {
      this.testStatus = { status: 'idle' };
    }
    this.render();
  }

  private getFormValues() {
    const endpointInput = this.container.querySelector('#cfg-endpoint') as HTMLInputElement;
    const tokenInput = this.container.querySelector('#cfg-token') as HTMLInputElement;
    const modelInput = this.container.querySelector('#cfg-model') as HTMLInputElement;
    const maxSampleInput = this.container.querySelector('#cfg-max-sample') as HTMLInputElement;
    const maxRetriesInput = this.container.querySelector('#cfg-max-retries') as HTMLInputElement;
    const mockInput = this.container.querySelector('#cfg-mock') as HTMLInputElement;
    const apiTypeSelect = this.container.querySelector('#cfg-api-type') as HTMLSelectElement;
    const reasoningSelect = this.container.querySelector('#cfg-reasoning') as HTMLSelectElement;

    return {
      endpoint: endpointInput ? endpointInput.value.trim() : appState.llmConfig.endpoint,
      token: tokenInput ? tokenInput.value.trim() : appState.llmConfig.token,
      model: modelInput ? modelInput.value.trim() : (appState.llmConfig.model || 'gpt-6-luna'),
      maxSampleRows: maxSampleInput ? parseInt(maxSampleInput.value || '50', 10) : (appState.llmConfig.maxSampleRows || 50),
      maxSelfHealingRetries: maxRetriesInput ? parseInt(maxRetriesInput.value || '2', 10) : (appState.llmConfig.maxSelfHealingRetries ?? 2),
      useMock: mockInput ? mockInput.checked : appState.llmConfig.useMock,
      apiType: apiTypeSelect ? (apiTypeSelect.value as any) : (appState.llmConfig.apiType || 'chat_completions'),
      reasoningEffort: reasoningSelect ? (reasoningSelect.value as any) : (appState.llmConfig.reasoningEffort || 'low')
    };
  }

  private async handleTestConnection() {
    const currentValues = this.getFormValues();

    // Sauvegarde immédiate des valeurs saisies dans le localStorage pour ne jamais les perdre
    appState.saveConfig(currentValues);

    this.testStatus = { status: 'testing' };
    this.updateTestFeedback();

    try {
      const res = await llmService.testConnection(currentValues);
      this.testStatus = {
        status: 'success',
        message: res.message,
        latency: res.latencyMs
      };
      appState.addLog(`Test de connexion réussi vers l'endpoint LLM (${res.latencyMs} ms).`, 'success');
    } catch (err: any) {
      this.testStatus = {
        status: 'error',
        message: err.message || String(err)
      };
      appState.addLog(`Échec du test de connexion LLM : ${err.message || String(err)}`, 'error');
    }

    this.updateTestFeedback();
  }

  private updateTestFeedback() {
    const feedbackBox = this.container.querySelector('#cfg-test-feedback-container');
    if (feedbackBox) {
      feedbackBox.innerHTML = this.renderTestStatus();
    }
    const testBtn = this.container.querySelector('#cfg-test-btn') as HTMLButtonElement;
    if (testBtn) {
      testBtn.disabled = this.testStatus.status === 'testing';
      testBtn.innerHTML = this.testStatus.status === 'testing' ? '🔄 Test en cours...' : '🔌 Tester la connexion';
    }
  }

  private handleSave() {
    const vals = this.getFormValues();
    appState.saveConfig(vals);
    appState.addLog("Configuration LLM enregistrée dans le localStorage de votre poste.", 'success');
    this.isOpen = false;
    this.render();
  }

  private handleClear() {
    if (confirm("Voulez-vous vraiment effacer votre configuration et jeton d'authentification ?")) {
      appState.clearConfig();
      this.testStatus = { status: 'idle' };
      appState.addLog("Configuration LLM et jeton effacés du localStorage.", 'info');
      this.render();
    }
  }

  public render() {
    if (!this.isOpen) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'block';
    const cfg = appState.llmConfig;

    this.container.innerHTML = `
      <div class="config-modal-backdrop">
        <div class="config-modal-card">
          <div class="modal-header">
            <div class="modal-title">
              <span class="icon">⚙️</span>
              <h3>Configuration de l'accès LLM d'entreprise</h3>
            </div>
            <button class="btn-icon close-btn" id="cfg-close-btn" title="Fermer">✕</button>
          </div>

          <div class="modal-body">
            <div class="security-banner">
              <span class="shield-icon">🛡️</span>
              <p>
                <strong>Sécurité & Confidentialité :</strong> Votre jeton est stocké exclusivement dans le <code>localStorage</code> de votre navigateur local. Aucun appel externe n'est émis hors de votre réseau d'entreprise.
              </p>
            </div>

            <div class="form-grid">
              <div class="form-group full-width">
                <label for="cfg-endpoint">Endpoint API (OpenAI compatible / vLLM / LiteLLM / Azure) :</label>
                <input
                  type="text"
                  id="cfg-endpoint"
                  placeholder="https://llm-api.intranet.groupe.fr/v1/chat/completions"
                  value="${cfg.endpoint}"
                />
              </div>

              <div class="form-group full-width">
                <label for="cfg-token">Jeton d'authentification personnel (Bearer Token) :</label>
                <div class="password-wrapper">
                  <input
                    type="password"
                    id="cfg-token"
                    placeholder="eyJhbGciOi..."
                    value="${cfg.token}"
                  />
                  <button type="button" class="btn-toggle-pwd" id="btn-toggle-pwd" title="Afficher/Masquer">👁️</button>
                </div>
              </div>

              <div class="form-group">
                <label for="cfg-model">Modèle cible :</label>
                <input
                  type="text"
                  id="cfg-model"
                  placeholder="ex: mistral-large, gpt-4o, claude-3-5-sonnet"
                  value="${cfg.model}"
                />
              </div>

              <div class="form-group">
                <label for="cfg-api-type">Contrat d'API :</label>
                <select id="cfg-api-type" style="width: 100%; background: var(--bg-input); border: 1px solid var(--border-card); color: var(--text-main); padding: 8px 12px; border-radius: 6px; font-size: 13px;">
                  <option value="chat_completions" ${cfg.apiType !== 'responses_api' ? 'selected' : ''}>Chat Completions (/v1/chat/completions)</option>
                  <option value="responses_api" ${cfg.apiType === 'responses_api' ? 'selected' : ''}>Responses API (/v1/responses)</option>
                </select>
              </div>

              <div class="form-group">
                <label for="cfg-reasoning">Effort de raisonnement (Reasoning) :</label>
                <select id="cfg-reasoning" style="width: 100%; background: var(--bg-input); border: 1px solid var(--border-card); color: var(--text-main); padding: 8px 12px; border-radius: 6px; font-size: 13px;">
                  <option value="low" ${cfg.reasoningEffort === 'low' ? 'selected' : ''}>low (Recommandé pour gpt-6-luna / reasoning)</option>
                  <option value="none" ${(!cfg.reasoningEffort || cfg.reasoningEffort === 'none') ? 'selected' : ''}>none (Désactivé / Standard)</option>
                  <option value="medium" ${cfg.reasoningEffort === 'medium' ? 'selected' : ''}>medium</option>
                  <option value="high" ${cfg.reasoningEffort === 'high' ? 'selected' : ''}>high</option>
                </select>
              </div>

              <div class="form-group">
                <label for="cfg-max-sample">Budget de lignes pour l'échantillon ciblé :</label>
                <input
                  type="number"
                  id="cfg-max-sample"
                  min="5"
                  max="500"
                  value="${cfg.maxSampleRows || 50}"
                />
              </div>

              <div class="form-group">
                <label for="cfg-max-retries">Tentatives max d'auto-réparation (Self-Healing) :</label>
                <input
                  type="number"
                  id="cfg-max-retries"
                  min="0"
                  max="10"
                  value="${cfg.maxSelfHealingRetries ?? 2}"
                />
              </div>

              <div class="form-group checkbox-group">
                <label class="checkbox-label">
                  <input type="checkbox" id="cfg-mock" ${cfg.useMock ? 'checked' : ''} />
                  <span>Mode Simulation / Mock (pour tester sans token ni appel réseau)</span>
                </label>
              </div>
            </div>

            <div id="cfg-test-feedback-container">
              ${this.renderTestStatus()}
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" id="cfg-test-btn" ${this.testStatus.status === 'testing' ? 'disabled' : ''}>
              ${this.testStatus.status === 'testing' ? '🔄 Test en cours...' : '🔌 Tester la connexion'}
            </button>
            <div class="footer-right">
              <button class="btn btn-danger-outline" id="cfg-clear-btn">Effacer les identifiants</button>
              <button class="btn btn-primary" id="cfg-save-btn">Enregistrer</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderTestStatus(): string {
    if (this.testStatus.status === 'idle') return '';
    if (this.testStatus.status === 'testing') {
      return `
        <div class="test-feedback-box testing">
          <span>🔄</span>
          <span>Envoi d'un ping de contrôle vers l'endpoint...</span>
        </div>
      `;
    }
    if (this.testStatus.status === 'success') {
      return `
        <div class="test-feedback-box success">
          <span>✅</span>
          <div>
            <strong>Connexion établie avec succès (${this.testStatus.latency} ms) !</strong>
            <p>${this.testStatus.message}</p>
          </div>
        </div>
      `;
    }
    return `
      <div class="test-feedback-box error">
        <span>❌</span>
        <div>
          <strong>Échec de la connexion :</strong>
          <p>${this.testStatus.message}</p>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    this.container.querySelector('#cfg-close-btn')?.addEventListener('click', () => this.toggle(false));
    this.container.querySelector('#cfg-save-btn')?.addEventListener('click', () => this.handleSave());
    this.container.querySelector('#cfg-clear-btn')?.addEventListener('click', () => this.handleClear());
    this.container.querySelector('#cfg-test-btn')?.addEventListener('click', () => this.handleTestConnection());

    const togglePwdBtn = this.container.querySelector('#btn-toggle-pwd');
    const pwdInput = this.container.querySelector('#cfg-token') as HTMLInputElement;
    if (togglePwdBtn && pwdInput) {
      togglePwdBtn.addEventListener('click', () => {
        pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
      });
    }

    // Sauvegarde en temps réel lors de toute saisie ou sélection dans les champs
    const formFields = this.container.querySelectorAll('input, select');
    formFields.forEach(el => {
      const sync = () => {
        const vals = this.getFormValues();
        appState.llmConfig = { ...appState.llmConfig, ...vals };
        try {
          localStorage.setItem('studio_actuariel_llm_config', JSON.stringify(appState.llmConfig));
        } catch (e) {}
      };
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });

    // Fermeture par clic sur l'arrière-plan
    this.container.querySelector('.config-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('config-modal-backdrop')) {
        this.toggle(false);
      }
    });
  }
}
