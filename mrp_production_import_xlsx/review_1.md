╭─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│  > this odoo module should make an MO order on sucessfull import. i don't see there is step where wizard's data populate main   │
│    database mrp.production. final result should be MO (mrp.production) order in state 'draft'                                   │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

✦ You are absolutely right to question that. The whole point of the wizard is to create Manufacturing Orders. Let's review the code to
  see where that happens and if it's being done correctly.

  I'll examine the wizards/mrp_import_wizard.py file again.
 ╭───────────────────────────────────────────╮
 │ ✔  ReadFile wizards/mrp_import_wizard.py  │
 ╰───────────────────────────────────────────╯
✦ You are correct. After reviewing the code, I can see that the creation of the mrp.production record is happening within the
  _process_rows method.

  Here's the relevant snippet:

    1 def _process_rows(self, rows):
    2     ok, ko = 0, []
    3     total_rows = len(rows)
    4
    5     # Process in batches for better performance
    6     batch_size = 10  # Update progress every 10 rows
    7
    8     for line_no, row in enumerate(rows, start=2):
    9         try:
   10             with self._with_savepoint():
   11                 mo_vals = self._prepare_mo_vals(row)
   12                 mo = self.env["mrp.production"].create(mo_vals)
   13                 if self.auto_confirm:
   14                     # Odoo 15+ => action_confirm; older => button_confirm
   15                     if hasattr(mo, "action_confirm"):
   16                         mo.action_confirm()
   17                     else:
   18                         mo.button_confirm()
   19             ok += 1
   20         except Exception as exc:
   21             _logger.exception("Manufacturing import error on line %s", line_no)
   22             ko.append(_("Line %(line)s – %(error)s",
   23                         line=line_no, error=tools.ustr(exc)))
   24
   25         # Update progress
   26         current_row = line_no - 1  # Adjust for 0-based indexing
   27         if current_row % batch_size == 0 or current_row == total_rows:
   28             self.write({'progress_current': current_row})
   29             self.env.cr.commit()  # Commit progress update
   30
   31     return ok, ko

  And here is the helper function that prepares the values for the create call:

    1 def _prepare_mo_vals(self, row):
    2     product = self._get_product(row.get("Product"))
    3     qty = self._float(row.get("Quantity", 0.0))
    4     if qty <= 0.0:
    5         raise UserError(_("Quantity must be strictly positive."))
    6
    7     return {
    8         "product_id": product.id,
    9         "product_uom_id": (
   10             self._get_uom(row.get("UoM")) or product.uom_id
   11         ).id,
   12         "product_qty": qty,
   13         "date_planned_start": self._date(row.get("Planned Start")),
   14         "origin": row.get("Reference") or "",
   15         "company_id": (
   16             self._get_company(row.get("Company")) or self.env.company
   17         ).id,
   18         # Optional fields
   19         "location_src_id": (
   20             self._get_location(row.get("Source Location"))
   21         ).id
   22         if row.get("Source Location")
   23         else False,
   24         "location_dest_id": (
   25             self._get_location(row.get("Destination Location"))
   26         ).id
   27         if row.get("Destination Location")
   28         else False,
   29         "user_id": self._get_user(row.get("Responsible")).id
   30         if row.get("Responsible")
   31         else False,
   32         "priority": row.get("Priority") or '0',
   33     }

  Analysis:

   1. MO Creation: The line mo = self.env["mrp.production"].create(mo_vals) is where the Manufacturing Order is created.
   2. State: The create method in Odoo will create the record with the default values defined for the model. For mrp.production, the
      default state is 'draft'. So, your requirement of having the MO in the 'draft' state is met.
   3. Auto-Confirm: The code also includes an auto_confirm option. If this is checked in the wizard, the code will attempt to call
      action_confirm() (or button_confirm() for older Odoo versions), which would move the MO to the 'confirmed' state.

  Conclusion:

  The code does create the Manufacturing Orders as intended. The _process_rows method iterates through the rows of the spreadsheet, and
   for each row, it calls _prepare_mo_vals to build a dictionary of values and then uses self.env["mrp.production"].create(mo_vals) to
  create the MO.

  The MO will be in the 'draft' state unless the "Automatically confirm orders" checkbox is ticked in the wizard.

  It seems the logic is in place. Perhaps there was a misunderstanding of the code's flow? Or maybe you are experiencing an issue where
   the MOs are not being created as expected? If so, could you provide more details on what is happening?