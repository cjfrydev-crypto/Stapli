# Supabase schema

The live Stapli project is `dyacfwcpaahcubcwxrwh` in `eu-west-1`.

The schema is managed as ordered Supabase migrations. At this baseline the applied migration names are:

1. `initial_stapli_schema`
2. `add_foreign_key_indexes`
3. `add_retailer_import_ledger`
4. `add_shopping_actions_and_defaults`
5. `strengthen_import_identity`
6. `make_need_keys_canonical`
7. `dedupe_retailer_imports`
8. `promote_import_uniqueness_constraints`
9. `enable_realtime_shopping`
10. `enforce_household_reference_integrity`

The database includes Supabase Auth-backed profiles and households, RLS on every household-owned table, exact retailer articles beneath household needs, shopping trips/items, purchase events, retailer import ledgers, transactional bought/undo RPCs, and Realtime publication for shopping trips/items.

No service-role or database secret belongs in this repository. The application only requires the project URL and Supabase publishable key at runtime.
