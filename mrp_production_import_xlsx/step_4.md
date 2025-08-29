Below is a minimal but workable “step-4” delivery: the **complete, ready-to-drop-into-addons-path source tree** of the new module
`mrp_production_import_xlsx`.
All files are shown in full; copy them verbatim (respecting directory
names) and restart Odoo.  The only external Python requirement is
`openpyxl`.

```
mrp_production_import_xlsx/
├── __init__.py
├── __manifest__.py
├── README.rst
├── security/
│   └── ir.model.access.csv
├── views/
│   └── import_wizard_views.xml
└── wizards/
    ├── __init__.py
    └── mrp_import_wizard.py
```

────────────────────────────────────────────────────────────────────
mrp_production_import_xlsx/__init__.py
────────────────────────────────────────────────────────────────────
```python
# Copyright 2024 Your Company
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).
from . import wizards
```

────────────────────────────────────────────────────────────────────
mrp_production_import_xlsx/__manifest__.py
────────────────────────────────────────────────────────────────────
```python
# Copyright 2024 Your Company
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).
{
    "name": "Manufacturing Order XLS/XLSX Import",
    "summary": "Import manufacturing orders (mrp.production) from an "
               "Excel spreadsheet.",
    "version": "16.0.1.0.0",
    "author": "Your Company, Odoo Community Association (OCA)",
    "website": "https://github.com/yourorg/odoo-addons",
    "license": "AGPL-3",
    "depends": ["mrp"],
    "external_dependencies": {
        "python": ["openpyxl"],
    },
    "data": [
        "security/ir.model.access.csv",
        "views/import_wizard_views.xml",
    ],
    "installable": True,
    "application": False,
}
```

────────────────────────────────────────────────────────────────────
mrp_production_import_xlsx/security/ir.model.access.csv
────────────────────────────────────────────────────────────────────
```
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_mrp_production_import_user,mrp.production.import user,model_mrp_production_import,base.group_user,1,1,1,0
```

────────────────────────────────────────────────────────────────────
mrp_production_import_xlsx/views/import_wizard_views.xml
────────────────────────────────────────────────────────────────────
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <!-- Wizard form -------------------------------------------------------->
    <record id="view_mrp_production_import_wizard" model="ir.ui.view">
        <field name="name">mrp.production.import.form</field>
        <field name="model">mrp.production.import</field>
        <field name="arch" type="xml">
            <form string="Import Manufacturing Orders">
                <group>
                    <field name="file" filename="file_name"/>
                    <field name="auto_confirm"/>
                    <field name="log" nolabel="1" readonly="1" widget="text"/>
                </group>
                <footer>
                    <button name="action_import" string="Import"
                            type="object" class="btn-primary"
                            attrs="{'invisible': [('file','=',False)]}"/>
                    <button string="Close" class="btn-secondary"
                            special="cancel"/>
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

────────────────────────────────────────────────────────────────────
mrp_production_import_xlsx/wizards/__init__.py
────────────────────────────────────────────────────────────────────
```python
from . import mrp_import_wizard
```

