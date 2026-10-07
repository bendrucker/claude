#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../stubs.sh"
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://gitlab.example.com/whirlai/api.git

commit() {
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3" git commit -qm "$4"
  git rev-parse HEAD
}
author() { commit "Mateo Ruiz" mateo@whirl.example "$@"; }

mkdir -p billing tests
touch billing/__init__.py tests/__init__.py
cat > billing/db.py <<'PY'
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

engine = create_engine("postgresql+psycopg://localhost/whirl")
session = Session(engine)
PY
BASE=$(commit "Ben Drucker" bvdrucker@gmail.com "2026-09-01T10:00:00Z" "billing: database session")

git switch -qc billing-invoices
cat > billing/models.py <<'PY'
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True)
    number = Column(String, unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    currency = Column(String(3), nullable=False)
    amount = Column(Float, nullable=False)
    due_at = Column(DateTime, nullable=False)
PY
cat > billing/invoice.py <<'PY'
import random
from dataclasses import dataclass
from datetime import datetime, timedelta

SUPPORTED_CURRENCIES = {"USD", "EUR", "GBP"}


@dataclass
class Line:
    description: str
    price: float
    qty: int
    currency: str


@dataclass
class Draft:
    customer_id: int
    currency: str
    lines: list[Line]
    discount: float = 0.0


def subtotal(draft: Draft) -> float:
    return sum(line.price * line.qty for line in draft.lines)


def total(draft: Draft) -> float:
    amount = subtotal(draft) - draft.discount
    return round(amount, 2)


def validate(draft: Draft) -> None:
    if not draft.currency:
        raise ValueError("currency is required")


def invoice_number() -> str:
    return f"INV-{random.randint(0, 99999):05d}"


def due_date() -> datetime:
    issued = datetime.now()
    return issued + timedelta(days=30)


def finalize(draft: Draft) -> dict:
    validate(draft)
    draft.lines.sort(key=lambda line: line.description)
    return {
        "number": invoice_number(),
        "customer_id": draft.customer_id,
        "currency": draft.currency,
        "lines": draft.lines,
        "amount": total(draft),
        "due_at": due_date(),
    }
PY
V1=$(author "2026-09-02T12:00:00Z" "billing: invoice drafts and totals")

cat > billing/tax.py <<'PY'
TAX_RATES = {"CA": 0.0725, "NY": 0.04, "TX": 0.0625}


def rate_for(region: str) -> float:
    return TAX_RATES.get(region, 0.0)


def tax(lines, region: str) -> float:
    return sum(round(line.price * line.qty * rate_for(region), 2) for line in lines)
PY
V2=$(author "2026-09-03T12:00:00Z" "billing: sales tax")

cat > billing/routes.py <<'PY'
from flask import Blueprint, abort, g, jsonify, request

from .db import session
from .invoice import Draft, Line, finalize
from .models import Invoice

bp = Blueprint("invoices", __name__)


@bp.get("/invoices/<int:invoice_id>")
def get_invoice(invoice_id: int):
    invoice = session.get(Invoice, invoice_id)
    if invoice is None:
        abort(404)
    return jsonify(number=invoice.number, amount=str(invoice.amount))


@bp.get("/invoices")
def list_invoices():
    rows = session.query(Invoice).filter_by(customer_id=g.customer_id).all()
    return jsonify([row.number for row in rows])


@bp.post("/invoices")
def create_invoice():
    body = request.get_json()
    print("create_invoice", body)
    try:
        lines = [Line(**line) for line in body["lines"]]
        created = finalize(Draft(customer_id=g.customer_id, currency=body["currency"], lines=lines))
    except ValueError as err:
        return jsonify(error=str(err)), 500
    return jsonify(number=created["number"]), 201
PY
V3=$(author "2026-09-05T12:00:00Z" "billing: invoice routes")

cat > tests/test_invoice.py <<'PY'
from datetime import datetime

from billing.invoice import Draft, Line, due_date, total


def test_total():
    draft = Draft(customer_id=1, currency="USD", lines=[Line("seat", 10.0, 2, "USD")])
    assert total(draft) == 20.0


def test_due_date():
    assert (due_date() - datetime.now()).days in (29, 30)
PY
V4=$(author "2026-09-08T12:00:00Z" "billing: tests")

# Thread anchors, as file and line at version 4.
L='{}'
mark() {
  local n
  n=$(grep -n -m1 -F -- "$3" "$2" | cut -d: -f1)
  L=$(jq -c --arg k "$1" --arg f "$2" --argjson n "$n" '.[$k] = {path: $f, line: $n}' <<< "$L")
}
mark I1 billing/invoice.py "return sum(line.price"
mark I2 billing/invoice.py "return round(amount, 2)"
mark I3 billing/invoice.py "amount = subtotal(draft) - draft.discount"
mark I4 billing/invoice.py "if not draft.currency:"
mark I5 billing/invoice.py "random.randint"
mark I6 billing/invoice.py "issued = datetime.now()"
mark I7 billing/invoice.py "timedelta(days=30)"
mark I8 billing/invoice.py "draft.lines.sort("
mark T1 billing/tax.py "return sum(round("
mark T2 billing/tax.py "TAX_RATES.get(region, 0.0)"
mark T3 billing/tax.py "TAX_RATES = {"
mark R1 billing/routes.py "invoice = session.get("
mark R2 billing/routes.py "), 500"
mark R3 billing/routes.py ".all()"
mark R4 billing/routes.py "print(\"create_invoice"
mark M1 billing/models.py "amount = Column(Float"
mark M2 billing/models.py "customer_id = Column("
mark X1 tests/test_invoice.py "def test_total"
mark X2 tests/test_invoice.py "datetime.now()).days"

cat > billing/models.py <<'PY'
from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True)
    number = Column(String, unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    currency = Column(String(3), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    due_at = Column(DateTime(timezone=True), nullable=False)
PY
cat > billing/numbers.py <<'PY'
from sqlalchemy import text


def next_invoice_number(session) -> str:
    n = session.execute(text("SELECT nextval('invoice_number_seq')")).scalar_one()
    return f"INV-{n:06d}"
PY
cat > billing/invoice.py <<'PY'
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from .numbers import next_invoice_number

SUPPORTED_CURRENCIES = {"USD", "EUR", "GBP"}
CENT = Decimal("0.01")


@dataclass
class Line:
    description: str
    price: float
    qty: int
    currency: str


@dataclass
class Draft:
    customer_id: int
    currency: str
    lines: list[Line]
    discount: Decimal = Decimal(0)


def subtotal(draft: Draft) -> Decimal:
    return sum((Decimal(line.price * line.qty) for line in draft.lines), Decimal(0))


def total(draft: Draft) -> Decimal:
    amount = max(subtotal(draft) - draft.discount, Decimal(0))
    return amount.quantize(CENT, rounding=ROUND_HALF_UP)


def validate(draft: Draft) -> None:
    if draft.currency not in SUPPORTED_CURRENCIES:
        raise ValueError(f"unsupported currency {draft.currency!r}")


def due_date() -> datetime:
    issued = datetime.now(UTC)
    return issued + timedelta(days=30)


def finalize(draft: Draft, session) -> dict:
    validate(draft)
    lines = sorted(draft.lines, key=lambda line: line.description)
    return {
        "number": next_invoice_number(session),
        "customer_id": draft.customer_id,
        "currency": draft.currency,
        "lines": lines,
        "amount": total(draft),
        "due_at": due_date(),
    }
PY
cat > billing/settings.py <<'PY'
import json
import os

TAX_RATES: dict[str, float] = json.loads(os.environ.get("TAX_RATES_JSON", "{}"))
PY
cat > billing/tax.py <<'PY'
from .settings import TAX_RATES


def rate_for(region: str) -> float:
    try:
        return TAX_RATES[region]
    except KeyError:
        raise ValueError(f"no tax rate configured for region {region!r}") from None


def tax(lines, region: str) -> float:
    return sum(round(line.price * line.qty * rate_for(region), 2) for line in lines)
PY
cat > billing/routes.py <<'PY'
from flask import Blueprint, abort, g, jsonify, request

from .db import session
from .invoice import Draft, Line, finalize
from .models import Invoice

bp = Blueprint("invoices", __name__)
PAGE_MAX = 200


@bp.get("/invoices/<int:invoice_id>")
def get_invoice(invoice_id: int):
    invoice = session.get(Invoice, invoice_id)
    if invoice is None or invoice.customer_id != g.customer_id:
        abort(404)
    return jsonify(number=invoice.number, amount=str(invoice.amount))


@bp.get("/invoices")
def list_invoices():
    limit = min(request.args.get("limit", 50, type=int), PAGE_MAX)
    offset = request.args.get("offset", 0, type=int)
    query = session.query(Invoice).filter_by(customer_id=g.customer_id).order_by(Invoice.id)
    rows = query.limit(limit).offset(offset).all()
    return jsonify([row.number for row in rows])


@bp.post("/invoices")
def create_invoice():
    body = request.get_json()
    try:
        lines = [Line(**line) for line in body["lines"]]
        draft = Draft(customer_id=g.customer_id, currency=body["currency"], lines=lines)
        created = finalize(draft, session)
    except ValueError as err:
        return jsonify(error=str(err)), 422
    return jsonify(number=created["number"]), 201
PY
cat > tests/test_invoice.py <<'PY'
from datetime import UTC, datetime
from decimal import Decimal

from freezegun import freeze_time

from billing.invoice import Draft, Line, due_date, total


def test_total():
    draft = Draft(customer_id=1, currency="USD", lines=[Line("seat", 10.0, 2, "USD")])
    assert total(draft) == Decimal("20.00")


def test_discount_never_makes_total_negative():
    draft = Draft(customer_id=1, currency="USD", lines=[Line("seat", 5.0, 1, "USD")], discount=Decimal(8))
    assert total(draft) == Decimal("0.00")


@freeze_time("2026-09-01T00:00:00Z")
def test_due_date():
    assert due_date() == datetime(2026, 10, 1, tzinfo=UTC)
PY
V5=$(author "2026-09-12T15:00:00Z" "billing: address round 2 review")

# The reviewer's checkout still sits on version 4, one commit behind the pushed branch.
git update-ref refs/remotes/origin/main "$BASE"
git update-ref refs/remotes/origin/billing-invoices "$V5"
git reset -q --hard "$V4"
git branch -q --set-upstream-to=origin/billing-invoices

jq -n --arg root "$PWD" --arg base "$BASE" --arg v1 "$V1" --arg v2 "$V2" --arg v3 "$V3" --arg v4 "$V4" --arg v5 "$V5" --argjson L "$L" -f /dev/stdin > "$HOME/.review-snapshot/meta.json" <<'JQ'
def user($u): {bdrucker: {id: 7, username: "bdrucker", name: "Ben Drucker"}, "mateo-r": {id: 52, username: "mateo-r", name: "Mateo Ruiz"}}[$u];
def note($id; $u; $at; $body): {id: $id, type: "DiscussionNote", body: $body, author: user($u), created_at: $at, updated_at: $at, system: false, noteable_id: 548548, noteable_type: "MergeRequest", noteable_iid: 548, resolvable: false};
def diffnote($id; $k; $head; $at; $body): note($id; "bdrucker"; $at; $body) + {type: "DiffNote", position: {base_sha: $base, start_sha: $base, head_sha: $head, old_path: $L[$k].path, new_path: $L[$k].path, position_type: "text", old_line: null, new_line: $L[$k].line}};
def changed($id): note($id; "mateo-r"; "2026-09-12T15:02:00Z"; "changed this line in [version 5 of the diff](/whirlai/api/-/merge_requests/548/diffs?diff_id=905&start_sha=\($v4)#note_\($id))") + {type: null, system: true};
def thread($id; $resolved; $notes): {id: $id, individual_note: false, notes: ($notes | map(. + {resolvable: true, resolved: $resolved}))};
def r2($n; $k; $body): diffnote($n; $k; $v4; "2026-09-09T10:\($n % 60 | tostring | if length == 1 then "0" + . else . end):00Z"; $body);
def done($n; $body): note($n; "mateo-r"; "2026-09-12T15:10:00Z"; $body);
{
  root: $root,
  host: "gitlab.example.com",
  project: "whirlai/api",
  projectId: 3310,
  viewer: user("bdrucker"),
  mr: {
    iid: 548,
    title: "Invoices: drafts, totals, tax, and routes",
    description: "Adds invoice drafting, totals with discounts, sales tax, and the invoice routes.",
    author: {username: "mateo-r", name: "Mateo Ruiz"},
    source_branch: "billing-invoices",
    created_at: "2026-09-02T12:05:00Z",
    updated_at: "2026-09-12T15:20:00Z"
  },
  versions: [
    {id: 901, head: $v1, base: $base, start: $base, created_at: "2026-09-02T12:05:00Z"},
    {id: 902, head: $v2, base: $base, start: $base, created_at: "2026-09-03T12:05:00Z"},
    {id: 903, head: $v3, base: $base, start: $base, created_at: "2026-09-05T12:05:00Z"},
    {id: 904, head: $v4, base: $base, start: $base, created_at: "2026-09-08T12:05:00Z"},
    {id: 905, head: $v5, base: $base, start: $base, created_at: "2026-09-12T15:02:00Z"}
  ],
  discussions: [
    thread("m01"; true; [
      diffnote(6101; "I1"; $v2; "2026-09-04T09:00:00Z"; "Money is float end to end here: `Line.price` is a float and `subtotal` multiplies floats, so representation error reaches the invoice amount. Carry prices and totals as `Decimal`."),
      note(6102; "mateo-r"; "2026-09-05T11:00:00Z"; "Will switch this over with the rounding change."),
      note(6103; "bdrucker"; "2026-09-09T10:00:00Z"; "Round 2: still floats."),
      done(6104; "Decimal now.")
    ]),
    thread("m02"; true; [r2(6201; "I2"; "`round()` rounds half to even, so 0.125 becomes 0.12. Invoices round half up to the cent."), changed(6202), done(6203; "Quantize with ROUND_HALF_UP.")]),
    thread("m03"; true; [r2(6301; "I3"; "A discount larger than the subtotal produces a negative invoice. Floor the total at zero."), done(6302; "Floored at zero, with a test.")]),
    thread("m04"; true; [
      diffnote(6401; "I4"; $v2; "2026-09-04T09:05:00Z"; "Check `currency` against the currencies we bill in, and reject a draft whose lines are in a different currency from the invoice. Today a EUR line on a USD invoice is summed as if it were dollars."),
      note(6402; "bdrucker"; "2026-09-09T10:01:00Z"; "Round 2: the mixed-currency case is still open."),
      done(6403; "Validating currency now.")
    ]),
    thread("m05"; true; [r2(6501; "I5"; "`random.randint` numbers collide after a few hundred invoices, and the column is unique, so finalize starts failing. Take the number from a database sequence."), done(6502; "Uses invoice_number_seq.")]),
    thread("m06"; true; [r2(6601; "I6"; "Naive `datetime.now()` is server-local time. Use an aware UTC timestamp so due dates don't shift with the host timezone."), changed(6602)]),
    thread("m07"; true; [r2(6701; "I7"; "Net 30 is a magic number. Make the payment terms configurable per customer."), note(6702; "mateo-r"; "2026-09-12T15:12:00Z"; "Every customer contract is Net 30 per finance (BILL-212), and per-customer terms aren't on the roadmap this half. I'd rather not add config nobody sets. Happy to revisit when sales asks for other terms.")]),
    thread("m08"; true; [r2(6801; "I8"; "`sort` reorders the caller's draft in place. Sort a copy."), done(6802; "Using sorted().")]),
    thread("m09"; false; [
      diffnote(6901; "T1"; $v2; "2026-09-04T09:10:00Z"; "Rounding tax per line and summing drifts by a cent or more on long invoices. Compute tax on the taxable total and round once."),
      note(6902; "mateo-r"; "2026-09-05T11:05:00Z"; "Good point, will look."),
      note(6903; "bdrucker"; "2026-09-09T10:02:00Z"; "Round 2: still rounding per line.")
    ]),
    thread("m10"; true; [r2(7001; "T2"; "An unknown region silently gets a 0% rate, so a typo in the region ships untaxed invoices. Raise instead."), done(7002; "Raises ValueError now.")]),
    thread("m11"; false; [r2(7101; "T3"; "Rates are hard-coded. Load them from configuration so finance can change a rate without a deploy.")]),
    thread("m12"; true; [r2(7201; "R1"; "Any logged-in customer can read any invoice by id. Check that the invoice belongs to `g.customer_id`, and 404 otherwise."), done(7202; "Owner check added, 404 on mismatch.")]),
    thread("m13"; true; [r2(7301; "R2"; "A validation error is the client's fault. Return 422, not 500, so it stays out of the error-rate alert."), done(7302; "422.")]),
    thread("m14"; true; [r2(7401; "R3"; "Unbounded `.all()` on a customer's invoices. Paginate with a capped limit."), done(7402; "limit/offset, capped at 200.")]),
    thread("m15"; true; [r2(7501; "R4"; "Leftover `print` that logs the whole request body, including line items, to stdout."), changed(7502)]),
    thread("m16"; true; [r2(7601; "M1"; "`Float` column for money. Use `Numeric(12, 2)`."), done(7602; "Numeric(12, 2).")]),
    thread("m17"; true; [r2(7701; "M2"; "Every list query filters on `customer_id`. Index it."), done(7702; "Indexed.")]),
    thread("m18"; true; [r2(7801; "X1"; "Add a case where the discount exceeds the subtotal."), done(7802; "Added.")]),
    thread("m19"; true; [r2(7901; "X2"; "This depends on the wall clock and flips around midnight. Freeze time and assert the exact due date."), done(7902; "freezegun, exact date.")]),
    {id: "m20", individual_note: true, notes: [note(8001; "mateo-r"; "2026-09-12T15:20:00Z"; "Round 3 ready. I think everything is addressed now @bdrucker")]}
  ]
}
JQ
