#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../stubs.sh"
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/org/repo.git

commit() {
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3" git commit -qm "$4"
  git rev-parse HEAD
}

mkdir -p notifier tests
touch notifier/__init__.py tests/__init__.py
cat > notifier/unsubscribe.py <<'PY'
def is_unsubscribed(email: str, unsubscribed: set[str]) -> bool:
    return email in unsubscribed
PY
cat > pyproject.toml <<'TOML'
[project]
name = "notifier"
version = "0.4.0"
requires-python = ">=3.12"
TOML
BASE=$(commit "Ben Drucker" bvdrucker@gmail.com "2026-09-01T10:00:00Z" "notifier: unsubscribe list")

git switch -qc daily-digest
cat > notifier/send.py <<'PY'
import logging
import smtplib

log = logging.getLogger(__name__)


def send(address: str, subject: str, body: str) -> None:
    try:
        with smtplib.SMTP("localhost") as smtp:
            smtp.sendmail("digest@example.com", [address], f"Subject: {subject}\n\n{body}")
    except smtplib.SMTPException:
        pass
PY
cat > notifier/digest.py <<'PY'
from .send import send
from .unsubscribe import is_unsubscribed


def build_digest(user, items) -> str:
    lines = "".join(f"<li>{item.title}</li>" for item in items)
    return f"<p>Hi {user.name},</p><ul>{lines}</ul>"


def send_digests(users, items_by_user, unsubscribed: set[str]) -> None:
    seen = set()
    for user in users:
        key = user.email
        if key in seen or is_unsubscribed(user.email, unsubscribed):
            continue
        seen.add(key)
        deliver(user.email, build_digest(user, items_by_user[user.id]))


def deliver(address: str, body: str, attempts: int = 3) -> None:
    for attempt in range(attempts):
        try:
            return send(address, "Your daily digest", body)
        except ConnectionError:
            if attempt == attempts - 1:
                raise
PY
REVIEWED=$(commit "Lee Morgan" lee@org.example "2026-09-14T15:00:00Z" "notifier: daily digest email")

cat > notifier/send.py <<'PY'
import logging
import smtplib

log = logging.getLogger(__name__)


def send(address: str, subject: str, body: str) -> None:
    try:
        with smtplib.SMTP("localhost") as smtp:
            smtp.sendmail("digest@example.com", [address], f"Subject: {subject}\n\n{body}")
    except smtplib.SMTPException:
        log.exception("digest send to %s failed", address)
        raise
PY
cat > notifier/digest.py <<'PY'
import time

from .send import send
from .unsubscribe import is_unsubscribed


def build_digest(user, items) -> str:
    lines = "".join(f"<li>{item.title}</li>" for item in items)
    return f"<p>Hi {user.name},</p><ul>{lines}</ul>"


def send_digests(users, items_by_user, unsubscribed: set[str]) -> None:
    seen = set()
    for user in users:
        key = (user.email or "").lower()
        if key in seen or is_unsubscribed(user.email, unsubscribed):
            continue
        seen.add(key)
        deliver(user.email, build_digest(user, items_by_user[user.id]))


def deliver(address: str, body: str, attempts: int = 3) -> None:
    for attempt in range(attempts):
        try:
            return send(address, "Your daily digest", body)
        except ConnectionError:
            if attempt == attempts - 1:
                raise
            time.sleep(min(2**attempt, 30))
PY
cat > tests/test_digest.py <<'PY'
from types import SimpleNamespace
from unittest import mock

from notifier import digest


def test_dedupes_addresses_case_insensitively():
    users = [
        SimpleNamespace(id=1, name="Bo", email="Bo@example.com"),
        SimpleNamespace(id=2, name="Bo", email="bo@example.com"),
    ]
    with mock.patch.object(digest, "deliver") as deliver:
        digest.send_digests(users, {1: [], 2: []}, set())
    assert deliver.call_count == 1
PY
HEAD_SHA=$(commit "Lee Morgan" lee@org.example "2026-09-15T10:20:00Z" "notifier: address review")

# The reviewer's checkout tracks the PR branch and is up to date with it.
git update-ref refs/remotes/origin/main "$BASE"
git update-ref refs/remotes/origin/daily-digest "$HEAD_SHA"
git branch -q --set-upstream-to=origin/daily-digest

jq -n --arg root "$PWD" --arg base "$BASE" --arg reviewed "$REVIEWED" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.review-snapshot/meta.json" <<'JQ'
def ask($at; $body): [{author: "bendrucker", createdAt: $at, commit: $reviewed, body: $body}];
{
  root: $root,
  repo: "org/repo",
  viewer: "bendrucker",
  base: $base,
  head: $head,
  pull: {
    number: 55,
    title: "Daily digest email",
    author: "lee-m",
    headRefName: "daily-digest",
    createdAt: "2026-09-14T15:05:00Z",
    body: "Sends each subscribed user a daily HTML digest of their items."
  },
  reviews: [
    {id: 8801, author: "bendrucker", state: "CHANGES_REQUESTED", submittedAt: "2026-09-14T17:30:00Z", commit: $reviewed, body: "Four things before this ships."}
  ],
  threads: [
    {id: "PRRT_kwDOorg0001", isResolved: true, isOutdated: true, path: "notifier/send.py", line: 12,
     comments: ask("2026-09-14T17:20:00Z"; "SMTP failures are swallowed here, so a dead relay looks like a successful send and nothing retries or alerts. Log it and re-raise.")},
    {id: "PRRT_kwDOorg0002", isResolved: true, path: "notifier/digest.py", line: 9,
     comments: ask("2026-09-14T17:22:00Z"; "`item.title` and `user.name` go into the HTML unescaped. An item titled `<script>` or a crafted display name lands verbatim in the email. Escape both with `html.escape`.")},
    {id: "PRRT_kwDOorg0003", isResolved: true, isOutdated: true, path: "notifier/digest.py", line: 15,
     comments: ask("2026-09-14T17:25:00Z"; "Deduping on the raw address sends `Bo@example.com` and `bo@example.com` two digests, and SSO accounts have `email = None`, which this then tries to mail. Normalize addresses in one place that the unsubscribe check uses too, and skip users with no address.")},
    {id: "PRRT_kwDOorg0004", isResolved: false, path: "notifier/digest.py", line: 23,
     comments: ask("2026-09-14T17:28:00Z"; "The retry fires three times back to back, which does nothing for a relay that is briefly down. Back off between attempts, exponential with a cap.")}
  ]
}
JQ