────────────────────────────────────────────────────────────────────
mrp_production_import_xlsx/wizards/mrp_import_wizard.py
────────────────────────────────────────────────────────────────────
```python
# Copyright 2024 Your Company
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

import base64
import io
import logging
from contextlib import contextmanager
from datetime import datetime

from openpyxl import load_workbook

from odoo import api, fields, models, tools, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class MrpProductionImport(models.TransientModel):
    _name = "mrp.production.import"
    _description = "Import Manufacturing Orders from XLS/XLSX"

    file = fields.Binary(string="XLS/XLSX file", required=True)
    file_name = fields.Char("File Name")
    auto_confirm = fields.Boolean(
        string="Automatically confirm orders",
        default=True,
        help="If ticked, the wizard will confirm each new MO after creation.",
    )
    log = fields.Text(string="Import log", readonly=True)

    # ---------------------------------------------------------------------
    # Public buttons
    # ---------------------------------------------------------------------

    def action_import(self):
        """Main entry point invoked by the form button."""
        self.ensure_one()
        rows = self._read_xlsx()
        ok, ko = self._process_rows(rows)

        log_lines = [_("%s production orders created.") % ok]
        if ko:
            log_lines.append(_("Errors (%s):") % len(ko))
            log_lines.extend(ko)

        self.log = "\n".join(log_lines)
        return self._action_show_log()

    # ---------------------------------------------------------------------
    # I/O helpers
    # ---------------------------------------------------------------------

    def _read_xlsx(self):
        """Return an *iterator* of dicts: one per data row."""
        self.ensure_one()
        try:
            binary = io.BytesIO(base64.b64decode(self.file))
            wb = load_workbook(binary, read_only=True, data_only=True)
        except Exception as exc:
            raise UserError(_("Unable to read the file: %s") % tools.ustr(exc))

        ws = wb.active
        try:
            headers = [str(cell.value).strip() for cell in next(ws.rows)]
        except StopIteration:
            raise UserError(_("The file is empty."))

        for row in ws.iter_rows(min_row=2, values_only=True):
            if all(val is None for val in row):
                continue  # skip empty lines
            yield dict(zip(headers, row))

    # ---------------------------------------------------------------------
    # Row processing
    # ---------------------------------------------------------------------

    def _process_rows(self, rows):
        ok, ko = 0, []
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
        return ok, ko

    @contextmanager
    def _with_savepoint(self):
        """Rollback the current row only, not the whole wizard."""
        self.env.cr.execute("SAVEPOINT mrp_import")
        try:
            yield
            self.env.cr.execute("RELEASE SAVEPOINT mrp_import")
        except Exception:
            self.env.cr.execute("ROLLBACK TO SAVEPOINT mrp_import")
            raise

    # ---------------------------------------------------------------------
    # Mapping helpers
    # ---------------------------------------------------------------------

    def _prepare_mo_vals(self, row):
        product = self._get_product(row.get("Product"))
        qty = self._float(row.get("Quantity", 0.0))
        if qty <= 0.0:
            raise UserError(_("Quantity must be strictly positive."))

        return {
            "product_id": product.id,
            "product_uom_id": (
                self._get_uom(row.get("UoM")) or product.uom_id
            ).id,
            "product_qty": qty,
            "date_planned_start": self._date(row.get("Planned Start")),
            "origin": row.get("Reference") or "",
            "company_id": (
                self._get_company(row.get("Company")) or self.env.company
            ).id,
            # Optional fields
            "location_src_id": (
                self._get_location(row.get("Source Location"))
            ).id
            if row.get("Source Location")
            else False,
            "location_dest_id": (
                self._get_location(row.get("Destination Location"))
            ).id
            if row.get("Destination Location")
            else False,
            "user_id": self._get_user(row.get("Responsible")).id
            if row.get("Responsible")
            else False,
            "priority": row.get("Priority") or '0',
        }

    # ------ elementary converters ----------------------------------------

    @staticmethod
    def _float(value):
        if value is None:
            return 0.0
        try:
            return float(str(value).replace(",", "."))
        except Exception:
            raise UserError(_("Could not convert %s to a number.") % value)

    @staticmethod
    def _date(value):
        if not value:
            return False
        if isinstance(value, datetime):
            return value
        try:
            # Try Odoo's built-in parser first
            return fields.Datetime.from_string(value)
        except Exception:
            # Fall back to ISO pattern
            try:
                return datetime.strptime(value, "%Y-%m-%d")
            except Exception:
                raise UserError(_("Bad date: %s") % value)

    # ------ record lookup helpers ----------------------------------------

    def _get_product(self, ref):
        if not ref:
            raise UserError(_("Column 'Product' is mandatory."))
        Product = self.env["product.product"].with_context(active_test=False)

        product = Product.search(
            ["|", ("default_code", "=", ref), ("barcode", "=", ref)], limit=1
        )
        if not product:
            product = Product.search([("name", "=", ref)], limit=1)
        if not product:
            raise UserError(_("Product not found: %s") % ref)
        return product

    def _get_uom(self, name):
        if not name:
            return None
        Uom = self.env["uom.uom"].with_context(active_test=False)
        uom = Uom.search([("name", "=", name)], limit=1)
        if not uom:
            raise UserError(_("UoM not found: %s") % name)
        return uom

    def _get_company(self, name):
        if not name:
            return None
        Company = self.env["res.company"]
        company = Company.search([("name", "=", name)], limit=1)
        if not company:
            raise UserError(_("Company not found: %s") % name)
        return company

    def _get_location(self, name):
        Location = self.env["stock.location"]
        loc = Location.search([("name", "=", name)], limit=1)
        if not loc:
            raise UserError(_("Location not found: %s") % name)
        return loc

    def _get_user(self, name):
        User = self.env["res.users"]
        user = User.search([("name", "=", name)], limit=1)
        if not user:
            raise UserError(_("User not found: %s") % name)
        return user

    # ---------------------------------------------------------------------
    # UI helpers
    # ---------------------------------------------------------------------

    def _action_show_log(self):
        """Reload the wizard so the log becomes visible."""
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "res_model": "mrp.production.import",
            "view_mode": "form",
            "res_id": self.id,
            "target": "new",
        }
```

────────────────────────────────────────────────────────────────────
mrp_production_import_xlsx/README.rst
────────────────────────────────────────────────────────────────────
```
Manufacturing Order XLS/XLSX Import
===================================

This add-on adds a **Manufacturing ▸ Operations ▸ Import Manufacturing
Orders** menu-entry.  It lets a user upload an Excel file and creates one
``mrp.production`` record per row.

Supported column names
----------------------

Exactly as written (case-sensitive):

=======  ==========================================================
Column   Populated field (mrp.production)
=======  ==========================================================
Product  product_id  (lookup by `default_code`, barcode or name)
Quantity product_qty
UoM      product_uom_id (optional, falls back to product’s default)
Planned Start  date_planned_start  (YYYY-MM-DD or spreadsheet date)
Reference      origin (free text)
Company        company_id (optional, default = wizard’s company)
Source Location, Destination Location, Responsible, Priority are all
optional and self-explanatory.
=======  ==========================================================

Usage
-----

1. Go to *Manufacturing ▸ Operations ▸ Import Manufacturing Orders*.
2. Select your filled-in XLS/XLSX file (see ``sample_mrp_import.xlsx``).
3. Click *Import*.
4. Read the log; any faulty line is reported but the remaining lines are
   still processed thanks to per-row savepoints.

Dependencies
------------

* Python package **openpyxl**

Licence
-------

AGPL-3.0.
```

────────────────────────────────────────────────────────────────────

That is all.  Put the directory inside any addons path, run

```
pip install openpyxl
```

update the apps list, install *Manufacturing Order XLS/XLSX Import* and
start importing!
