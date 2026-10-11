import { TableProfile, ExecutionResult, PromptAttachment, WorkerError } from './types/protocol';
import { LlmConfig } from './types/llm';

export type AppStatus = 'UNINITIALIZED' | 'LOADING' | 'READY' | 'PROCESSING' | 'ERROR';

export interface LoadedTable {
  alias: string;
  fileName: string;
  buffer: ArrayBuffer;
  separator: string;
  sampleSize: number;
  fileType?: 'csv' | 'tsv' | 'parquet' | 'xlsx';
  hasHeader?: boolean;
  rawExcelSample?: string[][];
  profile?: TableProfile;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  details?: any;
}

export interface CodeHistoryItem {
  id: string;
  code: string;
  timestamp: string;
  label: string;
  hasValidDfOut: boolean;
}

class AppState {
  private listeners: Set<() => void> = new Set();

  public status: AppStatus = 'UNINITIALIZED';
  public statusMessage: string = 'Initialisation...';
  
  public tables: Map<string, LoadedTable> = new Map();
  public activeTableAlias: string | null = null;
  
  public currentCode: string = '';
  public liveDraftCode: string = '';
  public codeHistory: CodeHistoryItem[] = [];
  public historyIndex: number = -1; // -1 = live draft, 0..N = index in history

  public promptInstruction: string = '';
  public promptAttachments: PromptAttachment[] = [];
  public lastError: WorkerError | null = null;
  
  public dryRunResult: ExecutionResult | null = null;
  public extractionResult: Record<string, any> | null = null;
  public extractionStrategy: string | null = null;
  public transformationsApplied: string[] = [];
  public warnings: string[] = [];
  
  public logs: LogEntry[] = [];

  public llmConfig: LlmConfig = {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    token: '',
    model: 'gpt-4o',
    maxSampleRows: 50,
    maxSelfHealingRetries: 2,
    useMock: false
  };

  constructor() {
    this.loadConfigFromStorage();
  }

  private loadConfigFromStorage() {
    try {
      const stored = localStorage.getItem('studio_actuariel_llm_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.llmConfig = { ...this.llmConfig, ...parsed };
        // Si un token est présent, désactiver useMock par défaut sauf si explicitement conservé
        if (this.llmConfig.token && parsed.useMock === undefined) {
          this.llmConfig.useMock = false;
        }
      }
    } catch (e) {
      console.warn('[AppState] Impossible de charger la configuration depuis localStorage:', e);
    }
  }

  public saveConfig(config: Partial<LlmConfig>) {
    this.llmConfig = { ...this.llmConfig, ...config };
    try {
      localStorage.setItem('studio_actuariel_llm_config', JSON.stringify(this.llmConfig));
    } catch (e) {
      console.warn('[AppState] Erreur de sauvegarde dans localStorage:', e);
    }
    this.notify();
  }

  public clearConfig() {
    this.llmConfig = {
      endpoint: '',
      token: '',
      model: 'gpt-4o',
      maxSampleRows: 50,
      maxSelfHealingRetries: 2
    };
    try {
      localStorage.removeItem('studio_actuariel_llm_config');
    } catch (e) {}
    this.notify();
  }

  public setStatus(status: AppStatus, message?: string) {
    this.status = status;
    if (message !== undefined) this.statusMessage = message;
    this.notify();
  }

  public addTable(table: LoadedTable) {
    this.tables.set(table.alias, table);
    if (!this.activeTableAlias) {
      this.activeTableAlias = table.alias;
    }
    this.notify();
  }

  public updateTable(alias: string, updates: Partial<LoadedTable>) {
    const existing = this.tables.get(alias);
    if (existing) {
      this.tables.set(alias, { ...existing, ...updates });
      this.notify();
    }
  }

  public removeTable(alias: string) {
    this.tables.delete(alias);
    if (this.activeTableAlias === alias) {
      const remaining = Array.from(this.tables.keys());
      this.activeTableAlias = remaining.length > 0 ? remaining[0] : null;
    }
    this.notify();
  }

  public renameTableAlias(oldAlias: string, newAlias: string): boolean {
    if (!newAlias || this.tables.has(newAlias)) return false;
    const existing = this.tables.get(oldAlias);
    if (!existing) return false;
    this.tables.delete(oldAlias);
    existing.alias = newAlias;
    if (existing.profile) {
      existing.profile.alias = newAlias;
    }
    this.tables.set(newAlias, existing);
    if (this.activeTableAlias === oldAlias) {
      this.activeTableAlias = newAlias;
    }
    this.notify();
    return true;
  }

  public setActiveTable(alias: string) {
    if (this.tables.has(alias)) {
      this.activeTableAlias = alias;
      this.notify();
    }
  }

