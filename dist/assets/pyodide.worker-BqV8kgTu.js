const _={PROFILE_TABLE:`
import polars as pl
import json
import math

def profile_and_sample(alias, file_path, separator, sample_size, file_type="csv", has_header=True):
    # Lecture initiale selon le format
    if file_type == "parquet":
        df_full = pl.read_parquet(file_path)
        df_sample = df_full.head(sample_size)
    else:
        # CSV / TSV avec gestion de has_header
        df_sample = pl.read_csv(
            file_path,
            separator=separator,
            has_header=has_header,
            n_rows=sample_size,
            infer_schema_length=sample_size,
            null_values=["", "NA", "NULL", ".", "None", "NR"],
            truncate_ragged_lines=True
        )
        df_full = globals().get("dfs_full", {}).get(alias, df_sample)

    total_row_count = df_full.height

    # Stockage global pour le mode dry-run
    if "dfs_sample" not in globals():
        globals()["dfs_sample"] = {}
    globals()["dfs_sample"][alias] = df_sample

    columns_summary = []
    sas_candidates = ["9999", "99999", "-1", "-999", "99", "NR", "."]

    for col in df_sample.columns:
        s = df_sample[col]
        raw_type = str(s.dtype)
        semantic_type = raw_type
        stats_data = {}
        detected_sentinels = []
        date_pattern = None

        # Calcul des statistiques numériques
        if s.dtype.is_numeric():
            s_clean = s.drop_nulls()
            if len(s_clean) > 0:
                stats_data["min"] = float(s_clean.min()) if s_clean.min() is not None else None
                stats_data["max"] = float(s_clean.max()) if s_clean.max() is not None else None
                stats_data["median"] = float(s_clean.median()) if s_clean.median() is not None else None
                try:
                    stats_data["q25"] = float(s_clean.quantile(0.25))
                    stats_data["q75"] = float(s_clean.quantile(0.75))
                except Exception:
                    pass
                stats_data["nUnique"] = int(s_clean.n_unique())

                # Détection de sentinelles numériques fréquentes en actuariat/SAS (ex: 9999, -1, 99)
                for cand in [-1, 99, 999, 9999, 99999, -999]:
                    if cand in s_clean:
                        cnt = (s_clean == cand).sum()
                        if cnt > 0:
                            detected_sentinels.append(f"{cand} (x{cnt})")

        # Détection sémantique avancée sur les colonnes String
        elif s.dtype == pl.String:
            non_nulls = s.drop_nulls()
            if len(non_nulls) > 0:
                sample_list = [str(x) for x in non_nulls.head(20).to_list()]
                stats_data["nUnique"] = int(non_nulls.n_unique())

                # Vérification de sentinelles textuelles
                for cand in ["9999", "-1", "NR", "NC", "SANS", "."]:
                    if cand in sample_list:
                        detected_sentinels.append(cand)

                # Test 1 : Nombre décimal avec virgule française (ex: 1250,50 ou -12,4)
                if any("," in x for x in sample_list):
                    try:
                        non_nulls.str.replace(" ", "").str.replace(",", ".").cast(pl.Float64, strict=True)
                        semantic_type = "Float (virgule FR)"
                    except Exception:
                        pass

                # Test 2 : Date au format français (ex: 01/01/2024 ou 2024-01-01)
                if semantic_type == raw_type and any("/" in x for x in sample_list):
                    try:
                        non_nulls.str.to_date("%d/%m/%Y", strict=True)
                        semantic_type = "Date (JJ/MM/AAAA)"
                        date_pattern = "%d/%m/%Y"
                    except Exception:
                        pass

                if semantic_type == raw_type and any("-" in x for x in sample_list):
                    try:
                        non_nulls.str.to_date("%Y-%m-%d", strict=True)
                        semantic_type = "Date (AAAA-MM-JJ)"
                        date_pattern = "%Y-%m-%d"
                    except Exception:
                        pass

        summary = {
            "name": col,
            "rawType": raw_type,
            "semanticType": semantic_type,
            "nullCount": int(s.null_count()),
            "uniqueCount": int(s.n_unique()),
            "sampleValues": s.drop_nulls().head(3).to_list(),
            "stats": stats_data if stats_data else None,
            "sasSentinels": detected_sentinels if detected_sentinels else None,
            "datePattern": date_pattern
        }
        columns_summary.append(summary)

    return json.dumps({
        "alias": alias,
        "totalRowCount": total_row_count,
        "totalRowsSampled": df_sample.height,
        "columns": columns_summary,
        "rawRecordsHead": df_sample.head(5).to_dicts()
    }, default=str)
`,LINT_AST:`
import ast
import json

def check_syntax(code_str):
    try:
        ast.parse(code_str)
        return json.dumps({"valid": True})
    except SyntaxError as e:
        return json.dumps({
            "valid": False,
            "line": e.lineno,
            "offset": e.offset,
            "message": e.msg
        })
`,RUN_EXTRACTION:`
import polars as pl
import json

def run_extraction(extraction_code):
    env_dfs = globals().get("dfs_full", {})
    if not env_dfs:
        env_dfs = globals().get("dfs_sample", {})

    exec_globals = {
        "pl": pl,
        "dfs": env_dfs
    }
    
    exec(extraction_code, exec_globals)
    
    if "sample_out" not in exec_globals:
        raise ValueError("Le code d'extraction doit impérativement définir une variable 'sample_out' (DataFrame ou dict de DataFrames).")
    
    raw_sample = exec_globals["sample_out"]
    if isinstance(raw_sample, pl.DataFrame):
        data = {"default": raw_sample.to_dicts()}
    elif isinstance(raw_sample, dict):
        data = {}
        for k, v in raw_sample.items():
            if isinstance(v, pl.DataFrame):
                data[k] = v.to_dicts()
            elif isinstance(v, list):
                data[k] = v
            else:
                data[k] = str(v)
    else:
        raise TypeError("sample_out doit être un polars.DataFrame ou un dictionnaire de DataFrames.")
        
    return json.dumps(data, default=str)
`,RUNNER_WRAPPER:`
import polars as pl
import json
import math
import sys
import io
import gc
import traceback

def run_pipeline(user_code, is_dry_run=True, output_sep=";", output_format="csv"):
    if is_dry_run:
        env_dfs = globals().get("dfs_sample", {})
    else:
        env_dfs = globals().get("dfs_full", {})

    exec_globals = {
        "pl": pl,
        "dfs": env_dfs
    }
    
    # Capture de sys.stdout pour intercepter les print()
    old_stdout = sys.stdout
    captured_io = io.StringIO()
    sys.stdout = captured_io

    exec_error = None
    try:
        exec(user_code, exec_globals)
    except Exception as e:
        exec_error = {
            "phase": "RUNTIME",
            "message": str(e),
            "traceback": traceback.format_exc()
        }
    finally:
        sys.stdout = old_stdout

    stdout_str = captured_io.getvalue().strip()

    if exec_error is not None:
        if not is_dry_run:
            raise RuntimeError(exec_error["message"])
        return json.dumps({
            "hasValidDfOut": False,
            "stdout": stdout_str,
            "error": exec_error
        }, default=str)

    # Récupération et conversion tolérante de df_out
    df_candidate = exec_globals.get("df_out")

    # Tolérance 1 : Conversion d'un LazyFrame avec streaming=True
    if isinstance(df_candidate, pl.LazyFrame):
        try:
            df_candidate = df_candidate.collect(streaming=True)
            exec_globals["df_out"] = df_candidate
        except Exception:
            df_candidate = df_candidate.collect()
            exec_globals["df_out"] = df_candidate

    # Tolérance 2 : Conversion automatique d'une Series en DataFrame mono-colonne
    if isinstance(df_candidate, pl.Series):
        df_candidate = df_candidate.to_frame()
        exec_globals["df_out"] = df_candidate

    if isinstance(df_candidate, pl.DataFrame):
        preview_rows = df_candidate.head(10).to_dicts()
        # Nettoyage des NaN / Infinity pour sérialisation JSON propre
        for row in preview_rows:
            for k, v in row.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    row[k] = None

        output_meta = {
            "hasValidDfOut": True,
            "stdout": stdout_str,
            "outputRowCount": df_candidate.height,
            "outputColCount": df_candidate.width,
            "outputColumns": [{"name": c, "dtype": str(df_candidate[c].dtype)} for c in df_candidate.columns],
            "headPreview": preview_rows
        }

        if not is_dry_run:
            if output_format == "parquet":
                df_candidate.write_parquet("/data/output.parquet")
            else:
                df_candidate.write_csv("/data/output.csv", separator=output_sep)

        # Nettoyage mémoire Python explicite
        gc.collect()

        return json.dumps(output_meta, default=str)

    # Cas où df_out n'est PAS un DataFrame
    if not is_dry_run:
        raise ValueError("L'exécution complète nécessite impérativement un DataFrame nommé 'df_out'.")

    # Recherche d'un retour alternatif (ex: variable res, output, df)
    alt_var_name = None
    alt_val_str = None
    for k in ["res", "output", "result", "df"]:
        if k in exec_globals and k != "dfs" and k != "pl":
            alt_var_name = k
            alt_val = exec_globals[k]
            alt_val_str = str(alt_val)
            break

    gc.collect()

    return json.dumps({
        "hasValidDfOut": False,
        "stdout": stdout_str,
        "rawOutput": alt_val_str,
        "altVarName": alt_var_name
    }, default=str)
`};let t=null;async function h(o){const p=(await import(`${o}/pyodide/pyodide.mjs`)).loadPyodide;t=await p({indexURL:`${o}/pyodide/`});const s=`${o}/wheels/polars-1.18.0-cp39-abi3-pyodide_2024_0_wasm32.whl`;await t.loadPackage(s);try{t.FS.mkdirTree("/data")}catch{}t.runPython(_.PROFILE_TABLE),t.runPython(_.LINT_AST),t.runPython(_.RUN_EXTRACTION),t.runPython(_.RUNNER_WRAPPER),t.runPython("dfs_full = {}; dfs_sample = {}")}self.onmessage=async o=>{const{id:n,action:p,payload:s}=o.data;try{switch(p){case"INIT":{const e=s?.vendorBase||`${self.location.origin}/vendor`;await h(e),self.postMessage({id:n,success:!0});break}case"LOAD_TABLE":{const{alias:e,fileName:a,buffer:l,separator:r,sampleSize:i,fileType:m,hasHeader:f}=s,d=m||(a.endsWith(".parquet")||a.endsWith(".pq")?"parquet":"csv"),c=`/data/${e}.${d==="parquet"?"parquet":"csv"}`;if(t.FS.writeFile(c,new Uint8Array(l)),d==="parquet")t.runPython(`dfs_full['${e}'] = pl.read_parquet('${c}')`);else{const g=r.replace(/'/g,"\\'"),x=f!==!1?"True":"False";t.runPython(`
dfs_full['${e}'] = pl.read_csv(
    '${c}',
    separator='${g}',
    has_header=${x},
    null_values=["", "NA", "NULL", ".", "None", "NR"],
    truncate_ragged_lines=True
)
`)}const y=t.globals.get("profile_and_sample")(e,c,r,i,d,f!==!1),u=JSON.parse(y);u.fileName=a,u.fileType=d,u.hasHeader=f!==!1,self.postMessage({id:n,success:!0,data:u});break}case"UNLOAD_TABLE":{const{alias:e}=s;t.runPython(`
dfs_full.pop('${e}', None)
dfs_sample.pop('${e}', None)
`);try{t.FS.unlink(`/data/${e}.csv`)}catch{}try{t.FS.unlink(`/data/${e}.parquet`)}catch{}self.postMessage({id:n,success:!0});break}case"EXECUTE_EXTRACTION":{const a=t.globals.get("run_extraction")(s.extractionCode),l=JSON.parse(a);self.postMessage({id:n,success:!0,data:l});break}case"CHECK_SYNTAX":{const e=t.globals.get("check_syntax"),a=JSON.parse(e(s.code));a.valid?self.postMessage({id:n,success:!0,data:{valid:!0}}):self.postMessage({id:n,success:!0,data:{valid:!1,error:{phase:"AST",message:a.message,line:a.line}}});break}case"EXECUTE_DRY_RUN":{const a=t.globals.get("run_pipeline")(s.code,!0);self.postMessage({id:n,success:!0,data:JSON.parse(a)});break}case"EXECUTE_FULL":{const e=t.globals.get("run_pipeline"),a=s.outputFormat||"csv",l=e(s.code,!1,s.outputSeparator||";",a),r=JSON.parse(l);if(a==="parquet"){const i=t.FS.readFile("/data/output.parquet");r.outputParquetBuffer=i}else{const i=t.FS.readFile("/data/output.csv");r.outputCsvBuffer=i}self.postMessage({id:n,success:!0,data:r});break}}}catch(e){const a=e.message||String(e);self.postMessage({id:n,success:!1,error:{phase:"RUNTIME",message:a,traceback:e.stack||a}})}};
