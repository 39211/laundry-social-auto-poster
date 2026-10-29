# -*- coding: utf-8 -*-
"""pytest 進場先裝隔離，避免寫入正式 data 或打 LINE API。M1"""
import test_line_flows as _flows

_flows.install_isolation(fixture=True)
