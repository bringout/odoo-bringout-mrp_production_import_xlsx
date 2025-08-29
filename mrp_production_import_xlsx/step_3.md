──────────────────────────────
STEP 3 – “REVIEW & RE-USE CODE”
──────────────────────────────

Goal of this step
Examine battle-tested import add-ons (Sale-, Stock-, BoM-import) and extract the patterns you will copy into the brand-new module that will import Manufacturing Orders (`mrp.production`) from an XLS/XLSX file.

The three most instructive references
1. stock-logistics-import/stock_picking_import  (OCA)
2. sale-workflow/sale_order_import             (OCA)
3. manufacture/mrp_bom_import_xls              (OCA) – useful only for the XLS(X) parsing part

Below we dissect their structure and show, line by line, what you need to replicate or adapt.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. File/Folder layout to copy
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reference modules all obey the same skeleton:

addon_name/
│
├── __init__.py
├── __manifest__.py
├── security/
│   └── ir.model.access.csv
├── wizards/                          ← transient import wizard lives here
│   ├── __init__.py
│   └── *_import*.py
├── views/
│   └── *_import_views.xml
└── doc/  or  README.rst              ← usage, column list, licence

=>  Keep exactly that structure for `mrp_production_import_xlsx`.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. Transient Wizard model
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pattern (abridged from stock_picking_import):

class StockPickingImport(models.TransientModel):
    _name        = 'stock.picking.import'
    _description = 'Import Stock Picking'

    file              = fields.Binary(string='File', required=True)
    file_name         = fields.Char()
    import_option     = fields.Selection([('create', 'Create'), ('update', 'Update')])
    log               = fields.Text(readonly=True)

    def action_import(self):
        decoded = base64.b64decode(self.file)
        # … parse … create … gather errors
        return self._action_show_log()

What you will do

class MrpProductionImport(models.TransientModel):
    _name        = 'mrp.production.import'
    _description = 'Import Manufacturing Orders from XLS/XLSX'

    file         = fields.Binary(required=True, string="XLS/XLSX file")
    file_name    = fields.Char()
    auto_confirm = fields.Boolean(default=True,
                       help="Tick to automatically confirm newly created MOs")
    separator    = fields.Selection([(',', ','), (';', ';')], default=',')
    log          = fields.Text(readonly=True)

    def action_import(self):
        rows = self._read_xlsx()
        ok, ko = self._process_rows(rows)
        return self._show_summary(ok, ko)

Points you just cloned:
• Binary + filename pair
• action_import delegating to helpers
• a Text field to feed back success/errors

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. Re-usable helpers worth copy/pasting
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(from sale_order_import & stock_picking_import)

• _decode_file() – returns Io.BytesIO of the uploaded binary
• _csv_row_iterator() – becomes your _xlsx_row_iterator()
• _date_from_string(), _float() – robust parsing helpers (thousands sep, dots/commas)
• _with_savepoint():

    @contextmanager
    def _with_savepoint(self):
        self.env.cr.execute('SAVEPOINT mrp_import')
        try:
            yield
            self.env.cr.execute('RELEASE SAVEPOINT mrp_import')
        except Exception:
            self.env.cr.execute('ROLLBACK TO SAVEPOINT mrp_import')
            raise

Using that wrapper you can create/confirm an MO line-by-line without aborting the whole import.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. XLS/XLSX reading logic
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
mrp_bom_import_xls uses `xlrd` (xls only).
Modern Odoo add-ons increasingly use `openpyxl` because it handles both XLSX read & write and is pure-python.

Skeleton to embed (adapted):

from openpyxl import load_workbook
import io, base64

def _read_xlsx(self):
    stream = io.BytesIO(base64.b64decode(self.file))
    wb      = load_workbook(filename=stream, read_only=True, data_only=True)
    sheet   = wb.active
    headers = [str(c.value).strip() for c in next(sheet.rows)]
    for row in sheet.iter_rows(min_row=2, values_only=True):
        yield dict(zip(headers, row))

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. Row-to-MO mapping
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
table-like representation of the column names you will support
(README will document exactly this):

