import os
import urllib.request
import sys

PYODIDE_VER = "0.27.0"
BASE_URL = f"https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VER}/full/"

POLARS_WHEEL = "polars-1.18.0-cp39-abi3-pyodide_2024_0_wasm32.whl"

TARGETS = {
    os.path.join("public", "vendor", "pyodide"): [
        "pyodide.mjs",
        "pyodide.js",
        "pyodide.asm.js",
        "pyodide.asm.wasm",
        "pyodide-lock.json",
        "python_stdlib.zip"
    ],
    os.path.join("public", "vendor", "wheels"): [
        POLARS_WHEEL
    ]
}

def download_assets():
    print(f"=== Initialisation des assets vendorisés (Pyodide {PYODIDE_VER} + Polars Wasm) ===")
    for folder, files in TARGETS.items():
        os.makedirs(folder, exist_ok=True)
        for filename in files:
            dest = os.path.join(folder, filename)
            if not os.path.exists(dest) or os.path.getsize(dest) == 0:
                url = BASE_URL + filename
                print(f"Téléchargement : {filename} depuis {url}...")
                try:
                    urllib.request.urlretrieve(url, dest)
                    size_mb = os.path.getsize(dest) / (1024 * 1024)
                    print(f"  -> Terminé ({size_mb:.2f} Mo) : {dest}")
                except Exception as e:
                    print(f"  -> ERREUR lors du téléchargement de {filename}: {e}", file=sys.stderr)
                    raise
            else:
                size_mb = os.path.getsize(dest) / (1024 * 1024)
                print(f"Déjà présent ({size_mb:.2f} Mo) : {filename}")
    print("Tous les assets vendorisés sont prêts dans public/vendor/.")

if __name__ == "__main__":
    download_assets()
