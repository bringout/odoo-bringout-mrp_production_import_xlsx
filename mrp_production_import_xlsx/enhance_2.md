 llm -f repomix-output.xml -m o3 "enhance import wizard so it show to the user number of rows in xlsx file and ask user for permission to continue with question 'do you want to import these rows?' "
Below is a non-breaking patch that adds a “two-step” workflow:

1. First click “Continue” – the wizard counts the data rows in the file and
   shows
   “This file contains X rows.  Do you want to import these rows?”
2. Second click “Import” – the real creation/confirmation of the MOs starts.

Nothing happens until the user has explicitly approved the number of rows.

────────────────────────────────────────────────────────────────────
1 / 2  wizards/mrp_import_wizard.py
────────────────────────────────────────────────────────────────────
```diff
@@
     auto_confirm = fields.Boolean(
         string="Automatically confirm orders",
         default=False,
         help="If ticked, the wizard will confirm each new MO after creation.",
     )
+    # -----------------------------------------------------------------
+    # New confirmation helper fields
+    # -----------------------------------------------------------------
+    state = fields.Selection(
+        [("draft", "Draft"), ("confirm", "Confirm"), ("done", "Done")],
+        default="draft",
+        string="Status",
+        readonly=True,
+    )
+    row_count = fields.Integer(
+        string="Rows in file",
+        readonly=True,
+        help="Number of non-empty data rows detected in the spreadsheet.",
+    )

     # ---------------------------------------------------------------------
     # Public buttons
     # ---------------------------------------------------------------------

+    # Step-1: user clicks “Continue” → we just count the rows
+    def action_count_rows(self):
+        self.ensure_one()
+        rows = list(self._read_xlsx())          # iterator -> list so we can len()
+        self.row_count = len(rows)
+        if not self.row_count:
+            raise UserError(_("The file does not contain any data rows."))
+        self.state = "confirm"
+        return self._action_reload()
+
     def action_import(self):
-        """Main entry point invoked by the form button."""
+        """
+        Real import – only reachable after the user acknowledged the amount
+        of rows (state = *confirm*).
+        """
+        self.ensure_one()
+        if self.state != "confirm":
+            # Developer safety-belt, should never happen through the UI
+            raise UserError(_("Please confirm the import first."))
+        rows = self._read_xlsx()
         ok, ko = self._process_rows(rows)

         log_lines = [_("%s production orders created.") % ok]
         if ko:
             log_lines.append(_("Errors (%s):") % len(ko))
             log_lines.extend(ko)

         self.log = "\n".join(log_lines)
+        self.state = "done"
         return self._action_show_log()

+    # -----------------------------------------------------------------
+    # Small re-load helper (used by both buttons)
+    # -----------------------------------------------------------------
+    def _action_reload(self):
+        self.ensure_one()
+        return {
+            "type": "ir.actions.act_window",
+            "res_model": "mrp.production.import",
+            "view_mode": "form",
+            "res_id": self.id,
+            "target": "new",
+        }
```

────────────────────────────────────────────────────────────────────
2 / 2  views/import_wizard_views.xml
────────────────────────────────────────────────────────────────────
```diff
@@
             <form string="Import Manufacturing Orders">
                 <group>
                     <field name="file" filename="file_name"/>
                     <field name="auto_confirm"/>
+
+                    <!-- Confirmation message -->
+                    <group attrs="{'invisible': [('state','!=','confirm')]}">
+                        <label string="This file contains"/>
+                        <field name="row_count" class="oe_inline" readonly="1"/>
+                        <label string="rows.  Do you want to import these rows?"/>
+                    </group>
+
+                    <!-- Log displayed once everything is done ------------->
                     <field name="log" nolabel="1" readonly="1" widget="text"
-                           attrs="{'invisible':[('log','=',False)]}"/>
+                           attrs="{'invisible':[('state','!=','done')]}"/>
                 </group>
                 <footer>
-                    <button name="action_import" string="Import"
-                            type="object" class="btn-primary"
-                            attrs="{'invisible': [('file','=',False)]}"/>
+                    <!-- STEP-1 : only visible while in *draft* ------------>
+                    <button name="action_count_rows" string="Continue"
+                            type="object" class="btn-primary"
+                            attrs="{'invisible': [('state','!=','draft')]}"/>
+
+                    <!-- STEP-2 : only visible while in *confirm* ----------->
+                    <button name="action_import" string="Import"
+                            type="object" class="btn-primary"
+                            attrs="{'invisible': [('state','!=','confirm')]}"/>
+
                     <button string="Close" class="btn-secondary"
                             special="cancel"/>
                 </footer>
             </form>
         </field>
```

────────────────────────────────────────────────────────────────────
3 / 3  (optional) test update
────────────────────────────────────────────────────────────────────
Existing tests need one extra call:

```python
wizard.action_count_rows()   # new step
wizard.action_import()       # actual import, as before
```

The rest of the assertions remain unchanged.

────────────────────────────────────────────────────────────────────
What changed for the user?
────────────────────────────────────────────────────────────────────
• The first click (“Continue”) instantiates the confirmation screen
  that reads, e.g.:

    This file contains 37 rows.
    Do you want to import these rows?

• Only after pressing “Import” are the Manufacturing Orders created and,
  if `auto_confirm` is ticked, confirmed.

This enhancement makes accidental imports far less likely while
remaining fully backward-compatible with the core logic already in
place.
