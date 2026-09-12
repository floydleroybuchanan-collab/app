CharmIPTV host adapters

The new native host adapters use CharmIPTV's network and playback contracts.
Behavior was compared with Yuzono/Anime extensions (Apache License 2.0):
https://github.com/yuzono/anime-extensions/tree/7a6f1474b6e48e477b5952af3ca635acff556496
Libraries reviewed: sendvidextractor, vidhideextractor, vidlandextractor,
mp4uploadextractor, sibnetextractor, and provider host routing.

Changes include cancellable bounded requests, redirect limits, correct Origin
and Referer construction, multiple host aliases, source validation, and adaptation
to CharmIPTV's Video and Sources UI. No external extractor app is installed.
JMcrafter26 Global Extractor and the unlicensed Docchi implementations are not included.
No FileMoon/MegaCloud third-party decryptor was added by this update.
