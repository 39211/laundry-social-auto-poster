"""OPS-ENVGUARD: real Flask test client, synthetic configuration, no model calls."""
import ast
import os
from pathlib import Path
import unittest
from unittest import mock

import line_webhook


class ReadyzTests(unittest.TestCase):
    def setUp(self):
        self.client = line_webhook.app.test_client()
        self.env = mock.patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def get(self, **kwargs):
        return self.client.get('/readyz', base_url='http://127.0.0.1:8791', **kwargs)

    def test_missing_configuration_is_false(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            'pid': os.getpid(), 'vision_configured': False, 'ai_chat': False,
            'missing': ['GEMINI_API_KEY', 'LAUNDRY_AI_CHAT'], 'chat_claude': False,
        })

    def test_configured_and_no_values(self):
        os.environ.update(GEMINI_API_KEY='synthetic-private-marker', LAUNDRY_AI_CHAT='on')
        row = self.get().get_json()
        self.assertEqual(row, {'pid': os.getpid(), 'vision_configured': True,
                               'ai_chat': True, 'missing': [], 'chat_claude': False})
        self.assertNotIn('synthetic-private-marker', str(row))
        self.assertNotIn('://', str(row))

    def test_claude_key_is_reported_as_a_boolean_only(self):
        os.environ.update(GEMINI_API_KEY='synthetic-private-marker', LAUNDRY_AI_CHAT='on',
                          CLAUDE_API_CREDIT_KEY='synthetic-claude-marker')
        row = self.get().get_json()
        self.assertIs(row['chat_claude'], True)
        self.assertIs(row['ai_chat'], True)
        self.assertNotIn('synthetic-claude-marker', str(row))

    def test_disabled_vision_and_chat_modes(self):
        os.environ.update(GEMINI_API_KEY='synthetic-private-marker', LAUNDRY_PHOTO_ESTIMATE='0')
        for mode in ('off', 'shadow', 'invalid', ''):
            with self.subTest(mode=mode):
                os.environ['LAUNDRY_AI_CHAT'] = mode
                row = self.get().get_json()
                self.assertIs(row['vision_configured'], False)
                self.assertIs(row['ai_chat'], False)
                self.assertEqual(row['missing'], ['LAUNDRY_PHOTO_ESTIMATE', 'LAUNDRY_AI_CHAT'])

    def test_on_without_key_and_normalized_on(self):
        os.environ['LAUNDRY_AI_CHAT'] = ' ON '
        row = self.get().get_json()
        self.assertIs(row['ai_chat'], False)
        self.assertEqual(row['missing'], ['GEMINI_API_KEY'])
        os.environ['GEMINI_API_KEY'] = 'synthetic-private-marker'
        self.assertIs(self.get().get_json()['ai_chat'], True)

    def test_uses_real_capability_predicates(self):
        os.environ.update(GEMINI_API_KEY='synthetic-private-marker', LAUNDRY_AI_CHAT='on')
        with mock.patch('photo_estimate.configured', return_value=False), \
                mock.patch('ai_chat.available', return_value=False):
            row = self.get().get_json()
            self.assertIs(row['vision_configured'], False)
            self.assertIs(row['ai_chat'], False)

    def test_loopback_only_even_behind_tunnel(self):
        self.assertEqual(self.client.get('/readyz', base_url='https://public.invalid').status_code, 403)
        self.assertEqual(self.get(environ_overrides={'REMOTE_ADDR': '192.0.2.1'}).status_code, 403)
        for name in ('X-Forwarded-For', 'X-Forwarded-Host', 'Forwarded', 'CF-Connecting-IP'):
            self.assertEqual(self.get(headers={name: 'synthetic'}).status_code, 403)

    def test_healthz_unchanged(self):
        response = self.client.get('/healthz')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, f'ok {os.getpid()}'.encode('ascii'))

    def test_allowlist_covers_runtime_environment_reads(self):
        root = Path(__file__).resolve().parent
        launcher = (root / 'run_line_bot.ps1').read_text(encoding='ascii')
        allowlist = launcher.split('function Get-BotConfigNames {', 1)[1].split('\n}', 1)[0]
        names = set()
        for path in root.glob('*.py'):
            if path.name.startswith(('test_', 'run_', 'eval_')):
                continue
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8-sig'))):
                key = None
                if (isinstance(node, ast.Call) and node.args
                        and isinstance(node.func, ast.Attribute)
                        and (node.func.attr == 'getenv' or
                             (node.func.attr in ('get', 'setdefault')
                              and isinstance(node.func.value, ast.Attribute)
                              and node.func.value.attr == 'environ'))):
                    key = node.args[0]
                elif (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute)
                      and node.value.attr == 'environ'):
                    key = node.slice
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    name = key.value
                    if name == 'GEMINI_API_KEY' or name.startswith(('LAUNDRY_', 'LINE_')):
                        names.add(name)
        for name in names:
            self.assertIn("'" + name + "'", allowlist, name)


if __name__ == '__main__':
    unittest.main()
