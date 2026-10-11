# serve_local.py
import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

CustomHandler.extensions_map.update({
    ".wasm": "application/wasm",
    ".whl": "application/octet-stream",
    ".mjs": "application/javascript",
    ".js": "application/javascript"
})

def main():
    if not os.path.isdir(DIRECTORY):
        print(f"Erreur : Le dossier '{DIRECTORY}' n'existe pas encore. Lancez d'abord 'npm run build'.", file=sys.stderr)
        sys.exit(1)

    print(f"============================================================")
    print(f"  Serveur local Studio Actuariel démarré sur :")
    print(f"  http://localhost:{PORT}")
    print(f"  Dossier racine servi : {DIRECTORY}")
    print(f"  En-têtes COOP/COEP actifs pour WebAssembly.")
    print(f"============================================================")

    if "--no-browser" not in sys.argv:
        webbrowser.open(f"http://localhost:{PORT}")

    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur local.")

if __name__ == "__main__":
    main()
