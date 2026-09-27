import frappe

from nexlify_budget_control.nexlify_budget_control.designation_manpower import (
    DEFAULT_DESIGNATION_MAP,
    seed_manpower_categories,
)

TABLES = [
    ("Project Equipment Scope Role", "trade"),
    ("Project Visit Team", "trade"),
    ("Project Cost Budget Rate", "designation"),
    ("Project Cost Budget Accommodation", "designation"),
]


def execute():
    seed_manpower_categories()
    categories = set(frappe.get_all("Manpower Category", pluck="name"))
    has_col = frappe.db.has_column("Designation", "manpower_category")

    used = set()
    for dt, f in TABLES:
        used |= set(frappe.db.sql_list(f"select distinct `{f}` from `tab{dt}` where ifnull(`{f}`, '') != ''"))

    mapping, missing = {}, []
    for value in sorted(used - categories):
        cat = (frappe.db.get_value("Designation", value, "manpower_category") if has_col else None) \
            or DEFAULT_DESIGNATION_MAP.get(value)
        if cat in categories:
            mapping[value] = cat
        else:
            parents = set()
            for dt, f in TABLES:
                parents |= {f"{p[0]} {p[1]}" for p in frappe.db.sql(
                    f"select parenttype, parent from `tab{dt}` where `{f}` = %s", value)}
            missing.append(f"{value} (in: {', '.join(sorted(parents))})")
    if missing:
        frappe.throw("Set a Manpower Category on these Designations, then migrate again:<br>" + "<br>".join(missing))

    collisions = []
    for dt, f in TABLES:
        seen = {}
        for parent, pfield, value in frappe.db.sql(
                f"select parent, parentfield, `{f}` from `tab{dt}` where ifnull(`{f}`, '') != ''"):
            key = (parent, pfield, mapping.get(value, value))
            if key in seen and seen[key] != value:
                collisions.append(f"{dt} in {parent}: {seen[key]} + {value} -> {key[2]}")
            seen.setdefault(key, value)
    if collisions:
        frappe.throw("These rows would become duplicates, merge them first:<br>" + "<br>".join(collisions))

    for dt, f in TABLES:
        for old, new in mapping.items():
            frappe.db.sql(f"update `tab{dt}` set `{f}` = %s where `{f}` = %s", (new, old))
    print(f"designation_to_manpower_category: {mapping}")
