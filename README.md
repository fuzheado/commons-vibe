# CommonsVibe: A Visual Feed Explorer for Wikimedia Commons

Wikimedia Commons is one of the best free image collections in the world, but it was built as a "file warehouse," rather than as a user experience. 

**CommonsVibe** aims to provide an easy-to-use, modern, visually rich, and serendipitous feed explorer and discovery tool.

Designed for the curious browser rather than a technical expert, it brings a "Pinterest-style" feel to Commons categories, making it easy to explore collections visually and quickly navigate the Commons category tree.

## Quick start 
* **Visually examine a specific category** by selecting a category from the pull-down menu, and "minimum" mode to isolate just the images.
* **Use shuffle mode on a large category** with "detail" mode on to quickly explore the variety.
* **Jump to different categories** by selecting the image's "tag' button to bring up Commons categories you can click on, visible or hidden.
* **Quickly scrub and play video** by visiting a category of WebM videos, and hovering your pointer (or clicking on mobile) to immediately preview the video without sound.

## **A running version can be found at: https://commons-vibe.toolforge.org/**

![Screenshot](https://github.com/fuzheado/commons-vibe/blob/main/commons-vibe-screenshot-featured.png "Screenshot")

---

## The Experience

### Serendipitous Feed
CommonsVibe uses a **responsive masonry grid** to showcase images in a fluid, visual layout. 
* **Infinite Discovery:** As you scroll, the app automatically fetches more content, creating a seamless "infinite scroll" that keeps the inspiration flowing.
* **Lazy Loading:** High-quality media loads efficiently only as you need it, keeping the interface quick and modern.

### Explore by "Vibe"
Most users aren't familiar with the intricate category tree of Wikimedia Commons. To assist in this:
* **Curated Seeds:** Start your journey with "Best of" collections like *Pictures of the Year*, *Featured Pictures*, or *Quality Images*.
* **Custom Entry:** If you know a specific category name, simply enter it in to generate a custom feed instantly.
* **Deep Context:** Every image tile includes a description. Want to go deeper? A simple pop-up menu reveals every category the file belongs to, allowing you to "teleport" to related areas quickly, whether they are visible or hidden categories.

### Shareable States
The entire state of your browser is captured in the URL.
* **Instant Sharing:** Your current category, layout settings (detailed vs. compact), and sort filters are all stored as URL parameters.
* **What You See is What They Get:** Send a link to a friend, and they will see the exact same view you are looking at.

---

## 🛠️ Browsing Modes

CommonsVibe supports distinct ways to interact with media:

1.  **Alphabetical Mode:** The classic organized approach. Browse through a category's contents in order, with 12 tiles loaded at a time as you scroll.
2.  **Shuffle Mode:** For true serendipity. Using Wikimedia’s *CirrusSearch*, this mode pulls 12 random tiles from a category, then another 12, and another, creating a unique, never-ending discovery session.

---

## 🚀 Future Roadmap

CommonsVibe is evolving from a browser into a personal curation tool. Planned features include:

* **List Mode:** A curated "Snapshot" mode. This allows the app to load a specific set of files via their unique IDs passed through the URL—perfect for sharing a specific "vibe" or a curated set of random finds that you want to preserve for someone else.
* **Personal Collections:** The ability to "clip" or save images into your own custom sets.
* **Stateful Storage:** User accounts to sync your favorite categories and collections across devices.
* **Enhanced Search:** Natural language tools to find "vibes" without needing to know exact category names.
* **Advanced Layouts:** Easy toggling between "Compact" views for rapid browsing and "Detailed" views for high-resolution appreciation.
* **Filtering:** Filter based on filetype (eg. no TIF files, only WEBM files), more advanced display of media files.

---

## Technical Overview

CommonsVibe is built to be lightweight and URL-driven.
* **API:** Interacts directly with the Wikimedia Action API and CirrusSearch.
* **Routing:** Heavy emphasis on URL parameter persistence to ensure the "Shareable View" philosophy.
* **Frontend:** Designed for high-performance image rendering and "lazy loading" patterns.
