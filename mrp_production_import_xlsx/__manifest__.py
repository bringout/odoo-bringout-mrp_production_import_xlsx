{
    "name": "MRP Production Import Components from XLSX",
    "version": "16.0.1.0.6",
    "summary": "Generate Manufacturing Order from Components in XLSX file",
    "author": "bring.out doo Sarajevo",
    "website": "https://www.bring.out.ba",
    "category": "Manufacturing",
    "depends": ["mrp"],
    "data": [
        "security/ir.model.access.csv",
        "views/import_wizard_view.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "mrp_production_import_xlsx/static/src/js/mrp_import_progress.js",
        ],
    },
    "installable": True,
    "application": False,
    "license": "AGPL-3",
}
