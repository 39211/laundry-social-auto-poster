import importlib.util
from pathlib import Path
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('composition', Path(__file__).with_name('check-production-composition.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class ProductionCompositionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.url = c.ORIGIN + 'guides/example.html'
        target = self.root / 'guides/example.html'
        target.parent.mkdir()
        target.write_text(f'<link href="{self.url}" rel="canonical"><meta name="robots" content="index, follow">')

    def test_stale_overlay_cannot_replace_owned_post(self):
        path = self.root / 'posts/a.html'
        path.parent.mkdir()
        path.write_bytes(b'stale overlay')
        with self.assertRaisesRegex(ValueError, 'Generated-owned'):
            c.assert_owned(self.root, {'posts/a.html': b'fresh generated'})

    def test_missing_owned_feed_fails(self):
        with self.assertRaisesRegex(ValueError, 'Generated-owned'):
            c.assert_owned(self.root, {'rss.xml': b'generated rss'})

    def test_valid_page(self):
        c.validate_pages(self.root, {self.url})

    def test_missing_overlay_page(self):
        with self.assertRaisesRegex(ValueError, 'Missing'):
            c.validate_pages(self.root, {c.ORIGIN + 'guides/missing.html'})

    def test_missing_journal_month(self):
        with self.assertRaisesRegex(ValueError, 'Missing'):
            c.validate_pages(self.root, {c.ORIGIN + 'journal/2026-11/'})

    def test_noindex_rejected(self):
        target = self.root / 'guides/example.html'
        target.write_text(target.read_text() + '<meta name="googlebot" content="noindex">')
        with self.assertRaisesRegex(ValueError, 'Noindex'):
            c.validate_pages(self.root, {self.url})

    def test_foreign_canonical_rejected(self):
        (self.root / 'guides/example.html').write_text('<link rel="canonical" href="https://elsewhere.test/">')
        with self.assertRaisesRegex(ValueError, 'Canonical'):
            c.validate_pages(self.root, {self.url})

    def test_duplicate_sitemap(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            c.urls(f'<urlset><url><loc>{self.url}</loc></url><url><loc>{self.url}</loc></url></urlset>')

    def test_equal_count_wrong_url_is_drift(self):
        with self.assertRaisesRegex(ValueError, 'missing='):
            c.assert_exact({c.ORIGIN + 'wrong/'}, {self.url}, 'drift')

    def test_missing_live_posts(self):
        final = {self.url, c.ORIGIN + 'posts/', c.ORIGIN + 'posts/a.html'}
        with self.assertRaisesRegex(ValueError, 'live: missing'):
            c.validate_live(final, {self.url})

    def test_missing_composed_posts(self):
        live = {self.url, c.ORIGIN + 'posts/', c.ORIGIN + 'posts/a.html'}
        with self.assertRaisesRegex(ValueError, 'composed: missing'):
            c.validate_live({self.url}, live)

    def test_live_nonpost_missing_is_drift(self):
        base = {self.url, c.ORIGIN + 'posts/', c.ORIGIN + 'posts/a.html'}
        with self.assertRaisesRegex(ValueError, 'non-post drift'):
            c.validate_live(base, base | {c.ORIGIN + 'journal/2026-11/'})

    def test_rotating_live_post_cohort_allowed(self):
        base = {self.url, c.ORIGIN + 'posts/'}
        c.validate_live(base | {c.ORIGIN + 'posts/a.html'}, base | {c.ORIGIN + 'posts/b.html'})


if __name__ == '__main__':
    unittest.main()