  public setCode(code: string, isFromUserEdit = false) {
    const codeChanged = this.currentCode !== code;
    this.currentCode = code;

    // Si l'utilisateur édite manuellement le code alors qu'on est sur le draft (-1), mettre à jour liveDraftCode
    if (isFromUserEdit) {
      if (this.historyIndex === -1) {
        this.liveDraftCode = code;
      } else {
        // Si l'utilisateur modifie une version issue de l'historique, cela devient son nouveau draft en direct
        this.historyIndex = -1;
        this.liveDraftCode = code;
      }
    }

    // Si le code est complètement vidé par l'utilisateur
    if (!code.trim()) {
      this.lastError = null;
      this.dryRunResult = null;
    } else if (isFromUserEdit && codeChanged && this.dryRunResult) {
      // Si l'utilisateur modifie manuellement le code, invalider le dernier résultat de dry-run
      this.dryRunResult = { ...this.dryRunResult, hasValidDfOut: false };
    }

    this.notify();
  }

  /**
   * Sauvegarde un code dans l'historique dès qu'il fait l'objet d'un test (Dry-Run ou exécution).
   */
  public pushExecutedCode(code: string, label = 'Exécution') {
    if (!code.trim()) return;

    // Éviter d'ajouter un doublon consécutif identique
    const last = this.codeHistory[this.codeHistory.length - 1];
    if (last && last.code.trim() === code.trim()) {
      last.hasValidDfOut = !!this.dryRunResult?.hasValidDfOut;
      return;
    }

    const item: CodeHistoryItem = {
      id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      code,
      timestamp: new Date().toLocaleTimeString(),
      label,
      hasValidDfOut: !!this.dryRunResult?.hasValidDfOut
    };

    this.codeHistory.push(item);
    // Limite à 50 versions
    if (this.codeHistory.length > 50) this.codeHistory.shift();

    // Après une exécution, on est positionné sur la dernière version exécutée
    this.historyIndex = -1;
    this.liveDraftCode = code;
    this.notify();
  }

  /**
   * Navigation dans l'historique : direction = -1 (précédent / back) ou +1 (suivant / forward).
   */
  public navigateHistory(direction: -1 | 1): boolean {
    if (this.codeHistory.length === 0) return false;

    if (direction === -1) {
      // Reculer
      if (this.historyIndex === -1) {
        // On était sur le draft en direct : sauvegarder le live draft avant de reculer
        this.liveDraftCode = this.currentCode;
        this.historyIndex = this.codeHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      } else {
        return false; // Déjà au tout début
      }
      this.currentCode = this.codeHistory[this.historyIndex].code;
      this.notify();
      return true;
    } else if (direction === 1) {
      // Avancer
      if (this.historyIndex === -1) {
        return false; // Déjà sur le live draft
      }
      if (this.historyIndex < this.codeHistory.length - 1) {
        this.historyIndex++;
        this.currentCode = this.codeHistory[this.historyIndex].code;
      } else {
        // Retour sur le draft en direct
        this.historyIndex = -1;
        this.currentCode = this.liveDraftCode;
      }
      this.notify();
      return true;
    }
    return false;
  }

  public setPromptInstruction(instruction: string) {
    this.promptInstruction = instruction;
    this.notify();
  }

  public addPromptAttachment(attachment: PromptAttachment) {
    // Si c'est du code ou une erreur, remplacer un éventuel badge préexistant du même type (mise à jour du snapshot)
    if (attachment.type === 'code' || attachment.type === 'error') {
      this.promptAttachments = this.promptAttachments.filter(a => a.type !== attachment.type);
    } else {
      // Pour les fichiers, éviter les doublons par identifiant ou nom identique
      this.promptAttachments = this.promptAttachments.filter(a => a.id !== attachment.id && a.title !== attachment.title);
    }
    this.promptAttachments.push(attachment);
    this.notify();
  }

  public removePromptAttachment(id: string) {
    this.promptAttachments = this.promptAttachments.filter(a => a.id !== id);
    this.notify();
  }

  public clearPromptAttachments() {
    this.promptAttachments = [];
    this.notify();
  }

  public setLastError(err: WorkerError | null) {
    this.lastError = err;
    this.notify();
  }

  public setDryRunResult(result: ExecutionResult | null) {
    this.dryRunResult = result;
    if (result?.error) {
      this.lastError = result.error;
    } else {
      // Si l'exécution ne sort plus en erreur, effacer l'erreur
      this.lastError = null;
    }
    this.notify();
  }

  public setExtractionData(strategy: string | null, data: Record<string, any> | null) {
    this.extractionStrategy = strategy;
    this.extractionResult = data;
    this.notify();
  }

  public setTransformations(transformations: string[], warnings: string[] = []) {
    this.transformationsApplied = transformations;
    this.warnings = warnings;
    this.notify();
  }

  public addLog(message: string, level: LogEntry['level'] = 'info', details?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
      details
    };
    this.logs.unshift(entry); // Le plus récent en premier
    if (this.logs.length > 200) this.logs.pop();
    this.notify();
  }

  public getLoadedTableProfiles(): TableProfile[] {
    return Array.from(this.tables.values())
      .map(t => t.profile)
      .filter((p): p is TableProfile => !!p);
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[AppState] Erreur dans un listener:', err);
      }
    }
  }
}

export const appState = new AppState();
