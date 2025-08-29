 repomix --ignore=*.md .

📦 Repomix v1.2.1

No custom config found at repomix.config.json5, repomix.config.jsonc, repomix.config.json or global config at /home/hernad/.config/repomix/repomix.config.json5, /home/hernad/.config/repomix/repomix.config.jsonc, /home/hernad/.config/repomix/repomix.config.json.
You can add a config file for additional settings. Please check https://github.com/yamadashy/repomix for more information.
✔ Packing completed successfully!

📈 Top 5 Files by Token Count:
──────────────────────────────────────────────────
1.  wizards/mrp_import_wizard.py (2,547 tokens, 12,560 chars, 52.9%)
2.  tests/test_mrp_import.py (1,109 tokens, 5,230 chars, 23.1%)
3.  views/import_wizard_view.xml (541 tokens, 2,717 chars, 11.2%)
4.  security/ir.model.access.csv (55 tokens, 189 chars, 1.1%)
5.  __init__.py (36 tokens, 126 chars, 0.7%)

🔎 Security Check:
──────────────────
✔ No suspicious files detected.

📊 Pack Summary:
────────────────
  Total Files: 6 files
 Total Tokens: 4,811 tokens
  Total Chars: 23,137 chars
       Output: repomix-output.xml
     Security: ✔ No suspicious files detected

🎉 All Done!
Your repository has been successfully packed.

💡 Repomix is now available in your browser! Try it at https://repomix.com
 llm -f repomix-output.xml -m openrouter/anthropic/claude-opus-4 "implement missing feature: no progress indication - for large files, users don't see progress"
Looking at the code, I can see that the import wizard processes files but doesn't provide any progress indication for large files. I'll implement a progress tracking feature that updates the UI during the import process.

Here's my implementation:

```python
# In wizards/mrp_import_wizard.py, add these modifications:

# Add new fields to the model
class MrpProductionImport(models.TransientModel):
    _name = "mrp.production.import"
    _description = "Import Manufacturing Orders from XLS/XLSX"

    # ... existing fields ...

    # Add progress tracking fields
    progress_current = fields.Integer(
        string="Current Progress",
        readonly=True,
        default=0,
        help="Number of rows processed so far"
    )
    progress_total = fields.Integer(
        string="Total Progress",
        readonly=True,
        default=0,
        help="Total number of rows to process"
    )
    progress_percentage = fields.Float(
        string="Progress %",
        compute="_compute_progress_percentage",
        readonly=True
    )
    is_processing = fields.Boolean(
        string="Is Processing",
        readonly=True,
        default=False,
        help="Indicates if import is currently in progress"
    )

    @api.depends('progress_current', 'progress_total')
    def _compute_progress_percentage(self):
        for record in self:
            if record.progress_total > 0:
                record.progress_percentage = (record.progress_current / record.progress_total) * 100
            else:
                record.progress_percentage = 0.0

    # Modify the action_import method
    def action_import(self):
        """
        Real import – only reachable after the user acknowledged the amount
        of rows (state = *confirm*).
        """
        self.ensure_one()
        if self.state != "confirm":
            raise UserError(_("Please confirm the import first."))

        # Set processing flag and initialize progress
        self.write({
            'is_processing': True,
            'progress_current': 0,
            'progress_total': self.row_count,
        })
        self.env.cr.commit()  # Commit to make progress visible

        try:
            # Turn the iterator into a *list* so we can iterate twice
            rows = list(self._read_xlsx())

            # --- NEW  : preliminary validation of product codes -------------
            missing_codes = self._check_missing_products(rows)
            if missing_codes:
                self.log = _(
                    "Import aborted — the following product codes do not exist "
                    "in the database:\n%s"
                ) % ", ".join(sorted(missing_codes))
                self.is_processing = False
                return self._action_show_log()
            # ----------------------------------------------------------------

            ok, ko = self._process_rows(rows)

            log_lines = [_("%s production orders created.") % ok]
            if ko:
                log_lines.append(_("Errors (%s):") % len(ko))
                log_lines.extend(ko)

            self.log = "\n".join(log_lines)
            self.state = "done"
        finally:
            self.is_processing = False

        return self._action_show_log()

    # Modify the _process_rows method to update progress
    def _process_rows(self, rows):
        ok, ko = 0, []
        total_rows = len(rows)

        # Process in batches for better performance
        batch_size = 10  # Update progress every 10 rows

        for line_no, row in enumerate(rows, start=2):
            try:
                with self._with_savepoint():
                    mo_vals = self._prepare_mo_vals(row)
                    mo = self.env["mrp.production"].create(mo_vals)
                    if self.auto_confirm:
                        # Odoo 15+ => action_confirm; older => button_confirm
                        if hasattr(mo, "action_confirm"):
                            mo.action_confirm()
                        else:
                            mo.button_confirm()
                ok += 1
            except Exception as exc:
                _logger.exception("Manufacturing import error on line %s", line_no)
                ko.append(_("Line %(line)s – %(error)s",
                            line=line_no, error=tools.ustr(exc)))

            # Update progress
            current_row = line_no - 1  # Adjust for 0-based indexing
            if current_row % batch_size == 0 or current_row == total_rows:
                self.write({'progress_current': current_row})
                self.env.cr.commit()  # Commit progress update

        return ok, ko

    # Add a method to check progress via RPC
    @api.model
    def get_import_progress(self, wizard_id):
        """Method to be called via RPC to check progress"""
        wizard = self.browse(wizard_id)
        if wizard.exists():
            return {
                'current': wizard.progress_current,
                'total': wizard.progress_total,
                'percentage': wizard.progress_percentage,
                'is_processing': wizard.is_processing,
                'state': wizard.state,
            }
        return {'error': 'Wizard not found'}
```

