# Deployment Strategy (Wikimedia Toolforge)
- **Static Hosting:** The app is `index.html` + `app.js` + `style.css` + `categories.txt`. No build step — copy or git-pull into `public_html`.
- **PHP Runtime Hack:** Deploy using `webservice php8.4 start` in the `public_html` directory (see `service.manifest`) to treat the environment as a static file server.
- **Deploy:** The live site currently mirrors GitHub `main` byte-for-byte; files were copied manually rather than via git pull — if you re-init the server-side git checkout, keep that in sync or switch to rsync.
