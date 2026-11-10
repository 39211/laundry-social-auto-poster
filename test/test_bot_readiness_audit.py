"""No sockets or customer data: real night-window helper with synthetic hours."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest import mock
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import bot_readiness_audit as audit

spec = importlib.util.spec_from_file_location('envguard_hours', ROOT / 'line-bot/tunnel_manager.py')
hours = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hours)
CONFIG = {'day_start': '10:00', 'day_end': '20:00', 'tz': 'Asia/Taipei',
          'night_takeover_delay_min': 5, 'days': {'6': None}}
TAIPEI = timezone(timedelta(hours=8))


class NightReadinessTests(unittest.TestCase):
    def run_check(self, row, hour=23, day=9):
        fetch = mock.Mock(return_value=row)
        with mock.patch.object(hours, 'load_handover_config', return_value=CONFIG):
            result = audit.audit_readiness(hours, now=datetime(2026, 11, day, hour, tzinfo=TAIPEI), fetch=fetch)
        return result, fetch

    def test_night_all_configurations(self):
        for vision in (True, False):
            for chat in (True, False):
                row = dict(pid=123, vision_configured=vision, ai_chat=chat, missing=[])
                result, fetch = self.run_check(row)
                self.assertEqual(result['status'], 'pass' if vision and chat else 'fail')
                fetch.assert_called_once_with()
                if not vision:
                    self.assertIn('GEMINI_API_KEY', result['reason'])
                if not chat:
                    self.assertIn('LAUNDRY_AI_CHAT', result['reason'])

    def test_day_does_not_fetch_or_fail(self):
        result, fetch = self.run_check(None, hour=13)
        self.assertEqual(result['status'], 'not_applicable')
        fetch.assert_not_called()

    def test_closed_day_uses_night_rule(self):
        result, fetch = self.run_check(None, hour=13, day=8)
        self.assertEqual(result['status'], 'fail')
        fetch.assert_called_once_with()

    def test_night_boundaries(self):
        for hour, expected in ((9, 'fail'), (10, 'not_applicable'), (19, 'not_applicable'), (20, 'fail')):
            self.assertEqual(self.run_check(None, hour=hour)[0]['status'], expected)

    def test_invalid_or_unavailable_is_redacted_failure(self):
        for row in (None, {}, [], dict(pid=True, vision_configured=True, ai_chat=True, missing=[]),
                    dict(pid=123, vision_configured='true', ai_chat=True, missing=[]),
                    dict(pid=123, vision_configured=True, ai_chat=True, missing=['synthetic-private-marker'])):
            result, _ = self.run_check(row)
            self.assertEqual(result['status'], 'fail')
            self.assertNotIn('synthetic-private-marker', str(result))
        with mock.patch.object(hours, 'is_night_window', return_value=True):
            result = audit.audit_readiness(hours, fetch=mock.Mock(side_effect=OSError('synthetic-private-marker')))
        self.assertEqual(result['reason'], 'readyz_unavailable_or_invalid')

    def test_invalid_hours_fail_without_fetch(self):
        fetch = mock.Mock()
        with mock.patch.object(hours, 'is_night_window', side_effect=ValueError('synthetic-private-marker')):
            result = audit.audit_readiness(hours, fetch=fetch)
        self.assertEqual(result['reason'], 'night_window_unavailable')
        fetch.assert_not_called()


class ReadyzTransportTests(unittest.TestCase):
    def test_fixed_loopback_request_and_close(self):
        with mock.patch.object(audit.http.client, 'HTTPConnection') as factory:
            connection = factory.return_value
            response = connection.getresponse.return_value
            response.status = 200
            response.read.return_value = b'{"pid":123,"vision_configured":true,"ai_chat":true,"missing":[]}'
            self.assertEqual(audit.read_readyz()['pid'], 123)
            factory.assert_called_once_with('127.0.0.1', 8791, timeout=3)
            connection.request.assert_called_once_with('GET', '/readyz')
            response.read.assert_called_once_with(8193)
            connection.close.assert_called_once_with()

    def test_http_error_redirect_or_oversize_closes(self):
        for status, body in ((302, b''), (500, b''), (200, b'x' * 8193), (200, b'broken')):
            with self.subTest(status=status), mock.patch.object(audit.http.client, 'HTTPConnection') as factory:
                connection = factory.return_value
                response = connection.getresponse.return_value
                response.status = status
                response.read.return_value = body
                with self.assertRaises(ValueError):
                    audit.read_readyz()
                connection.close.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
