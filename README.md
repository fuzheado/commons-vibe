# CommonsVibe: A Visual Feed Explorer for Wikimedia Commons

Wikimedia Commons is one of the best free image collections in the world, but it was built to be a "file warehouse," not as a user experience. 

**CommonsVibe** aims to provide an easy-to-use, modern, visually rich, and serendipitous discovery feed explorer.

Designed for the curious user rather than the technical expert, CommonsVibe brings a "Pinterest-style" feed to the Commons, making it easy to surf the world's largest free media library.

* **A running version can be found at: https://commons-vibe.toolforge.org/**
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
* **Deep Context:** Every image tile includes a description. Want to go deeper? A simple dropdown menu reveals every category the file belongs to, and with "parent" categories, allowing you to "teleport" to related areas quickly.

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
* **Filering:** Filter based on filetype (eg. no TIF files), useful display of video files, 

---

## Technical Overview

CommonsVibe is built to be lightweight and URL-driven.
* **API:** Interacts directly with the Wikimedia Action API and CirrusSearch.
* **Routing:** Heavy emphasis on URL parameter persistence to ensure the "Shareable View" philosophy.
* **Frontend:** Designed for high-performance image rendering and "lazy loading" patterns.
