## PRD: Commons Vibe Explorer
### 1. Project Goal
A stateless, high-performance visual discovery tool for Wikimedia Commons categories. It must provide a "Pinterest-style" masonry experience while overcoming the alphabetical bias of the MediaWiki API.

### 2. Core Architecture
Language: Python 3.x (running via PyScript/Pyodide 2026.1.1).

UI Framework: Tailwind CSS (CDN-loaded).

Deployment Target: Wikimedia Toolforge (Static hosting via PHP runtime).

Data Source: MediaWiki Action API (https://commons.wikimedia.org/w/api.php) or other APIs that are useful, such as REST API.

### 3. Technical Specifications
A. Browsing via alphabetical listing or "True Random" Discovery Engine
The most efficient way to do "random" seems to be to use CirrusSearch function with srsort=random, but other more optimized ways may be considered.

B. State & URL Syncing
The application must be entirely bookmarkable and "shareable" by having parameters appended to the URL.

Parameters at a minimum: cat (Category), sort (alpha/shuffle), view (min/det).

Logic: Update the URL every time a toggle is flipped or a category is changed so that the URL can be copied/shared to others.

Injected Categories: If a URL contains a cat parameter not in the hardcoded list, the app must programmatically append that category to a saved internal list and the dropdown menu on load.

C. UI & Masonry Logic
Masonry: A 4-column responsive grid using flex-col containers.

View Modes:

Detailed: Shows the filename (with File: prefix stripped) and the description.

Minimal: Images are edge-to-edge. Hovering reveals a gradient overlay with the filename.

Category Info: An asynchronous "look-ahead" query to prop=categoryinfo must display the total file count next to the category selector.

### 4. Functional Requirements
Case sensitivity: All listings or interfaces elements dealing with categories must display upper and lowercase properly, since categories are case-sensitive. Therefore, no "ALL CAPS" display or handling of categories, or the user may be confused.

Manual entry category Bar: A text input in the header. On Enter, it must:

Add the new category to the session's dropdown list if it doesn't already exist.

Trigger a reset_and_fetch() cycle.

Re-shuffle Button: A dedicated button with a spin animation (animate-spin) that clears the current masonry columns and triggers a fresh random listing.

Category Editor: A modal window where the textarea is pre-filled with the current configuration string that holds a list of categories. Changes to this textarea will be reflected in the dropdown list. The interface should do a quick sanity check to make sure that category actually exists in Wikimedia Commons, and report an error back to the user if it is invalid.

### 5. API Compliance & Security
User-Agent: Every pyfetch call must include a custom header:
User-Agent: CommonsVibeExplorer/1.4 (https://commons-vibe.toolforge.org; contact: User:Fuzheado)

CORS: All queries must include origin=*.

Image Sizing: Thumbnails should be requested at iiurlwidth=600 for high-density displays.

### 6. Deployment "Life Hack" (Toolforge)
To avoid the complexities of WSGI or Python-vhost configurations on Toolforge:

Name the file index.html.

Place it in public_html.

Start the web service using the PHP runtime: webservice php8.2 start. This forces the server to treat the directory as a static file server.