Now update the view to show progress:

```xml
<!-- In views/import_wizard_view.xml, modify the form view -->
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <!-- Wizard form -------------------------------------------------------->
    <record id="view_mrp_production_import_wizard" model="ir.ui.view">
        <field name="name">mrp.production.import.form</field>
        <field name="model">mrp.production.import</field>
        <field name="arch" type="xml">
            <form string="Import Manufacturing Orders">
                <sheet>
                    <group>
                        <field name="file" filename="file_name" attrs="{'readonly': [('is_processing', '=', True)]}"/>
                        <field name="file_name" invisible="1"/>
                        <field name="auto_confirm" attrs="{'readonly': [('is_processing', '=', True)]}"/>
                        <field name="is_processing" invisible="1"/>
                    </group>

                    <!-- Confirmation message -->
                    <group attrs="{'invisible': [('state','!=','confirm')]}">
                        <div class="alert alert-info" role="alert">
                            <p>This file contains <strong><field name="row_count" class="oe_inline" readonly="1"/></strong> rows.</p>
                            <p>Do you want to import these rows?</p>
                        </div>
                    </group>

                    <!-- Progress indicator -->
                    <group attrs="{'invisible': ['|', ('is_processing','=',False), ('state','=','done')]}">
                        <div class="o_import_progress">
                            <div class="alert alert-info" role="status">
                                <h4>Import in progress...</h4>
                                <p>Processing row <field name="progress_current" class="oe_inline"/> of <field name="progress_total" class="oe_inline"/></p>
                                <div class="progress" style="height: 25px;">
                                    <div class="progress-bar progress-bar-striped active" role="progressbar"
                                         t-att-style="'width: ' + str(int(progress_percentage)) + '%;'"
                                         t-att-aria-valuenow="progress_percentage"
                                         aria-valuemin="0"
                                         aria-valuemax="100">
                                        <span><field name="progress_percentage" widget="percentage"/></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </group>

                    <!-- Log displayed once everything is done -->
                    <group attrs="{'invisible':[('state','!=','done')]}">
                        <div class="alert alert-success" role="alert" attrs="{'invisible': [('log', '=', False)]}">
                            <h4>Import completed!</h4>
                            <field name="log" nolabel="1" readonly="1" widget="text"/>
                        </div>
                    </group>
                </sheet>

                <footer>
                    <!-- STEP-1 : only visible while in *draft* -->
                    <button name="action_count_rows" string="Continue"
                            type="object" class="btn-primary"
                            attrs="{'invisible': [('state','!=','draft')]}"/>

                    <!-- STEP-2 : only visible while in *confirm* -->
                    <button name="action_import" string="Import"
                            type="object" class="btn-primary"
                            attrs="{'invisible': ['|', ('state','!=','confirm'), ('is_processing','=',True)]}"/>

                    <!-- Show spinner while processing -->
                    <span attrs="{'invisible': [('is_processing','=',False)]}">
                        <i class="fa fa-spinner fa-spin"/> Processing...
                    </span>

                    <button string="Close" class="btn-secondary"
                            special="cancel"
                            attrs="{'invisible': [('is_processing','=',True)]}"/>
                </footer>
            </form>
        </field>
    </record>

    <!-- Window action ------------------------------------------------------>
    <record id="action_mrp_production_import_wizard" model="ir.actions.act_window">
        <field name="name">Import Manufacturing Orders</field>
        <field name="res_model">mrp.production.import</field>
        <field name="view_mode">form</field>
        <field name="target">new</field>
    </record>

    <!-- Menu item  (Manufacturing ▸ Operations) ---------------------------->
    <menuitem id="menu_mrp_production_import_wizard"
              name="Import Manufacturing Orders"
              parent="mrp.menu_mrp_operations"
              action="action_mrp_production_import_wizard"
              sequence="90"/>
</odoo>
```

