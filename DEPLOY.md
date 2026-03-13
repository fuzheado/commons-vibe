# Deployment Strategy (Wikimedia Toolforge)
- **Static Hosting:** The app is a single `index.html` file. 
- **PHP Runtime Hack:** Deploy using `webservice php8.2 start` in the `public_html` directory to treat the environment as a static file server.