# Marktplaats listing scraper

Small Python + Playwright scraper for a list of public Marktplaats listing or search/category URLs. Search pages are expanded into unique `/v/...` listing URLs, then each detail page is visited. It extracts:

- title, price, currency, category, and location
- the listing description (the seller's item text)
- basic seller name/profile text when visible
- item attributes from definition lists, tables, JSON-LD, and visible vehicle feature lists (for example, cruise control)
- gallery image URLs and downloaded image files

Use it only for pages you are allowed to access. Keep the delay enabled, respect Marktplaats's terms and robots guidance, and do not use it to bypass login, rate limits, CAPTCHA, or other access controls.

## Setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m playwright install chromium
```

## Run

Add one public listing or search/category URL per line to [`urls.txt`](urls.txt), then run:

```bash
.venv/bin/python scrape_marktplaats.py --urls urls.txt --output output
```

For a large result page, cap the number of detail pages while testing:

```bash
.venv/bin/python scrape_marktplaats.py --urls urls.txt --output output --max-items 10
```

Useful options:

```text
--delay 2.0       Wait two seconds between listing pages
--headful         Show Chromium while the script runs
--timeout 45000   Use a 45-second page timeout
--max-items 10    Scrape at most 10 discovered listings; 0 means all
```

The result is written to `output/items.json`. Images are written to `output/images/` and referenced from each item's `images` array. Failed URLs remain in `items.json` as objects containing `url` and `error`.

The DOM changes on marketplaces from time to time. The script uses semantic selectors, JSON-LD, and fallback extraction, but a changed page can still require selector updates.
