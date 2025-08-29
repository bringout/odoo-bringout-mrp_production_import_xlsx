Below is the minimal patch you have to apply to the wizard
(wizards/mrp_import_wizard.py) so that :

1. all product codes contained in the spreadsheet are validated **before**
   the first MO is created;
2. if at least one code is missing, no MO is created at all and the wizard
   shows the user the exact list of unknown codes.

Only ±40 extra lines are necessary and nothing else in the add-on
(structure, views, tests, …) has to change.

────────────────────────────────────────────────────────────────────
PATCH : wizards/mrp_import_wizard.py
────────────────────────────────────────────────────────────────────
```python
@@
     def action_import(self):
         """Main entry point invoked by the form button."""
         self.ensure_one()
-        rows = self._read_xlsx()
+        # Turn the iterator into a *list* so we can iterate twice
+        rows = list(self._read_xlsx())
+
+        # --- NEW  : preliminary validation of product codes -------------
+        missing_codes = self._check_missing_products(rows)
+        if missing_codes:
+            self.log = _(
+                "Import aborted — the following product codes do not exist "
+                "in the database:\n%s"
+            ) % ", ".join(sorted(missing_codes))
+            return self._action_show_log()
+        # ----------------------------------------------------------------

         ok, ko = self._process_rows(rows)
@@
         return self._action_show_log()
@@

     # ---------------------------------------------------------------------
     # I/O helpers
     # ---------------------------------------------------------------------
@@
             raise UserError(_("The file is empty."))

         for row in ws.iter_rows(min_row=2, values_only=True):
             if all(val is None for val in row):
                 continue  # skip empty lines
             yield dict(zip(headers, row))
+
+    # -----------------------------------------------------------------
+    # NEW  : product-code validation *before* row processing
+    # -----------------------------------------------------------------
+    def _check_missing_products(self, rows):
+        """
+        Return a *set* of default_codes that are present in the spreadsheet
+        but not in the database.  The search is done in bulk (one SQL query),
+        therefore it is much faster than checking row-by-row.
+        """
+        # Collect every non-empty value found in column “Product”
+        wanted_codes = {
+            str(row.get("Product")).strip()
+            for row in rows
+            if row.get("Product")
+        }
+        if not wanted_codes:
+            raise UserError(_("Column 'Product' is empty in the file."))
+
+        Product = self.env["product.product"].with_context(active_test=False)
+        existing_codes = set(
+            Product.search([("default_code", "in", list(wanted_codes))]).mapped(
+                "default_code"
+            )
+        )
+        return wanted_codes - existing_codes
```

────────────────────────────────────────────────────────────────────
HOW IT WORKS
────────────────────────────────────────────────────────────────────
1  `rows = list(self._read_xlsx())`
   • we load the whole worksheet once so we can loop over it as many times
   as we like (first for validation, then for the actual import).

2  `_check_missing_products()`
   • extracts every distinct value found in column *Product*;
   • performs **one** search in `product.product` on `default_code`;
   • returns the *difference* between the wanted codes and the ones found.

3  If that difference is non-empty the wizard:
   • writes a clear message (comma-separated list of wrong codes) to its
     `log` field;
   • **returns immediately**, so no MO is generated.

4  Otherwise the original logic (`_process_rows`) runs unchanged.

────────────────────────────────────────────────────────────────────
RESULT IN THE USER INTERFACE
────────────────────────────────────────────────────────────────────
• The wizard window re-opens instantly and displays for example:

    Import aborted — the following product codes do not exist
    in the database:
    BAD-SKU-1, P-DOES-NOT-EXIST

• The user amends the spreadsheet or the master data and re-launches the
  import; nothing has been created twice, no partial data pollutes the
  database.

────────────────────────────────────────────────────────────────────
OPTIONAL: UPDATE THE AUTOMATED TEST
────────────────────────────────────────────────────────────────────
Add the simple scenario below to `tests/test_mrp_import.py` to prove the
validation works:

```python
def test_import_aborts_on_unknown_product(self):
    # Build a file that references one *unknown* code
    file_b64 = self._build_sample_xlsx_b64()
    # tamper with first row
    import base64, io
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(base64.b64decode(file_b64)))
    ws = wb.active
    ws["A2"].value = "BAD-SKU-1"          # <- unknown code
    buf = io.BytesIO()
    wb.save(buf)
    file_b64 = base64.b64encode(buf.getvalue())

    wiz = self.env["mrp.production.import"].create(
        {"file": file_b64, "file_name": "bad.xlsx"}
    )
    wiz.action_import()

    self.assertIn("BAD-SKU-1", wiz.log)
    mos = self.env["mrp.production"].search([("origin", "=", "MO-XLS-01")])
    self.assertFalse(mos, "No MO should be created when codes are missing")
```

Run the tests again: they will confirm that the protective check behaves
exactly as requested.
