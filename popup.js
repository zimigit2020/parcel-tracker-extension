// Popup script for Parcel Tracker

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search');
  const ordersList = document.getElementById('orders-list');
  const orderCount = document.getElementById('order-count');
  const trackingCount = document.getElementById('tracking-count');

  let allOrders = {};

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = tab.dataset.tab;
      document.getElementById('orders-view').style.display = tabName === 'orders' ? 'block' : 'none';
      document.getElementById('manual-view').classList.toggle('active', tabName === 'manual');
    });
  });

  // Load orders from storage
  function loadOrders() {
    chrome.storage.local.get(['orders', 'manualEntries'], (result) => {
      allOrders = result.orders || {};
      const manualEntries = result.manualEntries || {};

      // Merge manual entries
      Object.assign(allOrders, manualEntries);

      updateStats();
      renderOrders(allOrders);
    });
  }

  function updateStats() {
    const orders = Object.values(allOrders);
    orderCount.textContent = orders.length;
    trackingCount.textContent = orders.filter(o => o.trackingId).length;
  }

  function renderOrders(orders) {
    // Convert to array with keys preserved
    const ordersArray = Object.entries(orders).map(([key, order]) => ({
      ...order,
      _storageKey: key
    })).sort((a, b) => {
      // Sort by most recent first
      const dateA = new Date(a.lastUpdated || a.orderDate || 0);
      const dateB = new Date(b.lastUpdated || b.orderDate || 0);
      return dateB - dateA;
    });

    if (ordersArray.length === 0) {
      ordersList.innerHTML = `
        <div class="empty-state">
          <p>No orders captured yet</p>
          <small>Visit Amazon or eBay orders page to capture order data</small>
        </div>
      `;
      return;
    }

    ordersList.innerHTML = ordersArray.map(order => {
      const hasTracking = !!order.trackingId;
      const items = order.items || [];

      // Use the actual storage key for deletion
      const storageKey = order._storageKey;
      // Display: orderId, or storage key if it looks like an order ID, or source
      const displayId = order.orderId || (storageKey && !storageKey.startsWith('ebay-') ? storageKey : null);
      const sourceLabel = order.source === 'ebay' ? 'eBay Order' : (order.source === 'amazon' ? 'Amazon Order' : 'Manual Entry');

      return `
        <div class="order-card ${hasTracking ? 'has-tracking' : ''}" data-order-id="${storageKey}">
          <div class="order-header">
            <div class="order-header-left">
              <span class="order-id">${displayId || sourceLabel}</span>
              <span class="order-date">${order.orderDate || ''}</span>
            </div>
            <div class="order-header-right">
              <button class="delete-btn" data-delete="${storageKey}" title="Delete">×</button>
            </div>
          </div>

          <div class="order-items">
            ${items.length > 0 ? items.map(item => `
              <div class="order-item">
                ${item.name}
                ${item.quantity > 1 ? `<span class="item-qty">× ${item.quantity}</span>` : ''}
                ${item.price ? `<span class="item-qty">$${item.price}</span>` : ''}
              </div>
            `).join('') : '<div class="order-item" style="color:#86868b">No items captured</div>'}
          </div>

          ${order.total ? `<div class="order-total">Total: $${order.total}</div>` : ''}

          ${hasTracking ? `
            <div class="tracking-row">
              <span class="tracking-label">${order.carrier || 'Tracking'}:</span>
              <span class="tracking-number">${order.trackingId}</span>
              <button class="copy-btn" data-copy="${generateCopyText(order)}">Copy</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Add click handlers for copy buttons
    ordersList.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = btn.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 1500);
        });
      });
    });

    // Add click handlers for delete buttons
    ordersList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const orderKey = btn.dataset.delete;
        deleteOrder(orderKey);
      });
    });
  }

  // Delete a single order
  function deleteOrder(orderKey) {
    console.log('Deleting order:', orderKey);
    chrome.storage.local.get(['orders', 'manualEntries'], (result) => {
      const orders = result.orders || {};
      const manualEntries = result.manualEntries || {};

      // Remove from both stores
      delete orders[orderKey];
      delete manualEntries[orderKey];

      chrome.storage.local.set({ orders, manualEntries }, () => {
        console.log('Order deleted, reloading...');
        loadOrders();
      });
    });
  }

  // Clear all orders
  function clearAllOrders() {
    console.log('Clearing all orders...');
    chrome.storage.local.set({ orders: {}, manualEntries: {} }, () => {
      console.log('All orders cleared, reloading...');
      loadOrders();
    });
  }

  function generateCopyText(order) {
    const items = order.items || [];
    const lines = [];

    if (items.length > 0) {
      items.forEach(item => {
        lines.push(`${item.name}`);
        lines.push(`Qty: ${item.quantity || 1}`);
        if (item.price) {
          lines.push(`Value: $${item.price}`);
        }
      });
    }

    if (order.total && items.length === 0) {
      lines.push(`Value: $${order.total}`);
    }

    return lines.join('\n');
  }

  // Search functionality
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
      renderOrders(allOrders);
      return;
    }

    const filtered = {};
    Object.entries(allOrders).forEach(([key, order]) => {
      const searchableText = [
        order.orderId,
        order.trackingId,
        order.carrier,
        ...(order.items || []).map(i => i.name)
      ].filter(Boolean).join(' ').toLowerCase();

      if (searchableText.includes(query)) {
        filtered[key] = order;
      }
    });

    renderOrders(filtered);
  });

  // Manual entry save
  document.getElementById('save-manual').addEventListener('click', () => {
    const tracking = document.getElementById('manual-tracking').value.trim();
    const description = document.getElementById('manual-description').value.trim();
    const qty = parseInt(document.getElementById('manual-qty').value) || 1;
    const value = document.getElementById('manual-value').value.trim();

    if (!tracking) {
      alert('Please enter a tracking number');
      return;
    }

    chrome.storage.local.get(['manualEntries'], (result) => {
      const manualEntries = result.manualEntries || {};

      manualEntries[tracking] = {
        trackingId: tracking,
        items: [{
          name: description || 'Manual entry',
          quantity: qty,
          price: value
        }],
        total: value,
        lastUpdated: new Date().toISOString(),
        source: 'manual'
      };

      chrome.storage.local.set({ manualEntries }, () => {
        // Clear form
        document.getElementById('manual-tracking').value = '';
        document.getElementById('manual-description').value = '';
        document.getElementById('manual-qty').value = '1';
        document.getElementById('manual-value').value = '';

        // Switch to orders tab and reload
        document.querySelector('.tab[data-tab="orders"]').click();
        loadOrders();
      });
    });
  });

  // Clear all button
  document.getElementById('clear-all').addEventListener('click', clearAllOrders);

  // Initial load
  loadOrders();
});
