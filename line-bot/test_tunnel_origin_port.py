"""Origin port override for the tunnel (11/11 owner: answer customers with the shop's own code on 18791)."""
import os
import unittest
from unittest import mock

import tunnel_manager


class OriginPortTests(unittest.TestCase):
    def port(self, value):
        env = {} if value is None else {"LAUNDRY_TUNNEL_ORIGIN_PORT": value}
        with mock.patch.dict(os.environ, env, clear=False):
            if value is None:
                os.environ.pop("LAUNDRY_TUNNEL_ORIGIN_PORT", None)
            return tunnel_manager._origin_port()

    def test_default_is_this_bot(self):
        self.assertEqual(self.port(None), 8791)
        self.assertEqual(self.port(""), 8791)

    def test_shop_copy_port_accepted(self):
        self.assertEqual(self.port("18791"), 18791)

    def test_unknown_or_bad_ports_fall_back(self):
        for value in ("8792", "80", "abc", "18791x", "-1"):
            self.assertEqual(self.port(value), 8791, value)


if __name__ == "__main__":
    unittest.main()
