# Product Requirements Document (PRD): Commons Vibe Explorer

## 1. Project Goal
A stateless, high-performance visual discovery tool for Wikimedia Commons categories. It must provide a "Pinterest-style" masonry experience while overcoming the alphabetical bias of the MediaWiki API.

## 2. Core Architecture
- **Language:** Python 3.x (running via [PyScript/Pyodide 2026.1.1](https://pyscript.net/)).
- **UI Framework:** Tailwind CSS (CDN-loaded).
- **Styles:** Custom CSS maintained in `style.css`.
- **Configuration:** 
    - Default categories loaded from external `categories.txt`.
    - User settings and custom category lists persist via browser `localStorage`.
- **Deployment Target:** Wikimedia Toolforge (Static hosting via PHP runtime).
- **Data Source:** [MediaWiki Action API](https://commons.wikimedia.org/w/api.php).

## 3. Technical Specifications

### A. Discovery Engine (Alphabetical vs. Random)
- **Alphabetical Mode:** Uses standard `categorymembers` generator. Correctly terminates and displays an "End of Collection" message when no `continue` token is returned by the API.
- **Shuffle Mode:** Uses `list=search` with `incategory:"Category Name"` and `srsort=random` (CirrusSearch). Randomizes the order of the retrieved batch before rendering to ensure high-quality visual variety.

### B. State & URL Syncing
- **Bookmarkable:** All application state (Category, Sort Mode, View Mode) must be reflected in the URL parameters (`cat`, `sort`, `view`).
- **Home Reset:** The "CommonsVibe" logo in the header acts as a reset link, reloading the application with no URL parameters.
- **Session Persistence:** Any category searched for, clicked via a pill, or entered via URL is automatically added to the internal list and the Category Editor, persisting across refreshes via `localStorage`.

### C. UI & Masonry Logic
- **Masonry:** A responsive 4-column grid using `flex-col` containers.
- **View Modes:**
    - **Detailed:** Shows the filename (without `File:` prefix) and a cleaned, truncated description (3 lines max).
    - **Minimal:** Edge-to-edge images with a hover-activated gradient overlay for metadata.
- **Category Info:** Asynchronous `prop=categoryinfo` query to display the total file count next to the category selector.
- **Enhanced Dropdown:** The category selector has a wide layout (`max-width: 320px`) to accommodate long category names.

## 4. Functional Requirements

### A. Category Handling
- **Case Sensitivity:** Categories are case-sensitive. The UI respects correct casing; "Jump to Category" and the dropdown do **not** use `uppercase` styling for data values.
- **Validation & Normalization:**
    - Manual search and the Category Editor both validate categories against the Wikimedia API.
    - Casing is automatically normalized to the official API version upon successful validation.
- **Manual Entry:** A text input in the header adds validated categories to the session's list and triggers a refresh.

### B. Deep Visual Discovery (Category Navigation)
- **Category Fetching:** Each file tile retrieves its full category list (`cllimit: max`) including "hidden" status via the API.
- **Tag Icon:** A context-aware icon located in the lower-right corner of the tile/overlay.
- **Category Drawer:** A blurred-glass drawer that slides up from the bottom of the image area. 
    - **Normal Categories:** Solid blue pills.
    - **Hidden Categories:** Outlined/ghost pills.
- **Dynamic Navigation:** Clicking any category pill in the drawer immediately "jumps" the app to that category.
- **Dismissal:** The drawer is dismissible via a dedicated "Close (X)" button in its header.

### C. Interaction & Feedback
- **Control Grouping:** The Re-shuffle/Refresh button is positioned immediately to the right of the Shuffle toggle for unified sorting control.
- **Category Editor:** A modal window for bulk editing. 
    - **UI:** Large text area (approx 50% of viewport height).
    - **Validation:** Performs batch sanity checks and title normalization before saving to `localStorage`.

## 5. API Compliance & Security
- **User-Agent:** `CommonsVibeExplorer/1.4 (https://commons-vibe.toolforge.org; contact: User:Fuzheado)`
- **CORS:** All API queries must include `origin=*`.
- **Image Sizing:** Thumbnails requested at `iiurlwidth=600`.

## 6. Deployment Strategy (Wikimedia Toolforge)
- **Static Hosting:** `index.html` referencing `style.css` and `categories.txt`. 
- **PHP Runtime Hack:** Deploy using `webservice php8.2 start` in the `public_html` directory.