Column                    | Maps to field                   | Comment / helper
--------------------------|---------------------------------|---------------------------
Reference                 | origin OR name                  | if empty use sequence
Product Code / Barcode    | product_id                      | lookup by default_code or barcode
Quantity                  | product_qty (float)             | _float()
UoM                       | product_uom_id                  | search by uom.name
BOM Code (optional)       | bom_id                          | verify compatibility
Planned Start             | date_planned_start              | _date_from_string()
Company                   | company_id                      | fallback = wizard.env.company
Source Location (opt.)    | location_src_id                 | default from production
Destination Location (opt)| location_dest_id                | idem
Responsible (opt.)        | user_id                         | search res.users
Priority (opt.)           | priority                        | ‘0’,’1’,’2’,’3’

Core helper (pattern from stock_picking_import):

def _prepare_mo_vals(self, row):
    product = self._get_product(row['Product'])
    bom     = self._get_bom(product, row.get('BOM Code'))
    return {
        'product_id'         : product.id,
        'product_uom_id'     : self._get_uom(row.get('UoM')) or product.uom_id.id,
        'product_qty'        : self._float(row.get('Quantity', 0)),
        'bom_id'             : bom and bom.id,
        'date_planned_start' : self._date(row.get('Planned Start')),
        'company_id'         : self._get_company(row.get('Company')).id,
        'origin'             : row.get('Reference') or '',
        'location_src_id'    : self._get_location(row.get('Source Location')),
        'location_dest_id'   : self._get_location(row.get('Destination Location')),
        'user_id'            : self._get_user(row.get('Responsible')),
    }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. Row processing loop (borrowed almost verbatim)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ok, ko = 0, []
for row_nb, row in enumerate(rows, start=2):
    try:
        with self._with_savepoint():
            mo_vals = self._prepare_mo_vals(row)
            mo      = self.env['mrp.production'].create(mo_vals)
            if self.auto_confirm:
                mo.button_confirm()
        ok += 1
    except Exception as e:
        ko.append('Line %s – %s' % (row_nb, tools.ustr(e)))

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. View XML copied & renamed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<record id="view_mrp_production_import_wizard" model="ir.ui.view">
    <field name="model">mrp.production.import</field>
    <field name="arch" type="xml">
        <form string="Import Manufacturing Orders">
            <group>
                <field name="file" filename="file_name"/>
                <field name="auto_confirm"/>
            </group>
            <footer>
                <button name="action_import" type="object"
                        class="btn-primary" string="Import"/>
                <button string="Cancel" special="cancel" class="btn-secondary"/>
            </footer>
        </form>
    </field>
</record>

Then an act_window & menuitem exactly like in stock_picking_import but placed under Manufacturing / Operations / ‘Import Manufacturing Orders’.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. Security – ir.model.access.csv
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Copy the CSV line from stock_picking_import, change model and group:

id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_mrp_production_import_user,
    access.mrp.production.import.user,
    model_mrp_production_import,
    base.group_user,1,1,1,0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. What NOT to copy unchanged
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Don’t keep CSV parsing parts – switch to openpyxl.
• Do not reference `stock.picking`/`sale.order` model ids.
• Remove functions dealing with taxes, partners, incoterms – not relevant for MOs.
• keep licence header (AGPL-3) intact and add your copyright line.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. Quick “diff” Cheat-Sheet
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                           | stock_picking_import     | mrp_production_import_xlsx
---------------------------|--------------------------|---------------------------
_wizard name               | stock.picking.import     | mrp.production.import
_iter_ rows                | csv.DictReader           | openpyxl rows→dict
_prepare_*_vals            | _prepare_picking_vals    | _prepare_mo_vals
create() target model      | stock.picking            | mrp.production
post-create action         | validate / assign moves  | button_confirm() (opt.)
menu parent                | Inventory › Operations   | Manufacturing › Operations
sample file                | sample_stock.csv         | sample_mrp_import.xlsx

With that mapping in hand you should be able to do a “mechanical” copy-adapt-rename exercise:
1. duplicate OCA stock_picking_import ⇒ rename every occurrence of *stock* to *mrp* and *picking* to *production*,
2. swap CSV code for the `_read_xlsx` helper,
3. rewrite `_prepare_mo_vals` exactly as the table above shows,
4. adjust views & menu,
5. add README with column list and attach `sample_mrp_import.xlsx`.

You now have a fully-fledged step-by-step blueprint extracted from real-world, well-maintained OCA code, ready for Step 4 (“create the module skeleton”, which is basically `odoo-bin scaffold …` and then drop in the files you just designed).
