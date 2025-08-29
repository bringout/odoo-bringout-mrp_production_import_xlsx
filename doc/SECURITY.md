# Security

Access control and security definitions in mrp_production_import_xlsx.

## Access Control Lists (ACLs)

Model access permissions defined in:
- **[ir.model.access.csv](../mrp_production_import_xlsx/security/ir.model.access.csv)**
  - 1 model access rules

## Record Rules

Row-level security rules defined in:

```mermaid
graph TB
    subgraph "Security Layers"
        A[Users] --> B[Groups]
        B --> C[Access Control Lists]
        C --> D[Models]
        B --> E[Record Rules]
        E --> F[Individual Records]
    end
```

Security files overview:
- **[ir.model.access.csv](../mrp_production_import_xlsx/security/ir.model.access.csv)**
  - Model access permissions (CRUD rights)

Notes
- Access Control Lists define which groups can access which models
- Record Rules provide row-level security (filter records by user/group)
- Security groups organize users and define permission sets
- All security is enforced at the ORM level by Odoo
