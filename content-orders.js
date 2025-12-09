// Content script for Amazon Orders page
// Captures order details: item name, quantity, price, order ID, order date

(function() {
  'use strict';

  // Debounce to avoid multiple rapid calls
  let debounceTimer;

  function debounce(func, wait) {
    return function(...args) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function extractOrders() {
    const orders = [];

    // Find all order cards - Amazon uses various class patterns
    const orderCards = document.querySelectorAll('.order-card, [class*="order-card"], .a-box-group.order');

    // Also try the newer Amazon UI structure
    const orderContainers = document.querySelectorAll('[data-component="orderCard"], .order-info, .js-order-card');

    // Combine and deduplicate
    const allOrderElements = new Set([...orderCards, ...orderContainers]);

    // Fallback: find by order ID pattern
    if (allOrderElements.size === 0) {
      // Look for elements containing order IDs
      const allText = document.body.innerText;
      const orderIdMatches = allText.match(/\d{3}-\d{7}-\d{7}/g);
      if (orderIdMatches) {
        console.log('Parcel Tracker: Found order IDs via text search:', orderIdMatches);
      }
    }

    // Try to parse the page structure we saw in Playwright
    // Look for order sections by finding Order # text
    const pageText = document.body.innerHTML;
    const orderSections = document.querySelectorAll('.a-box-group, .order-card, [class*="OrderCard"]');

    orderSections.forEach(section => {
      try {
        const order = extractOrderFromSection(section);
        if (order && order.orderId) {
          orders.push(order);
        }
      } catch (e) {
        console.log('Parcel Tracker: Error parsing order section', e);
      }
    });

    // If no orders found with structured approach, try text-based extraction
    if (orders.length === 0) {
      const textBasedOrders = extractOrdersFromText();
      orders.push(...textBasedOrders);
    }

    return orders;
  }

  function extractOrderFromSection(section) {
    const order = {
      orderId: null,
      orderDate: null,
      total: null,
      items: []
    };

    const sectionText = section.innerText;
    const sectionHtml = section.innerHTML;

    // Extract Order ID (format: 111-1234567-1234567)
    const orderIdMatch = sectionText.match(/(?:Order\s*#?\s*)?(\d{3}-\d{7}-\d{7})/);
    if (orderIdMatch) {
      order.orderId = orderIdMatch[1];
    }

    // Extract Order Date
    const datePatterns = [
      /(?:Order placed|Ordered on)\s*([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/i,
      /([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})/
    ];
    for (const pattern of datePatterns) {
      const dateMatch = sectionText.match(pattern);
      if (dateMatch) {
        order.orderDate = dateMatch[1];
        break;
      }
    }

    // Extract Total
    const totalMatch = sectionText.match(/(?:Order Total|Total)[:\s]*\$?([\d,]+\.?\d*)/i);
    if (totalMatch) {
      order.total = totalMatch[1];
    }

    // Extract Items - look for product links
    const itemLinks = section.querySelectorAll('a[href*="/gp/product/"], a[href*="/dp/"]');
    const seenItems = new Set();

    itemLinks.forEach(link => {
      const itemName = link.innerText.trim();
      if (itemName && itemName.length > 5 && !seenItems.has(itemName)) {
        seenItems.add(itemName);

        // Try to find quantity near this item
        let quantity = 1;
        const parent = link.closest('.a-row, .a-column, [class*="item"], [class*="product"]');
        if (parent) {
          const qtyMatch = parent.innerText.match(/(?:Qty|Quantity)[:\s]*(\d+)/i);
          if (qtyMatch) {
            quantity = parseInt(qtyMatch[1]);
          }
        }

        // Try to find item price
        let price = null;
        if (parent) {
          const priceMatch = parent.innerText.match(/\$(\d+\.?\d*)/);
          if (priceMatch) {
            price = priceMatch[1];
          }
        }

        order.items.push({
          name: itemName,
          quantity: quantity,
          price: price
        });
      }
    });

    return order;
  }

  function extractOrdersFromText() {
    const orders = [];
    const text = document.body.innerText;

    // Find all order IDs
    const orderIdRegex = /(\d{3}-\d{7}-\d{7})/g;
    let match;
    const orderIds = [];

    while ((match = orderIdRegex.exec(text)) !== null) {
      if (!orderIds.includes(match[1])) {
        orderIds.push(match[1]);
      }
    }

    // For each order ID, try to extract nearby information
    orderIds.forEach(orderId => {
      orders.push({
        orderId: orderId,
        orderDate: null,
        total: null,
        items: [],
        note: 'Extracted from page text - click into order for full details'
      });
    });

    return orders;
  }

  function saveOrders(orders) {
    if (orders.length === 0) return;

    // Get existing orders from storage
    chrome.storage.local.get(['orders'], (result) => {
      const existingOrders = result.orders || {};

      // Merge new orders
      orders.forEach(order => {
        if (order.orderId) {
          // Merge with existing if present, prefer newer data
          existingOrders[order.orderId] = {
            ...existingOrders[order.orderId],
            ...order,
            items: order.items.length > 0 ? order.items : (existingOrders[order.orderId]?.items || []),
            source: 'amazon',
            lastUpdated: new Date().toISOString()
          };
        }
      });

      chrome.storage.local.set({ orders: existingOrders }, () => {
        console.log('Parcel Tracker: Saved', Object.keys(existingOrders).length, 'orders');
        showNotification(orders.length + ' orders captured');
      });
    });
  }

  function showNotification(message) {
    // Create a small notification badge
    let badge = document.getElementById('parcel-tracker-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'parcel-tracker-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #232f3e;
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

    badge.textContent = '📦 Parcel Tracker: ' + message;
    badge.style.opacity = '1';

    setTimeout(() => {
      badge.style.opacity = '0';
    }, 3000);
  }

  // Add capture button to page
  function addCaptureButton() {
    if (document.getElementById('parcel-tracker-capture-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'parcel-tracker-capture-btn';
    btn.innerHTML = '📦 Capture Orders';
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
    `;

    btn.addEventListener('click', () => {
      const orders = extractOrders();
      console.log('Parcel Tracker: Extracted orders:', orders);
      saveOrders(orders);
    });

    document.body.appendChild(btn);
  }

  // Initialize
  function init() {
    console.log('Parcel Tracker: Orders page content script loaded');
    addCaptureButton();

    // Auto-extract on page load with delay
    setTimeout(() => {
      const orders = extractOrders();
      if (orders.length > 0) {
        saveOrders(orders);
      }
    }, 2000);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also watch for dynamic content changes (infinite scroll, etc)
  const observer = new MutationObserver(debounce(() => {
    const orders = extractOrders();
    if (orders.length > 0) {
      saveOrders(orders);
    }
  }, 1000));

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();
