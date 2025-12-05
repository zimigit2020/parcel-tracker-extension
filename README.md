# Parcel Tracker

A Safari browser extension that captures order details and tracking numbers from Amazon and eBay for Planet Express customs declarations.

## Features

- **Amazon Support**: Captures orders from Amazon order history and tracking pages
- **eBay Support**: Captures orders from eBay purchase history and order details pages
- **Tracking Detection**: Automatically detects UPS, USPS, and FedEx tracking numbers
- **Planet Express Integration**: Auto-fills customs declaration forms
- **Manual Entry**: Add tracking numbers manually when needed
- **Search**: Find orders by tracking number, order ID, or item name

## Installation

### Safari (macOS)

1. Clone this repository
2. Convert to Safari extension:
   ```bash
   xcrun safari-web-extension-converter /path/to/parcel-tracker-extension \
     --project-location /path/to/output \
     --app-name "Parcel Tracker" \
     --bundle-identifier "com.yourname.Parcel-Tracker" \
     --macos-only
   ```
3. Open the generated Xcode project and build
4. Enable the extension in Safari Settings > Extensions

### Chrome/Firefox

Load as an unpacked extension from the source directory.

## Usage

1. **Capture Orders**: Visit your Amazon or eBay orders page - orders are captured automatically
2. **View Tracking**: Click the extension icon to see captured orders and tracking numbers
3. **Copy for Declarations**: Use the Copy button to copy order details for customs forms
4. **Planet Express**: Visit Planet Express declaration page for auto-fill support

## Files

- `manifest.json` - Extension manifest (Manifest V3)
- `popup.html/js` - Extension popup UI
- `content-orders.js` - Amazon orders page content script
- `content-tracking.js` - Amazon tracking page content script
- `content-ebay.js` - eBay content script
- `content-planetexpress.js` - Planet Express auto-fill script
- `background.js` - Background service worker

## Supported Sites

- Amazon.com (orders and tracking pages)
- eBay.com (purchase history, order details, tracking)
- PlanetExpress.com (customs declaration auto-fill)

## License

MIT
