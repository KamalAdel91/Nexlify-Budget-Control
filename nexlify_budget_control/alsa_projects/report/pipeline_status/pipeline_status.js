// Pipeline Status: everything that waits on someone now, from the Hand-off Log.
frappe.query_reports['Pipeline Status'] = {
    filters: [
        { fieldname: 'waiting_on', label: __('Waiting On'), fieldtype: 'Link', options: 'Role' },
        { fieldname: 'reference_doctype', label: __('Document Type'), fieldtype: 'Select',
          options: ['', 'Project Estimation', 'Supply Request', 'Project Planning', 'Project Overview', 'Project Invoicing'] },
        { fieldname: 'customer', label: __('Customer'), fieldtype: 'Link', options: 'Customer' },
        { fieldname: 'project', label: __('Project'), fieldtype: 'Link', options: 'Project' },
        { fieldname: 'company', label: __('Company'), fieldtype: 'Link', options: 'Company' },
        { fieldname: 'overdue_only', label: __('Overdue Only'), fieldtype: 'Check' },
    ],
    formatter(value, row, column, data, default_formatter) {
        value = default_formatter(value, row, column, data);
        if (column.fieldname === 'duration_days' && data && data.is_overdue) {
            value = `<span style="color: var(--red-600); font-weight: 600">${value}</span>`;
        }
        return value;
    },
};
