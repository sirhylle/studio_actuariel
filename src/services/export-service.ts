import { appState } from '../state';

export class ExportService {
  /**
   * Génère un Jupyter Notebook (.ipynb v4) propre et exécutable contenant la pipeline Polars.
   */
  public generateNotebook(pythonCode: string): string {
    const tables = Array.from(appState.tables.values());
    const transformations = appState.transformationsApplied;
    const warnings = appState.warnings;
    const instruction = appState.promptInstruction;

    // 1. Markdown cell : En-tête et description
    const mdHeader = [
      "# 📊 Studio Actuariel - Pipeline Vectorisée Polars\n",
      `*Généré automatiquement le ${new Date().toLocaleString()}*\n\n`,
      instruction ? `### 🎯 Consigne Métier :\n> ${instruction.replace(/\n/g, '\n> ')}\n\n` : '',
      transformations.length > 0 ? "### ✅ Transformations appliquées :\n" + transformations.map(t => `- ${t}\n`).join('') + "\n" : '',
      warnings.length > 0 ? "### ⚠️ Points d'attention :\n" + warnings.map(w => `- ${w}\n`).join('') + "\n" : ''
    ].filter(Boolean);

    // 2. Code cell : Imports & Environnement
    const codeSetup = [
      "# Installation optionnelle : pip install polars\n",
      "import polars as pl\n",
      "import os\n",
      "print(f\"Polars version: {pl.__version__}\")\n"
    ];

    // 3. Code cell : Chargement des tables sources
    const loadLines: string[] = ["# Chargement des tables dans le dictionnaire 'dfs'\n", "dfs = {}\n"];
    if (tables.length > 0) {
      for (const t of tables) {
        const path = t.fileName || `${t.alias}.${t.fileType === 'parquet' ? 'parquet' : 'csv'}`;
        if (t.fileType === 'parquet') {
          loadLines.push(`dfs['${t.alias}'] = pl.read_parquet("${path}")\n`);
        } else {
          loadLines.push(`dfs['${t.alias}'] = pl.read_csv("${path}", separator="${t.separator}", has_header=${t.hasHeader !== false})\n`);
        }
      }
    } else {
      loadLines.push("# Aucune table source pré-chargée : code autonome\n");
    }

    // 4. Code cell : Pipeline Actuarielle
    const codePipeline = [
      "# ==========================================================\n",
      "# PIPELINE DE TRANSFORMATION POLARS VECTORISÉE\n",
      "# ==========================================================\n",
      pythonCode.endsWith('\n') ? pythonCode : pythonCode + '\n'
    ];

    // 5. Code cell : Contrôle & Exportation
    const codeExport = [
      "# Contrôles qualité et export\n",
      "if 'df_out' in locals():\n",
      "    print(f\"Shape du résultat : {df_out.shape}\")\n",
      "    print(\"\\nAperçu des 5 premières lignes :\")\n",
      "    print(df_out.head(5))\n",
      "    output_file = \"resultat_actuariel.csv\"\n",
      "    df_out.write_csv(output_file)\n",
      "    print(f\"\\n✓ Fichier exporté avec succès dans '{output_file}'\")\n",
      "else:\n",
      "    print(\"Notice : Aucune variable df_out n'a été produite.\")\n"
    ];

    const notebook = {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: mdHeader
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: codeSetup
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: loadLines
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: codePipeline
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: codeExport
        }
      ],
      metadata: {
        language_info: {
          name: 'python',
          version: '3.11'
        },
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3'
        }
      },
      nbformat: 4,
      nbformat_minor: 5
    };

    return JSON.stringify(notebook, null, 2);
  }

  /**
   * Génère un script Python autonome prêt pour la production batch CLI avec argparse.
   */
  public generateBatchScript(pythonCode: string): string {
    const tables = Array.from(appState.tables.values());
    const instruction = appState.promptInstruction;

    const lines: string[] = [
      '#!/usr/bin/env python3',
      '"""',
      'Studio Actuariel - Pipeline de production batch',
      `Généré automatiquement le ${new Date().toLocaleString()}`,
      instruction ? `Consigne : ${instruction.replace(/\n/g, ' ')}` : '',
      '',
      'Exécution recommandée avec uv :',
      '  uv run python pipeline_actuariel.py --help',
      '"""',
      '',
      'import argparse',
      'import sys',
      'from pathlib import Path',
      'import polars as pl',
      '',
      'def main():',
      '    parser = argparse.ArgumentParser(description="Pipeline actuarielle Polars vectorisée")',
    ];

    // Arguments CLI pour chaque table source
    for (const t of tables) {
      lines.push(
        `    parser.add_argument("--${t.alias}", type=str, default="${t.fileName || t.alias + '.csv'}", help="Chemin du fichier pour ${t.alias}")`
      );
    }

    lines.push('    parser.add_argument("--output", "-o", type=str, default="resultat.csv", help="Chemin du fichier résultat")');
    lines.push('    parser.add_argument("--format", choices=["csv", "parquet"], default="csv", help="Format de sortie")');
    lines.push('    args = parser.parse_args()');
    lines.push('');
    lines.push('    print("▶ Chargement des tables sources...")');
    lines.push('    dfs = {}');

    for (const t of tables) {
      if (t.fileType === 'parquet') {
        lines.push(`    dfs['${t.alias}'] = pl.read_parquet(args.${t.alias})`);
      } else {
        lines.push(`    dfs['${t.alias}'] = pl.read_csv(args.${t.alias}, separator="${t.separator}", has_header=${t.hasHeader !== false})`);
      }
      lines.push(`    print(f"  • {args.${t.alias}} : {dfs['${t.alias}'].shape[0]} lignes, {dfs['${t.alias}'].shape[1]} colonnes")`);
    }

    lines.push('');
    lines.push('    print("▶ Exécution de la pipeline vectorisée...")');
    lines.push('    try:');

    // Indentation du code Python utilisateur dans le try block
    const userCodeLines = pythonCode.split('\n');
    for (const line of userCodeLines) {
      lines.push(`        ${line}`);
    }

    lines.push('    except Exception as e:');
    lines.push('        print(f"❌ Erreur lors du calcul : {e}", file=sys.stderr)');
    lines.push('        sys.exit(1)');
    lines.push('');
    lines.push('    if "df_out" not in locals() or not isinstance(df_out, pl.DataFrame):');
    lines.push('        print("❌ La pipeline n\'a pas produit de variable \'df_out\' de type pl.DataFrame.", file=sys.stderr)');
    lines.push('        sys.exit(1)');
    lines.push('');
    lines.push('    print(f"✓ Calcul terminé avec succès ({df_out.shape[0]} lignes générées).")');
    lines.push('    out_path = Path(args.output)');
    lines.push('    if args.format == "parquet" or out_path.suffix == ".parquet":');
    lines.push('        df_out.write_parquet(out_path)');
    lines.push('    else:');
    lines.push('        df_out.write_csv(out_path, separator=";")');
    lines.push('    print(f"✓ Fichier résultat sauvegardé dans {out_path.resolve()}")');
    lines.push('');
    lines.push('if __name__ == "__main__":');
    lines.push('    main()');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Télécharge une chaîne de caractères en tant que fichier dans le navigateur.
   */
  public triggerDownload(content: string | Uint8Array, filename: string, mimeType: string) {
    const blob = new Blob([content as any], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const exportService = new ExportService();
