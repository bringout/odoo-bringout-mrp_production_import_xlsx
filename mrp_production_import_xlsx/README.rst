Manufacturing Order XLSX Import
===================================

This add-on adds a **Manufacturing ▸ Operations ▸ Import Manufacturing
Order** menu-entry.  It lets a user upload an Excel file and creates one
``mrp.production`` document from rows in xlsx file.

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

1. Go to *Manufacturing ▸ Operations ▸ Import Manufacturing Order*.
2. Select your filled-in XLSX file (see ``sample_mrp_import.xlsx``).
3. Click *Import*.
4. Read the log; any faulty line is reported but the remaining lines are
   still processed thanks to per-row savepoints.

Dependencies
------------

* Python package **openpyxl**

Licence
-------

AGPL-3.0.