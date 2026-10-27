"""One-off cross-check export (ADR-0004): weekday closures and early closes for 2026–2028.

Not a runtime dependency. Run in a throwaway virtualenv, never a global install:

    python3 -m venv .venv-xcal && .venv-xcal/bin/pip install exchange_calendars
    .venv-xcal/bin/python -I scripts/calendars/export_exchange_calendars.py \
      > packages/calendar/test/fixtures/exchange-calendars-2026-2028.json
"""

import json
import sys

import exchange_calendars as xc
import pandas as pd

START, END = "2026-01-01", "2028-12-31"
out = {"exchange_calendars": xc.__version__, "calendars": {}}
for code in ["XETR", "XAMS", "XPAR", "XCSE", "XLON", "XNYS"]:
    cal = xc.get_calendar(code, start=START, end=END)
    sessions = set(cal.sessions.strftime("%Y-%m-%d"))
    closed = [d for d in pd.bdate_range(START, END).strftime("%Y-%m-%d") if d not in sessions]
    early = {
        s.strftime("%Y-%m-%d"): cal.session_close(s).tz_convert(cal.tz).strftime("%H:%M")
        for s in cal.early_closes
    }
    out["calendars"][code] = {
        "tz": str(cal.tz),
        "weekdayClosures": closed,
        "earlyCloses": early,
        "regularOpen": cal.open_times[-1][1].strftime("%H:%M"),
        "regularClose": cal.close_times[-1][1].strftime("%H:%M"),
    }
json.dump(out, sys.stdout, indent=2, sort_keys=True)
