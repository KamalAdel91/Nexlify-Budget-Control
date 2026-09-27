import os

import frappe
from frappe.core.doctype.doctype.doctype import DocType
from frappe.modules import get_doc_path

PAIRS = [('Project Cost Budget Rate', 'Project Estimation Rate'), ('Project Cost Budget Other Cost', 'Project Estimation Other Cost'), ('Project Cost Budget Accommodation', 'Project Estimation Accommodation'), ('Project Cost Budget Test Equipment', 'Project Estimation Test Equipment'), ('Project Cost Budget Transportation', 'Project Estimation Transportation'), ('Project Cost Budget Detail', 'Project Estimation Detail'), ('Project Cost Budget', 'Project Estimation')]


def execute():
    """Renames the Estimation DocTypes before the DocType files are synced. Tables and data are kept.

    The app already ships the new folders, so moving the old folder is skipped when it is not there
    (it would fail with developer mode on and stop the rename halfway)."""
    original = getattr(DocType, "rename_files_and_folders", None)

    def move_only_if_there(self, old, new):
        if original and os.path.exists(get_doc_path(self.module, "doctype", old)):
            return original(self, old, new)

    # Same behaviour as the rehearsal: no file writes or folder moves while renaming,
    # even if the site runs with developer mode on
    dev_mode = frappe.conf.developer_mode
    frappe.conf.developer_mode = 0
    if original:
        DocType.rename_files_and_folders = move_only_if_there
    try:
        for old, new in PAIRS:
            if frappe.db.exists("DocType", old) and not frappe.db.exists("DocType", new):
                frappe.rename_doc("DocType", old, new, force=True)
    finally:
        frappe.conf.developer_mode = dev_mode
        if original:
            DocType.rename_files_and_folders = original
