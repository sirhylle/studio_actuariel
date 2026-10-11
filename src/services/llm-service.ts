import { TableProfile } from '../types/protocol';
import {
  LlmConfig,
  SamplingStrategyResponse,
  ActuarialCodeResponse,
  RepairContext
} from '../types/llm';

export class LlmService {
  /**
   * Teste la connectivité vers l'endpoint LLM d'entreprise sans transmettre de données métier.
   */
  public async testConnection(config: LlmConfig): Promise<{ success: boolean; message: string; latencyMs: number }> {
    if (config.useMock) {
      return {
        success: true,
        message: 'Mode simulation actif (Mock local sans appel réseau)',
        latencyMs: 12
      };
    }

    if (!config.endpoint) {
      throw new Error("L'URL de l'endpoint LLM n'est pas renseignée.");
    }
    if (!config.token) {
      throw new Error("Le jeton d'authentification LLM n'est pas renseigné.");
    }

    const t0 = performance.now();
    try {
      const isResponsesApi = config.apiType === 'responses_api' || config.endpoint.endsWith('/responses');
      const hasReasoning = config.reasoningEffort && config.reasoningEffort !== 'none';

      let payload: any;
      if (isResponsesApi) {
        payload = {
          model: config.model || 'gpt-6-luna',
          input: [{ role: 'user', content: 'Réponds uniquement par le mot "PONG" en un seul mot.' }]
        };
        if (hasReasoning) {
          payload.reasoning = { effort: config.reasoningEffort };
        }
      } else {
        payload = {
          model: config.model || 'gpt-6-luna',
          messages: [{ role: 'user', content: 'Réponds uniquement par le mot "PONG" en un seul mot.' }]
        };
        if (hasReasoning) {
          payload.reasoning_effort = config.reasoningEffort;
          // Note : OpenAI rejette le paramètre temperature pour les modèles de reasoning
        } else {
          payload.temperature = 0.0;
        }
      }

      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token.trim()}`
        },
        body: JSON.stringify(payload)
      });

      const latencyMs = Math.round(performance.now() - t0);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Réponse HTTP ${response.status} (${response.statusText}): ${errorText.slice(0, 300)}`);
      }

      const data = await response.json();
      const extractedContent = this.extractTextFromResponse(data);

      return {
        success: true,
        message: `Connexion réussie vers ${config.model} (${latencyMs}ms) : "${extractedContent.slice(0, 50).trim()}"`,
        latencyMs
      };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - t0);
      let errMsg = err.message || String(err);
      if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
        errMsg = "Impossible de contacter l'endpoint (Vérifiez l'URL, votre VPN ou les restrictions CORS de l'API interne).";
      }
      throw new Error(`Échec du test de connexion (${latencyMs}ms) : ${errMsg}`);
    }
  }

  /**
   * Étape 1 : Demande au LLM de formuler sa stratégie d'échantillonnage et de générer le code d'extraction.
   */
  public async requestSamplingStrategy(
    instruction: string,
    tables: TableProfile[],
    maxSampleRows: number,
    config: LlmConfig
  ): Promise<SamplingStrategyResponse> {
    if (config.useMock || !config.token) {
      return this.mockSamplingStrategy(instruction, tables, maxSampleRows);
    }

    const systemPrompt = `Tu es un actuaire senior et un expert Polars.
Ton objectif est de décider de la MEILLEURE STRATÉGIE D'EXTRACTION d'échantillon sur les tables disponibles pour préparer la résolution d'une instruction métier ou d'un script SAS.
Tu dois renvoyer STRICTEMENT un objet JSON valide avec les clés :
- "strategyExplanation" : explication concise de pourquoi et comment tu sélectionnes les lignes (stratification, cas limites, sentinelles nulles, jointures).
- "extractionPythonCode" : code Python Polars qui s'exécute sur le dictionnaire 'dfs' (ex: dfs['contrats']) et stocke le résultat dans la variable 'sample_out' (un dictionnaire de DataFrames Polars de taille totale <= ${maxSampleRows} lignes).`;

    let userPrompt = `### TABLES DISPONIBLES :\n`;
    for (const t of tables) {
      const typeStr = t.fileType ? ` [${t.fileType.toUpperCase()}${t.hasHeader === false ? ', SANS EN-TÊTE' : ''}]` : '';
      userPrompt += `\nTable dfs['${t.alias}']${typeStr} (Total: ${t.totalRowCount} lignes) :\n`;
      
      // Si c'est un fichier Excel avec lignes brutes non nettoyées
      if (t.rawExcelSample && t.rawExcelSample.length > 0) {
        userPrompt += `  [Extrait brut des 15 premières lignes Excel (feuille complexe avec titres/métadonnées potentielles)] :\n`;
        userPrompt += JSON.stringify(t.rawExcelSample.slice(0, 15)) + "\n";
      }

      for (const c of t.columns) {
        let colDesc = `- ${c.name} : type_brut=${c.rawType}, sémantique=${c.semanticType || c.rawType}, nulls=${c.nullCount}`;
        if (c.stats) {
          colDesc += `, stats=[min:${c.stats.min}, max:${c.stats.max}, med:${c.stats.median}, q25:${c.stats.q25}, q75:${c.stats.q75}, uniques:${c.stats.nUnique}]`;
        }
        if (c.sasSentinels && c.sasSentinels.length > 0) {
          colDesc += `, SENTINELLES_DETECTEES=${JSON.stringify(c.sasSentinels)}`;
        }
        if (c.datePattern) {
          colDesc += `, motif_date="${c.datePattern}"`;
        }
        colDesc += `, exemples=${JSON.stringify(c.sampleValues)}\n`;
        userPrompt += colDesc;
      }
    }
    userPrompt += `\n### INSTRUCTION MÉTIER OU CODE SAS :\n${instruction}\n`;
    userPrompt += `\nBUDGET MAXIMUM DE LIGNES AU TOTAL : ${maxSampleRows} lignes.\nGénère le code assignant sample_out = { ... } au format JSON.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const rawContent = await this.callLlmApi(messages, config);
    return this.parseJson<SamplingStrategyResponse>(rawContent);
  }

  /**
   * Étape 2 : Demande au LLM de générer le code Polars final vectorisé avec les lignes extraites réelles (Grounding).
   */
  public async generateActuarialCode(
    instruction: string,
    tables: TableProfile[],
    extractedSamples: Record<string, any>,
    config: LlmConfig
  ): Promise<ActuarialCodeResponse> {
    if (config.useMock || !config.token) {
      return this.mockActuarialCode(instruction, tables);
    }

    const systemPrompt = `Tu es un expert senior en actuariat et ingénieur Python Polars spécialisé dans la modernisation de calculs SAS.
Tu génères du code Python Polars rigoureux, vectorisé et exécutable dans WebAssembly Pyodide.

RÈGLES IMPÉRATIVES :
1. Le résultat final doit IMPÉRATIVEMENT être assigné à la variable 'df_out' (instance de pl.DataFrame ou pl.LazyFrame).
2. Les tables sources sont déjà en mémoire dans le dictionnaire 'dfs' (ex: dfs['contrats']).
3. Vectorisation stricte : AUCUNE boucle for/while, AUCUN .apply() ni .map_elements(). Utilise uniquement des expressions Polars.
4. Optimisation mémoire WebAssembly : favorise les calculs par colonnes, évite les copies inutiles .clone(). Tu peux retourner un LazyFrame pl.LazyFrame si pertinent.
5. Gestion experte des formats et anomalies :
   - Fichiers Excel complexes : repère la zone de données utiles, ignore les en-têtes ou métadonnées parasites si applicable.
   - Nombres avec virgules (ex: '1250,50') : .str.replace(',', '.').cast(pl.Float64)
   - Dates françaises : .str.to_date('%d/%m/%Y') ou format ISO .str.to_date('%Y-%m-%d')
   - Préserve les zéros non significatifs sur les identifiants ou codes produits (conserve en pl.String).
   - Traite les sentinelles SAS (. ou 9999 ou -1) repérées dans le profil en les imputant correctement.
6. Traduis les DATA steps avec RETAIN en calculs cumulés (.cum_sum()) ou en fonctions de fenêtrage (.over()).
7. Réécris les PROC SUMMARY / MEANS en .group_by().agg().
8. Réponds UNIQUEMENT au format JSON strict avec les clés :
   - "pythonCode" : string du code complet directement exécutable.
   - "transformationsApplied" : array de string listant les typages et opérations clés.
   - "warnings" : array de string signalant d'éventuelles anomalies repérées dans l'échantillon.`;

    let userPrompt = '';
    if (Object.keys(extractedSamples).length > 0) {
      userPrompt += `### ÉCHANTILLONS RÉELS EXTRAITS POUR CETTE TÂCHE :\n\`\`\`json\n`;
      userPrompt += JSON.stringify(extractedSamples, null, 2);
      userPrompt += `\n\`\`\`\n\n`;
    } else if (tables.length > 0) {
      userPrompt += `### SCHÉMAS ET STATISTIQUES DES TABLES DISPONIBLES :\n`;
      for (const t of tables) {
        userPrompt += `- Table dfs['${t.alias}'] [${t.fileType || 'csv'}] : colonnes [${t.columns.map(c => c.name).join(', ')}]\n`;
        for (const c of t.columns) {
          if (c.stats || (c.sasSentinels && c.sasSentinels.length > 0)) {
            userPrompt += `    • ${c.name} : stats=${JSON.stringify(c.stats || {})}, sentinelles=${JSON.stringify(c.sasSentinels || [])}\n`;
          }
        }
      }
      userPrompt += `\n`;
    } else {
      userPrompt += `(Information : Aucune table de données n'est pré-chargée dans 'dfs'. Génère le code autonome ou traite les pièces jointes/instructions fournies ci-dessous en définissant 'df_out' ou le résultat adéquat).\n\n`;
    }

    userPrompt += `### INSTRUCTION MÉTIER OU CODE SAS À TRAITER :\n${instruction}\n`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const rawContent = await this.callLlmApi(messages, config);
    return this.parseJson<ActuarialCodeResponse>(rawContent);
  }

  /**
   * Étape 3 : Réparation automatique ciblée suite à une erreur AST ou Runtime Polars.
   */
  public async repairLlmCode(context: RepairContext, config: LlmConfig): Promise<ActuarialCodeResponse> {
    if (config.useMock || !config.token) {
      return this.mockRepairedCode(context);
    }

    const systemPrompt = `Tu es un expert Python Polars en correction de bugs.
Le code Polars précédemment généré a rencontré une erreur lors de la validation ou du test Dry-Run.
Analyse la trace d'erreur exacte, corrige le code et renvoie UNIQUEMENT un JSON avec :
- "pythonCode" : le code Python corrigé assignant df_out.
- "transformationsApplied" : explications de la correction effectuée.
- "warnings" : alertes éventuelles.`;

    let userPrompt = `### CODE EN ERREUR :\n\`\`\`python\n${context.previousCode}\n\`\`\`\n\n`;
    userPrompt += `### ERREUR DÉTECTÉE (Phase ${context.error.phase}) :\n`;
    userPrompt += `Message : ${context.error.message}\n`;
    if (context.error.line) userPrompt += `Ligne approximative : ${context.error.line}\n`;
    if (context.error.traceback) userPrompt += `Traceback :\n${context.error.traceback}\n`;

    if (context.sampleData) {
      userPrompt += `\n### ÉCHANTILLON DE DONNÉES MANIPULÉ :\n\`\`\`json\n`;
      userPrompt += JSON.stringify(context.sampleData, null, 2);
      userPrompt += `\n\`\`\`\n`;
    }

    userPrompt += `\nFournis le code corrigé sans erreur assignant df_out.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const rawContent = await this.callLlmApi(messages, config);
    return this.parseJson<ActuarialCodeResponse>(rawContent);
  }

  /**
   * Effectue la requête HTTP vers l'endpoint LLM d'entreprise.
   */
  private async callLlmApi(messages: any[], config: LlmConfig): Promise<string> {
    const isResponsesApi = config.apiType === 'responses_api' || config.endpoint.endsWith('/responses');
    const hasReasoning = config.reasoningEffort && config.reasoningEffort !== 'none';

    let payload: any;
    if (isResponsesApi) {
      payload = {
        model: config.model || 'gpt-6-luna',
        input: messages.map(m => ({ role: m.role, content: m.content }))
      };
      if (hasReasoning) {
        payload.reasoning = { effort: config.reasoningEffort };
      }
    } else {
      payload = {
        model: config.model || 'gpt-6-luna',
        messages
      };
      if (hasReasoning) {
        payload.reasoning_effort = config.reasoningEffort;
      } else {
        payload.temperature = 0.1;
      }
    }

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token.trim()}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Erreur LLM (${response.status} ${response.statusText}) : ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = this.extractTextFromResponse(data);
    if (!content) {
      throw new Error("L'API LLM a renvoyé une réponse vide ou sans champ de texte exploitable.");
    }

    return content;
  }

  private extractTextFromResponse(data: any): string {
    if (!data) return '';
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    if (typeof data.output_text === 'string') {
      return data.output_text;
    }
    if (Array.isArray(data.output)) {
      const parts: string[] = [];
      for (const item of data.output) {
        if (typeof item === 'string') {
          parts.push(item);
        } else if (typeof item?.text === 'string') {
          parts.push(item.text);
        } else if (typeof item?.content === 'string') {
          parts.push(item.content);
        } else if (Array.isArray(item?.content)) {
          for (const sub of item.content) {
            if (typeof sub === 'string') parts.push(sub);
            else if (typeof sub?.text === 'string') parts.push(sub.text);
          }
        }
      }
      if (parts.length > 0) return parts.join('\n');
    }
    if (typeof data.response === 'string') {
      return data.response;
    }
    if (Array.isArray(data.content)) {
      const textParts = data.content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).filter(Boolean);
      if (textParts.length > 0) return textParts.join('\n');
    }
    if (data.candidates?.[0]?.content?.parts) {
      const textParts = data.candidates[0].content.parts.map((p: any) => p?.text || '').filter(Boolean);
      if (textParts.length > 0) return textParts.join('\n');
    }
    if (typeof data.result === 'string') return data.result;
    if (typeof data.text === 'string') return data.text;
    if (typeof data.generated_text === 'string') return data.generated_text;

    return '';
  }

  /**
   * Parseur JSON tolérant capable d'extraire les objets même encapsulés dans des blocs Markdown.
   */
  private parseJson<T>(content: string): T {
    let clean = content.trim();

    // Détection d'un bloc ```json ... ```
    const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      clean = match[1].trim();
    } else {
      // Détection de la première accolade ouvrante et de la dernière fermante
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        clean = clean.substring(start, end + 1);
      }
    }

    try {
      return JSON.parse(clean) as T;
    } catch (err: any) {
      throw new Error(`Impossible de parser la réponse JSON du LLM : ${err.message}\nContenu reçu :\n${content.slice(0, 300)}`);
    }
  }

  // ==========================================
  // SIMULATION LOCALE INTELLIGENTE (MOCK)
  // ==========================================

  private mockSamplingStrategy(_instruction: string, tables: TableProfile[], maxRows: number): SamplingStrategyResponse {
    const hasContrats = tables.some(t => t.alias === 'contrats');
    const hasSinistres = tables.some(t => t.alias === 'sinistres');

    if (hasContrats && hasSinistres) {
      return {
        strategyExplanation: "Échantillonnage ciblé sur les contrats ayant des sinistres déclarés (jointure par num_police) pour vérifier la cohérence des montants de prime et de sinistre.",
        extractionPythonCode: `import polars as pl
# Sélection de polices communes
df_c = dfs['contrats']
df_s = dfs['sinistres']
sample_out = {
    'contrats': df_c.head(${Math.min(maxRows, 5)}),
    'sinistres': df_s.head(${Math.min(maxRows, 5)})
}`
      };
    }

    const primaryAlias = tables[0]?.alias || 'table';
    return {
      strategyExplanation: `Échantillon représentatif de tête et détection des valeurs atypiques sur dfs['${primaryAlias}'].`,
      extractionPythonCode: `import polars as pl
sample_out = {
    '${primaryAlias}': dfs['${primaryAlias}'].head(${Math.min(maxRows, 10)})
}`
    };
  }

  private mockActuarialCode(_instruction: string, tables: TableProfile[]): ActuarialCodeResponse {
    if (tables.length === 0) {
      return {
        pythonCode: `import polars as pl

# Exemple de DataFrame généré pour test (mode simulation sans table source)
df_out = pl.DataFrame({
    "id_police": ["POL_001", "POL_002", "POL_003", "POL_004", "POL_005"],
    "prime_annuelle": [450.0, 720.5, 310.0, 1150.0, 580.0],
    "sinistre_survenu": [False, True, False, True, False],
    "charge_sinistre": [0.0, 1250.0, 0.0, 480.0, 0.0]
})
`,
        transformationsApplied: ["Création d'un jeu de données synthétique pl.DataFrame"],
        warnings: ["Mode simulation : configurez votre clé API LLM pour une génération personnalisée."]
      };
    }

    const hasContrats = tables.some(t => t.alias === 'contrats');
    const hasSinistres = tables.some(t => t.alias === 'sinistres');

    if (hasContrats && hasSinistres) {
      return {
        pythonCode: `import polars as pl

# 1. Nettoyage et typage de la table contrats
df_contrats_clean = dfs['contrats'].with_columns([
    pl.col("prime_annuelle").str.replace(",", ".").cast(pl.Float64),
    pl.col("frais_gestion").str.replace(",", ".").cast(pl.Float64),
    pl.col("date_effet").str.to_date("%d/%m/%Y")
])

# 2. Nettoyage et agrégation des sinistres par police
df_sinistres_agg = (
    dfs['sinistres']
    .with_columns(pl.col("cout_regle").str.replace(",", ".").cast(pl.Float64))
    .group_by("num_police")
    .agg([
        pl.col("cout_regle").sum().alias("charge_sinistres_totale"),
        pl.len().alias("nombre_sinistres")
    ])
)

# 3. Jointure gauche (préservation de tous les contrats) et calcul de la marge technique
df_out = (
    df_contrats_clean
    .join(df_sinistres_agg, on="num_police", how="left")
    .with_columns([
        pl.col("charge_sinistres_totale").fill_null(0.0),
        pl.col("nombre_sinistres").fill_null(0)
    ])
    .with_columns(
        (pl.col("prime_annuelle") - pl.col("charge_sinistres_totale") - pl.col("frais_gestion"))
        .alias("marge_technique")
    )
)`,
        transformationsApplied: [
            "Conversion des montants français avec virgule en pl.Float64 (prime_annuelle, frais_gestion, cout_regle)",
            "Parsing des dates françaises 'DD/MM/YYYY' en pl.Date",
            "Agrégation vectorisée .group_by('num_police').agg() sur les sinistres",
            "Jointure gauche .join(..., how='left') avec imputation des nulls par fill_null(0.0)",
            "Calcul de la nouvelle colonne 'marge_technique'"
        ],
        warnings: [
            "Certaines polices comportent des valeurs nulles sur la prime : elles ont été conservées sans filtrage abusif.",
            "Les zéros non significatifs sur code_produit ont été préservés."
        ]
      };
    }

    const tAlias = tables[0]?.alias || 'data';
    return {
      pythonCode: `import polars as pl

# Nettoyage et calcul vectorisé standard
df_out = dfs['${tAlias}'].clone()
`,
      transformationsApplied: ["Copie directe de la table active"],
      warnings: []
    };
  }

  private mockRepairedCode(context: RepairContext): ActuarialCodeResponse {
    return {
      pythonCode: `import polars as pl
# Code corrigé après erreur : ${context.error.message}
df_out = dfs['contrats'].with_columns([
    pl.col("prime_annuelle").str.replace(",", ".").cast(pl.Float64)
])`,
      transformationsApplied: ["Correction de la syntaxe et garantie d'assignation de df_out"],
      warnings: ["Vérifié par la boucle d'auto-réparation."]
    };
  }
}

export const llmService = new LlmService();
