// Content script for Planet Express pages
// Auto-fills declaration forms when tracking number matches captured Amazon data

(function() {
  'use strict';

  // Browser API compatibility (Safari uses browser, Chrome uses chrome)
  const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

  const currentPath = window.location.pathname;
  const isDeclarationPage = currentPath.includes('/client/declaration/');
  const isDashboardPage = currentPath === '/client/' || currentPath === '/client' || currentPath.includes('/client/default');

  console.log('Parcel Tracker: Planet Express script loaded');
  console.log('Parcel Tracker: Path:', currentPath);
  console.log('Parcel Tracker: Is declaration:', isDeclarationPage);
  console.log('Parcel Tracker: Is dashboard:', isDashboardPage);

  // Always show we're active
  function showActiveIndicator() {
    let indicator = document.getElementById('parcel-tracker-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'parcel-tracker-indicator';
      indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #232f3e;
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `;
      indicator.textContent = '📦 Parcel Tracker Active';
      document.body.appendChild(indicator);

      // Fade out after 3 seconds
      setTimeout(() => {
        indicator.style.transition = 'opacity 0.5s';
        indicator.style.opacity = '0.3';
      }, 3000);
    }
  }

  function showNotification(message, color = '#4CAF50') {
    let badge = document.getElementById('parcel-tracker-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'parcel-tracker-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${color};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: opacity 0.3s;
      `;
      document.body.appendChild(badge);
    }

    badge.style.background = color;
    badge.textContent = '📦 ' + message;
    badge.style.opacity = '1';

    setTimeout(() => {
      badge.style.opacity = '0';
    }, 5000);
  }

  // Extract package ID from declaration URL
  function getPackageIdFromUrl() {
    // URL format: /client/declaration/default/12345
    const match = currentPath.match(/\/client\/declaration\/\w+\/(\d+)/);
    return match ? match[1] : null;
  }

  // On dashboard: scan for packages and their tracking numbers
  function scanDashboardPackages() {
    console.log('Parcel Tracker: Scanning dashboard for packages...');

    const packageMap = {};
    const pageText = document.body.innerText;
    const pageHtml = document.body.innerHTML;

    // Look for tracking numbers with various patterns
    const trackingPatterns = [
      /IN\s*Tracking\s*#?:?\s*(TBA\d{12,})/gi,
      /IN\s*Tracking\s*#?:?\s*(1Z[A-Z0-9]{16})/gi,
      /IN\s*Tracking\s*#?:?\s*([A-Z0-9]{12,30})/gi,
      /Tracking[:\s]+(TBA\d{12,})/gi,
      /Tracking[:\s]+(1Z[A-Z0-9]{16})/gi
    ];

    const foundTracking = new Set();

    for (const pattern of trackingPatterns) {
      let match;
      while ((match = pattern.exec(pageText)) !== null) {
        foundTracking.add(match[1]);
      }
    }

    console.log('Parcel Tracker: Found tracking numbers on dashboard:', Array.from(foundTracking));

    // Look for declaration links and try to associate with tracking numbers
    const declarationLinks = document.querySelectorAll('a[href*="/client/declaration/"]');
    console.log('Parcel Tracker: Found declaration links:', declarationLinks.length);

    declarationLinks.forEach(link => {
      const href = link.getAttribute('href');
      const packageIdMatch = href.match(/\/client\/declaration\/\w+\/(\d+)/);
      if (packageIdMatch) {
        const packageId = packageIdMatch[1];

        // Try to find tracking number near this link
        const row = link.closest('tr, .package-row, .card, [class*="package"], [class*="row"]');
        if (row) {
          const rowText = row.innerText;
          for (const pattern of trackingPatterns) {
            pattern.lastIndex = 0;
            const trackingMatch = pattern.exec(rowText);
            if (trackingMatch) {
              packageMap[packageId] = trackingMatch[1];
              console.log('Parcel Tracker: Mapped package', packageId, 'to tracking', trackingMatch[1]);
              break;
            }
          }
        }
      }
    });

    // Store the mapping
    if (Object.keys(packageMap).length > 0) {
      browserAPI.storage.local.set({ planetExpressPackages: packageMap }, () => {
        console.log('Parcel Tracker: Saved package mappings:', packageMap);
        showNotification(`Found ${Object.keys(packageMap).length} packages with tracking`, '#232f3e');
      });
    }

    // Also highlight packages that match our stored orders
    highlightMatchingPackages(foundTracking);
  }

  function highlightMatchingPackages(trackingNumbers) {
    browserAPI.storage.local.get(['orders', 'manualEntries', 'trackingMap'], (result) => {
      const orders = result.orders || {};
      const manualEntries = result.manualEntries || {};
      const trackingMap = result.trackingMap || {};
      const allOrders = { ...orders, ...manualEntries };

      let matchCount = 0;

      trackingNumbers.forEach(tracking => {
        // Check if we have this tracking number (case-insensitive)
        let hasMatch = false;
        const trackingUpper = tracking.toUpperCase();

        for (const key in trackingMap) {
          if (key.toUpperCase() === trackingUpper) {
            hasMatch = true;
            break;
          }
        }

        if (!hasMatch) {
          for (const orderId in allOrders) {
            if (allOrders[orderId].trackingId && allOrders[orderId].trackingId.toUpperCase() === trackingUpper) {
              hasMatch = true;
              break;
            }
          }
        }

        if (hasMatch) {
          matchCount++;
          // Try to highlight the tracking number on the page
          highlightTrackingNumber(tracking);
        }
      });

      if (matchCount > 0) {
        showNotification(`${matchCount} package(s) match your Amazon orders!`, '#4CAF50');
      }
    });
  }

  function highlightTrackingNumber(tracking) {
    // Find and highlight elements containing this tracking number
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    while (walker.nextNode()) {
      if (walker.currentNode.textContent.includes(tracking)) {
        const parent = walker.currentNode.parentElement;
        if (parent && !parent.classList.contains('parcel-tracker-highlighted')) {
          parent.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
          parent.style.borderLeft = '3px solid #4CAF50';
          parent.style.paddingLeft = '5px';
          parent.classList.add('parcel-tracker-highlighted');
        }
      }
    }
  }

  // On declaration page: try to auto-fill
  function handleDeclarationPage() {
    console.log('Parcel Tracker: On declaration page');

    const packageId = getPackageIdFromUrl();
    console.log('Parcel Tracker: Package ID from URL:', packageId);

    // First try to find tracking number on the page itself
    let trackingNumber = findTrackingNumberOnPage();

    // If not found, look up from our stored mapping
    if (!trackingNumber && packageId) {
      browserAPI.storage.local.get(['planetExpressPackages'], (result) => {
        const packages = result.planetExpressPackages || {};
        trackingNumber = packages[packageId];
        console.log('Parcel Tracker: Tracking from stored mapping:', trackingNumber);

        if (trackingNumber) {
          lookupAndShowButton(trackingNumber);
        } else {
          showNotification('Visit dashboard first to link packages', '#666');
        }
      });
    } else if (trackingNumber) {
      lookupAndShowButton(trackingNumber);
    } else {
      showNotification('No tracking number found - visit dashboard first', '#666');
    }
  }

  function findTrackingNumberOnPage() {
    const pageText = document.body.innerText;

    const patterns = [
      /(TBA\d{12,})/i,
      /(1Z[A-Z0-9]{16})/i,
      /Tracking[:\s#]+([A-Z0-9]{10,30})/i
    ];

    for (const pattern of patterns) {
      const match = pageText.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  function lookupAndShowButton(trackingNumber) {
    console.log('Parcel Tracker: Looking up order for tracking:', trackingNumber);

    browserAPI.storage.local.get(['orders', 'manualEntries', 'trackingMap'], (result) => {
      const orders = result.orders || {};
      const manualEntries = result.manualEntries || {};
      const trackingMap = result.trackingMap || {};
      const allOrders = { ...orders, ...manualEntries };

      let matchingOrder = null;
      const trackingUpper = trackingNumber.toUpperCase();

      // Check tracking map first (case-insensitive)
      for (const key in trackingMap) {
        if (key.toUpperCase() === trackingUpper) {
          const orderId = trackingMap[key].orderId;
          if (allOrders[orderId]) {
            matchingOrder = allOrders[orderId];
            break;
          }
        }
      }

      // Search through orders (case-insensitive)
      if (!matchingOrder) {
        for (const orderId in allOrders) {
          if (allOrders[orderId].trackingId && allOrders[orderId].trackingId.toUpperCase() === trackingUpper) {
            matchingOrder = allOrders[orderId];
            break;
          }
        }
      }

      if (matchingOrder) {
        console.log('Parcel Tracker: Found matching order:', matchingOrder);
        addAutoFillButton(matchingOrder);
        showNotification('Found matching order! Click button to auto-fill.', '#4CAF50');
      } else {
        console.log('Parcel Tracker: No matching order for', trackingNumber);
        showNotification('Tracking found but no matching Amazon order', '#ff9800');
      }
    });
  }

  function addAutoFillButton(order) {
    if (document.getElementById('parcel-tracker-autofill-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'parcel-tracker-autofill-btn';

    const itemCount = order.items?.length || 0;
    const itemName = order.items?.[0]?.name || 'Unknown item';
    const shortName = itemName.length > 40 ? itemName.substring(0, 40) + '...' : itemName;

    btn.innerHTML = `📦 Auto-Fill: ${shortName}`;
    btn.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: #ff9900;
      color: #111;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      max-width: 400px;
      text-align: left;
    `;

    btn.addEventListener('click', () => {
      fillDeclarationForm(order);
    });

    btn.title = `${itemCount} item(s): ${order.items?.map(i => i.name).join(', ') || 'No items'}`;
    document.body.appendChild(btn);
  }

  function fillDeclarationForm(order) {
    if (!order || !order.items || order.items.length === 0) {
      showNotification('No items to fill', '#f44336');
      return;
    }

    const firstItem = order.items[0];
    console.log('Parcel Tracker: Filling form with:', firstItem);

    // Find all text inputs on the page
    const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea');
    console.log('Parcel Tracker: Found inputs:', inputs.length);

    let filled = false;

    inputs.forEach((input, index) => {
      const placeholder = (input.placeholder || '').toLowerCase();
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const label = input.closest('label')?.innerText?.toLowerCase() || '';

      // Also check preceding label
      const prevLabel = input.previousElementSibling?.innerText?.toLowerCase() || '';
      const parentText = input.parentElement?.innerText?.toLowerCase() || '';

      const allContext = `${placeholder} ${name} ${id} ${label} ${prevLabel} ${parentText}`;

      console.log('Parcel Tracker: Input', index, 'context:', allContext.substring(0, 100));

      if (allContext.includes('description') || allContext.includes('item') || (index === 0 && !input.value)) {
        fillField(input, firstItem.name);
        filled = true;
      } else if (allContext.includes('qty') || allContext.includes('quantity')) {
        fillField(input, firstItem.quantity || 1);
        filled = true;
      } else if (allContext.includes('value') || allContext.includes('price') || allContext.includes('$')) {
        fillField(input, firstItem.price || order.total || '');
        filled = true;
      }
    });

    if (filled) {
      showNotification('Form filled! Review and save.', '#4CAF50');
      if (order.items.length > 1) {
        setTimeout(() => {
          showNotification(`Note: ${order.items.length - 1} more item(s) - use Add Item`, '#2196F3');
        }, 2000);
      }
    } else {
      showNotification('Could not find form fields', '#f44336');
    }
  }

  function fillField(field, value) {
    if (!field || value === undefined || value === null) return;

    console.log('Parcel Tracker: Filling field with:', value);

    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function init() {
    // Always show we're active
    showActiveIndicator();

    // Wait for page to fully load
    setTimeout(() => {
      if (isDashboardPage) {
        scanDashboardPackages();
      } else if (isDeclarationPage) {
        handleDeclarationPage();
      } else {
        console.log('Parcel Tracker: On other Planet Express page');
      }
    }, 1500);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
