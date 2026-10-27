// GENERATED from config/calendars/*.yaml by `pnpm --filter @euroedge/calendar gen`. Do not edit.
import type { CalendarFile } from '../schema.ts';

export const CALENDAR_FILES: readonly CalendarFile[] = [
  {
    "venue": "FX",
    "name": "Spot FX",
    "tz": "America/New_York",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://en.wikipedia.org/wiki/Foreign_exchange_market",
        "retrieved": null,
        "verified": false,
        "note": "Market convention, not a venue calendar."
      }
    ],
    "regular": {
      "days": [
        7
      ],
      "phases": {
        "continuous": {
          "open": "17:00",
          "close": "17:00",
          "spanDays": 5
        }
      }
    },
    "holidays": [],
    "specialSessions": []
  },
  {
    "venue": "LSX",
    "name": "Lang & Schwarz",
    "tz": "Europe/Berlin",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": true,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.ls-x.de/",
        "retrieved": null,
        "verified": false,
        "note": "Best effort. Weekday hours only; weekend sessions and holiday trading are not modelled."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "continuous": {
          "open": "07:30",
          "close": "23:00"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2026-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2027-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2028-12-26",
        "name": "Boxing Day"
      }
    ],
    "specialSessions": []
  },
  {
    "venue": "TGAT",
    "name": "Tradegate",
    "tz": "Europe/Berlin",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.tradegate.de/",
        "retrieved": null,
        "verified": false,
        "note": "No independent cross-check exists for Tradegate; holidays assumed to follow the Frankfurt exchange-wide closures. Founder to verify against the Tradegate trading calendar."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "continuous": {
          "open": "08:00",
          "close": "22:00"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-04-06",
        "name": "Easter Monday"
      },
      {
        "date": "2026-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2026-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2026-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-03-29",
        "name": "Easter Monday"
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2027-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-04-17",
        "name": "Easter Monday"
      },
      {
        "date": "2028-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2028-12-26",
        "name": "Boxing Day"
      }
    ],
    "specialSessions": []
  },
  {
    "venue": "USON",
    "name": "US overnight session",
    "tz": "America/New_York",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 1,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://blueocean-tech.io/",
        "retrieved": null,
        "verified": false,
        "note": "Mirrors the XNYS holiday list; overnight sessions before early-close days run normally. Founder to verify the overnight venue's own calendar."
      }
    ],
    "regular": {
      "days": [
        7,
        1,
        2,
        3,
        4
      ],
      "phases": {
        "continuous": {
          "open": "20:00",
          "close": "04:00"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-01-19",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2026-02-16",
        "name": "Washington's Birthday"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-05-25",
        "name": "Memorial Day"
      },
      {
        "date": "2026-06-19",
        "name": "Juneteenth"
      },
      {
        "date": "2026-07-03",
        "name": "Independence Day (observed)"
      },
      {
        "date": "2026-09-07",
        "name": "Labor Day"
      },
      {
        "date": "2026-11-26",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-01-18",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2027-02-15",
        "name": "Washington's Birthday"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-05-31",
        "name": "Memorial Day"
      },
      {
        "date": "2027-06-18",
        "name": "Juneteenth (observed)"
      },
      {
        "date": "2027-07-05",
        "name": "Independence Day (observed)"
      },
      {
        "date": "2027-09-06",
        "name": "Labor Day"
      },
      {
        "date": "2027-11-25",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Day (observed)"
      },
      {
        "date": "2028-01-17",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2028-02-21",
        "name": "Washington's Birthday"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-05-29",
        "name": "Memorial Day"
      },
      {
        "date": "2028-06-19",
        "name": "Juneteenth"
      },
      {
        "date": "2028-07-04",
        "name": "Independence Day"
      },
      {
        "date": "2028-09-04",
        "name": "Labor Day"
      },
      {
        "date": "2028-11-23",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      }
    ],
    "specialSessions": []
  },
  {
    "venue": "XAMS",
    "name": "Euronext Amsterdam",
    "tz": "Europe/Amsterdam",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.euronext.com/en/trade/trading-hours-holidays",
        "retrieved": null,
        "verified": false,
        "note": "Cross-checked against exchange_calendars 4.13.2 (committed fixture); not yet checked against the official venue publication (host unreachable from the build environment)."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "openingAuction": {
          "open": "07:15",
          "close": "09:00"
        },
        "continuous": {
          "open": "09:00",
          "close": "17:30"
        },
        "closingAuction": {
          "open": "17:30",
          "close": "17:35"
        },
        "postTrading": {
          "open": "17:35",
          "close": "17:40"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-04-06",
        "name": "Easter Monday"
      },
      {
        "date": "2026-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-03-29",
        "name": "Easter Monday"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-04-17",
        "name": "Easter Monday"
      },
      {
        "date": "2028-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2028-12-26",
        "name": "Boxing Day"
      }
    ],
    "specialSessions": [
      {
        "date": "2026-12-24",
        "name": "Christmas Eve",
        "phases": {
          "openingAuction": {
            "open": "07:15",
            "close": "09:00"
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05"
          },
          "postTrading": {
            "open": "14:05",
            "close": "14:10"
          }
        }
      },
      {
        "date": "2026-12-31",
        "name": "New Year's Eve",
        "phases": {
          "openingAuction": {
            "open": "07:15",
            "close": "09:00"
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05"
          },
          "postTrading": {
            "open": "14:05",
            "close": "14:10"
          }
        }
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Eve",
        "phases": {
          "openingAuction": {
            "open": "07:15",
            "close": "09:00"
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05"
          },
          "postTrading": {
            "open": "14:05",
            "close": "14:10"
          }
        }
      },
      {
        "date": "2027-12-31",
        "name": "New Year's Eve",
        "phases": {
          "openingAuction": {
            "open": "07:15",
            "close": "09:00"
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05"
          },
          "postTrading": {
            "open": "14:05",
            "close": "14:10"
          }
        }
      }
    ]
  },
  {
    "venue": "XCSE",
    "name": "Nasdaq Copenhagen",
    "tz": "Europe/Copenhagen",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.nasdaqomxnordic.com/tradinghours",
        "retrieved": null,
        "verified": false,
        "note": "Cross-checked against exchange_calendars 4.13.2 (committed fixture); not yet checked against the official venue publication (host unreachable from the build environment)."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "preOpen": {
          "open": "08:00",
          "close": "08:30"
        },
        "openingAuction": {
          "open": "08:30",
          "close": "09:00"
        },
        "continuous": {
          "open": "09:00",
          "close": "16:55"
        },
        "closingAuction": {
          "open": "16:55",
          "close": "17:00",
          "randomEndSec": 30
        },
        "postTrading": {
          "open": "17:00",
          "close": "17:30"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-04-02",
        "name": "Maundy Thursday"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-04-06",
        "name": "Easter Monday"
      },
      {
        "date": "2026-05-14",
        "name": "Ascension Day"
      },
      {
        "date": "2026-05-15",
        "name": "Day after Ascension"
      },
      {
        "date": "2026-05-25",
        "name": "Whit Monday"
      },
      {
        "date": "2026-06-05",
        "name": "Constitution Day"
      },
      {
        "date": "2026-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2026-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-03-25",
        "name": "Maundy Thursday"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-03-29",
        "name": "Easter Monday"
      },
      {
        "date": "2027-05-06",
        "name": "Ascension Day"
      },
      {
        "date": "2027-05-07",
        "name": "Day after Ascension"
      },
      {
        "date": "2027-05-17",
        "name": "Whit Monday"
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2027-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2028-04-13",
        "name": "Maundy Thursday"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-04-17",
        "name": "Easter Monday"
      },
      {
        "date": "2028-05-25",
        "name": "Ascension Day"
      },
      {
        "date": "2028-05-26",
        "name": "Day after Ascension"
      },
      {
        "date": "2028-06-05",
        "name": "Whit Monday and Constitution Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2028-12-26",
        "name": "Boxing Day"
      }
    ],
    "specialSessions": []
  },
  {
    "venue": "XETR",
    "name": "Xetra",
    "tz": "Europe/Berlin",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.deutsche-boerse-cash-market.com/dbcm-en/trading/trading-calendar-and-trading-hours",
        "retrieved": null,
        "verified": false,
        "note": "Cross-checked against exchange_calendars 4.13.2 (committed fixture); not yet checked against the official venue publication (host unreachable from the build environment)."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "preOpen": {
          "open": "07:30",
          "close": "08:50"
        },
        "openingAuction": {
          "open": "08:50",
          "close": "09:00",
          "randomEndSec": 30
        },
        "continuous": {
          "open": "09:00",
          "close": "17:30"
        },
        "closingAuction": {
          "open": "17:30",
          "close": "17:35",
          "randomEndSec": 30
        },
        "postTrading": {
          "open": "17:35",
          "close": "20:00"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-04-06",
        "name": "Easter Monday"
      },
      {
        "date": "2026-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2026-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2026-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-03-29",
        "name": "Easter Monday"
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2027-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-04-17",
        "name": "Easter Monday"
      },
      {
        "date": "2028-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2028-12-26",
        "name": "Boxing Day"
      }
    ],
    "specialSessions": [
      {
        "date": "2026-12-30",
        "name": "Last trading day of the year",
        "phases": {
          "preOpen": {
            "open": "07:30",
            "close": "08:50"
          },
          "openingAuction": {
            "open": "08:50",
            "close": "09:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "14:05",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2027-12-30",
        "name": "Last trading day of the year",
        "phases": {
          "preOpen": {
            "open": "07:30",
            "close": "08:50"
          },
          "openingAuction": {
            "open": "08:50",
            "close": "09:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "14:05",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2028-12-29",
        "name": "Last trading day of the year",
        "phases": {
          "preOpen": {
            "open": "07:30",
            "close": "08:50"
          },
          "openingAuction": {
            "open": "08:50",
            "close": "09:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "14:05",
            "close": "17:00"
          }
        }
      }
    ]
  },
  {
    "venue": "XEUR",
    "name": "Eurex",
    "tz": "Europe/Berlin",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.eurex.com/ex-en/trade/trading-hours",
        "retrieved": null,
        "verified": false,
        "note": "No independent cross-check; holidays assumed to equal the Frankfurt cash-market closures. Product-specific hours vary; this is the equity index futures timetable."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "continuous": {
          "open": "01:10",
          "close": "22:00"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-04-06",
        "name": "Easter Monday"
      },
      {
        "date": "2026-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2026-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2026-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-03-29",
        "name": "Easter Monday"
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Eve"
      },
      {
        "date": "2027-12-31",
        "name": "New Year's Eve"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-04-17",
        "name": "Easter Monday"
      },
      {
        "date": "2028-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2028-12-26",
        "name": "Boxing Day"
      }
    ],
    "specialSessions": []
  },
  {
    "venue": "XLON",
    "name": "London Stock Exchange",
    "tz": "Europe/London",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.londonstockexchange.com/equities-trading/business-days",
        "retrieved": null,
        "verified": false,
        "note": "Cross-checked against exchange_calendars 4.13.2 (committed fixture); not yet checked against the official venue publication (host unreachable from the build environment)."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "openingAuction": {
          "open": "07:50",
          "close": "08:00",
          "randomEndSec": 30
        },
        "continuous": {
          "open": "08:00",
          "close": "16:30"
        },
        "closingAuction": {
          "open": "16:30",
          "close": "16:35",
          "randomEndSec": 30
        },
        "postTrading": {
          "open": "16:35",
          "close": "16:40"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-04-06",
        "name": "Easter Monday"
      },
      {
        "date": "2026-05-04",
        "name": "Early May bank holiday"
      },
      {
        "date": "2026-05-25",
        "name": "Spring bank holiday"
      },
      {
        "date": "2026-08-31",
        "name": "Summer bank holiday"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2026-12-28",
        "name": "Boxing Day (substitute)"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-03-29",
        "name": "Easter Monday"
      },
      {
        "date": "2027-05-03",
        "name": "Early May bank holiday"
      },
      {
        "date": "2027-05-31",
        "name": "Spring bank holiday"
      },
      {
        "date": "2027-08-30",
        "name": "Summer bank holiday"
      },
      {
        "date": "2027-12-27",
        "name": "Christmas Day (substitute)"
      },
      {
        "date": "2027-12-28",
        "name": "Boxing Day (substitute)"
      },
      {
        "date": "2028-01-03",
        "name": "New Year's Day (substitute)"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-04-17",
        "name": "Easter Monday"
      },
      {
        "date": "2028-05-01",
        "name": "Early May bank holiday"
      },
      {
        "date": "2028-05-29",
        "name": "Spring bank holiday"
      },
      {
        "date": "2028-08-28",
        "name": "Summer bank holiday"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2028-12-26",
        "name": "Boxing Day"
      }
    ],
    "specialSessions": [
      {
        "date": "2026-12-24",
        "name": "Christmas Eve",
        "phases": {
          "openingAuction": {
            "open": "07:50",
            "close": "08:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "08:00",
            "close": "12:30"
          },
          "closingAuction": {
            "open": "12:30",
            "close": "12:35",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "12:35",
            "close": "12:40"
          }
        }
      },
      {
        "date": "2026-12-31",
        "name": "New Year's Eve",
        "phases": {
          "openingAuction": {
            "open": "07:50",
            "close": "08:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "08:00",
            "close": "12:30"
          },
          "closingAuction": {
            "open": "12:30",
            "close": "12:35",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "12:35",
            "close": "12:40"
          }
        }
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Eve",
        "phases": {
          "openingAuction": {
            "open": "07:50",
            "close": "08:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "08:00",
            "close": "12:30"
          },
          "closingAuction": {
            "open": "12:30",
            "close": "12:35",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "12:35",
            "close": "12:40"
          }
        }
      },
      {
        "date": "2027-12-31",
        "name": "New Year's Eve",
        "phases": {
          "openingAuction": {
            "open": "07:50",
            "close": "08:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "08:00",
            "close": "12:30"
          },
          "closingAuction": {
            "open": "12:30",
            "close": "12:35",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "12:35",
            "close": "12:40"
          }
        }
      },
      {
        "date": "2028-12-22",
        "name": "Last business day before Christmas",
        "phases": {
          "openingAuction": {
            "open": "07:50",
            "close": "08:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "08:00",
            "close": "12:30"
          },
          "closingAuction": {
            "open": "12:30",
            "close": "12:35",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "12:35",
            "close": "12:40"
          }
        }
      },
      {
        "date": "2028-12-29",
        "name": "Last business day of the year",
        "phases": {
          "openingAuction": {
            "open": "07:50",
            "close": "08:00",
            "randomEndSec": 30
          },
          "continuous": {
            "open": "08:00",
            "close": "12:30"
          },
          "closingAuction": {
            "open": "12:30",
            "close": "12:35",
            "randomEndSec": 30
          },
          "postTrading": {
            "open": "12:35",
            "close": "12:40"
          }
        }
      }
    ]
  },
  {
    "venue": "XNAS",
    "name": "Nasdaq",
    "tz": "America/New_York",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.nasdaq.com/market-activity/stock-market-holiday-schedule",
        "retrieved": null,
        "verified": false,
        "note": "Same holiday rules as XNYS (exchange_calendars has no separate Nasdaq calendar); not yet checked against the official venue publication."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "preOpen": {
          "open": "04:00",
          "close": "09:30"
        },
        "continuous": {
          "open": "09:30",
          "close": "16:00"
        },
        "postTrading": {
          "open": "16:00",
          "close": "20:00"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-01-19",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2026-02-16",
        "name": "Washington's Birthday"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-05-25",
        "name": "Memorial Day"
      },
      {
        "date": "2026-06-19",
        "name": "Juneteenth"
      },
      {
        "date": "2026-07-03",
        "name": "Independence Day (observed)"
      },
      {
        "date": "2026-09-07",
        "name": "Labor Day"
      },
      {
        "date": "2026-11-26",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-01-18",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2027-02-15",
        "name": "Washington's Birthday"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-05-31",
        "name": "Memorial Day"
      },
      {
        "date": "2027-06-18",
        "name": "Juneteenth (observed)"
      },
      {
        "date": "2027-07-05",
        "name": "Independence Day (observed)"
      },
      {
        "date": "2027-09-06",
        "name": "Labor Day"
      },
      {
        "date": "2027-11-25",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Day (observed)"
      },
      {
        "date": "2028-01-17",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2028-02-21",
        "name": "Washington's Birthday"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-05-29",
        "name": "Memorial Day"
      },
      {
        "date": "2028-06-19",
        "name": "Juneteenth"
      },
      {
        "date": "2028-07-04",
        "name": "Independence Day"
      },
      {
        "date": "2028-09-04",
        "name": "Labor Day"
      },
      {
        "date": "2028-11-23",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      }
    ],
    "specialSessions": [
      {
        "date": "2026-11-27",
        "name": "Day after Thanksgiving",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2026-12-24",
        "name": "Christmas Eve",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2027-11-26",
        "name": "Day after Thanksgiving",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2028-07-03",
        "name": "Day before Independence Day",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2028-11-24",
        "name": "Day after Thanksgiving",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      }
    ]
  },
  {
    "venue": "XNYS",
    "name": "New York Stock Exchange",
    "tz": "America/New_York",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.nyse.com/markets/hours-calendars",
        "retrieved": null,
        "verified": false,
        "note": "Cross-checked against exchange_calendars 4.13.2 (committed fixture); not yet checked against the official venue publication (host unreachable from the build environment)."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "preOpen": {
          "open": "04:00",
          "close": "09:30"
        },
        "continuous": {
          "open": "09:30",
          "close": "16:00"
        },
        "postTrading": {
          "open": "16:00",
          "close": "20:00"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-01-19",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2026-02-16",
        "name": "Washington's Birthday"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-05-25",
        "name": "Memorial Day"
      },
      {
        "date": "2026-06-19",
        "name": "Juneteenth"
      },
      {
        "date": "2026-07-03",
        "name": "Independence Day (observed)"
      },
      {
        "date": "2026-09-07",
        "name": "Labor Day"
      },
      {
        "date": "2026-11-26",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-01-18",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2027-02-15",
        "name": "Washington's Birthday"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-05-31",
        "name": "Memorial Day"
      },
      {
        "date": "2027-06-18",
        "name": "Juneteenth (observed)"
      },
      {
        "date": "2027-07-05",
        "name": "Independence Day (observed)"
      },
      {
        "date": "2027-09-06",
        "name": "Labor Day"
      },
      {
        "date": "2027-11-25",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Day (observed)"
      },
      {
        "date": "2028-01-17",
        "name": "Martin Luther King Jr. Day"
      },
      {
        "date": "2028-02-21",
        "name": "Washington's Birthday"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-05-29",
        "name": "Memorial Day"
      },
      {
        "date": "2028-06-19",
        "name": "Juneteenth"
      },
      {
        "date": "2028-07-04",
        "name": "Independence Day"
      },
      {
        "date": "2028-09-04",
        "name": "Labor Day"
      },
      {
        "date": "2028-11-23",
        "name": "Thanksgiving Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      }
    ],
    "specialSessions": [
      {
        "date": "2026-11-27",
        "name": "Day after Thanksgiving",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2026-12-24",
        "name": "Christmas Eve",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2027-11-26",
        "name": "Day after Thanksgiving",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2028-07-03",
        "name": "Day before Independence Day",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      },
      {
        "date": "2028-11-24",
        "name": "Day after Thanksgiving",
        "phases": {
          "preOpen": {
            "open": "04:00",
            "close": "09:30"
          },
          "continuous": {
            "open": "09:30",
            "close": "13:00"
          },
          "postTrading": {
            "open": "13:00",
            "close": "17:00"
          }
        }
      }
    ]
  },
  {
    "venue": "XPAR",
    "name": "Euronext Paris",
    "tz": "Europe/Paris",
    "coverage": {
      "from": "2026-01-01",
      "to": "2028-12-31"
    },
    "tradeDateOffsetDays": 0,
    "informational": false,
    "sources": [
      {
        "years": [
          2026,
          2027,
          2028
        ],
        "url": "https://www.euronext.com/en/trade/trading-hours-holidays",
        "retrieved": null,
        "verified": false,
        "note": "Cross-checked against exchange_calendars 4.13.2 (committed fixture); not yet checked against the official venue publication (host unreachable from the build environment)."
      }
    ],
    "regular": {
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "phases": {
        "openingAuction": {
          "open": "07:15",
          "close": "09:00"
        },
        "continuous": {
          "open": "09:00",
          "close": "17:30"
        },
        "closingAuction": {
          "open": "17:30",
          "close": "17:35"
        },
        "postTrading": {
          "open": "17:35",
          "close": "17:40"
        }
      }
    },
    "holidays": [
      {
        "date": "2026-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2026-04-03",
        "name": "Good Friday"
      },
      {
        "date": "2026-04-06",
        "name": "Easter Monday"
      },
      {
        "date": "2026-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2026-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2027-01-01",
        "name": "New Year's Day"
      },
      {
        "date": "2027-03-26",
        "name": "Good Friday"
      },
      {
        "date": "2027-03-29",
        "name": "Easter Monday"
      },
      {
        "date": "2028-04-14",
        "name": "Good Friday"
      },
      {
        "date": "2028-04-17",
        "name": "Easter Monday"
      },
      {
        "date": "2028-05-01",
        "name": "Labour Day"
      },
      {
        "date": "2028-12-25",
        "name": "Christmas Day"
      },
      {
        "date": "2028-12-26",
        "name": "Boxing Day"
      }
    ],
    "specialSessions": [
      {
        "date": "2026-12-24",
        "name": "Christmas Eve",
        "phases": {
          "openingAuction": {
            "open": "07:15",
            "close": "09:00"
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05"
          },
          "postTrading": {
            "open": "14:05",
            "close": "14:10"
          }
        }
      },
      {
        "date": "2026-12-31",
        "name": "New Year's Eve",
        "phases": {
          "openingAuction": {
            "open": "07:15",
            "close": "09:00"
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05"
          },
          "postTrading": {
            "open": "14:05",
            "close": "14:10"
          }
        }
      },
      {
        "date": "2027-12-24",
        "name": "Christmas Eve",
        "phases": {
          "openingAuction": {
            "open": "07:15",
            "close": "09:00"
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05"
          },
          "postTrading": {
            "open": "14:05",
            "close": "14:10"
          }
        }
      },
      {
        "date": "2027-12-31",
        "name": "New Year's Eve",
        "phases": {
          "openingAuction": {
            "open": "07:15",
            "close": "09:00"
          },
          "continuous": {
            "open": "09:00",
            "close": "14:00"
          },
          "closingAuction": {
            "open": "14:00",
            "close": "14:05"
          },
          "postTrading": {
            "open": "14:05",
            "close": "14:10"
          }
        }
      }
    ]
  }
];