For a more advanced implementation with real-time updates, you could add JavaScript to poll the progress:

```javascript
// Create a new file: static/src/js/mrp_import_progress.js
odoo.define('mrp_production_import.progress', function (require) {
    "use strict";

    const FormController = require('web.FormController');
    const core = require('web.core');
    const _t = core._t;

    FormController.include({
        init: function () {
            this._super.apply(this, arguments);
            this.progressInterval = null;
        },

        willStart: function () {
            const res = this._super.apply(this, arguments);
            if (this.modelName === 'mrp.production.import') {
                this._startProgressTracking();
            }
            return res;
        },

        _startProgressTracking: function () {
            if (this.progressInterval) {
                clearInterval(this.progressInterval);
            }

            const self = this;
            this.progressInterval = setInterval(function () {
                if (self.model.get(self.handle).data.is_processing) {
                    self._checkProgress();
                } else {
                    clearInterval(self.progressInterval);
                }
            }, 1000); // Check every second
        },

        _checkProgress: function () {
            const self = this;
            const recordID = this.model.get(this.handle).res_id;

            if (!recordID) return;

            this._rpc({
                model: 'mrp.production.import',
                method: 'get_import_progress',
                args: [recordID],
            }).then(function (result) {
                if (!result.error && result.is_processing) {
                    // Update progress bar dynamically
                    self.$('.progress-bar').css('width', result.percentage + '%');
                    self.$('.progress-bar span').text(Math.round(result.percentage) + '%');
                    self.$('[name="progress_current"]').text(result.current);

                    if (result.state === 'done') {
                        self.reload();
                    }
                }
            });
        },

        destroy: function () {
            if (this.progressInterval) {
                clearInterval(this.progressInterval);
            }
            this._super.apply(this, arguments);
        },
    });
});
```

And register the JavaScript file in `__manifest__.py`:

```python
{
    # ... existing manifest data ...
    'assets': {
        'web.assets_backend': [
            'mrp_production_import/static/src/js/mrp_import_progress.js',
        ],
    },
}
```

This implementation provides:

1. **Progress tracking fields** that store the current progress state
2. **Visual progress bar** in the wizard form showing percentage completion
3. **Real-time updates** through periodic commits during processing
4. **Batch processing** to balance performance with progress updates
5. **UI feedback** showing which row is currently being processed
6. **Optional JavaScript polling** for smoother real-time updates

The progress indication helps users:
- See that the import is actively working
- Estimate how long the import will take
- Know if they can safely wait or should come back later
- Identify if the process has stalled

For very large files, this gives users confidence that the system is working and haven't frozen or crashed.
