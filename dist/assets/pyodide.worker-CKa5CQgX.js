const i={PROFILE_TABLE:`
import polars as pl
import json

def profile_and_sample(alias, file_path, separator, sample_size):
    # Lecture d'un bloc initial pour l'échantillon
    df_sample = pl.read_csv(
        file_path,
        separator=separator,
        n_rows=sample_size,
        infer_schema_length=sample_size,
        null_values=["", "NA", "NULL", ".", "None"],
        truncate_ragged_lines=True
    )
    
    # Récupération de la taille totale de la table complète si déjà chargée
    df_full = globals().get("dfs_full", {}).get(alias, df_sample)
    total_row_count = df_full.height

    # Stockage global pour le mode dry-run
    if "dfs_sample" not in globals():
        globals()["dfs_sample"] = {}
    globals()["dfs_sample"][alias] = df_sample

    columns_summary = []
    for col in df_sample.columns:
        s = df_sample[col]
        raw_type = str(s.dtype)
        semantic_type = raw_type

        # Détection sémantique avancée sur les colonnes String
        if s.dtype == pl.String:
            non_nulls = s.drop_nulls()
            if len(non_nulls) > 0:
                sample_list = non_nulls.head(10).to_list()
                
                # Test 1 : Nombre décimal avec virgule française (ex: 1250,50 ou -12,4)
                if any("," in str(x) for x in sample_list):
                    try:
                        non_nulls.str.replace(" ", "").str.replace(",", ".").cast(pl.Float64, strict=True)
                        semantic_type = "Float (virgule FR)"
                    except Exception:
                        pass
                
                # Test 2 : Date au format français (ex: 01/01/2024)
                if semantic_type == raw_type and any("/" in str(x) for x in sample_list):
                    try:
                        non_nulls.str.to_date("%d/%m/%Y", strict=True)
                        semantic_type = "Date (JJ/MM/AAAA)"
                    except Exception:
                        pass

        summary = {
            "name": col,
            "rawType": raw_type,
            "semanticType": semantic_type,
            "nullCount": int(s.null_count()),
            "uniqueCount": int(s.n_unique()),
            "sampleValues": s.drop_nulls().head(3).to_list()
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

def run_pipeline(user_code, is_dry_run=True, output_sep=";"):
    if is_dry_run:
        env_dfs = globals().get("dfs_sample", {})
    else:
        env_dfs = globals().get("dfs_full", {})

    exec_globals = {
        "pl": pl,
        "dfs": env_dfs
    }
    
    # Exécution du code utilisateur
    exec(user_code, exec_globals)

    if "df_out" not in exec_globals or not isinstance(exec_globals["df_out"], pl.DataFrame):
        raise ValueError("Le code exécuté doit impérativement définir un DataFrame nommé 'df_out'.")

    df_res = exec_globals["df_out"]

    preview_rows = df_res.head(10).to_dicts()
    # Nettoyage strict pour éviter NaN/Infinity qui cassent JSON.parse en JavaScript
    for row in preview_rows:
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                row[k] = None

    output_meta = {
        "outputRowCount": df_res.height,
        "outputColCount": df_res.width,
        "outputColumns": [{"name": c, "dtype": str(df_res[c].dtype)} for c in df_res.columns],
        "headPreview": preview_rows
    }

    if not is_dry_run:
        df_res.write_csv("/data/output.csv", separator=output_sep)

    return json.dumps(output_meta, default=str)
`};let s=null;async function m(l){const c=(await import(`${l}/pyodide/pyodide.mjs`)).loadPyodide;s=await c({indexURL:`${l}/pyodide/`});const o=`${l}/wheels/polars-1.18.0-cp39-abi3-pyodide_2024_0_wasm32.whl`;await s.loadPackage(o);try{s.FS.mkdirTree("/data")}catch{}s.runPython(i.PROFILE_TABLE),s.runPython(i.LINT_AST),s.runPython(i.RUN_EXTRACTION),s.runPython(i.RUNNER_WRAPPER),s.runPython("dfs_full = {}; dfs_sample = {}")}self.onmessage=async l=>{const{id:t,action:c,payload:o}=l.data;try{switch(c){case"INIT":{const e=o?.vendorBase||`${self.location.origin}/vendor`;await m(e),self.postMessage({id:t,success:!0});break}case"LOAD_TABLE":{const{alias:e,fileName:a,buffer:r,separator:n,sampleSize:p}=o,d=`/data/${e}.csv`;s.FS.writeFile(d,new Uint8Array(r));const _=n.replace(/'/g,"\\'");s.runPython(`
dfs_full['${e}'] = pl.read_csv(
    '${d}',
    separator='${_}',
    null_values=["", "NA", "NULL", ".", "None"],
    truncate_ragged_lines=True
)
`);const f=s.globals.get("profile_and_sample")(e,d,n,p),u=JSON.parse(f);u.fileName=a,self.postMessage({id:t,success:!0,data:u});break}case"UNLOAD_TABLE":{const{alias:e}=o;s.runPython(`
dfs_full.pop('${e}', None)
dfs_sample.pop('${e}', None)
`);try{s.FS.unlink(`/data/${e}.csv`)}catch{}self.postMessage({id:t,success:!0});break}case"EXECUTE_EXTRACTION":{const a=s.globals.get("run_extraction")(o.extractionCode),r=JSON.parse(a);self.postMessage({id:t,success:!0,data:r});break}case"CHECK_SYNTAX":{const e=s.globals.get("check_syntax"),a=JSON.parse(e(o.code));a.valid?self.postMessage({id:t,success:!0,data:{valid:!0}}):self.postMessage({id:t,success:!0,data:{valid:!1,error:{phase:"AST",message:a.message,line:a.line}}});break}case"EXECUTE_DRY_RUN":{const a=s.globals.get("run_pipeline")(o.code,!0);self.postMessage({id:t,success:!0,data:JSON.parse(a)});break}case"EXECUTE_FULL":{const a=s.globals.get("run_pipeline")(o.code,!1,o.outputSeparator||";"),r=JSON.parse(a),n=s.FS.readFile("/data/output.csv");r.outputCsvBuffer=n,self.postMessage({id:t,success:!0,data:r});break}}}catch(e){const a=e.message||String(e);self.postMessage({id:t,success:!1,error:{phase:"RUNTIME",message:a,traceback:e.stack||a}})}};
