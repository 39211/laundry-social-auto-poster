"""Read-only production drift gate: compose only in a temporary directory.

Production tracks laundry main for desk pages, while the publisher may run a
release branch. Do not compare the release-only sitemap to the layered site.
No network writes, deploys, fixture updates or production working-tree changes.
"""
import argparse
import hashlib
import importlib.util
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.request import urlopen
import xml.etree.ElementTree as ET

ORIGIN = 'https://sixiangjialaundry.com/'


class PageMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonicals = []
        self.robots = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link' and 'canonical' in attrs.get('rel', '').lower().split():
            self.canonicals.append(attrs.get('href', ''))
        if tag == 'meta' and attrs.get('name', '').lower() in ('robots', 'googlebot'):
            self.robots.update(attrs.get('content', '').lower().replace(',', ' ').split())


def urls(raw):
    root = ET.fromstring(raw)
    if root.tag.split('}')[-1] != 'urlset':
        raise ValueError('Expected sitemap urlset')
    result = [node.text or '' for node in root.iter() if node.tag.split('}')[-1] == 'loc']
    if not result or len(result) != len(set(result)):
        raise ValueError('Empty or duplicate sitemap URLs')
    if any(not url.startswith(ORIGIN) for url in result):
        raise ValueError('Unexpected sitemap origin')
    return set(result)


def validate_pages(root, expected):
    root = Path(root).resolve()
    for url in sorted(expected):
        relative = url.removeprefix(ORIGIN)
        if not relative or relative.endswith('/'):
            relative += 'index.html'
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f'Missing or unsafe sitemap target: {url}')
        meta = PageMetadata()
        meta.feed(path.read_text(encoding='utf-8-sig'))
        if meta.canonicals != [url]:
            raise ValueError(f'Canonical mismatch: {url}: {meta.canonicals}')
        if 'noindex' in meta.robots:
            raise ValueError(f'Noindex sitemap target: {url}')


def assert_exact(actual, expected, label):
    if actual != expected:
        raise ValueError(f'{label}: missing={sorted(expected-actual)}, unexpected={sorted(actual-expected)}')


def validate_live(final, live):
    nonposts = lambda values: {u for u in values if not u.startswith(ORIGIN + 'posts/')}
    assert_exact(nonposts(final), nonposts(live), 'Composed/live non-post drift')
    # Keep the previous live post gate: the live rotating cohort need not match
    # a checked-in publisher snapshot, but it must not disappear or exceed 30.
    for name, values in [('composed', final), ('live', live)]:
        posts = values - nonposts(values)
        if ORIGIN + 'posts/' not in posts or not 2 <= len(posts) <= 31:
            raise ValueError(f'{name}: missing post hub/articles or too many indexable posts')


def git_head(root):
    result = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], check=True,
                            capture_output=True, text=True)
    sha = result.stdout.strip()
    if len(sha) != 40:
        raise ValueError('Cannot establish source commit')
    return sha


def assert_owned(site, owned):
    for path, raw in owned.items():
        target = Path(site) / path
        if not target.is_file() or target.read_bytes() != raw:
            raise ValueError(f'Generated-owned content changed: {path}')


def compose(generated_root, overlay_root, scripts_root, output):
    sys.path.insert(0, str(scripts_root))
    spec = importlib.util.spec_from_file_location('seo_overlay_merge', scripts_root / 'seo_overlay_merge.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    site = output / 'site'
    snapshot = output / 'generated'
    shutil.copytree(generated_root, site)
    # Preserve exact generated-owned bytes; ai-sitemap is intentionally extended
    # by the real merger, so its original URL entries are checked separately.
    owned = {p.relative_to(site).as_posix(): p.read_bytes()
             for p in site.rglob('*') if p.is_file()
             and module.is_generated_owned(p.relative_to(site))
             and p.relative_to(site).as_posix() != 'ai-sitemap.xml'}
    ai_before = urls((site / 'ai-sitemap.xml').read_bytes())
    module.snapshot(site, snapshot)
    for source in module.overlay_files(overlay_root):
        target = site / source.relative_to(overlay_root)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    # merge includes the real R10 journal renderer, not just sitemap union.
    module.merge(site, snapshot, overlay_root)
    module.verify(site, overlay_root, snapshot)
    assert_owned(site, owned)
    ai_after = urls((site / 'ai-sitemap.xml').read_bytes())
    if not ai_before <= ai_after:
        raise ValueError('Generated AI sitemap entries disappeared')
    final = urls((site / 'sitemap.xml').read_bytes())
    validate_pages(site, final)
    # Production applies this shell after merge/verify. Its own strict guard
    # preserves main/SEO content while legitimately changing post HTML bytes.
    subprocess.run(['node', str(scripts_root / 'apply_v4_shell.mjs'), '--site-root', str(site), '--strict'], check=True)
    assert_exact(urls((site / 'sitemap.xml').read_bytes()), final, 'Design shell sitemap drift')
    validate_pages(site, final)
    return final


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generated-root', type=Path, required=True)
    parser.add_argument('--overlay-repo', type=Path, required=True)
    parser.add_argument('--root-repo', type=Path, required=True)
    args = parser.parse_args()
    provenance = {'overlay_commit': git_head(args.overlay_repo),
                  'root_commit': git_head(args.root_repo),
                  'generated_sitemap_sha256': hashlib.sha256((args.generated_root / 'sitemap.xml').read_bytes()).hexdigest()}
    with tempfile.TemporaryDirectory(prefix='dot-production-composition-') as temp:
        final = compose(args.generated_root.resolve(), args.overlay_repo.resolve() / 'seo-overrides',
                        args.root_repo.resolve() / '.github/scripts', Path(temp))
        # A network failure or invalid snapshot fails visibly, never skips.
        with urlopen(ORIGIN + 'sitemap.xml', timeout=45) as response:
            raw = response.read()
        provenance.update({'live_fetched_at': datetime.now(timezone.utc).isoformat(),
                           'live_sitemap_sha256': hashlib.sha256(raw).hexdigest()})
        print(json.dumps(provenance, sort_keys=True))
        live = urls(raw)
        validate_live(final, live)
        print(f'Production composition verified: {len(final)} URLs; exact non-post live parity; generated-owned bytes preserved before strict design shell')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, ET.ParseError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f'::error::Production composition failed: {exc}')
