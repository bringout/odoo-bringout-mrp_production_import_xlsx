# Architecture

```mermaid
flowchart TD
    U[Users] -->|HTTP| V[Views and QWeb Templates]
    V --> C[Controllers]
    V --> W[Wizards – Transient Models]
    C --> M[Models and ORM]
    W --> M
    M --> R[Reports]
    DX[Data XML] --> M
    S[Security – ACLs and Groups] -. enforces .-> M

    subgraph Mrp_production_import_xlsx Module - mrp_production_import_xlsx
      direction LR
      M:::layer
      W:::layer
      C:::layer
      V:::layer
      R:::layer
      S:::layer
      DX:::layer
    end

    classDef layer fill:#eef8ff,stroke:#6ea8fe,stroke-width:1px
```

Notes
- Views include tree/form/kanban templates and report templates.
- Controllers provide website/portal routes when present.
- Wizards are UI flows implemented with `models.TransientModel`.
- Data XML loads data/demo records; Security defines groups and access.
