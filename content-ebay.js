// Content script for eBay Orders/Purchase History
// Captures order details: item name, quantity, price, tracking

(function() {
  'use strict';

  const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
  const isTrackingPage = window.location.pathname.includes('/ship/trk/');
  const isOrderDetailsPage = window.location.hostname === 'order.ebay.com';

  // Extract tracking from dedicated tracking page
  function extractTrackingFromPage() {
    console.log('Parcel Tracker: On eBay tracking page');

    const pageText = document.body.innerText;
    let trackingId = null;
    let carrier = null;

    // UPS tracking (1Z...)
    const upsMatch = pageText.match(/(1Z[A-Z0-9]{16})/);
    if (upsMatch) {
      trackingId = upsMatch[1];
      carrier = 'UPS';
    }

    // USPS tracking (starts with 9, 15-22 digits)
    if (!trackingId) {
      const uspsMatch = pageText.match(/\b(9[0-9]{15,21})\b/);
      if (uspsMatch) {
        trackingId = uspsMatch[1];
        carrier = 'USPS';
      }
    }

    // FedEx (12-15 or 20-22 digits)
    if (!trackingId) {
      const fedexMatch = pageText.match(/\b(\d{12,15})\b/) || pageText.match(/\b(\d{20,22})\b/);
      if (fedexMatch) {
        trackingId = fedexMatch[1];
        carrier = 'FedEx';
      }
    }

    // Get item ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const itemId = urlParams.get('itemid');
    const transId = urlParams.get('transid');

    if (trackingId) {
      console.log('Parcel Tracker: Found tracking on page:', trackingId, carrier);
      saveTrackingNumber(trackingId, carrier, itemId, transId);
    }
  }

  // Extract tracking and order info from order details page (order.ebay.com)
  function extractFromOrderDetailsPage() {
    console.log('Parcel Tracker: On eBay order details page');

    const pageText = document.body.innerText;
    let trackingId = null;
    let carrier = null;
    let itemName = null;
    let price = null;
    let orderId = null;

    // Get order number from URL or page
    const urlParams = new URLSearchParams(window.location.search);
    orderId = urlParams.get('orderId');

    // UPS tracking (1Z...)
    const upsMatch = pageText.match(/(1Z[A-Z0-9]{16})/);
    if (upsMatch) {
      trackingId = upsMatch[1];
      carrier = 'UPS';
    }

    // USPS tracking
    if (!trackingId) {
      const uspsMatch = pageText.match(/\b(9[0-9]{15,21})\b/);
      if (uspsMatch) {
        trackingId = uspsMatch[1];
        carrier = 'USPS';
      }
    }

    // FedEx
    if (!trackingId) {
      const fedexMatch = pageText.match(/\b(\d{12,15})\b/);
      if (fedexMatch && pageText.toLowerCase().includes('fedex')) {
        trackingId = fedexMatch[1];
        carrier = 'FedEx';
      }
    }

    // Extract item name - try multiple selectors for eBay order details page
    const itemSelectors = [
      'a[href*="/itm/"]',  // Item links
      '[data-test-id*="item"] a',
      '.item-title',
      '.line-item-title',
      'h3 a',
      'h4 a'
    ];

    for (const selector of itemSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.innerText.trim();
        // Make sure it's an actual product name (not navigation text)
        if (text && text.length > 10 && text.length < 300 && !/^(view|see|track|buy)/i.test(text)) {
          itemName = text;
          break;
        }
      }
    }

    // Extract price - look for the item price specifically
    const priceMatch = pageText.match(/\$([0-9,]+\.[0-9]{2})/);
    if (priceMatch) {
      price = priceMatch[1].replace(',', '');
    }

    console.log('Parcel Tracker: Order details - orderId:', orderId, 'tracking:', trackingId, 'item:', itemName);

    if (trackingId || itemName) {
      browserAPI.storage.local.get(['orders', 'trackingMap'], (result) => {
        const orders = result.orders || {};
        const trackingMap = result.trackingMap || {};

        // First, try to find an existing order with matching orderId
        let existingKey = null;
        for (const key in orders) {
          if (orders[key].orderId === orderId) {
            existingKey = key;
            break;
          }
        }

        // If not found by orderId, look for matching item name
        if (!existingKey && itemName) {
          for (const key in orders) {
            const orderItems = orders[key].items || [];
            for (const item of orderItems) {
              if (item.name && item.name.includes(itemName.substring(0, 20))) {
                existingKey = key;
                break;
              }
            }
            if (existingKey) break;
          }
        }

        // Use orderId as the primary key for new entries
        const key = existingKey || orderId || `ebay-${Date.now()}`;

        // Build order data
        const orderData = {
          orderId: orderId,
          source: 'ebay',
          lastUpdated: new Date().toISOString()
        };

        if (trackingId) {
          orderData.trackingId = trackingId;
          orderData.carrier = carrier;
        }

        if (itemName) {
          orderData.items = [{
            name: itemName,
            quantity: 1,
            price: price
          }];
        }

        if (price) {
          orderData.total = price;
        }

        // Merge with existing order, preserving existing items if we don't have new ones
        const existing = orders[key] || {};
        orders[key] = {
          ...existing,
          ...orderData,
          items: orderData.items && orderData.items.length > 0 ? orderData.items : (existing.items || [])
        };

        // If we had a different key before and found tracking, also delete the old entry
        if (existingKey && existingKey !== key) {
          // Copy data from old key to new key and delete old
          orders[key] = { ...orders[existingKey], ...orders[key] };
          delete orders[existingKey];
        }

        // Update tracking map
        if (trackingId) {
          trackingMap[trackingId] = {
            orderId: orderId || key,
            carrier: carrier,
            source: 'ebay',
            capturedAt: new Date().toISOString()
          };
        }

        browserAPI.storage.local.set({ orders, trackingMap }, () => {
          console.log('Parcel Tracker: Saved/merged order from details page, key:', key);
          const displayName = orders[key].items?.[0]?.name || trackingId || orderId;
          showNotification(`Captured: ${displayName.substring(0, 30)}... ${trackingId ? `(${carrier})` : ''}`);
        });
      });
    } else {
      console.log('Parcel Tracker: No tracking or item found on order details page');
    }
  }

  function saveTrackingNumber(trackingId, carrier, itemId, transId) {
    browserAPI.storage.local.get(['orders', 'trackingMap'], (result) => {
      const orders = result.orders || {};
      const trackingMap = result.trackingMap || {};

      // Try to find matching order by item ID
      let matchedKey = null;
      for (const key in orders) {
        if (orders[key].itemId === itemId || key.includes(itemId)) {
          matchedKey = key;
          break;
        }
      }

      // Update existing order or create tracking entry
      if (matchedKey) {
        orders[matchedKey].trackingId = trackingId;
        orders[matchedKey].carrier = carrier;
        orders[matchedKey].lastUpdated = new Date().toISOString();
      }

      // Always update tracking map
      trackingMap[trackingId] = {
        orderId: matchedKey || transId || itemId,
        carrier: carrier,
        source: 'ebay',
        itemId: itemId,
        capturedAt: new Date().toISOString()
      };

      browserAPI.storage.local.set({ orders, trackingMap }, () => {
        console.log('Parcel Tracker: Saved tracking number:', trackingId);
        showNotification(`Tracking captured: ${trackingId} (${carrier})`);
      });
    });
  }

  // Watch for modal dialogs containing tracking info
  function watchForTrackingModals() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Look for modal/dialog elements
            const isModal = node.matches && (
              node.matches('[role="dialog"]') ||
              node.matches('[class*="modal"]') ||
              node.matches('[class*="lightbox"]') ||
              node.matches('[class*="overlay"]')
            );

            if (isModal || node.querySelector) {
              const modalContent = isModal ? node : node.querySelector('[role="dialog"], [class*="modal"], [class*="lightbox"]');
              if (modalContent) {
                setTimeout(() => extractTrackingFromModal(modalContent), 500);
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function extractTrackingFromModal(modal) {
    const modalText = modal.innerText || '';
    console.log('Parcel Tracker: Checking modal for tracking...');

    let trackingId = null;
    let carrier = null;

    // UPS
    const upsMatch = modalText.match(/(1Z[A-Z0-9]{16})/);
    if (upsMatch) {
      trackingId = upsMatch[1];
      carrier = 'UPS';
    }

    // USPS
    if (!trackingId) {
      const uspsMatch = modalText.match(/\b(9[0-9]{15,21})\b/);
      if (uspsMatch) {
        trackingId = uspsMatch[1];
        carrier = 'USPS';
      }
    }

    // FedEx
    if (!trackingId) {
      const fedexMatch = modalText.match(/\b(\d{12,15})\b/);
      if (fedexMatch && modalText.toLowerCase().includes('fedex')) {
        trackingId = fedexMatch[1];
        carrier = 'FedEx';
      }
    }

    if (trackingId) {
      console.log('Parcel Tracker: Found tracking in modal:', trackingId, carrier);
      saveTrackingNumber(trackingId, carrier, null, null);
    }
  }

  function extractOrders() {
    const orders = [];
    const seenItems = new Set();

    console.log('Parcel Tracker: Scanning eBay page...');

    // Find all item links - these are the most reliable way to find items on eBay
    const itemLinks = document.querySelectorAll('a[href*="/itm/"]');
    console.log('Parcel Tracker: Found item links:', itemLinks.length);

    itemLinks.forEach(link => {
      // Get the item name from the link text or nearby elements
      let itemName = link.innerText.trim();

      // Skip if it's just a short label or navigation text
      if (!itemName || itemName.length < 10 || itemName.length > 500) {
        // Try to find item name in parent/sibling elements
        const parent = link.closest('[class*="item"], [class*="card"], [class*="order"], li, article, section');
        if (parent) {
          const titleEl = parent.querySelector('[class*="title"], h3, h4, .item-title');
          if (titleEl) {
            itemName = titleEl.innerText.trim();
          }
        }
      }

      // Clean up the item name
      itemName = itemName.replace(/\s+/g, ' ').trim();

      // Skip duplicates, short names, or navigation text
      if (!itemName || itemName.length < 10 || seenItems.has(itemName)) return;
      if (/^(view|see|track|buy|sell|bid|watch)/i.test(itemName)) return;

      seenItems.add(itemName);

      // Try to find associated data near this item
      const container = link.closest('li, tr, [class*="item"], [class*="card"], [class*="order"], article, section') || link.parentElement;
      const containerText = container ? container.innerText : '';

      // Extract price
      let price = null;
      const priceMatch = containerText.match(/\$([\d,]+\.\d{2})/);
      if (priceMatch) {
        price = priceMatch[1].replace(',', '');
      }

      // Extract quantity
      let quantity = 1;
      const qtyMatch = containerText.match(/(?:Qty|Quantity|x)\s*:?\s*(\d+)/i);
      if (qtyMatch) {
        quantity = parseInt(qtyMatch[1]);
      }

      // Extract tracking number if visible
      let trackingId = null;
      let carrier = null;

      // UPS
      const upsMatch = containerText.match(/(1Z[A-Z0-9]{16})/);
      if (upsMatch) {
        trackingId = upsMatch[1];
        carrier = 'UPS';
      }

      // USPS
      if (!trackingId) {
        const uspsMatch = containerText.match(/\b(9[0-9]{15,21})\b/);
        if (uspsMatch) {
          trackingId = uspsMatch[1];
          carrier = 'USPS';
        }
      }

      // FedEx (12-15 or 20-22 digits)
      if (!trackingId) {
        const fedexMatch = containerText.match(/\b(\d{12,15})\b/) || containerText.match(/\b(\d{20,22})\b/);
        if (fedexMatch) {
          trackingId = fedexMatch[1];
          carrier = 'FedEx';
        }
      }

      // Generic tracking pattern
      if (!trackingId) {
        const genericMatch = containerText.match(/(?:tracking|track)[:\s#]+([A-Z0-9]{10,30})/i);
        if (genericMatch) {
          trackingId = genericMatch[1];
        }
      }

      // Extract order ID if present
      let orderId = null;
      const orderMatch = containerText.match(/(\d{2}-\d{5}-\d{5})/);
      if (orderMatch) {
        orderId = orderMatch[1];
      }

      // Create the order object
      const order = {
        orderId: orderId,
        trackingId: trackingId,
        carrier: carrier,
        items: [{
          name: itemName,
          quantity: quantity,
          price: price
        }],
        total: price,
        source: 'ebay',
        lastUpdated: new Date().toISOString()
      };

      // Use orderId as primary key, fall back to tracking, then item name hash
      const key = orderId || trackingId || `ebay-${itemName.substring(0, 30).replace(/\W/g, '')}`;
      order._key = key;

      orders.push(order);
    });

    // Also scan for any tracking numbers we might have missed
    scanForTrackingNumbers(orders);

    console.log('Parcel Tracker: Extracted', orders.length, 'eBay items');
    return orders;
  }

  function scanForTrackingNumbers(existingOrders) {
    const pageText = document.body.innerText;
    const existingTracking = new Set(existingOrders.map(o => o.trackingId).filter(Boolean));

    // Look for tracking numbers in the page
    const patterns = [
      { regex: /(1Z[A-Z0-9]{16})/g, carrier: 'UPS' },
      { regex: /\b(9[0-9]{15,21})\b/g, carrier: 'USPS' },
      { regex: /(?:tracking|shipped)[:\s#]*([A-Z0-9]{12,30})/gi, carrier: null }
    ];

    patterns.forEach(({ regex, carrier }) => {
      let match;
      while ((match = regex.exec(pageText)) !== null) {
        const trackingId = match[1];
        if (!existingTracking.has(trackingId)) {
          console.log('Parcel Tracker: Found additional tracking:', trackingId);
          // Try to associate with an existing order without tracking
          const orderWithoutTracking = existingOrders.find(o => !o.trackingId);
          if (orderWithoutTracking) {
            orderWithoutTracking.trackingId = trackingId;
            orderWithoutTracking.carrier = carrier;
            existingTracking.add(trackingId);
          }
        }
      }
    });
  }

  function saveOrders(orders) {
    if (orders.length === 0) {
      showNotification('No eBay items found on this page');
      return;
    }

    browserAPI.storage.local.get(['orders', 'trackingMap'], (result) => {
      const existingOrders = result.orders || {};
      const trackingMap = result.trackingMap || {};
      let newCount = 0;
      let updatedCount = 0;

      orders.forEach(order => {
        const key = order._key || order.trackingId || order.orderId || `ebay-${Date.now()}-${Math.random()}`;
        delete order._key;

        const isNew = !existingOrders[key];

        // Merge with existing data
        existingOrders[key] = {
          ...existingOrders[key],
          ...order,
          // Keep existing items if new ones are empty
          items: order.items.length > 0 ? order.items : (existingOrders[key]?.items || []),
          lastUpdated: new Date().toISOString()
        };

        if (isNew) newCount++;
        else updatedCount++;

        // Update tracking map
        if (order.trackingId) {
          trackingMap[order.trackingId] = {
            orderId: order.orderId || key,
            carrier: order.carrier,
            source: 'ebay',
            capturedAt: new Date().toISOString()
          };
        }
      });

      browserAPI.storage.local.set({ orders: existingOrders, trackingMap }, () => {
        console.log('Parcel Tracker: Saved eBay orders. New:', newCount, 'Updated:', updatedCount);

        const trackingCount = orders.filter(o => o.trackingId).length;
        let msg = `${orders.length} eBay item(s) captured`;
        if (trackingCount > 0) {
          msg += ` (${trackingCount} with tracking)`;
        }
        showNotification(msg);
      });
    });
  }

  function showNotification(message) {
    let badge = document.getElementById('parcel-tracker-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'parcel-tracker-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #3665f3;
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

    badge.textContent = '📦 ' + message;
    badge.style.opacity = '1';

    setTimeout(() => {
      badge.style.opacity = '0';
    }, 4000);
  }

  function addCaptureButton() {
    if (document.getElementById('parcel-tracker-capture-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'parcel-tracker-capture-btn';
    btn.innerHTML = '📦 Capture eBay Items';
    btn.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: #3665f3;
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;

    btn.addEventListener('click', () => {
      const orders = extractOrders();
      console.log('Parcel Tracker: Captured eBay orders:', orders);
      saveOrders(orders);
    });

    document.body.appendChild(btn);
  }

  function init() {
    console.log('Parcel Tracker: eBay content script loaded on', window.location.href);

    if (isTrackingPage) {
      // On tracking detail page - extract tracking number
      setTimeout(() => {
        extractTrackingFromPage();
      }, 1500);
    } else if (isOrderDetailsPage) {
      // On order details page (order.ebay.com) - extract tracking and item info
      setTimeout(() => {
        extractFromOrderDetailsPage();
      }, 1500);
    } else {
      // On orders/purchase page - extract orders and watch for modals
      addCaptureButton();
      watchForTrackingModals();

      // Auto-extract after page loads
      setTimeout(() => {
        const orders = extractOrders();
        if (orders.length > 0) {
          saveOrders(orders);
        }
      }, 2500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
