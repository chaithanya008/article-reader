# Article Reader

A lightweight tool to extract and read clean article content from any news website.

## Web App

Open `index.html` in a browser or visit the [hosted version](https://chaithanya008.github.io/article-reader/).

Paste any article URL to get a clean, distraction-free reading view. Dark/light mode included.

## CLI

```bash
npx article-reader <url>
```

Or install globally:

```bash
npm i -g article-reader
article-reader <url>
```

Requires Node.js 18+. Zero dependencies.

## How it works

Fetches the page with a browser-like request, then extracts the headline, author, date, and body content using HTML parsing. The web app uses CORS proxies to fetch from the browser.
