# CommonsVibe: Project Rules & Context

## 🛠️ Core Tech Stack
- **Framework:** Pyodide / PyScript (Python in the browser).
- **Frontend Logic:** All logic must stay in Python. Avoid generating JavaScript unless explicitly asked for FFI (Foreign Function Interface) bridging.
- **API:** Wikimedia Action API + CirrusSearch for "Shuffle" mode.
- **Layout:** Responsive Masonry Grid (Pinterest-style).

## 💡 Quota Optimization Rules
- **Direct Execution:** Do not "think" or "plan" for more than one turn on CSS/HTML tweaks.
- **Flash-First:** If the task is purely descriptive (README, comments, documentation), use Gemini 3 Flash. 
- **No Refactors:** Never suggest "Global Refactors" unless specifically requested. Stick to localized file edits to minimize token exchange.
- **Brief Responses:** Keep chat responses concise. Focus on the code diffs rather than explaining the theory of Python.

## 🐍 PyScript Specifics
- Always use `<py-script>` tags or linked `.py` files.
- Remember to include necessary imports like `pyodide.http` or `js` for DOM interaction.
- **Infinite Scroll:** Implement using a scroll event listener in the Python logic that triggers a new `pyfetch` call when the user is ~200px from the bottom.

## 🔗 URL State Management
- All application states (category, mode, layout_type) MUST be reflected in URL parameters.
- Use the `js.window.location.search` bridge to read/write these states so views remain shareable.

## 🚫 Exclusions
- Do not suggest Node.js, React, or TypeScript alternatives. This is a pure Python-frontend project.