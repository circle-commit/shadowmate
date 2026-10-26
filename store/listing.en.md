# Chrome Web Store listing (English)

Text to paste into the dashboard (https://chrome.google.com/webstore/devconsole) for the English listing.

## Basic info

- **Name**: taken from `_locales/en/messages.json` (`name`). `Shadowmate – Dual Subtitles & Shadowing for Netflix`
- **Summary (132 characters max)**: taken from `_locales/en/messages.json` (`description`).
  > Learn any language on Netflix: dual subtitles, line-by-line shadowing, repeat, slow replay, hide lines, record & compare, word lists
- **Category**: Education
- **Language**: English
- **Privacy policy URL**: https://circle-commit.github.io/shadowmate/privacy.en.html
- **Support site**: https://github.com/circle-commit/shadowmate/issues

## Detailed description

Shadowmate shows subtitles in two languages on Netflix, the one you're learning and your own, and helps you practice shadowing: listen to one line at a time and say it back. English, Japanese, Spanish or anything else: if Netflix has subtitles in it, you can study it.

▶ Dual subtitles
· The language you're learning on top, a translation in your language below
· Pair any subtitle languages Netflix offers (English + Spanish, Japanese + English, Korean + French…)
· Compact view: just clean subtitles like on Apple TV, with buttons on hover

▶ Line-by-line shadowing
· A, S, D for previous, replay and next line
· Auto-pause: stops after every line so you have time to say it back
· Line repeat: replays each line 2, 3 or 5 times automatically
· Slow replay: hear fast lines again at 0.75×
· Hide original or translation: listen first, then hover to check

▶ Record & compare your pronunciation
· Record yourself and hear the native line, then your voice, right away
· Recordings live only in the tab's memory and are discarded. Nothing is saved or sent anywhere

▶ Word and idiom lookup (English subtitles)
· Click a word for its English definition (Wiktionary) and a link to a dictionary in your language
· Drag across several words to look up idioms (beat me to the punch → beat someone to the punch)

▶ Word list
· Save words and lines with ☆ and export them to CSV or Anki

▶ And more
· On ad-supported plans, subtitle timing syncs up again after ads
· Every shortcut can be remapped
· Move and resize the panel however you like

A Netflix account is required. Shadowmate is an independent personal project and is not affiliated with Netflix.

## Privacy tab

**Single purpose description**
> Shows subtitles in two languages together on Netflix and helps users learn a foreign language with line-by-line replay, record-and-compare and word lookup.

**Permission justifications**
- `storage`: Used to keep words and lines the user saves with ☆ in the browser (chrome.storage.local) and show them in the toolbar's saved-items page.
- Host permission `https://www.netflix.com/*` (content script): Used to show the subtitle panel on the Netflix player and to read the subtitle files Netflix provides so the two languages can be paired. It does not run on any other site.

**Remote code**: No. All code is included in the extension package.

**Data usage**
- User data collected: none (leave every item unchecked)
- Check all three certifications: not sold / not used for purposes unrelated to the core functionality / not used to determine creditworthiness
- Note (if a reviewer note is needed): For word lookup, only the word the user selects is sent to the Wiktionary API. Microphone recordings are played back only from tab memory and are never stored or transmitted.

## Images

- Icon 128×128: `icons/icon128.png`
- Screenshots 1280×800: `store/en/shot-1.png` to `store/en/shot-5.png`
- Small promo tile 440×280: `store/en/promo-440x280.png`
