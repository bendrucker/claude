File this in Linear for ENG. The invoice PDF job crashes for any invoice with more than 200 line items. Repro: create an invoice with 250 line items, then run `bin/invoice-pdf --id <id>`. It works up to 200.

Here's the trace from the worker:

Traceback (most recent call last):
  File "/app/billing/pdf/render.py", line 88, in render_invoice
    pages = paginate(items, per_page=PAGE_SIZE)
  File "/app/billing/pdf/paginate.py", line 41, in paginate
    return [layout(chunk) for chunk in chunks(items, per_page)]
  File "/app/billing/pdf/paginate.py", line 27, in layout
    raise OverflowError("table exceeds page frame")
OverflowError: table exceeds page frame

Done when: invoices with 1000 line items render, totals still land on the last page, and there's a regression test at 201 items.
