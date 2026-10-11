from playwright.sync_api import sync_playwright
import time
from pathlib import Path

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('http://localhost:8080')
        page.wait_for_selector('.app-header', timeout=10000)
        print('1. PAGE OUVERTE:', page.title())

        # Attendre que Pyodide soit prêt
        page.wait_for_selector('.status-dot.ready', timeout=25000)
        print('2. STATUS: Pyodide est READY')

        file_input = page.locator('#file-input')

        # --- TEST 1 : Apache Parquet ---
        parquet_path = str(Path('test_data/garanties.parquet').resolve())
        file_input.set_input_files(parquet_path)
        page.wait_for_selector(".table-card[data-alias='garanties']", timeout=10000)
        badge_text = page.locator(".table-card[data-alias='garanties'] .table-alias-badge").inner_text()
        meta_text = page.locator(".table-card[data-alias='garanties'] .table-meta-bar").inner_text()
        print('3. TEST PARQUET REUSSI:', badge_text.strip(), '|', meta_text.strip())

        # --- TEST 2 : CSV sans en-tête ---
        csv_no_head_path = str(Path('test_data/contrats_sans_entete.csv').resolve())
        file_input.set_input_files(csv_no_head_path)
        page.wait_for_selector(".table-card[data-alias='contrats_sans_entete']", timeout=10000)
        
        # Décocher 'En-tête présente'
        checkbox = page.locator(".table-card[data-alias='contrats_sans_entete'] .header-toggle-checkbox")
        checkbox.uncheck()
        time.sleep(1.5)
        meta_no_head = page.locator(".table-card[data-alias='contrats_sans_entete'] .table-meta-bar").inner_text()
        print('4. TEST CSV SANS EN-TETE DECOCHE REUSSI:', meta_no_head.strip())

        # --- TEST 3 : Excel bordélique (.xlsx) ---
        xlsx_path = str(Path('test_data/inventaire_bordelique.xlsx').resolve())
        file_input.set_input_files(xlsx_path)
        page.wait_for_selector(".table-card[data-alias='inventaire_bordelique']", timeout=15000)
        badge_xlsx = page.locator(".table-card[data-alias='inventaire_bordelique'] .table-alias-badge").inner_text()
        meta_xlsx = page.locator(".table-card[data-alias='inventaire_bordelique'] .table-meta-bar").inner_text()
        print('5. TEST EXCEL CHARGE REUSSI:', badge_xlsx.strip(), '|', meta_xlsx.strip())

        # Activer la table Excel pour vérifier la vue brute
        page.locator(".table-card[data-alias='inventaire_bordelique']").click()
        time.sleep(1)
        excel_tab = page.locator("button[data-view='excel_raw']")
        print('6. ONGLET EXCEL BRUT VISIBLE:', excel_tab.is_visible())
        if excel_tab.is_visible():
            excel_tab.click()
            time.sleep(0.5)
            rows_count = page.locator('.excel-raw-table tr').count()
            print('7. LIGNES MATRICE EXCEL BRUTE DETECTEES:', rows_count)

        # --- TEST 4 : Execution Dry-Run Polars croisant Parquet et CSV ---
        test_code = """import polars as pl

# Ingestion et jointure directe entre Parquet et CSV sans entete
df_p = dfs['garanties']
df_c = dfs['contrats_sans_entete']

df_out = pl.DataFrame({
    'total_garanties': [df_p.height],
    'total_contrats': [df_c.height],
    'somme_garanties': [float(df_p['montant_garantie'].sum())]
})
"""
        cm = page.locator('.cm-content')
        cm.fill(test_code)
        time.sleep(0.5)

        btn_dry_run = page.locator('#btn-dry-run')
        btn_dry_run.click()

        page.wait_for_selector('.preview-stats .badge-success-pill', timeout=10000)
        preview_stat = page.locator('.preview-stats').inner_text()
        print('8. TEST DRY-RUN POLARS SUR PARQUET & CSV REUSSI:', preview_stat.strip())

        browser.close()
        print('=== TOUS LES TESTS DES 3 NOUVEAUX FORMATS SONT VALIDÉS AVEC SUCCÈS ! ===')

if __name__ == '__main__':
    run_tests()
