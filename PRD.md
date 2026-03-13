# Product Requirements Document (PRD): Commons Vibe Explorer

## 1. Project Goal
A stateless, high-performance visual discovery tool for Wikimedia Commons categories. It must provide a "Pinterest-style" masonry experience while overcoming the alphabetical bias of the MediaWiki API.

## 2. Core Architecture
- **Language:** Python 3.x (running via [PyScript/Pyodide 2026.1.1](https://pyscript.net/)).
- **UI Framework:** Tailwind CSS (CDN-loaded).
- **Deployment Target:** Wikimedia Toolforge (Static hosting via PHP runtime).
- **Data Source:** [MediaWiki Action API](https://commons.wikimedia.org/w/api.php) (and potentially the REST API).

## 3. Technical Specifications

### A. Discovery Engine (Alphabetical vs. Random)
- **Alphabetical Mode:** Uses standard `categorymembers` generator.
- **Shuffle Mode:** Currently uses `list=search` with `incategory:"Category Name"` and `srsort=random` (CirrusSearch). 
- **Optimization:** Investigate more efficient ways to get high-quality random results if `list=search` has limitations (e.g., namespace filtering, limit constraints).

### B. State & URL Syncing
- **Bookmarkable:** All application state (Category, Sort Mode, View Mode) must be reflected in the URL parameters.
- **Parameters:** `cat` (Category), `sort` (`alpha`|`shuffle`), `view` (`min`|`det`).
- **Dynamic Injections:** If a URL contains a `cat` parameter not in the default list, it must be added to the dropdown and internal category list on load.

### C. UI & Masonry Logic
- **Masonry:** A responsive 4-column grid using `flex-col` containers, allowing for infinite scroll that will keep loading results as the user hits the "bottom" of the content
- **View Modes:**
    - **Detailed:** Shows the filename (without `File:` prefix) and the description fetched from Commons, and can be truncated if more than 3 lines long.
    - **Minimal:** Edge-to-edge images with a hover-activated gradient overlay for the filename.
- **Category Info:** Asynchronous `prop=categoryinfo` query to display the total file count next to the category selector.

## 4. Functional Requirements

### A. Category Handling
- **Case Sensitivity:** Categories are case-sensitive. The UI must respect and display the correct casing to avoid user confusion.
- **Manual Entry:** A text input in the header that adds the category to the session's dropdown and triggers a `reset_and_fetch()` cycle.

### B. Interaction & Feedback
- **Re-shuffle Button:** A button with a spin animation that clears the current masonry and triggers a fresh random fetch.
- **Category Editor:** A modal window for bulk editing the category list. 
    - **Validation:** (Planned) Sanity check to ensure categories exist on Wikimedia Commons before applying changes. An error box should pop up to warn the user about all categories that failed to be verified so they can fix the problem.

## 5. API Compliance & Security
- **User-Agent:** `CommonsVibeExplorer/1.4 (https://commons-vibe.toolforge.org; contact: User:Fuzheado)`
- **CORS:** All API queries must include `origin=*`.
- **Image Sizing:** Thumbnails requested at `iiurlwidth=600` for high-density displays.
