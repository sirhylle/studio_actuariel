import {
  WorkerAction,
  WorkerMessage,
  WorkerResponse,
  TableProfile,
  ExecutionResult,
  WorkerError
} from '../types/protocol';

class WorkerClient {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, {
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }>();
  private reqCounter = 0;
  private isInitialized = false;

  private getWorker(): Worker {
    if (!this.worker) {
      // Instanciation du Worker avec support Vite ESM
      this.worker = new Worker(
        new URL('../worker/pyodide.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, success, data, error } = event.data;
        const pending = this.pendingRequests.get(id);
        if (!pending) return;

        this.pendingRequests.delete(id);
        if (success) {
          pending.resolve(data);
        } else {
          pending.reject(error || new Error('Erreur inconnue du Worker'));
        }
      };

      this.worker.onerror = (err) => {
        console.error('[WorkerClient] Erreur non gérée dans le Worker:', err);
      };
    }
    return this.worker;
  }

  private send<T = any>(action: WorkerAction, payload?: any): Promise<T> {
    const worker = this.getWorker();
    const id = `req_${++this.reqCounter}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      const message: WorkerMessage = { id, action, payload };
      worker.postMessage(message);
    });
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    // Résolution précise de l'URL du dossier public/vendor
    const vendorBase = new URL('./vendor', window.location.href).href;
    await this.send('INIT', { vendorBase });
    this.isInitialized = true;
  }

  public async loadTable(
    alias: string,
    fileName: string,
    buffer: ArrayBuffer,
    separator = ';',
    sampleSize = 1000
  ): Promise<TableProfile> {
    return this.send<TableProfile>('LOAD_TABLE', {
      alias,
      fileName,
      buffer,
      separator,
      sampleSize
    });
  }

  public async unloadTable(alias: string): Promise<void> {
    return this.send<void>('UNLOAD_TABLE', { alias });
  }

  public async executeExtraction(extractionCode: string): Promise<Record<string, any>> {
    return this.send<Record<string, any>>('EXECUTE_EXTRACTION', { extractionCode });
  }

  public async checkSyntax(code: string): Promise<{ valid: boolean; error?: WorkerError }> {
    return this.send<{ valid: boolean; error?: WorkerError }>('CHECK_SYNTAX', { code });
  }

  public async executeDryRun(code: string): Promise<ExecutionResult> {
    return this.send<ExecutionResult>('EXECUTE_DRY_RUN', { code });
  }

  public async executeFull(code: string, outputSeparator = ';'): Promise<ExecutionResult> {
    return this.send<ExecutionResult>('EXECUTE_FULL', {
      code,
      outputSeparator
    });
  }
}

export const workerBridge = new WorkerClient();
