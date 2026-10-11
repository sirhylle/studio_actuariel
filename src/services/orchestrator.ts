import { appState } from '../state';
import { workerBridge } from './worker-client';
import { llmService } from './llm-service';
import { WorkerError } from '../types/protocol';

export class Orchestrator {
  private isRunning = false;

  public async processInstruction(userInstruction: string): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const tables = appState.getLoadedTableProfiles();
    const config = appState.llmConfig;

    // Intégration transparente des pièces jointes contextuelles (code, erreurs, scripts SAS)
    let enrichedInstruction = userInstruction;
    const attachments = appState.promptAttachments;
    if (attachments.length > 0) {
      enrichedInstruction += "\n\n### PIÈCES JOINTES & CONTEXTE ADDITIONNEL FOURNI PAR L'UTILISATEUR :\n";
      for (const att of attachments) {
        if (att.type === 'code') {
          enrichedInstruction += `\n#### 🐍 CODE SOURCE PYTHON ATTACHÉ (${att.title}) :\n\`\`\`python\n${att.content}\n\`\`\`\n`;
        } else if (att.type === 'error') {
          enrichedInstruction += `\n#### ⚠️ CONTEXTE D'ERREUR DU RUN PRÉCÉDENT (${att.title}) :\n\`\`\`text\n${att.content}\n\`\`\`\n`;
        } else {
          const ext = att.metadata?.filename?.split('.').pop()?.toLowerCase() || 'text';
          enrichedInstruction += `\n#### 📎 FICHIER JOINT (${att.title}) :\n\`\`\`${ext}\n${att.content}\n\`\`\`\n`;
        }
      }
    }

