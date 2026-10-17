Refine this into an issue:

Add a CSV export to the reports page. People want to pull the table they're currently looking at into a spreadsheet. It should respect the filters and sort they already applied, so the export matches what is on screen.

Files:
- reports/views.py (ReportTableView renders the filtered, sorted rows)
- reports/serializers.py (RowSerializer shapes each row for the table)
