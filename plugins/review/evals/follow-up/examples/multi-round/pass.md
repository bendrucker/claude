## Needs Your Attention

- `billing/invoice.py:25` (resolved, mechanical): `subtotal` wraps a float product in `Decimal`, and `Line.price` is still a float.
- `billing/invoice.py:34` (resolved, partial): `validate` checks the invoice currency but not the lines.
- `billing/tax.py:9` (open, not addressed): tax still rounds per line.
- `billing/invoice.py:44` (dismissed): Net 30 stays fixed per the finance contract. The reason holds.

## Cleanly Addressed

Fifteen threads, including the owner check, the 422, and the hard-coded rates now in `settings.py` (thread still open).

## Recommendation

Request changes.