    try {
      let extractedSample: Record<string, any> = {};

      if (tables.length > 0) {
        // -------------------------------------------------------------
        // Étape 1 : Décision de la stratégie d'échantillonnage par le LLM
        // -------------------------------------------------------------
        appState.setStatus('PROCESSING', "Étape 1/4 : Décision de la stratégie d'échantillonnage par l'IA...");
        appState.addLog("Interrogation du LLM pour décider de la stratégie d'échantillonnage...", 'info');

        const strategyRes = await llmService.requestSamplingStrategy(
          enrichedInstruction,
          tables,
          config.maxSampleRows || 50,
          config
        );

        appState.setExtractionData(strategyRes.strategyExplanation, null);
        appState.addLog(`Stratégie décidée : ${strategyRes.strategyExplanation}`, 'info');

        // -------------------------------------------------------------
        // Étape 2 : Exécution locale du code d'extraction dans le Worker
        // -------------------------------------------------------------
        appState.setStatus('PROCESSING', "Étape 2/4 : Extraction locale de l'échantillon ciblé en Wasm...");
        appState.addLog("Exécution locale de la requête d'extraction en mémoire...", 'info');

        extractedSample = await workerBridge.executeExtraction(strategyRes.extractionPythonCode);
        appState.setExtractionData(strategyRes.strategyExplanation, extractedSample);
        appState.addLog("Échantillon ciblé extrait avec succès et prêt pour l'ancrage.", 'success');
      } else {
        appState.addLog("Génération sans table source préalable : traitement autonome de la consigne et des pièces jointes.", 'info');
      }

      // -------------------------------------------------------------
      // Étape 3 : Génération du code Polars
      // -------------------------------------------------------------
      appState.setStatus('PROCESSING', tables.length > 0 ? "Étape 3/4 : Génération du code Polars vectorisé..." : "Génération du code Polars par l'IA...");
      appState.addLog("Génération du code vectorisé par le LLM...", 'info');

      const codeRes = await llmService.generateActuarialCode(
        enrichedInstruction,
        tables,
        extractedSample,
        config
      );

      let currentCode = codeRes.pythonCode;
      appState.setCode(currentCode);
      appState.setTransformations(codeRes.transformationsApplied, codeRes.warnings);

      // -------------------------------------------------------------
      // Étape 4 : Validation locale AST, Dry-Run et boucle d'auto-guérison
      // -------------------------------------------------------------
      await this.runSelfHealingValidation(currentCode, enrichedInstruction, extractedSample, 0);

    } catch (err: any) {
      appState.setStatus('READY', 'Pyodide & Polars Prêts');
      appState.addLog(`Échec : ${err.message || String(err)}`, 'error');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Boucle d'auto-guérison (AST ➔ Dry-Run ➔ Réparation) avec demande utilisateur en cas de dépassement.
   */
  public async runSelfHealingValidation(
    codeToTest: string,
    instruction: string,
    sampleData: Record<string, any>,
    attemptNumber = 0
  ): Promise<boolean> {
    const config = appState.llmConfig;
    const maxRetries = config.maxSelfHealingRetries ?? 2;
    let currentCode = codeToTest;
    let attempts = attemptNumber;

    while (attempts <= maxRetries) {
      // 1. Contrôle syntaxique AST
      appState.setStatus('PROCESSING', `Validation syntaxique AST (tentative ${attempts + 1}/${maxRetries + 1})...`);
      let astCheck: { valid: boolean; error?: WorkerError };
      try {
        astCheck = await workerBridge.checkSyntax(currentCode);
      } catch (err: any) {
        astCheck = {
          valid: false,
          error: {
            phase: 'AST',
            message: err.message || String(err),
            line: err.line
          }
        };
      }

      if (!astCheck.valid) {
        const error: WorkerError = astCheck.error || {
          phase: 'AST',
          message: 'Erreur de syntaxe Python'
        };

        if (attempts >= maxRetries) {
          this.handleMaxRetriesReached(currentCode, error, instruction, sampleData, attempts);
          return false;
        }

        appState.setStatus('PROCESSING', `Auto-réparation de l'erreur de syntaxe par le LLM (${attempts + 1}/${maxRetries})...`);
        appState.addLog(`Erreur AST détectée : ${error.message}. Demande de réparation au LLM...`, 'warn');

        const repairRes = await llmService.repairLlmCode(
          { previousCode: currentCode, error, userInstruction: instruction, sampleData },
          config
        );
        currentCode = repairRes.pythonCode;
        appState.setCode(currentCode);
        attempts++;
        continue;
      }

      // 2. Test Dry-Run sur l'échantillon
      appState.setStatus('PROCESSING', `Exécution du test Dry-Run en mémoire (tentative ${attempts + 1}/${maxRetries + 1})...`);
      try {
        const dryRunRes = await workerBridge.executeDryRun(currentCode);

        // Succès total !
        appState.setCode(currentCode);
        appState.setDryRunResult(dryRunRes);
        appState.pushExecutedCode(currentCode, 'Validation IA');
        appState.setStatus('READY', 'Code validé et prêt à l\'emploi');
        appState.addLog(`Test Dry-Run réussi (${dryRunRes.outputRowCount} lignes produites dans df_out).`, 'success');
        return true;
      } catch (err: any) {
        const error: WorkerError = err.phase ? err : {
          phase: 'RUNTIME',
          message: err.message || String(err),
          traceback: err.traceback
        };

        if (attempts >= maxRetries) {
          this.handleMaxRetriesReached(currentCode, error, instruction, sampleData, attempts);
          return false;
        }

        appState.setStatus('PROCESSING', `Auto-réparation de l'erreur d'exécution par le LLM (${attempts + 1}/${maxRetries})...`);
        appState.addLog(`Erreur Polars en Dry-Run : ${error.message}. Demande de réparation...`, 'warn');

        const repairRes = await llmService.repairLlmCode(
          { previousCode: currentCode, error, userInstruction: instruction, sampleData },
          config
        );
        currentCode = repairRes.pythonCode;
        appState.setCode(currentCode);
        attempts++;
        continue;
      }
    }

    return false;
  }

  /**
   * Lorsque le quota max de retouches est atteint, avertit et offre le choix à l'utilisateur.
   */
  private handleMaxRetriesReached(
    failingCode: string,
    error: WorkerError,
    instruction: string,
    sampleData: Record<string, any>,
    attemptsCount: number
  ) {
    appState.setCode(failingCode);
    appState.setStatus('ERROR', `Limite de ${attemptsCount} auto-réparations atteinte.`);
    appState.addLog(
      `Nombre maximal de tentatives atteint (${attemptsCount}). Erreur persistante : ${error.message}.`,
      'error',
      { error, failingCode }
    );

    // Déclenchement d'un événement global pour afficher la boîte de dialogue de choix dans l'UI
    window.dispatchEvent(new CustomEvent('studio:max-retries-reached', {
      detail: {
        failingCode,
        error,
        instruction,
        sampleData,
        maxRetries: appState.llmConfig.maxSelfHealingRetries ?? 2
      }
    }));
  }
}

export const orchestrator = new Orchestrator();
