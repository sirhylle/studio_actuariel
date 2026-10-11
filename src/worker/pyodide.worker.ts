import { WorkerMessage, WorkerResponse } from '../types/protocol';
import { PYTHON_CORE_SCRIPTS } from './python-templates';

let pyodideInstance: any = null;

async function initPyodide(vendorBase: string) {
  // Chargement dynamique de pyodide.mjs compatible ES Module
  const pyodideModule = await import(/* @vite-ignore */ `${vendorBase}/pyodide/pyodide.mjs`);
  const loadPyodide = pyodideModule.loadPyodide;

  pyodideInstance = await loadPyodide({
    indexURL: `${vendorBase}/pyodide/`
  });

  // Chargement de Polars depuis le wheel local vendorisé
  const wheelUrl = `${vendorBase}/wheels/polars-1.18.0-cp39-abi3-pyodide_2024_0_wasm32.whl`;
  await pyodideInstance.loadPackage(wheelUrl);

  // Initialisation du MEMFS et des scripts utilitaires
  try {
    pyodideInstance.FS.mkdirTree('/data');
  } catch (_) {}

  pyodideInstance.runPython(PYTHON_CORE_SCRIPTS.PROFILE_TABLE);
  pyodideInstance.runPython(PYTHON_CORE_SCRIPTS.LINT_AST);
  pyodideInstance.runPython(PYTHON_CORE_SCRIPTS.RUN_EXTRACTION);
  pyodideInstance.runPython(PYTHON_CORE_SCRIPTS.RUNNER_WRAPPER);
  pyodideInstance.runPython(`dfs_full = {}; dfs_sample = {}`);
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { id, action, payload } = event.data;

  try {
    switch (action) {
      case 'INIT': {
        const vendorBase = payload?.vendorBase || `${self.location.origin}/vendor`;
        await initPyodide(vendorBase);
        self.postMessage({ id, success: true } as WorkerResponse);
        break;
      }

      case 'LOAD_TABLE': {
        const { alias, fileName, buffer, separator, sampleSize, fileType, hasHeader } = payload;
        const actualFileType = fileType || (fileName.endsWith('.parquet') || fileName.endsWith('.pq') ? 'parquet' : 'csv');
        const filePath = `/data/${alias}.csv`;

        // Écriture du fichier brut (ou converti en CSV par hyparquet) dans le MEMFS de Pyodide
        pyodideInstance.FS.writeFile(filePath, new Uint8Array(buffer));

        const safeSep = separator.replace(/'/g, "\\'");
        const hasHeaderPy = hasHeader !== false ? 'True' : 'False';
        pyodideInstance.runPython(`
dfs_full['${alias}'] = pl.read_csv(
    '${filePath}',
    separator='${safeSep}',
    has_header=${hasHeaderPy},
    null_values=["", "NA", "NULL", ".", "None", "NR"],
    truncate_ragged_lines=True
)
`);

        // Profiling et échantillon initial
        const profileFn = pyodideInstance.globals.get('profile_and_sample');
        const rawJson = profileFn(alias, filePath, separator, sampleSize, actualFileType, hasHeader !== false);
        const data = JSON.parse(rawJson);
        data.fileName = fileName;
        data.fileType = actualFileType;
        data.hasHeader = hasHeader !== false;

        self.postMessage({ id, success: true, data } as WorkerResponse);
        break;
      }

      case 'UNLOAD_TABLE': {
        const { alias } = payload;
        pyodideInstance.runPython(`
dfs_full.pop('${alias}', None)
dfs_sample.pop('${alias}', None)
`);
        try {
          pyodideInstance.FS.unlink(`/data/${alias}.csv`);
        } catch (_) {}
        try {
          pyodideInstance.FS.unlink(`/data/${alias}.parquet`);
        } catch (_) {}
        self.postMessage({ id, success: true } as WorkerResponse);
        break;
      }

      case 'EXECUTE_EXTRACTION': {
        const extractFn = pyodideInstance.globals.get('run_extraction');
        const rawRes = extractFn(payload.extractionCode);
        const extractedData = JSON.parse(rawRes);
        self.postMessage({ id, success: true, data: extractedData } as WorkerResponse);
        break;
      }

      case 'CHECK_SYNTAX': {
        const lintFn = pyodideInstance.globals.get('check_syntax');
        const res = JSON.parse(lintFn(payload.code));
        if (res.valid) {
          self.postMessage({ id, success: true, data: { valid: true } } as WorkerResponse);
        } else {
          self.postMessage({
            id,
            success: true,
            data: {
              valid: false,
              error: {
                phase: 'AST',
                message: res.message,
                line: res.line
              }
            }
          } as WorkerResponse);
        }
        break;
      }

      case 'EXECUTE_DRY_RUN': {
        const runFn = pyodideInstance.globals.get('run_pipeline');
        const rawRes = runFn(payload.code, true);
        self.postMessage({ id, success: true, data: JSON.parse(rawRes) } as WorkerResponse);
        break;
      }

      case 'EXECUTE_FULL': {
        const runFn = pyodideInstance.globals.get('run_pipeline');
        const outputFormat = payload.outputFormat || 'csv';
        const rawRes = runFn(payload.code, false, payload.outputSeparator || ';', outputFormat);
        const meta = JSON.parse(rawRes);

        // Lecture du fichier généré dans le MEMFS
        if (outputFormat === 'parquet') {
          const outBuffer = pyodideInstance.FS.readFile('/data/output.parquet');
          meta.outputParquetBuffer = outBuffer;
        } else {
          const outBuffer = pyodideInstance.FS.readFile('/data/output.csv');
          meta.outputCsvBuffer = outBuffer;
        }

        self.postMessage({ id, success: true, data: meta } as WorkerResponse);
        break;
      }
    }
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    self.postMessage({
      id,
      success: false,
      error: {
        phase: 'RUNTIME',
        message: errorMsg,
        traceback: err.stack || errorMsg
      }
    } as WorkerResponse);
  }
};
