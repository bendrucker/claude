#!/usr/bin/env bash
set -euo pipefail
mkdir -p app tests
touch app/__init__.py tests/__init__.py
cat > app/pages.py <<'PY'
def paginate(items, page, per_page=10):
    """Return the items on a 1-based page."""
    start = page * per_page
    return items[start:start + per_page]


def page_count(items, per_page=10):
    return max(1, -(-len(items) // per_page))
PY
cat > tests/test_pages.py <<'PY'
import unittest

from app.pages import page_count


class PageCountTest(unittest.TestCase):
    def test_rounds_partial_pages_up(self):
        self.assertEqual(page_count(list(range(25))), 3)

    def test_empty_list_has_one_page(self):
        self.assertEqual(page_count([]), 1)
PY
