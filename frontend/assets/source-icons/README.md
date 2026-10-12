# Source-board symbols

These assets are local SVG files. The browser never contacts the icon libraries
or a third-party favicon service when rendering a source board.

## Brand symbols

`github`, `youtube`, `producthunt`, `v2ex`, `juejin`, `zhihu`, `baidu`, and `x`
are from [Simple Icons](https://github.com/simple-icons/simple-icons), pinned to
commit `98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d`.

Simple Icons distributes the collection under CC0 1.0; the original license is
included as `simple-icons-LICENSE.md`. Individual brand names and trademarks
belong to their owners. Their use here identifies the named source and does not
imply endorsement. Assets retain the library's original SVG content.

## Generic symbols

`rss`, `news`, `message-circle`, `apps`, `book-2`, and `chart-line` are from
[Tabler Icons](https://github.com/tabler/tabler-icons), pinned to commit
`a4ce1404bc6d24d3c365afe7b258d6bf6f48d62d`.

Tabler Icons uses the MIT license. Its copyright and permission notice are
included in `tabler-icons-LICENSE`. These symbols remain unmodified.

Sources without an available brand symbol use a generic symbol alongside their
actual source name. SoPilot boards use a generic post symbol, rather than the X
logo, because the data provider is SoPilot. This avoids making third-party
excerpt boards appear to be official X sources.

`manifest.json` records each exact download URL and checked byte size. SVGs were
checked for a root SVG element, a viewBox, and absence of scripts, event handlers,
or remote embedded assets on 2026-10-07.

The source name beside the symbol provides its accessible label; image elements
should use `alt=""` to avoid reading the same label twice.
