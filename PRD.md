# Product Requirements Document (PRD): Commons Vibe Explorer

## 1. Project Goal
A stateless, high-performance visual discovery tool for Wikimedia Commons categories. It must provide a "Pinterest-style" masonry experience while overcoming the alphabetical bias of the MediaWiki API.

## 2. Core Architecture
- **Language:** Python 3.x (running via [PyScript/Pyodide 2026.1.1](https://pyscript.net/)).
- **UI Framework:** Tailwind CSS (CDN-loaded).
- **Styles:** Custom CSS moved to `style.css` for maintainability.
- **Deployment Target:** Wikimedia Toolforge (Static hosting via PHP runtime).
- **Data Source:** [MediaWiki Action API](https://commons.wikimedia.org/w/api.php).

## 3. Technical Specifications

### A. Discovery Engine (Alphabetical vs. Random)
- **Alphabetical Mode:** Uses standard `categorymembers` generator. Correctly terminates and displays an "End of Collection" message when no `continue` token is returned by the API.
- **Shuffle Mode:** Currently uses `list=search` with `incategory:"Category Name"` and `srsort=random` (CirrusSearch). 

### B. State & URL Syncing
- **Bookmarkable:** All application state (Category, Sort Mode, View Mode) must be reflected in the URL parameters.
- **Parameters:** `cat` (Category), `sort` (`alpha`|`shuffle`), `view` (`min`|`det`).
- **Session Persistence:** Any category searched for or entered via URL must "stick" to the dropdown menu and the Category Editor for the duration of the session.

### C. UI & Masonry Logic
- **Masonry:** A responsive 4-column grid using `flex-col` containers.
- **View Modes:**
    - **Detailed:** Shows the filename (without `File:` prefix) and a cleaned, truncated description (3 lines max).
    - **Minimal:** Edge-to-edge images with a hover-activated gradient overlay for the filename.
- **Category Info:** Asynchronous `prop=categoryinfo` query to display the total file count next to the category selector.

## 4. Functional Requirements

### A. Category Handling
- **Case Sensitivity:** Categories are case-sensitive. The UI must respect and display the correct casing. The "Jump to Category" input and Category Dropdown must **not** use `uppercase` styling for the data values.
- **Validation & Normalization:**
    - Manual search and the Category Editor both validate categories against the Wikimedia API.
    - Casing is automatically normalized to the official API version upon successful validation.
- **Manual Entry:** A text input in the header that adds the category to the session's list and triggers a `reset_and_fetch()` cycle.

### B. Interaction & Feedback
- **Re-shuffle Button:** A button with a spin animation (`animate-spin`) that clears the current masonry and triggers a fresh random fetch.
- **Category Editor:** A modal window for bulk editing the category list. 
    - **UI:** Must provide a large, readable text area (approx 50% of viewport height).
    - **Validation:** Performs a batch sanity check and title normalization before applying changes. Displays error messages for invalid categories.

## 5. API Compliance & Security
- **User-Agent:** `CommonsVibeExplorer/1.4 (https://commons-vibe.toolforge.org; contact: User:Fuzheado)`
- **CORS:** All API queries must include `origin=*`.
- **Image Sizing:** Thumbnails requested at `iiurlwidth=600`.

## 6. Deployment Strategy (Wikimedia Toolforge)
- **Static Hosting:** Single `index.html` referencing `style.css`. 
- **PHP Runtime Hack:** Deploy using `webservice php8.2 start` in the `public_html` directory.
