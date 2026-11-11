# FrontDesk Pro website

Static site (Cloudflare Pages). No build step.

## Fill in your details — one file
Edit `assets/config.js`:
- `contactName`, `email`, `phone`, `abn` — shown on Contact page + footers (empty = hidden)
- `demoLine` — your Retell number; adds "Call our AI receptionist" buttons
- `bookingLink` — Cal.com link without https://cal.com/ (e.g. `yourname/demo`). Empty = request-a-time form
- `formAccessKey` — free key from web3forms.com so forms email you. Empty = forms open the visitor's email app
